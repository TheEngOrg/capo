// =============================================================================
// parse-verdict.ts — parseVerdict utility (WS-P1-05 refactor)
//
// Extracted from claude-code.ts spawnAgent() inline regex. This module owns
// the canonical VERDICT line parsing contract so it can be tested in isolation
// and reused by any future spawner or adapter.
// =============================================================================

/**
 * Scan `output` for lines matching the VERDICT protocol.
 *
 * Regex: /^VERDICT:\s+(PASS|FAIL)\s*$/gm
 *   - Case-sensitive
 *   - Line-anchored (^ and $ with multiline flag)
 *   - One-or-more spaces required after colon (\s+)
 *   - Trailing whitespace allowed (\s*)
 *
 * Returns:
 *   "PASS"  — one or more VERDICT: PASS lines found, zero VERDICT: FAIL lines
 *   "FAIL"  — one or more VERDICT: FAIL lines found, zero VERDICT: PASS lines
 *   null    — both found (conflict), or neither found
 */
export function parseVerdict(output: string): "PASS" | "FAIL" | null {
  const verdictRe = /^VERDICT:\s+(PASS|FAIL)\s*$/gm;
  const matches: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = verdictRe.exec(output)) !== null) {
    matches.push(m[1] as string);
  }

  const passCount = matches.filter((v) => v === "PASS").length;
  const failCount = matches.filter((v) => v === "FAIL").length;

  if (passCount > 0 && failCount === 0) {
    return "PASS";
  }
  if (failCount > 0 && passCount === 0) {
    return "FAIL";
  }
  // Both present (conflict) or neither found → null
  return null;
}
