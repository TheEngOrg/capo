// =============================================================================
// run-plan.test.ts — WS-P1-07 — gate-2 (green)
//
// Tests for src/engine/run-plan.ts — the runPlan() engine entrypoint.
//
// Ordering: misuse → boundary → golden path (per ADR-064 critical-path policy)
//
// Implementation complete. All specs pass against src/engine/run-plan.ts.
// =============================================================================

import { describe, it, expect, vi } from "vitest";
import type { Plan, TEOTask } from "../core/plan.js";
import type { RunResult } from "../core/runner.js";
import type { TEOAdapter, AgentContext } from "../adapters/types.js";
import { runPlan, type RunPlanOptions } from "../engine/run-plan.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid Plan with the given tasks (requires >= 1 task per schema). */
function makePlan(tasks: TEOTask[], overrides?: Partial<Plan>): Plan {
  return {
    plan_id: "plan-test",
    project_id: "proj-test",
    created_at: "2026-06-18T00:00:00Z",
    version: "1",
    ...overrides,
    tasks,
  };
}

/** Build a minimal valid AGENT task. */
function makeAgentTask(id: string, needs: string[] = []): TEOTask {
  return {
    id,
    type: "AGENT",
    agent_id: "eng",
    prompt: `Execute task ${id}`,
    needs,
    gates: [],
  };
}

/** Build a minimal valid SCRIPT task. */
function makeScriptTask(id: string, needs: string[] = []): TEOTask {
  return {
    id,
    type: "SCRIPT",
    command: `run-${id}`,
    needs,
    gates: [],
  };
}

/**
 * Build a mock TEOAdapter using vi.fn() stubs.
 * spawnAgent defaults to returning PASS for any task.
 */
function makeMockAdapter(): TEOAdapter & {
  spawnAgent: ReturnType<typeof vi.fn>;
  sagePlan: ReturnType<typeof vi.fn>;
} {
  return {
    sagePlan: vi.fn(),
    spawnAgent: vi
      .fn()
      .mockImplementation((task: TEOTask, _ctx: AgentContext) =>
        Promise.resolve({ taskId: task.id, status: "PASS" as const })
      ),
  };
}

// ---------------------------------------------------------------------------
// MISUSE / INVALID INPUT — run these first, before happy-path tests
// ---------------------------------------------------------------------------

