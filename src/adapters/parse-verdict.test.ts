// =============================================================================
// parse-verdict.test.ts — All 16 tests PASS at gate-2 (implementation complete).
// Implementation lives in src/adapters/parse-verdict.ts.
//
// Tests for:
//   export function parseVerdict(output: string): "PASS" | "FAIL" | null
//
// Location: src/adapters/parse-verdict.ts
//
// CONTRACT:
//   Scans `output` for lines matching /^VERDICT:\s+(PASS|FAIL)\s*$/m
//   (case-sensitive, line-anchored, one-or-more spaces after colon).
//
//   - One or more VERDICT: PASS lines, zero VERDICT: FAIL lines → "PASS"
//   - One or more VERDICT: FAIL lines, zero VERDICT: PASS lines → "FAIL"
//   - Both VERDICT: PASS AND VERDICT: FAIL found (conflict) → null
//   - Neither found → null
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
    expect(parseVerdict("")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Whitespace-only: blank lines do not constitute a verdict.
  // -------------------------------------------------------------------------
  it("returns null for whitespace-only string", () => {
    expect(parseVerdict("   \n\t\n   ")).toBeNull();
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
    expect(parseVerdict("VERDICT:PASS")).toBeNull();
  });
});

describe("parseVerdict — boundary: case-sensitivity", () => {
  // -------------------------------------------------------------------------
  // The regex is case-sensitive. Lowercase value must NOT match.
  // -------------------------------------------------------------------------
  it("returns null for VERDICT: pass (lowercase value)", () => {
    expect(parseVerdict("VERDICT: pass")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Lowercase keyword must NOT match.
  // -------------------------------------------------------------------------
  it("returns null for verdict: PASS (lowercase keyword)", () => {
    expect(parseVerdict("verdict: PASS")).toBeNull();
  });
});

describe("parseVerdict — boundary: extra suffix", () => {
  // -------------------------------------------------------------------------
  // "VERDICT: PASSED" has extra text after PASS on the same line.
  // The regex requires \s*$ after the value — "PASSED" does not match.
  // -------------------------------------------------------------------------
  it("returns null for VERDICT: PASSED (extra suffix, not a bare PASS token)", () => {
    expect(parseVerdict("VERDICT: PASSED")).toBeNull();
  });
});

describe("parseVerdict — boundary: conflict", () => {
  // -------------------------------------------------------------------------
  // When both VERDICT: PASS and VERDICT: FAIL appear in the same output
  // the result is ambiguous → null.
  // -------------------------------------------------------------------------
  it("returns null when both VERDICT: PASS and VERDICT: FAIL are present (conflict)", () => {
    const output =
      "Starting work...\n" +
      "VERDICT: PASS\n" +
      "Wait, actually things failed.\n" +
      "VERDICT: FAIL\n";
    expect(parseVerdict(output)).toBeNull();
  });
});

describe("parseVerdict — boundary: multiple same-value lines", () => {
  // -------------------------------------------------------------------------
  // Multiple VERDICT: PASS lines with no FAIL → still "PASS".
  // Multiple matches on the same value are acceptable.
  // -------------------------------------------------------------------------
  it("returns PASS when multiple VERDICT: PASS lines are present and no FAIL", () => {
    const output = "VERDICT: PASS\nsome noise\nVERDICT: PASS\n";
    expect(parseVerdict(output)).toBe("PASS");
  });
});

describe("parseVerdict — boundary: mid-line embedding", () => {
  // -------------------------------------------------------------------------
  // Verdict embedded within a line (prefix text before VERDICT:) must NOT
  // match because the regex is anchored at line start (^).
  // -------------------------------------------------------------------------
  it("returns null when VERDICT: PASS appears mid-line (not at line start)", () => {
    expect(parseVerdict("The VERDICT: PASS is confirmed")).toBeNull();
  });
});

describe("parseVerdict — boundary: trailing whitespace", () => {
  // -------------------------------------------------------------------------
  // Trailing whitespace after PASS or FAIL is accepted by \s*$.
  // -------------------------------------------------------------------------
  it("returns PASS for VERDICT: PASS with trailing spaces before newline", () => {
    expect(parseVerdict("VERDICT: PASS   \n")).toBe("PASS");
  });

  it("returns FAIL for VERDICT: FAIL with trailing spaces before newline", () => {
    expect(parseVerdict("VERDICT: FAIL  \n")).toBe("FAIL");
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
    expect(parseVerdict("VERDICT: PASS\n")).toBe("PASS");
  });

  // -------------------------------------------------------------------------
  // Clean VERDICT: FAIL with trailing newline.
  // -------------------------------------------------------------------------
  it("returns FAIL for clean VERDICT: FAIL\\n", () => {
    expect(parseVerdict("VERDICT: FAIL\n")).toBe("FAIL");
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
    expect(parseVerdict(output)).toBe("PASS");
  });

  it("returns FAIL when verdict appears on its own line amid surrounding output", () => {
    const output = "Running tests...\n" + "3 tests failed.\n" + "VERDICT: FAIL\n" + "Exiting.\n";
    expect(parseVerdict(output)).toBe("FAIL");
  });

  // -------------------------------------------------------------------------
  // VERDICT: PASS with no trailing newline (end of string).
  // The multiline flag handles this — $ matches end-of-string too.
  // -------------------------------------------------------------------------
  it("returns PASS for VERDICT: PASS with no trailing newline (end of string)", () => {
    expect(parseVerdict("VERDICT: PASS")).toBe("PASS");
  });
});
