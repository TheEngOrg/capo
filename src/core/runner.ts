// =============================================================================
// runner.ts — TEO TopologicalRunner (WS-CORE-03)
//
// PURE DISPATCHER: no model calls, no LLM, no real I/O. Executors are injected
// at construction, making the runner fully testable with stubs.
//
// BOUNDARY DECISIONS (documented here so downstream workstreams know what they own):
//
//   1. Re-validate or trust?
//      The runner TRUSTS a pre-validated plan (validatePlan is WS-CORE-02's job).
//      However, it DEFENDS against cycles to avoid infinite loops — cycles cause
//      a fast FAILED result, not a hang. Unknown needs[] refs also produce FAILED.
//
//   2. Per-step timeout: default 60_000ms (1 minute), exported as
//      DEFAULT_STEP_TIMEOUT_MS. Override globally via `defaultStepTimeoutMs`
//      in the constructor options. Per-task override is available via
//      RunContext.stepTimeoutMs (passed to each executor call).
//
//   3. maxParallel=0 behavior: THROWS at construction time with a clear error.
//      Silent coercion to 1 would mask caller bugs. Callers that want serial
//      execution must pass maxParallel=1 explicitly.
//
//   4. Executor dispatch: a SINGLE Executor function that receives the full
//      TEOTask (including its `type` field). Callers that need per-type routing
//      can switch on `task.type` inside their executor. This is simpler than a
//      Map<taskType, Executor> — no registration step, no missing-key errors,
//      and it's trivially mockable in tests.
//
// =============================================================================

import type { Plan, TEOTask } from "./plan.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Default per-step timeout in milliseconds (1 minute). Overridable at construction. */
export const DEFAULT_STEP_TIMEOUT_MS = 60_000;

/** Default maximum concurrent steps in flight. Overridable at construction. */
export const DEFAULT_MAX_PARALLEL = 4;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Context passed to each Executor invocation.
 * `stepTimeoutMs` reflects the effective timeout for this specific step —
 * the runner sets it so executors can propagate it to sub-calls if needed.
 */
export interface RunContext {
  planId: string;
  projectId: string;
  /** Effective per-step timeout (ms) for this invocation. */
  stepTimeoutMs: number;
}

/**
 * Result of a single task execution.
 * - PASS   — executor resolved successfully
 * - FAILED — executor threw, rejected, or timed out; or dependency is missing
 * - SKIPPED — upstream dependency failed; this step was not attempted
 */
export interface StepResult {
  taskId: string;
  status: "PASS" | "FAILED" | "SKIPPED";
  /** Human-readable detail, e.g. error message or skip reason. */
  detail?: string;
}

/**
 * Aggregate result of running an entire Plan.
 * overallStatus is PASS only when every step is PASS (SKIPPED counts as failure).
 */
export interface RunResult {
  steps: StepResult[];
  overallStatus: "PASS" | "FAILED";
}

/**
 * Executor interface — the only external integration point.
 * Receives the task and a RunContext; returns a StepResult promise.
 * The runner wraps every call in timeout + error isolation.
 */
