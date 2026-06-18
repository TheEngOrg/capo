import { describe, it, expect } from "vitest";
import { evaluateGate } from "./gate.js";
import type { VerificationResult } from "./verification.js";

// =============================================================================
// gate.test.ts — exhaustive tests for src/core/gate.ts
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy).
//
// FAIL-SAFE CONTRACT: Absence of a verdict (BLOCKED) is NEVER treated as PASS.
// The gate engine is strictly fail-safe — no fail-open path exists.
// =============================================================================

// ---------------------------------------------------------------------------
// MISUSE: wrong / unexpected input shapes
// ---------------------------------------------------------------------------
describe("GateEvaluator — misuse", () => {
  it("treats a verdict of BLOCKED as a HALT — never PASS (fail-safe contract)", () => {
    const result: VerificationResult = {
      verdict: "BLOCKED",
      reason: "verification mechanism did not exit cleanly",
    };
    const verdict = evaluateGate(result);
    expect(verdict.verdict).toBe("BLOCKED");
  });

  it("does not treat a null-like evidence field on FAIL as BLOCKED", () => {
    const result: VerificationResult = {
      verdict: "FAIL",
      evidence: "exit code 1",
    };
    const verdict = evaluateGate(result);
    // A FAIL with evidence is still a FAIL — not BLOCKED
    expect(verdict.verdict).toBe("FAIL");
  });

  it("does not allow a PASS result to carry evidence (no downgrade — value-type contract)", () => {
    const result: VerificationResult = { verdict: "PASS" };
    const verdict = evaluateGate(result);
    // A PASS verdict contains no evidence or reason field
    expect(verdict.verdict).toBe("PASS");
    // TypeScript discriminated union enforces this; at runtime verify the shape:
    expect("evidence" in verdict).toBe(false);
    expect("reason" in verdict).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: the three verdict transitions, exhaustive mapping
// ---------------------------------------------------------------------------
describe("GateEvaluator — boundary verdict mapping", () => {
  it("maps PASS → GateVerdict { verdict: 'PASS' }", () => {
    const result: VerificationResult = { verdict: "PASS" };
    const verdict = evaluateGate(result);
    expect(verdict.verdict).toBe("PASS");
  });

  it("maps FAIL → GateVerdict { verdict: 'FAIL', evidence }", () => {
    const result: VerificationResult = {
      verdict: "FAIL",
      evidence: "taskless found 3 policy violations",
    };
    const verdict = evaluateGate(result);
    expect(verdict.verdict).toBe("FAIL");
    if (verdict.verdict === "FAIL") {
      expect(verdict.evidence).toBe("taskless found 3 policy violations");
    }
  });

  it("maps BLOCKED → GateVerdict { verdict: 'BLOCKED', reason }", () => {
    const result: VerificationResult = {
      verdict: "BLOCKED",
      reason: "binary not found",
    };
    const verdict = evaluateGate(result);
    expect(verdict.verdict).toBe("BLOCKED");
    if (verdict.verdict === "BLOCKED") {
      expect(verdict.reason).toBe("binary not found");
    }
  });

  it("FAIL evidence is threaded through to GateVerdict.evidence", () => {
    const result: VerificationResult = {
      verdict: "FAIL",
      evidence: "detailed violation report here",
    };
    const verdict = evaluateGate(result);
    if (verdict.verdict === "FAIL") {
      expect(verdict.evidence).toBe("detailed violation report here");
    } else {
      throw new Error("Expected FAIL verdict");
    }
  });

  it("BLOCKED reason is threaded through to GateVerdict.reason", () => {
    const result: VerificationResult = {
      verdict: "BLOCKED",
      reason: "malformed JSON from subprocess",
    };
    const verdict = evaluateGate(result);
    if (verdict.verdict === "BLOCKED") {
      expect(verdict.reason).toBe("malformed JSON from subprocess");
    } else {
      throw new Error("Expected BLOCKED verdict");
    }
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: verdict integrity — no mutation of returned value
// ---------------------------------------------------------------------------
describe("GateEvaluator — verdict integrity (no mutation)", () => {
  it("returned PASS verdict object is frozen (no external mutation)", () => {
    const result: VerificationResult = { verdict: "PASS" };
    const verdict = evaluateGate(result);
    expect(Object.isFrozen(verdict)).toBe(true);
  });

  it("returned FAIL verdict object is frozen", () => {
    const result: VerificationResult = {
      verdict: "FAIL",
      evidence: "exit 1",
    };
    const verdict = evaluateGate(result);
    expect(Object.isFrozen(verdict)).toBe(true);
  });

  it("returned BLOCKED verdict object is frozen", () => {
    const result: VerificationResult = {
      verdict: "BLOCKED",
      reason: "no exit",
    };
    const verdict = evaluateGate(result);
    expect(Object.isFrozen(verdict)).toBe(true);
  });

  it("attempting to mutate a frozen PASS verdict throws in strict mode", () => {
    const result: VerificationResult = { verdict: "PASS" };
    const verdict = evaluateGate(result);
    expect(() => {
      // @ts-expect-error — intentional mutation attempt to test freeze
      (verdict as Record<string, unknown>)["verdict"] = "FAIL";
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: end-to-end happy path
// ---------------------------------------------------------------------------
describe("GateEvaluator — golden path", () => {
  it("a clean PASS from verification continues the pipeline", () => {
    const result: VerificationResult = { verdict: "PASS" };
    const verdict = evaluateGate(result);
    expect(verdict.verdict).toBe("PASS");
  });

  it("returns a stable reference type (discriminated union narrowing works)", () => {
    const passResult: VerificationResult = { verdict: "PASS" };
    const pass = evaluateGate(passResult);
    // TypeScript narrowing: after this branch, pass.verdict === "PASS"
    if (pass.verdict !== "PASS") {
      throw new Error("Expected PASS");
    }
    // No evidence or reason fields present on PASS
    const asRecord = pass as Record<string, unknown>;
    expect(asRecord["evidence"]).toBeUndefined();
    expect(asRecord["reason"]).toBeUndefined();
  });

  it("processes multiple sequential verdicts without state bleed", () => {
    const results: VerificationResult[] = [
      { verdict: "PASS" },
      { verdict: "FAIL", evidence: "err" },
      { verdict: "BLOCKED", reason: "no bin" },
      { verdict: "PASS" },
    ];
    const verdicts = results.map(evaluateGate);
    expect(verdicts[0]?.verdict).toBe("PASS");
    expect(verdicts[1]?.verdict).toBe("FAIL");
    expect(verdicts[2]?.verdict).toBe("BLOCKED");
    expect(verdicts[3]?.verdict).toBe("PASS");
  });
});
