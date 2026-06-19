// =============================================================================
// parse-verdict.test.ts — All 16 tests PASS at gate-2 (implementation complete).
// Implementation lives in src/adapters/parse-verdict.ts.
//
// Tests for:
//   export interface VerdictResult {
//     verdict: "PASS" | "FAIL" | null;
//     passCount: number;
//     failCount: number;
//   }
//   export function parseVerdict(output: string): VerdictResult
//
// Location: src/adapters/parse-verdict.ts
//
// CONTRACT:
//   Scans `output` for lines matching /^VERDICT:\s+(PASS|FAIL)\s*$/gm
//   (case-sensitive, line-anchored, one-or-more spaces after colon).
//
//   passCount: count of VERDICT: PASS lines matched
//   failCount: count of VERDICT: FAIL lines matched
//
//   - passCount > 0 && failCount === 0 → verdict "PASS"
//   - failCount > 0 && passCount === 0 → verdict "FAIL"
//   - Both present (conflict) → verdict null, counts reflect actual matches
//   - Neither found → verdict null, passCount: 0, failCount: 0
//   - Trailing whitespace on verdict line is accepted (\s*$ allows it)
//
// ============================================================================
// TEST ORDER: misuse → boundary → golden (ADR-064 critical-path policy)
// ============================================================================

import { describe, it, expect } from "vitest";
import { parseVerdict } from "./parse-verdict.js";

// =============================================================================
// MISUSE TESTS — inputs the function should never receive but must handle
// =============================================================================