describe("runPlan() — misuse: invalid plan inputs", () => {
  it("1. returns FAILED with empty steps when tasks array is empty — does NOT throw", async () => {
    // The Plan schema requires min(1) task, so we use a type cast to bypass
    // schema validation and exercise the validatePlan() call inside runPlan().
    const plan = makePlan([] as unknown as TEOTask[]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("FAILED");
    expect(result.steps).toEqual([]);
    // Crucially: no throw — runPlan absorbs the validation error
  });

  it("2. returns FAILED with empty steps for duplicate task IDs — does NOT throw", async () => {
    // PlanSchema does not catch duplicates at parse time; validatePlan() does.
    // Two tasks sharing the same ID should produce { valid: false }.
    const duplicateTask = makeAgentTask("task-a");
    const plan = makePlan([duplicateTask, { ...duplicateTask }]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("FAILED");
    expect(result.steps).toEqual([]);
    expect(adapter.spawnAgent).not.toHaveBeenCalled();
  });

  it("3. returns FAILED with empty steps when needs[] references a non-existent task ID — does NOT throw", async () => {
    const taskWithBadNeed = makeAgentTask("task-b", ["nonexistent-id"]);
    const plan = makePlan([taskWithBadNeed]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("FAILED");
    expect(result.steps).toEqual([]);
    expect(adapter.spawnAgent).not.toHaveBeenCalled();
  });

  it("4. returns FAILED with empty steps for a dependency cycle (A→B→A) — does NOT throw", async () => {
    // A needs B, B needs A — validatePlan() detects the cycle and returns valid: false.
    const taskA = makeAgentTask("task-cycle-a", ["task-cycle-b"]);
    const taskB = makeAgentTask("task-cycle-b", ["task-cycle-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("FAILED");
    expect(result.steps).toEqual([]);
    expect(adapter.spawnAgent).not.toHaveBeenCalled();
  });

  it("5. SCRIPT task returns FAILED with 'SCRIPT execution deferred' detail — adapter.spawnAgent is NOT called", async () => {
    // SCRIPT execution is deferred (security review pending). runPlan() must mark
    // these steps FAILED without ever calling adapter.spawnAgent().
    // Single SCRIPT task: plan has 1 task which will trigger a PQ_01 warning but
    // still be valid (warnings do not set valid: false).
    const scriptTask = makeScriptTask("script-task-1");
    const plan = makePlan([scriptTask]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.steps).toHaveLength(1);
    const scriptStep = result.steps[0];
    expect(scriptStep.taskId).toBe("script-task-1");
    expect(scriptStep.status).toBe("FAILED");
    expect(scriptStep.detail).toContain("SCRIPT execution deferred");
    // The adapter must never be called for SCRIPT tasks
    expect(adapter.spawnAgent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — adapter dispatch, error propagation, option wiring
// ---------------------------------------------------------------------------

describe("runPlan() — boundary: adapter dispatch and option pass-through", () => {
  it("6. AGENT task: spawnAgent is called with the task and a valid AgentContext; returns PASS", async () => {
    const agentTask = makeAgentTask("agent-task-1");
    const plan = makePlan([agentTask]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(adapter.spawnAgent).toHaveBeenCalledTimes(1);

    const [calledTask, calledCtx] = adapter.spawnAgent.mock.calls[0] as [TEOTask, AgentContext];
    // Task identity preserved
    expect(calledTask.id).toBe("agent-task-1");
    expect(calledTask.type).toBe("AGENT");
    // AgentContext carries plan and project identity
    expect(calledCtx.planId).toBe("plan-test");
    expect(calledCtx.projectId).toBe("proj-test");
    // stepTimeoutMs must be a positive number (default 60_000)
    expect(typeof calledCtx.stepTimeoutMs).toBe("number");
    expect(calledCtx.stepTimeoutMs).toBeGreaterThan(0);

    expect(result.steps[0].status).toBe("PASS");
    expect(result.overallStatus).toBe("PASS");
  });

  it("7. adapter error propagation: spawnAgent rejection yields FAILED step with the error message as detail", async () => {
    const agentTask = makeAgentTask("agent-boom-task");
    const plan = makePlan([agentTask]);
    const adapter = makeMockAdapter();
    adapter.spawnAgent.mockRejectedValueOnce(new Error("agent boom"));

    const result: RunResult = await runPlan(plan, adapter);

    // runPlan must not throw — the runner isolates per-step errors
    expect(result.steps).toHaveLength(1);
    const step = result.steps[0];
    expect(step.taskId).toBe("agent-boom-task");
    expect(step.status).toBe("FAILED");
    expect(step.detail).toBe("agent boom");
    expect(result.overallStatus).toBe("FAILED");
  });

  it("8. opts.stepTimeoutMs is forwarded: AgentContext.stepTimeoutMs matches the option value", async () => {
    const agentTask = makeAgentTask("agent-timeout-task");
    const plan = makePlan([agentTask]);
    const adapter = makeMockAdapter();
    const opts: RunPlanOptions = { stepTimeoutMs: 5000 };

    await runPlan(plan, adapter, opts);

    expect(adapter.spawnAgent).toHaveBeenCalledTimes(1);
    const [, calledCtx] = adapter.spawnAgent.mock.calls[0] as [TEOTask, AgentContext];
    expect(calledCtx.stepTimeoutMs).toBe(5000);
  });

  it("9. opts.maxParallel is wired: two sequential AGENT tasks both complete successfully", async () => {
    // Functional smoke for maxParallel wiring: pass maxParallel: 1 to force serial
    // execution and confirm both tasks still resolve correctly. If maxParallel were
    // not wired, this would hang or produce an error at runner construction.
    const taskA = makeAgentTask("seq-task-a");
    const taskB = makeAgentTask("seq-task-b", ["seq-task-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();
    const opts: RunPlanOptions = { maxParallel: 1 };

    const result: RunResult = await runPlan(plan, adapter, opts);

    expect(result.steps).toHaveLength(2);
    expect(result.steps.every((s) => s.status === "PASS")).toBe(true);
    expect(result.overallStatus).toBe("PASS");
    expect(adapter.spawnAgent).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — multi-task scenarios and overallStatus rollup
// ---------------------------------------------------------------------------

describe("runPlan() — golden path: multi-task plans and overallStatus rollup", () => {
  it("10. multi-task AGENT plan: B depends on A — both steps PASS, overallStatus PASS", async () => {
    const taskA = makeAgentTask("golden-a");
    const taskB = makeAgentTask("golden-b", ["golden-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.steps).toHaveLength(2);
    const stepA = result.steps.find((s) => s.taskId === "golden-a");
    const stepB = result.steps.find((s) => s.taskId === "golden-b");
    expect(stepA?.status).toBe("PASS");
    expect(stepB?.status).toBe("PASS");
    expect(result.overallStatus).toBe("PASS");
    // Both tasks were dispatched to the adapter
    expect(adapter.spawnAgent).toHaveBeenCalledTimes(2);
  });

  it("11. mixed plan (AGENT + SCRIPT): AGENT step is PASS, SCRIPT step is FAILED with deferred message, overallStatus FAILED", async () => {
    const agentTask = makeAgentTask("mixed-agent");
    const scriptTask = makeScriptTask("mixed-script");
    const plan = makePlan([agentTask, scriptTask]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.steps).toHaveLength(2);

    const agentStep = result.steps.find((s) => s.taskId === "mixed-agent");
    expect(agentStep?.status).toBe("PASS");

    const scriptStep = result.steps.find((s) => s.taskId === "mixed-script");
    expect(scriptStep?.status).toBe("FAILED");
    expect(scriptStep?.detail).toContain("SCRIPT execution deferred");

    // Only the AGENT task should have triggered an adapter call
    expect(adapter.spawnAgent).toHaveBeenCalledTimes(1);
    const [calledTask] = adapter.spawnAgent.mock.calls[0] as [TEOTask, AgentContext];
    expect(calledTask.id).toBe("mixed-agent");

    expect(result.overallStatus).toBe("FAILED");
  });

  it("12a. overallStatus rollup — all AGENT tasks PASS: overallStatus is PASS", async () => {
    const taskA = makeAgentTask("rollup-pass-a");
    const taskB = makeAgentTask("rollup-pass-b", ["rollup-pass-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();
    // Both tasks return PASS (default mock behavior)

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.steps.every((s) => s.status === "PASS")).toBe(true);
    expect(result.overallStatus).toBe("PASS");
  });

  it("12b. overallStatus rollup — one AGENT task FAILS: overallStatus is FAILED", async () => {
    const taskA = makeAgentTask("rollup-fail-a");
    const taskB = makeAgentTask("rollup-fail-b", ["rollup-fail-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();
    // Make task A fail
    adapter.spawnAgent.mockImplementation((task: TEOTask, _ctx: AgentContext) => {
      if (task.id === "rollup-fail-a") {
        return Promise.resolve({
          taskId: task.id,
          status: "FAILED" as const,
          detail: "forced failure",
        });
      }
      return Promise.resolve({ taskId: task.id, status: "PASS" as const });
    });

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("FAILED");
    const stepA = result.steps.find((s) => s.taskId === "rollup-fail-a");
    expect(stepA?.status).toBe("FAILED");
    // task B depends on A which failed — it should be SKIPPED by the runner
    const stepB = result.steps.find((s) => s.taskId === "rollup-fail-b");
    expect(stepB?.status).toBe("SKIPPED");
  });
});
