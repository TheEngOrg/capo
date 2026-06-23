import { describe, it, expect } from "vitest";
import {
  TopologicalRunner,
  type Executor,
  type RunContext,
  type StepResult,
  DEFAULT_STEP_TIMEOUT_MS,
  DEFAULT_MAX_PARALLEL,
} from "./runner.js";
import type { Plan, TEOTask } from "./plan.js";

// =============================================================================
// runner.test.ts — exhaustive tests for src/core/runner.ts
//
// Ordering: misuse → boundary → golden path (per ADR-064 critical-path policy)
// This module is on the critical path; 100% coverage is required.
// =============================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Plan with the given tasks. */
function makePlan(tasks: TEOTask[]): Plan {
  return {
    plan_id: "plan-test",
    project_id: "proj-test",
    created_at: "2026-06-18T00:00:00Z",
    version: "1",
    tasks,
  };
}

/** Build a SCRIPT TEOTask. */
function makeTask(id: string, needs: string[] = [], overrides?: Partial<TEOTask>): TEOTask {
  return {
    id,
    type: "SCRIPT",
    command: `run-${id}`,
    needs,
    gates: [],
    ...overrides,
  } as TEOTask;
}

/** An executor stub that resolves PASS after `delayMs`. */
function makePassExecutor(delayMs = 0): Executor {
  return async (_task: TEOTask, _ctx: RunContext): Promise<StepResult> => {
    if (delayMs > 0) {
      await new Promise<void>((r) => setTimeout(r, delayMs));
    }
    return { taskId: _task.id, status: "PASS" };
  };
}

/** An executor stub that resolves FAILED for a specific task ID, PASS for others. */
function makeFailExecutorFor(failId: string): Executor {
  return async (task: TEOTask, _ctx: RunContext): Promise<StepResult> => {
    return { taskId: task.id, status: task.id === failId ? "FAILED" : "PASS" };
  };
}

/** An executor stub that throws synchronously. */
function makeThrowingExecutor(): Executor {
  return async (task: TEOTask, _ctx: RunContext): Promise<StepResult> => {
    throw new Error(`Executor threw for task ${task.id}`);
  };
}

/** An executor that never resolves (simulates a hung task). */
function makeHangingExecutor(): Executor {
  return (_task: TEOTask, _ctx: RunContext): Promise<StepResult> => {
    return new Promise<StepResult>(() => {
      // Never resolves — timeout must fire.
    });
  };
}

// ---------------------------------------------------------------------------
// MISUSE: Constructor validation
// ---------------------------------------------------------------------------

describe("TopologicalRunner constructor — misuse", () => {
  it("throws when maxParallel is 0 and coerceZeroToOne is not set (default: throw)", () => {
    const executor = makePassExecutor();
    expect(
      () =>
        new TopologicalRunner({
          executor,
          maxParallel: 0,
        })
    ).toThrow(/maxParallel.*must be.*at least 1/i);
  });

  it("throws when maxParallel is negative", () => {
    const executor = makePassExecutor();
    expect(
      () =>
        new TopologicalRunner({
          executor,
          maxParallel: -1,
        })
    ).toThrow(/maxParallel.*must be.*at least 1/i);
  });

  it("throws when defaultStepTimeoutMs is 0 or negative", () => {
    const executor = makePassExecutor();
    expect(
      () =>
        new TopologicalRunner({
          executor,
          defaultStepTimeoutMs: 0,
        })
    ).toThrow(/defaultStepTimeoutMs.*must be.*positive/i);
  });

  it("throws when defaultStepTimeoutMs is negative", () => {
    const executor = makePassExecutor();
    expect(
      () =>
        new TopologicalRunner({
          executor,
          defaultStepTimeoutMs: -1000,
        })
    ).toThrow(/defaultStepTimeoutMs.*must be.*positive/i);
  });
});

// ---------------------------------------------------------------------------
// MISUSE: Plan with a cycle (defensive — plan should be pre-validated)
// ---------------------------------------------------------------------------

