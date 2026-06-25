// =============================================================================
// gate-profiles/types.ts — WS-06: injectable gate profile types
//
// STATUS: FAILING — implement in dev gate (WS-06)
//
// GateProfileRunner is the injection seam: tests pass a mock; production uses
// the default child_process runner in each profile's implementation.
// =============================================================================

/** Result returned by a raw subprocess execution. */
export type SubprocessResult = { exitCode: number; stdout: string; stderr: string };

/**
 * Injectable subprocess executor.
 * - In tests: inject a deterministic mock via the `runner` field on GateProfileInput.
 * - In production: each profile defaults to a child_process-backed runner.
 */
export type GateProfileRunner = (command: string, args: string[], cwd: string) => SubprocessResult;

/** Input passed to every gate profile. */
export type GateProfileInput = {
  cwd: string;
  gate_type: string;
  context?: Record<string, unknown>;
  /** Injectable runner — undefined means use real child_process. */
  runner?: GateProfileRunner;
};

/** Verdicts a gate profile can emit. */
export type GateProfileVerdict = "PASS" | "FAIL" | "BLOCKED";

/** Result returned by every gate profile. */
export type GateProfileResult = {
  verdict: GateProfileVerdict;
  status: "ENFORCED";
  evidence: Record<string, unknown>;
};
