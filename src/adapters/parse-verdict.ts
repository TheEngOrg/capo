// =============================================================================
// parse-verdict.ts — parseVerdict utility (WS-P1-05 refactor)
//
// Extracted from claude-code.ts spawnAgent() inline regex. This module owns
// the canonical VERDICT line parsing contract so it can be tested in isolation
// and reused by any future spawner or adapter.
//
// Return shape updated to expose passCount/failCount so callers can distinguish
// conflict from no-verdict without re-parsing.
// =============================================================================

export interface VerdictResult {
  /** "PASS" when passCount > 0 && failCount === 0; "FAIL" when failCount > 0 && passCount === 0; null otherwise (conflict or no match). */
  verdict: "PASS" | "FAIL" | null;
  /** Number of VERDICT: PASS lines found. */
  passCount: number;
  /** Number of VERDICT: FAIL lines found. */
  failCount: number;
}

/**
 * Scan `output` for lines matching the VERDICT protocol.
 *
 * Regex: /^VERDICT:\s+(PASS|FAIL)\s*$/gm
 *   - Case-sensitive
 *   - Line-anchored (^ and $ with multiline flag)
 *   - One-or-more spaces required after colon (\s+)
 *   - Trailing whitespace allowed (\s*)
 */
export function parseVerdict(output: string): VerdictResult {
  const verdictRe = /^VERDICT:\s+(PASS|FAIL)\s*$/gm;
  const matches: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = verdictRe.exec(output)) !== null) {
    matches.push(m[1] as string);
  }

  const passCount = matches.filter((v) => v === "PASS").length;
  const failCount = matches.filter((v) => v === "FAIL").length;

  let verdict: "PASS" | "FAIL" | null = null;
  if (passCount > 0 && failCount === 0) {
    verdict = "PASS";
  } else if (failCount > 0 && passCount === 0) {
    verdict = "FAIL";
  }

  return { verdict, passCount, failCount };
}