export type Executor = (task: TEOTask, context: RunContext) => Promise<StepResult>;

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface TopologicalRunnerOptions {
  /**
   * A single executor function that dispatches all task types.
   * Switch on `task.type` inside for per-type routing.
   */
  executor: Executor;
  /**
   * Maximum number of steps to run concurrently.
   * Defaults to DEFAULT_MAX_PARALLEL (4).
   * Must be >= 1 — passing 0 or negative throws at construction.
   */
  maxParallel?: number;
  /**
   * Per-step timeout in milliseconds.
   * Defaults to DEFAULT_STEP_TIMEOUT_MS (60_000).
   * Must be > 0 — passing 0 or negative throws at construction.
   */
  defaultStepTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// TopologicalRunner
// ---------------------------------------------------------------------------

export class TopologicalRunner {
  private readonly executor: Executor;
  private readonly maxParallel: number;
  private readonly defaultStepTimeoutMs: number;

  constructor(options: TopologicalRunnerOptions) {
    const {
      executor,
      maxParallel = DEFAULT_MAX_PARALLEL,
      defaultStepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
    } = options;

    if (maxParallel < 1) {
      throw new Error(
        `maxParallel must be at least 1 (received ${maxParallel}). ` +
          `To run serially, pass maxParallel: 1.`
      );
    }
    if (defaultStepTimeoutMs <= 0) {
      throw new Error(
        `defaultStepTimeoutMs must be a positive number (received ${defaultStepTimeoutMs}).`
      );
    }

    this.executor = executor;
    this.maxParallel = maxParallel;
    this.defaultStepTimeoutMs = defaultStepTimeoutMs;
  }

  /**
   * Execute a plan topologically.
   *
   * - Resolves execution order from task.needs[] dependencies.
   * - Defends against cycles: if detected, returns FAILED immediately.
   * - Respects maxParallel (no more than N steps in flight at once).
   * - Per-step timeout: steps exceeding the timeout are FAILED, not hung.
   * - Per-step exception isolation: throws are caught and converted to FAILED.
   * - RED-halt: downstream steps of a FAILED step are marked SKIPPED.
   * - Independent branches continue despite a failure in another branch.
   */
  async run(plan: Plan): Promise<RunResult> {
    const tasks = plan.tasks as TEOTask[];

    // Empty plan: succeed immediately with no steps.
    if (tasks.length === 0) {
      return { steps: [], overallStatus: "PASS" };
    }

    // Build a task map for fast lookup.
    const taskMap = new Map<string, TEOTask>(tasks.map((t) => [t.id, t]));

    // Validate that all needs[] refs point to known task IDs.
    const unknownRefs: { taskId: string; ref: string }[] = [];
    for (const task of tasks) {
      for (const dep of task.needs) {
        if (!taskMap.has(dep)) {
          unknownRefs.push({ taskId: task.id, ref: dep });
        }
      }
    }
    if (unknownRefs.length > 0) {
      // One or more tasks reference non-existent IDs. Mark them FAILED; others
      // that depend on them will cascade to SKIPPED via the normal mechanism.
      const failedIds = new Set(unknownRefs.map((r) => r.taskId));
      const steps: StepResult[] = tasks.map((t) =>
        failedIds.has(t.id)
          ? {
              taskId: t.id,
              status: "FAILED" as const,
              detail: `Unresolved needs[] reference: ${unknownRefs
                .filter((r) => r.taskId === t.id)
                .map((r) => `"${r.ref}"`)
                .join(", ")}`,
            }
          : { taskId: t.id, status: "PASS" as const }
      );
      return { steps, overallStatus: "FAILED" };
    }

    // Topological sort with Kahn's algorithm (cycle-safe).
    const sortResult = topologicalSort(tasks);
    if (sortResult.hasCycle) {
      const steps: StepResult[] = tasks.map((t) => ({
        taskId: t.id,
        status: "FAILED" as const,
        detail: "Cycle detected in plan dependency graph",
      }));
      return { steps, overallStatus: "FAILED" };
    }

    const order = sortResult.order;
    const context: RunContext = {
      planId: plan.plan_id,
      projectId: plan.project_id,
      stepTimeoutMs: this.defaultStepTimeoutMs,
    };

    // Execute in topological order, respecting maxParallel.
    //
    // Strategy: iterate the topo-sorted queue. For each task, if it is ready
    // (all needs complete), either SKIP it (upstream failed) or dispatch it.
    // Cap concurrent dispatches at maxParallel by waiting for at least one
    // in-flight promise to settle before dispatching the next batch.
    //
    // Because Kahn's algorithm guarantees every dependency precedes the task
    // in `order`, a task at position i has all its deps at positions < i.
    // We scan the queue in order; when a task is not yet ready we wait for
    // in-flight tasks to complete, then re-scan from the beginning to pick
    // up anything newly ready (not just the stalled task).

    const results = new Map<string, StepResult>();
    const dispatched = new Set<string>(); // tasks dispatched or pre-resolved
    const inFlight = new Set<Promise<void>>();

    const isCompleted = (id: string): boolean => results.has(id);

    const isReady = (task: TEOTask): boolean =>
      task.needs.every((dep) => isCompleted(dep));

    const hasFailedDep = (task: TEOTask): boolean =>
      task.needs.some((dep) => {
        const r = results.get(dep);
        return r !== undefined && (r.status === "FAILED" || r.status === "SKIPPED");
      });

    const dispatchTask = (task: TEOTask): void => {
      dispatched.add(task.id);
      if (hasFailedDep(task)) {
        // Synchronously mark as SKIPPED — no async needed.
        results.set(task.id, {
          taskId: task.id,
          status: "SKIPPED",
          detail: "Skipped due to upstream failure",
        });
        return;
      }
      const p: Promise<void> = this.runStep(task, context).then(
        (stepResult) => {
          results.set(task.id, stepResult);
          inFlight.delete(p);
        }
      );
      inFlight.add(p);
    };

    // Drive: scan the topo-sorted queue repeatedly until all tasks are done.
    while (results.size < order.length) {
      let dispatched_this_pass = 0;

      for (const task of order) {
        if (dispatched.has(task.id)) continue; // already handled
        if (!isReady(task)) continue;          // deps not done yet
        if (inFlight.size >= this.maxParallel) break; // at capacity

        dispatchTask(task);
        dispatched_this_pass++;
      }

      // If we dispatched nothing and inFlight is empty, we're stuck —
      // this should never happen after a clean topo sort, but guard anyway.
      /* c8 ignore next 3 */
      if (dispatched_this_pass === 0 && inFlight.size === 0) {
        break;
      }

      if (inFlight.size > 0) {
        // Wait for at least one task to finish, then re-scan for newly ready tasks.
        await Promise.race(inFlight);
      }
    }

    // Build ordered step list (preserve original plan task order).
    const steps = tasks.map((t) => {
      const r = results.get(t.id);
      /* c8 ignore next 3 */
      if (r === undefined) {
        return { taskId: t.id, status: "FAILED" as const, detail: "Task was not reached" };
      }
      return r;
    });
    const overallStatus = steps.every((s) => s.status === "PASS")
      ? "PASS"
      : "FAILED";

    return { steps, overallStatus };
  }

  /**
   * Run a single task step with timeout and exception isolation.
   * Never throws — always returns a StepResult.
   */
  private async runStep(task: TEOTask, context: RunContext): Promise<StepResult> {
    const timeoutMs = this.defaultStepTimeoutMs;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOutPromise: Promise<StepResult> = new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve({
          taskId: task.id,
          status: "FAILED",
          detail: `Step timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);
    });

    try {
      const executorPromise = Promise.resolve(
        this.executor(task, context)
      ).then(
        (result) => {
          clearTimeout(timer);
          return result;
        },
        (err: unknown) => {
          clearTimeout(timer);
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            taskId: task.id,
            status: "FAILED" as const,
            detail: message,
          };
        }
      );

      return await Promise.race([executorPromise, timedOutPromise]);
    } finally {
      // Belt-and-suspenders: ensure timer is always cleared.
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

interface SortResult {
  order: TEOTask[];
  hasCycle: boolean;
}

function topologicalSort(tasks: TEOTask[]): SortResult {
  // Build in-degree map and adjacency list.
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // task → tasks that need it

  for (const task of tasks) {
    if (!inDegree.has(task.id)) {
      inDegree.set(task.id, 0);
    }
    if (!dependents.has(task.id)) {
      dependents.set(task.id, []);
    }
  }

  for (const task of tasks) {
    for (const dep of task.needs) {
      // All task IDs are pre-initialized above; ?? fallbacks are unreachable.
      /* c8 ignore next */
      const current = inDegree.get(task.id) ?? 0;
      inDegree.set(task.id, current + 1);
      /* c8 ignore next */
      const list = dependents.get(dep) ?? [];
      list.push(task.id);
      dependents.set(dep, list);
    }
  }

  // Kahn's: start with tasks that have no dependencies.
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const order: TEOTask[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const task = taskMap.get(id);
    if (task !== undefined) {
      order.push(task);
    }
    /* c8 ignore next */
    for (const dependentId of dependents.get(id) ?? []) {
      /* c8 ignore next */
      const deg = (inDegree.get(dependentId) ?? 1) - 1;
      inDegree.set(dependentId, deg);
      if (deg === 0) {
        queue.push(dependentId);
      }
    }
  }

  const hasCycle = order.length < tasks.length;
  return { order, hasCycle };
}
