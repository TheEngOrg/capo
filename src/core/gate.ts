// =============================================================================
// gate.ts — GateEvaluator (WS-CORE-04)
//
// ADR-061 (ratified 2026-06-18): The gate engine consumes a VerificationResult
// and produces a GateVerdict. It is a pure mapping function — no I/O, no state.
//
// CONTRACT (read this before changing anything):
//
//   1. FAIL-SAFE — absence of a verdict is NEVER treated as PASS.
//      BLOCKED → halt. Always. No configuration can override this.
//
//   2. NO DOWNGRADE — a PASS cannot be reconfigured to FAIL or BLOCKED.
//      The verdict flows directly from the verification result.
//
//   3. FROZEN RETURNS — every GateVerdict is Object.freeze()'d before return.
//      Callers cannot mutate the verdict; attempts throw in strict mode.
//
//   4. PURE FUNCTION — evaluateGate() is stateless. Calling it N times with
//      the same input produces the same output with no side-effects.
//
// =============================================================================

import type { VerificationResult } from "./verification.js";

// ---------------------------------------------------------------------------
// GateVerdict — discriminated union over gate outcomes.
//
// PASS   → pipeline continues.
// FAIL   → pipeline halts; evidence carries details for the user.
// BLOCKED → pipeline halts; reason explains why verdict was unresolvable.
//            BLOCKED is a halt, not an unknown — it is the fail-safe state.
// ---------------------------------------------------------------------------

/** Verification passed. Pipeline continues. */
export interface GatePass {
  readonly verdict: "PASS";
}

/** Verification found violations. Pipeline halts. */
export interface GateFail {
  readonly verdict: "FAIL";
  /** Human-readable description of what failed (from the verification provider). */
  readonly evidence: string;
}

/**
 * Verification could not reach a conclusion, OR the result was absent/blocked.
 * Pipeline halts. This is the fail-safe state — never coerced to PASS.
 */
export interface GateBlocked {
  readonly verdict: "BLOCKED";
  /** Human-readable reason why no verdict was reachable. */
  readonly reason: string;
}

/** Discriminated union over all gate outcomes. */
export type GateVerdict = GatePass | GateFail | GateBlocked;

// ---------------------------------------------------------------------------
// evaluateGate — the gate engine entry point.
//
// Maps a VerificationResult → a frozen GateVerdict. Pure function.
//
// FAIL-SAFE: BLOCKED input → BLOCKED output. No path to PASS from BLOCKED.
// NO DOWNGRADE: PASS input → PASS output. No configuration alters this.
// ---------------------------------------------------------------------------

/**
 * Evaluates a verification result and returns a frozen GateVerdict.
 *
 * @param result - The result produced by a VerificationMechanism.
 * @returns A frozen GateVerdict. The object is immutable — any mutation
 *          attempt will throw a TypeError in strict mode.
 */
export function evaluateGate(result: VerificationResult): GateVerdict {
  switch (result.verdict) {
    case "PASS":
      // Clean verification — pipeline continues. No evidence or reason fields.
      return Object.freeze({ verdict: "PASS" } satisfies GatePass);

    case "FAIL":
      // Definitive failure — pipeline halts. Thread evidence through.
      return Object.freeze({
        verdict: "FAIL",
        evidence: result.evidence,
      } satisfies GateFail);

    case "BLOCKED":
      // Unresolvable verdict — pipeline halts. Fail-safe: never PASS.
      // Thread reason through for diagnostics.
      return Object.freeze({
        verdict: "BLOCKED",
        reason: result.reason,
      } satisfies GateBlocked);
  }
}
