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

import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
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

// =============================================================================
// WS-A07-03: GATE-STUB — evaluateGate discriminant coverage and WARN gap
//
// evaluateGate() returns only "PASS" or "FAIL". The type signature allows "WARN"
// but no code path returns it. If a future implementation returns "WARN", the
// run-plan.ts check (`if (gateVerdict === "FAIL")`) would NOT override the step
// to FAILED — WARN would silently be treated as PASS.
//
// GATE-STUB-01..03: Verify current stub behavior — all should be GREEN.
// GATE-STUB-04: Documents the gap. Uses a vi.spyOn to mock evaluateGate returning
//   "WARN" and verifies that run-plan.ts does NOT flip the step to FAILED.
//   Must be GREEN on current code (proving the gap exists).
// =============================================================================

describe("evaluateGate() — GATE-STUB: discriminant coverage", () => {
  // GATE-STUB-01: FAILED stepResult → returns "FAIL"
  // Mirrors the existing misuse test but prefixed for audit-07 tracking.
  it("GATE-STUB-01: evaluateGate with FAILED stepResult returns 'FAIL'", async () => {
    const task = makeAgentTask("gate-stub-01");
    const stepResult = makeStepResult("FAILED", "agent crashed");
    const ctx = makeRunContext();

    const verdict: GateVerdict = await evaluateGate(task, stepResult, ctx);

    expect(verdict).toBe("FAIL");
  });

  // GATE-STUB-02: PASS stepResult → returns "PASS"
  it("GATE-STUB-02: evaluateGate with PASS stepResult returns 'PASS'", async () => {
    const task = makeAgentTask("gate-stub-02");
    const stepResult = makeStepResult("PASS");
    const ctx = makeRunContext();

    const verdict: GateVerdict = await evaluateGate(task, stepResult, ctx);

    expect(verdict).toBe("PASS");
  });

  // GATE-STUB-03: SKIPPED stepResult → returns "PASS"
  it("GATE-STUB-03: evaluateGate with SKIPPED stepResult returns 'PASS'", async () => {
    const task = makeAgentTask("gate-stub-03");
    const stepResult = makeStepResult("SKIPPED");
    const ctx = makeRunContext();

    const verdict: GateVerdict = await evaluateGate(task, stepResult, ctx);

    expect(verdict).toBe("PASS");
  });

  // GATE-STUB-04: WARN gap documentation test.
  //
  // WARN-GAP: If evaluateGate returns "WARN", run-plan.ts currently treats it as
  // PASS. This test documents the gap. Add a "WARN" case to run-plan.ts if/when
  // evaluateGate is implemented to return WARN.
  //
  // Strategy: spy on the evaluateGate module to return "WARN" for a PASS adapter
  // result, run a full runPlan() with a mock adapter, and assert the step status
  // is NOT flipped to FAILED (i.e., WARN is silently treated as PASS).
  //
  // This test MUST BE GREEN on current code — it proves the gap exists.
  it("GATE-STUB-04 (WARN-GAP): evaluateGate returning WARN does NOT flip step to FAILED — run-plan.ts treats WARN as PASS", async () => {
    // Import the modules needed for the full run-plan path.
    const { runPlan } = await import("./run-plan.js");
    const { PlanSchema } = await import("../core/plan.js");
    const evaluateGateModule = await import("./evaluate-gate.js");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-gate-stub04-"));

    try {
      const rawPlan = {
        plan_id: "gate-stub-04-plan",
        project_id: "proj-gate-stub-04",
        created_at: "2026-06-23T00:00:00Z",
        version: "1" as const,
        tasks: [
          {
            id: "gate-stub-04-task",
            type: "AGENT" as const,
            agent_id: "eng",
            prompt: "test WARN gap",
            needs: [],
            gates: [],
          },
        ],
      };

      const plan = PlanSchema.parse(rawPlan);

      // Mock adapter: returns PASS
      const adapter = {
        sagePlan: vi.fn(),
        spawnAgent: vi
          .fn()
          .mockResolvedValueOnce({ taskId: "gate-stub-04-task", status: "PASS" as const }),
      };

      // Spy on evaluateGate to return "WARN" instead of "PASS"
      const gateSpy = vi
        .spyOn(evaluateGateModule, "evaluateGate")
        .mockResolvedValueOnce("WARN" as GateVerdict);

      try {
        const result = await runPlan(plan, adapter, {
          sessionId: "gate-stub-04-session",
          ledgerBaseDir: tmpDir,
        });

        // WARN-GAP: run-plan.ts only checks `if (gateVerdict === "FAIL")`.
        // "WARN" does not match "FAIL", so the step is NOT overridden to FAILED.
        // The step status stays PASS — this documents the gap.
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0]!.status).not.toBe("FAILED");
        // More precisely: WARN is silently treated as PASS
        expect(result.steps[0]!.status).toBe("PASS");
        expect(result.overallStatus).toBe("PASS");
      } finally {
        gateSpy.mockRestore();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