describe("parseVerdict — misuse", () => {
  // -------------------------------------------------------------------------
  // Empty string: no lines, no verdict possible.
  // -------------------------------------------------------------------------
  it("returns null for empty string input", () => {
    const result = parseVerdict("");
    expect(result.verdict).toBeNull();
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Whitespace-only: blank lines do not constitute a verdict.
  // -------------------------------------------------------------------------
  it("returns null for whitespace-only string", () => {
    const result = parseVerdict("   \n\t\n   ");
    expect(result.verdict).toBeNull();
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(0);
  });
});

// =============================================================================
// BOUNDARY TESTS — inputs near the edge of the matching contract
// =============================================================================

describe("parseVerdict — boundary: no-space-after-colon", () => {
  // -------------------------------------------------------------------------
  // "VERDICT:PASS" has no space after the colon. The contract requires
  // one-or-more spaces (\s+), so this must NOT match.
  // -------------------------------------------------------------------------
  it("returns null for VERDICT:PASS with no space after colon", () => {
    const result = parseVerdict("VERDICT:PASS");
    expect(result.verdict).toBeNull();
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(0);
  });
});

describe("parseVerdict — boundary: case-sensitivity", () => {
  // -------------------------------------------------------------------------
  // The regex is case-sensitive. Lowercase value must NOT match.
  // -------------------------------------------------------------------------
  it("returns null for VERDICT: pass (lowercase value)", () => {
    const result = parseVerdict("VERDICT: pass");
    expect(result.verdict).toBeNull();
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Lowercase keyword must NOT match.
  // -------------------------------------------------------------------------
  it("returns null for verdict: PASS (lowercase keyword)", () => {
    const result = parseVerdict("verdict: PASS");
    expect(result.verdict).toBeNull();
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(0);
  });
});

describe("parseVerdict — boundary: extra suffix", () => {
  // -------------------------------------------------------------------------
  // "VERDICT: PASSED" has extra text after PASS on the same line.
  // The regex requires \s*$ after the value — "PASSED" does not match.
  // -------------------------------------------------------------------------
  it("returns null for VERDICT: PASSED (extra suffix, not a bare PASS token)", () => {
    const result = parseVerdict("VERDICT: PASSED");
    expect(result.verdict).toBeNull();
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(0);
  });
});

describe("parseVerdict — boundary: conflict", () => {
  // -------------------------------------------------------------------------
  // When both VERDICT: PASS and VERDICT: FAIL appear in the same output
  // the result is ambiguous → null. Counts reflect actual matches (1 each).
  // -------------------------------------------------------------------------
  it("returns null when both VERDICT: PASS and VERDICT: FAIL are present (conflict)", () => {
    const output =
      "Starting work...\n" +
      "VERDICT: PASS\n" +
      "Wait, actually things failed.\n" +
      "VERDICT: FAIL\n";
    const result = parseVerdict(output);
    expect(result.verdict).toBeNull();
    expect(result.passCount).toBe(1);
    expect(result.failCount).toBe(1);
  });
});

describe("parseVerdict — boundary: multiple same-value lines", () => {
  // -------------------------------------------------------------------------
  // Multiple VERDICT: PASS lines with no FAIL → still "PASS".
  // passCount reflects the actual count of matching lines (2).
  // -------------------------------------------------------------------------
  it("returns PASS when multiple VERDICT: PASS lines are present and no FAIL", () => {
    const output = "VERDICT: PASS\nsome noise\nVERDICT: PASS\n";
    const result = parseVerdict(output);
    expect(result.verdict).toBe("PASS");
    expect(result.passCount).toBe(2);
    expect(result.failCount).toBe(0);
  });
});

describe("parseVerdict — boundary: mid-line embedding", () => {
  // -------------------------------------------------------------------------
  // Verdict embedded within a line (prefix text before VERDICT:) must NOT
  // match because the regex is anchored at line start (^).
  // -------------------------------------------------------------------------
  it("returns null when VERDICT: PASS appears mid-line (not at line start)", () => {
    const result = parseVerdict("The VERDICT: PASS is confirmed");
    expect(result.verdict).toBeNull();
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(0);
  });
});

describe("parseVerdict — boundary: trailing whitespace", () => {
  // -------------------------------------------------------------------------
  // Trailing whitespace after PASS or FAIL is accepted by \s*$.
  // -------------------------------------------------------------------------
  it("returns PASS for VERDICT: PASS with trailing spaces before newline", () => {
    const result = parseVerdict("VERDICT: PASS   \n");
    expect(result.verdict).toBe("PASS");
    expect(result.passCount).toBe(1);
    expect(result.failCount).toBe(0);
  });

  it("returns FAIL for VERDICT: FAIL with trailing spaces before newline", () => {
    const result = parseVerdict("VERDICT: FAIL  \n");
    expect(result.verdict).toBe("FAIL");
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(1);
  });
});

// =============================================================================
// GOLDEN PATH TESTS — clean, expected inputs
// =============================================================================

describe("parseVerdict — golden", () => {
  // -------------------------------------------------------------------------
  // Clean VERDICT: PASS with trailing newline.
  // -------------------------------------------------------------------------
  it("returns PASS for clean VERDICT: PASS\\n", () => {
    const result = parseVerdict("VERDICT: PASS\n");
    expect(result.verdict).toBe("PASS");
    expect(result.passCount).toBe(1);
    expect(result.failCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Clean VERDICT: FAIL with trailing newline.
  // -------------------------------------------------------------------------
  it("returns FAIL for clean VERDICT: FAIL\\n", () => {
    const result = parseVerdict("VERDICT: FAIL\n");
    expect(result.verdict).toBe("FAIL");
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Verdict on its own line surrounded by multi-line noise (typical agent output).
  // -------------------------------------------------------------------------
  it("returns PASS when verdict appears on its own line amid surrounding output", () => {
    const output =
      "Running tests...\n" +
      "All 42 tests passed.\n" +
      "Coverage: 99.2%\n" +
      "VERDICT: PASS\n" +
      "Done.\n";
    const result = parseVerdict(output);
    expect(result.verdict).toBe("PASS");
    expect(result.passCount).toBe(1);
    expect(result.failCount).toBe(0);
  });

  it("returns FAIL when verdict appears on its own line amid surrounding output", () => {
    const output = "Running tests...\n" + "3 tests failed.\n" + "VERDICT: FAIL\n" + "Exiting.\n";
    const result = parseVerdict(output);
    expect(result.verdict).toBe("FAIL");
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // VERDICT: PASS with no trailing newline (end of string).
  // The multiline flag handles this — $ matches end-of-string too.
  // -------------------------------------------------------------------------
  it("returns PASS for VERDICT: PASS with no trailing newline (end of string)", () => {
    const result = parseVerdict("VERDICT: PASS");
    expect(result.verdict).toBe("PASS");
    expect(result.passCount).toBe(1);
    expect(result.failCount).toBe(0);
  });
});
