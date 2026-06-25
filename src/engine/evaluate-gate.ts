// WS-SEC-01 — evaluateGate() inline verification
import type { TEOTask } from "../core/plan.js";
import type { StepResult, RunContext } from "../core/runner.js";

// Verdict values align with GATE_RESULT_ARTIFACT schema in src/core/artifacts.ts.
// "UNENFORCED_MOCK" is used in test/CI contexts where gate enforcement is bypassed.
export type GateVerdict = "PASS" | "FAIL" | "WARN" | "UNENFORCED_MOCK";

export function evaluateGate(
  _task: TEOTask,
  stepResult: StepResult,
  _context: RunContext
): Promise<GateVerdict> {
  // FAILED adapter result → gate FAIL
  if (stepResult.status === "FAILED") return Promise.resolve("FAIL");
  // SKIPPED → PASS at gate level
  if (stepResult.status === "SKIPPED") return Promise.resolve("PASS");
  // PASS → PASS
  return Promise.resolve("PASS");
}
