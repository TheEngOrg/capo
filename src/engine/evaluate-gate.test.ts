// WS-SEC-01 — passing (post-impl, CAD gate 2)
//
// Tests for src/engine/evaluate-gate.ts — the evaluateGate() function.
//
// evaluateGate() is called INLINE in run-plan.ts on the signed path after
// adapter.spawnAgent() returns. It returns a GateVerdict ("PASS" | "FAIL" | "WARN")
// and can override the adapter's self-report when they disagree.
//
// Ordering: misuse → boundary → golden path (ADR-064 policy)
//
// These tests FAIL until dev implements src/engine/evaluate-gate.ts.

import { describe, it, expect } from "vitest";
import type { TEOTask } from "../core/plan.js";
import type { StepResult, RunContext } from "../core/runner.js";
// These imports will fail until dev creates the module.
import { evaluateGate, type GateVerdict } from "./evaluate-gate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentTask(id: string, overrides: Partial<TEOTask> = {}): TEOTask {
  return {
    id,
    type: "AGENT",
    agent_id: "eng",
    prompt: `Execute task ${id}`,
    needs: [],
    gates: [],
    ...overrides,
  } as TEOTask;
}

function makeStepResult(status: StepResult["status"], detail?: string): StepResult {
  return {
    taskId: "task-x",
    status,
    ...(detail !== undefined ? { detail } : {}),
  };
}

function makeRunContext(): RunContext {
  return {
    planId: "plan-test",
    projectId: "proj-test",
    stepTimeoutMs: 60_000,
  };
}

// ---------------------------------------------------------------------------
// MISUSE: adapter reported FAILED — gate must reflect failure
// ---------------------------------------------------------------------------

describe("evaluateGate() — misuse: FAILED adapter result", () => {
  it("task with FAILED stepResult → gate returns 'FAIL'", async () => {
    const task = makeAgentTask("task-fail");
    const stepResult = makeStepResult("FAILED", "agent crashed");
    const ctx = makeRunContext();

    const verdict: GateVerdict = await evaluateGate(task, stepResult, ctx);

    expect(verdict).toBe("FAIL");
  });

  it("task with FAILED stepResult, no detail → gate still returns 'FAIL'", async () => {
    const task = makeAgentTask("task-fail-no-detail");
    const stepResult = makeStepResult("FAILED");
    const ctx = makeRunContext();

    const verdict: GateVerdict = await evaluateGate(task, stepResult, ctx);

    expect(verdict).toBe("FAIL");
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: SKIPPED adapter result — not a gate failure
// ---------------------------------------------------------------------------

describe("evaluateGate() — boundary: SKIPPED adapter result", () => {
  it("task with SKIPPED stepResult → gate returns 'PASS' (SKIPPED is not a gate failure)", async () => {
    // SKIPPED means the task was bypassed by upstream dep failure or abort.
    // The gate does not penalise skipped tasks — they never ran.
    const task = makeAgentTask("task-skipped");
    const stepResult = makeStepResult("SKIPPED", "Skipped due to upstream failure");
    const ctx = makeRunContext();

    const verdict: GateVerdict = await evaluateGate(task, stepResult, ctx);

    expect(verdict).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: PASS adapter result
// ---------------------------------------------------------------------------

describe("evaluateGate() — golden path: PASS adapter result", () => {
  it("task with PASS stepResult → gate returns 'PASS'", async () => {
    const task = makeAgentTask("task-pass");
    const stepResult = makeStepResult("PASS");
    const ctx = makeRunContext();

    const verdict: GateVerdict = await evaluateGate(task, stepResult, ctx);

    expect(verdict).toBe("PASS");
  });

  it("GateVerdict is one of the expected literal types: PASS | FAIL | WARN", async () => {
    const task = makeAgentTask("task-type-check");
    const stepResult = makeStepResult("PASS");
    const ctx = makeRunContext();

    const verdict = await evaluateGate(task, stepResult, ctx);

    // Type guard: verdict must be one of the three allowed literals
    const validVerdicts: GateVerdict[] = ["PASS", "FAIL", "WARN"];
    expect(validVerdicts).toContain(verdict);
  });

  it("evaluateGate() is async and returns a Promise<GateVerdict>", async () => {
    const task = makeAgentTask("task-async-check");
    const stepResult = makeStepResult("PASS");
    const ctx = makeRunContext();

    // Must be awaitable — not a synchronous return
    const result = evaluateGate(task, stepResult, ctx);
    expect(result).toBeInstanceOf(Promise);

    const verdict = await result;
    expect(verdict).toBe("PASS");
  });
});