describe("TopologicalRunner run() — cycle detection (defensive)", () => {
  it("fails cleanly on a two-node cycle instead of infinite-looping", async () => {
    const executor = makePassExecutor();
    const runner = new TopologicalRunner({ executor });

    // A → B, B → A: cycle. Plan schema allows it (shape-only); runner must detect.
    // We bypass PlanSchema validation because the schema requires min 1 task but
    // doesn't validate referential integrity (that's validatePlan's job, WS-CORE-02).
    const plan = makePlan([makeTask("A", ["B"]), makeTask("B", ["A"])]);

    const result = await runner.run(plan);
    expect(result.overallStatus).toBe("FAILED");
    // At least one step result should reference cycle error in detail
    const hasCycleDetail = result.steps.some((s) => s.detail?.toLowerCase().includes("cycle"));
    expect(hasCycleDetail).toBe(true);
  });

  it("fails cleanly on a three-node cycle", async () => {
    const executor = makePassExecutor();
    const runner = new TopologicalRunner({ executor });

    const plan = makePlan([makeTask("A", ["C"]), makeTask("B", ["A"]), makeTask("C", ["B"])]);

    const result = await runner.run(plan);
    expect(result.overallStatus).toBe("FAILED");
    const hasCycleDetail = result.steps.some((s) => s.detail?.toLowerCase().includes("cycle"));
    expect(hasCycleDetail).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: Empty plan
// ---------------------------------------------------------------------------

describe("TopologicalRunner run() — empty plan (boundary)", () => {
  it("returns overall PASS with empty steps when the plan has zero tasks", async () => {
    // PlanSchema requires min 1 task, but we allow empty at the runner level
    // for defensive completeness. The runner receives a Plan — it doesn't re-validate.
    const executor = makePassExecutor();
    const runner = new TopologicalRunner({ executor });

    // Cast to bypass TS — the runner's run() accepts Plan which requires tasks.min(1)
    // but our defensive posture means we handle it cleanly at runtime.
    const plan = {
      plan_id: "plan-empty",
      project_id: "proj-test",
      created_at: "2026-06-18T00:00:00Z",
      version: "1" as const,
      tasks: [] as unknown as Plan["tasks"],
    } as Plan;

    const result = await runner.run(plan);
    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: maxParallel=0 behavior
// ---------------------------------------------------------------------------

describe("TopologicalRunner — maxParallel=0 behavior (documented: throws)", () => {
  it("throws at construction time when maxParallel=0 is passed", () => {
    // BOUNDARY DECISION: maxParallel=0 is rejected at construction with a clear
    // error. We do NOT silently coerce to 1, because silent coercion masks caller
    // bugs. Callers that want 1 must say 1.
    expect(
      () =>
        new TopologicalRunner({
          executor: makePassExecutor(),
          maxParallel: 0,
        })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: per-step timeout fires
// ---------------------------------------------------------------------------

describe("TopologicalRunner — per-step timeout (boundary)", () => {
  it("marks a hanging step FAILED (timed out) and does not leave it in flight", async () => {
    // Use a very short timeout so the test is fast. No fake timers needed —
    // we just set a 20ms timeout and the hanging executor never resolves.
    const runner = new TopologicalRunner({
      executor: makeHangingExecutor(),
      defaultStepTimeoutMs: 20, // 20ms — fast test, real clock
    });

    const plan = makePlan([makeTask("A")]);
    const result = await runner.run(plan);

    expect(result.overallStatus).toBe("FAILED");
    const stepA = result.steps.find((s) => s.taskId === "A");
    expect(stepA?.status).toBe("FAILED");
    expect(stepA?.detail).toMatch(/timed out/i);
  });

  it("downstream steps are SKIPPED when their dependency times out", async () => {
    const runner = new TopologicalRunner({
      executor: makeHangingExecutor(),
      defaultStepTimeoutMs: 20,
    });

    const plan = makePlan([makeTask("A"), makeTask("B", ["A"])]);
    const result = await runner.run(plan);

    const stepA = result.steps.find((s) => s.taskId === "A");
    const stepB = result.steps.find((s) => s.taskId === "B");
    expect(stepA?.status).toBe("FAILED");
    expect(stepB?.status).toBe("SKIPPED");
  });

  it("uses the default timeout constant (DEFAULT_STEP_TIMEOUT_MS = 60000)", () => {
    // Verify the exported constant is 60_000 ms (1 minute).
    expect(DEFAULT_STEP_TIMEOUT_MS).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: Executor throws synchronously
// ---------------------------------------------------------------------------

describe("TopologicalRunner — executor throws synchronously (boundary)", () => {
  it("catches a thrown error and marks the step FAILED without crashing the run loop", async () => {
    const runner = new TopologicalRunner({
      executor: makeThrowingExecutor(),
    });

    const plan = makePlan([makeTask("A"), makeTask("B")]);
    const result = await runner.run(plan);

    // Both are independent. Both should be FAILED (not a crash).
    expect(result.overallStatus).toBe("FAILED");
    for (const step of result.steps) {
      expect(step.status).toBe("FAILED");
    }
  });

  it("step FAILED detail includes the thrown error message", async () => {
    const runner = new TopologicalRunner({
      executor: makeThrowingExecutor(),
    });

    const plan = makePlan([makeTask("X")]);
    const result = await runner.run(plan);

    const stepX = result.steps.find((s) => s.taskId === "X");
    expect(stepX?.detail).toMatch(/executor threw/i);
  });

  it("handles a non-Error thrown value (e.g. a string) without crashing", async () => {
    // Covers the `err instanceof Error ? err.message : String(err)` else branch.
    const stringThrowExecutor: Executor = async (task) => {
      throw `string error for ${task.id}`;
    };
    const runner = new TopologicalRunner({ executor: stringThrowExecutor });
    const plan = makePlan([makeTask("Z")]);
    const result = await runner.run(plan);

    const stepZ = result.steps.find((s) => s.taskId === "Z");
    expect(stepZ?.status).toBe("FAILED");
    expect(stepZ?.detail).toMatch(/string error for Z/i);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: Unrelated task continues when another branch fails
// WS-ARCH-01 UPDATE: now asserts SKIPPED (abort behavior)
// ---------------------------------------------------------------------------

describe("TopologicalRunner — independent branch isolation (boundary)", () => {
  it("an unrelated task keeps running while a failed branch halts", async () => {
    // Plan: A and C are independent roots.
    // B depends on A. A will fail.
    //
    // After WS-ARCH-01: abortSignalled=true after A fails, C is SKIPPED (not dispatched).
    // Before WS-ARCH-01: C would have continued running and returned PASS.
    const failAExecutor: Executor = async (task) => ({
      taskId: task.id,
      status: task.id === "A" ? "FAILED" : "PASS",
    });

    const runner = new TopologicalRunner({ executor: failAExecutor });

    const plan = makePlan([
      makeTask("A"), // will fail
      makeTask("B", ["A"]), // will be skipped (upstream dep)
      makeTask("C"), // independent — SKIPPED by abort after WS-ARCH-01
    ]);

    const result = await runner.run(plan);

    const stepA = result.steps.find((s) => s.taskId === "A");
    const stepB = result.steps.find((s) => s.taskId === "B");
    const stepC = result.steps.find((s) => s.taskId === "C");

    expect(stepA?.status).toBe("FAILED");
    expect(stepB?.status).toBe("SKIPPED");
    // WS-ARCH-01: abort-on-first-failure means C is SKIPPED, never dispatched
    expect(stepC?.status).toBe("SKIPPED");
    expect(result.overallStatus).toBe("FAILED"); // overall fails if any step failed
  });
});

// =============================================================================
// WS-ARCH-01 — passing (post-impl, CAD gate 2)
//
// These tests exercise abort-on-first-failure behavior implemented in WS-ARCH-01.
// The abortSignalled flag is now wired into the drive loop.
// =============================================================================

describe("TopologicalRunner — abort-on-first-failure (WS-ARCH-01)", () => {
  // ---------------------------------------------------------------------------
  // MISUSE: single task / minimal abort cases
  // ---------------------------------------------------------------------------

  it("MISUSE-1: single task FAILED → overallStatus is FAILED, runner terminates cleanly (no hang)", async () => {
    // Degenerate case: only one task, it fails. abortSignalled fires but there's
    // nothing else to dispatch. The runner must still exit without hanging.
    const runner = new TopologicalRunner({ executor: makeFailExecutorFor("only") });
    const plan = makePlan([makeTask("only")]);

    const result = await runner.run(plan);

    expect(result.overallStatus).toBe("FAILED");
    expect(result.steps).toHaveLength(1);
    const step = result.steps[0];
    expect(step?.taskId).toBe("only");
    expect(step?.status).toBe("FAILED");
  });

  it("MISUSE-2: two independent tasks A and B; A dispatched first and FAILs before B starts — B is SKIPPED (abort blocks dispatch)", async () => {
    // maxParallel:1 forces serial execution: A runs, fails, then B would be next.
    // With abort-on-first-failure, B must be SKIPPED, never dispatched.
    const runner = new TopologicalRunner({
      executor: makeFailExecutorFor("A"),
      maxParallel: 1,
    });

    const plan = makePlan([
      makeTask("A"), // fails first (serial, dispatched first)
      makeTask("B"), // independent — abort prevents dispatch
    ]);

    const result = await runner.run(plan);

    const stepA = result.steps.find((s) => s.taskId === "A");
    const stepB = result.steps.find((s) => s.taskId === "B");

    expect(stepA?.status).toBe("FAILED");
    // B was never dispatched — must be SKIPPED due to abort
    expect(stepB?.status).toBe("SKIPPED");
    expect(result.overallStatus).toBe("FAILED");
  });

  // ---------------------------------------------------------------------------
  // BOUNDARY: in-flight tasks drain; new dispatches blocked
  // ---------------------------------------------------------------------------

  it("BOUNDARY-1: in-flight task B drains to completion while A (in-flight simultaneously) fails; C (not yet started) is SKIPPED", async () => {
    // maxParallel:2 — A and B are dispatched simultaneously.
    // A resolves FAILED quickly; B takes longer (still in-flight when A fails).
    // B must NOT be cancelled — it drains to PASS.
    // C (independent, not yet dispatched when abort fires) must be SKIPPED.
    //
    // Timing: A resolves in ~5ms (FAILED). B resolves in ~30ms (PASS). C never starts.
    let bResolve: (() => void) | undefined;

    const executor: Executor = async (task): Promise<StepResult> => {
      if (task.id === "A") {
        // Short delay then fail — ensures B is in-flight when A fails
        await new Promise<void>((r) => setTimeout(r, 5));
        return { taskId: task.id, status: "FAILED" };
      }
      if (task.id === "B") {
        // Longer delay — drain to completion after A fails
        await new Promise<void>((r) => {
          bResolve = r;
          setTimeout(r, 30);
        });
        return { taskId: task.id, status: "PASS" };
      }
      // C: should never be dispatched (abort fires before C is reached)
      return { taskId: task.id, status: "PASS" };
    };

    const runner = new TopologicalRunner({ executor, maxParallel: 2 });

    // A and B are independent roots; C is also independent (not yet dispatched when A fails)
    const plan = makePlan([
      makeTask("A"), // fails quickly
      makeTask("B"), // in-flight, drains to PASS
      makeTask("C"), // not yet dispatched — must be SKIPPED
    ]);

    const result = await runner.run(plan);

    const stepA = result.steps.find((s) => s.taskId === "A");
    const stepB = result.steps.find((s) => s.taskId === "B");
    const stepC = result.steps.find((s) => s.taskId === "C");

    expect(stepA?.status).toBe("FAILED");
    // B was in-flight — must NOT be killed, must drain to completion
    expect(stepB?.status).toBe("PASS");
    // C was not yet dispatched when abort fired — must be SKIPPED
    expect(stepC?.status).toBe("SKIPPED");
    expect(result.overallStatus).toBe("FAILED");

    void bResolve; // referenced to suppress unused warning
  });

  it("BOUNDARY-2: A fails; B (dep on A) and C (independent) are both SKIPPED — but for different reasons", async () => {
    // Plan: A → B (dep), C (independent).
    // A fails. B gets SKIPPED because of upstream dep failure.
    // C gets SKIPPED because abort fires.
    // Both are SKIPPED. The test doesn't distinguish *why* (that's an implementation
    // detail), but asserts both land as SKIPPED and overall is FAILED.
    const runner = new TopologicalRunner({ executor: makeFailExecutorFor("A") });

    const plan = makePlan([
      makeTask("A"), // fails
      makeTask("B", ["A"]), // SKIPPED: upstream dep failure
      makeTask("C"), // SKIPPED: abort-on-first-failure
    ]);

    const result = await runner.run(plan);

    const stepA = result.steps.find((s) => s.taskId === "A");
    const stepB = result.steps.find((s) => s.taskId === "B");
    const stepC = result.steps.find((s) => s.taskId === "C");

    expect(stepA?.status).toBe("FAILED");
    expect(stepB?.status).toBe("SKIPPED");
    expect(stepC?.status).toBe("SKIPPED");
    expect(result.overallStatus).toBe("FAILED");
  });

  // ---------------------------------------------------------------------------
  // GOLDEN PATH: no abort when all tasks pass
  // ---------------------------------------------------------------------------

  it("GOLDEN-1: all tasks PASS — abort never triggers, behavior identical to current (PASS for all)", async () => {
    // Regression guard: abort must be a no-op when nothing fails.
    const runner = new TopologicalRunner({ executor: makePassExecutor() });

    const plan = makePlan([
      makeTask("A"),
      makeTask("B", ["A"]),
      makeTask("C"), // independent
      makeTask("D", ["B"]),
    ]);

    const result = await runner.run(plan);

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(4);
    for (const step of result.steps) {
      expect(step.status).toBe("PASS");
    }
  });

  it("GOLDEN-2: A fails — cascading abort SKIPs all remaining tasks across dep and independent branches", async () => {
    // Plan: A fails. B depends on A. C is independent. D depends on C.
    // After abort:
    //   A = FAILED
    //   B = SKIPPED (upstream dep + abort)
    //   C = SKIPPED (abort — independent but no new dispatches after abort)
    //   D = SKIPPED (abort + dep on C which is SKIPPED)
    const runner = new TopologicalRunner({ executor: makeFailExecutorFor("A") });

    const plan = makePlan([
      makeTask("A"), // fails — triggers abort
      makeTask("B", ["A"]), // SKIPPED: dep + abort
      makeTask("C"), // SKIPPED: abort (independent)
      makeTask("D", ["C"]), // SKIPPED: abort + dep on SKIPPED C
    ]);

    const result = await runner.run(plan);

    const stepA = result.steps.find((s) => s.taskId === "A");
    const stepB = result.steps.find((s) => s.taskId === "B");
    const stepC = result.steps.find((s) => s.taskId === "C");
    const stepD = result.steps.find((s) => s.taskId === "D");

    expect(stepA?.status).toBe("FAILED");
    expect(stepB?.status).toBe("SKIPPED");
    expect(stepC?.status).toBe("SKIPPED");
    expect(stepD?.status).toBe("SKIPPED");
    expect(result.overallStatus).toBe("FAILED");
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: Diamond DAG ordering
// ---------------------------------------------------------------------------

describe("TopologicalRunner — diamond DAG (golden path)", () => {
  it("executes A first, then B and C in parallel, then D last", async () => {
    // Diamond: A → B, A → C, B → D, C → D
    const startOrder: string[] = [];
    const finishOrder: string[] = [];

    const executor: Executor = async (task) => {
      startOrder.push(task.id);
      await new Promise<void>((r) => setTimeout(r, 5));
      finishOrder.push(task.id);
      return { taskId: task.id, status: "PASS" };
    };

    const runner = new TopologicalRunner({ executor, maxParallel: 4 });
    const plan = makePlan([
      makeTask("A"),
      makeTask("B", ["A"]),
      makeTask("C", ["A"]),
      makeTask("D", ["B", "C"]),
    ]);

    const result = await runner.run(plan);

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(4);
    expect(result.steps.every((s) => s.status === "PASS")).toBe(true);

    // A must start before B and C
    expect(startOrder.indexOf("A")).toBeLessThan(startOrder.indexOf("B"));
    expect(startOrder.indexOf("A")).toBeLessThan(startOrder.indexOf("C"));
    // D must start after B and C finish
    expect(finishOrder.indexOf("B")).toBeLessThan(startOrder.indexOf("D"));
    expect(finishOrder.indexOf("C")).toBeLessThan(startOrder.indexOf("D"));
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: maxParallel cap on fan-out
// ---------------------------------------------------------------------------

describe("TopologicalRunner — maxParallel cap (golden path)", () => {
  it("never exceeds maxParallel=2 in flight simultaneously on a fan-out", async () => {
    // Fan-out: A → B, C, D, E (4 children, maxParallel=2)
    let inFlight = 0;
    let maxObservedInFlight = 0;

    const executor: Executor = async (task) => {
      if (task.id === "A") {
        return { taskId: task.id, status: "PASS" };
      }
      inFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      await new Promise<void>((r) => setTimeout(r, 10));
      inFlight--;
      return { taskId: task.id, status: "PASS" };
    };

    const runner = new TopologicalRunner({
      executor,
      maxParallel: 2,
    });

    const plan = makePlan([
      makeTask("A"),
      makeTask("B", ["A"]),
      makeTask("C", ["A"]),
      makeTask("D", ["A"]),
      makeTask("E", ["A"]),
    ]);

    const result = await runner.run(plan);

    expect(result.overallStatus).toBe("PASS");
    expect(maxObservedInFlight).toBeLessThanOrEqual(2);
    expect(maxObservedInFlight).toBeGreaterThanOrEqual(1);
  });

  it("respects maxParallel=1 (serial execution)", async () => {
    const finishOrder: string[] = [];

    const executor: Executor = async (task) => {
      await new Promise<void>((r) => setTimeout(r, 5));
      finishOrder.push(task.id);
      return { taskId: task.id, status: "PASS" };
    };

    const runner = new TopologicalRunner({ executor, maxParallel: 1 });

    // All independent — should still run serially (one at a time)
    const plan = makePlan([makeTask("A"), makeTask("B"), makeTask("C")]);

    const result = await runner.run(plan);
    expect(result.overallStatus).toBe("PASS");
    expect(finishOrder).toHaveLength(3);
  });

  it("uses DEFAULT_MAX_PARALLEL=4 when not specified", () => {
    expect(DEFAULT_MAX_PARALLEL).toBe(4);
    // Construction should succeed with default maxParallel
    const runner = new TopologicalRunner({ executor: makePassExecutor() });
    expect(runner).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: RED-halt cascading (failing step skips downstream)
// ---------------------------------------------------------------------------

describe("TopologicalRunner — RED-halt cascade (golden path)", () => {
  it("B→C chain: failure on B causes C to be SKIPPED, not FAILED", async () => {
    const runner = new TopologicalRunner({
      executor: makeFailExecutorFor("B"),
    });

    const plan = makePlan([makeTask("B"), makeTask("C", ["B"])]);
    const result = await runner.run(plan);

    const stepB = result.steps.find((s) => s.taskId === "B");
    const stepC = result.steps.find((s) => s.taskId === "C");
    expect(stepB?.status).toBe("FAILED");
    expect(stepC?.status).toBe("SKIPPED");
    expect(result.overallStatus).toBe("FAILED");
  });

  it("multi-hop cascade: A→B→C, A fails — B and C both SKIPPED", async () => {
    const runner = new TopologicalRunner({
      executor: makeFailExecutorFor("A"),
    });

    const plan = makePlan([makeTask("A"), makeTask("B", ["A"]), makeTask("C", ["B"])]);
    const result = await runner.run(plan);

    const stepA = result.steps.find((s) => s.taskId === "A");
    const stepB = result.steps.find((s) => s.taskId === "B");
    const stepC = result.steps.find((s) => s.taskId === "C");
    expect(stepA?.status).toBe("FAILED");
    expect(stepB?.status).toBe("SKIPPED");
    expect(stepC?.status).toBe("SKIPPED");
  });

  it("overallStatus is PASS when all steps pass", async () => {
    const runner = new TopologicalRunner({ executor: makePassExecutor() });
    const plan = makePlan([makeTask("A"), makeTask("B", ["A"])]);
    const result = await runner.run(plan);
    expect(result.overallStatus).toBe("PASS");
    expect(result.steps.every((s) => s.status === "PASS")).toBe(true);
  });

  it("overallStatus is FAILED when any step fails", async () => {
    const runner = new TopologicalRunner({
      executor: makeFailExecutorFor("A"),
    });
    const plan = makePlan([makeTask("A"), makeTask("B", ["A"])]);
    const result = await runner.run(plan);
    expect(result.overallStatus).toBe("FAILED");
  });

  it("skipped step detail indicates it was skipped due to upstream failure", async () => {
    const runner = new TopologicalRunner({
      executor: makeFailExecutorFor("A"),
    });
    const plan = makePlan([makeTask("A"), makeTask("B", ["A"])]);
    const result = await runner.run(plan);

    const stepB = result.steps.find((s) => s.taskId === "B");
    expect(stepB?.detail).toMatch(/skip/i);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: Single task
// ---------------------------------------------------------------------------

describe("TopologicalRunner — single task (golden path)", () => {
  it("runs a single task and returns PASS", async () => {
    const runner = new TopologicalRunner({ executor: makePassExecutor() });
    const plan = makePlan([makeTask("only")]);
    const result = await runner.run(plan);
    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe("PASS");
    expect(result.steps[0]?.taskId).toBe("only");
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: RunResult structure
// ---------------------------------------------------------------------------

describe("TopologicalRunner — RunResult structure", () => {
  it("RunResult contains steps array and overallStatus", async () => {
    const runner = new TopologicalRunner({ executor: makePassExecutor() });
    const plan = makePlan([makeTask("A"), makeTask("B", ["A"])]);
    const result = await runner.run(plan);

    expect(result).toHaveProperty("steps");
    expect(result).toHaveProperty("overallStatus");
    expect(Array.isArray(result.steps)).toBe(true);
    expect(["PASS", "FAILED"]).toContain(result.overallStatus);
  });

  it("each StepResult has taskId, status, and optional detail", async () => {
    const runner = new TopologicalRunner({ executor: makePassExecutor() });
    const plan = makePlan([makeTask("A")]);
    const result = await runner.run(plan);
    const step = result.steps[0]!;
    expect(step).toHaveProperty("taskId", "A");
    expect(step).toHaveProperty("status");
    expect(["PASS", "FAILED", "SKIPPED"]).toContain(step.status);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: Needs ref to unknown task ID is tolerated defensively
// ---------------------------------------------------------------------------

describe("TopologicalRunner — unknown needs ref (defensive)", () => {
  it("treats a needs[] ref to an unknown task ID as a broken dependency and reports FAILED", async () => {
    // validatePlan would catch this (WS-CORE-02), but the runner defends anyway.
    const runner = new TopologicalRunner({ executor: makePassExecutor() });
    const plan = makePlan([makeTask("A", ["nonexistent"])]);
    const result = await runner.run(plan);
    // A cannot run because its dependency doesn't exist — mark FAILED
    expect(result.overallStatus).toBe("FAILED");
    const stepA = result.steps.find((s) => s.taskId === "A");
    expect(stepA?.status).toBe("FAILED");
  });

  it("tasks without unknown refs are returned as PASS in the same early-exit batch", async () => {
    // A has a bad ref; B is independent and valid.
    // The runner returns early (both in same unknown-refs pass) — B gets PASS.
    const runner = new TopologicalRunner({ executor: makePassExecutor() });
    const plan = makePlan([
      makeTask("A", ["nonexistent"]),
      makeTask("B"), // independent, no bad refs
    ]);
    const result = await runner.run(plan);
    expect(result.overallStatus).toBe("FAILED");
    const stepA = result.steps.find((s) => s.taskId === "A");
    const stepB = result.steps.find((s) => s.taskId === "B");
    expect(stepA?.status).toBe("FAILED");
    expect(stepB?.status).toBe("PASS");
  });
});

// =============================================================================
// WS-GO-04: runtime guard — missing/invalid status coercion
//
// These tests will FAIL today — runner.ts does not yet have a runtime guard
// that coerces invalid adapter results to { status: "FAILED", detail: "..." }.
// =============================================================================

describe("runtime guard — missing status coercion (WS-GO-04)", () => {
  // T-NEW-1: adapter returns { taskId } with no status field → coerced to FAILED
  it("T-NEW-1: adapter returns { taskId } (no status) → step coerced to FAILED with 'invalid status' in detail", async () => {
    // Arrange: executor that returns an object missing the status field entirely.
    // Cast through any to bypass TypeScript — simulates a real-world contract breach.
    const executor: Executor = async (task: TEOTask, _ctx: RunContext): Promise<StepResult> => {
      return { taskId: task.id } as unknown as StepResult;
    };

    const runner = new TopologicalRunner({ executor });
    const plan = makePlan([makeTask("t1")]);

    // Act — must NOT throw; the guard must absorb the contract violation
    const result = await runner.run(plan);

    // The step must be coerced to FAILED (not left as undefined/garbage status)
    // This FAILS today — no guard in runner.ts.
    expect(result.overallStatus).toBe("FAILED");
    const step = result.steps.find((s) => s.taskId === "t1");
    expect(step).toBeDefined();
    expect(step!.status).toBe("FAILED");
    expect(step!.detail).toMatch(/invalid status/i);
  });

  // T-NEW-2: adapter returns { taskId, status: "BANANA" } → coerced to FAILED
  it("T-NEW-2: adapter returns { taskId, status: 'BANANA' } (invalid string) → coerced to FAILED with 'invalid status' in detail", async () => {
    // Arrange: executor that returns an unrecognized status string.
    const executor: Executor = async (task: TEOTask, _ctx: RunContext): Promise<StepResult> => {
      return { taskId: task.id, status: "BANANA" as unknown as StepResult["status"] };
    };

    const runner = new TopologicalRunner({ executor });
    const plan = makePlan([makeTask("t1")]);

    // Act
    const result = await runner.run(plan);

    // The step must be coerced to FAILED with "invalid status" in detail
    // This FAILS today — no guard in runner.ts.
    expect(result.overallStatus).toBe("FAILED");
    const step = result.steps.find((s) => s.taskId === "t1");
    expect(step).toBeDefined();
    expect(step!.status).toBe("FAILED");
    expect(step!.detail).toMatch(/invalid status/i);
  });

  // T-NEW-3: adapter returns valid { taskId, status: "PASS" } → NOT coerced (passthrough)
  it("T-NEW-3: adapter returns { taskId, status: 'PASS' } (valid) → NOT coerced, status preserved as PASS", async () => {
    // Arrange: executor that returns a valid PASS result.
    const executor: Executor = async (task: TEOTask, _ctx: RunContext): Promise<StepResult> => {
      return { taskId: task.id, status: "PASS" };
    };

    const runner = new TopologicalRunner({ executor });
    const plan = makePlan([makeTask("t1")]);

    // Act
    const result = await runner.run(plan);

    // Valid PASS must pass through uncoerced — this already works today,
    // but the test is important as a regression guard once the guard is added.
    expect(result.overallStatus).toBe("PASS");
    const step = result.steps.find((s) => s.taskId === "t1");
    expect(step).toBeDefined();
    expect(step!.status).toBe("PASS");
    // detail should NOT contain "invalid status" — either undefined or a non-coercion message
    if (step!.detail !== undefined) {
      expect(step!.detail).not.toMatch(/invalid status/i);
    }
  });
});
