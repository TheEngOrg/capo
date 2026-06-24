// WS-SEC-01 — evaluateGate() inline verification
import type { TEOTask } from "../core/plan.js";
import type { StepResult, RunContext } from "../core/runner.js";

export type GateVerdict = "PASS" | "FAIL" | "WARN";

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
