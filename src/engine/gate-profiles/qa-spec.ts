// =============================================================================
// gate-profiles/qa-spec.ts — WS-06: qa-spec gate profile
//
// STATUS: FAILING — implement in dev gate (WS-06)
//
// Each AC declared in ac.json must map to at least one test with [AC-N] in its
// it()/describe() name. Scans **/*.test.ts and **/*.spec.ts under cwd.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { validateArtifact } from "../../core/artifacts.js";
import type { GateProfileInput, GateProfileResult } from "./types.js";

function collectTestFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts"))
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

export function runQaSpecGate(input: GateProfileInput): GateProfileResult {
  const { cwd } = input;

  if (!cwd) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "Missing required context.cwd" },
    };
  }

  if (!fs.existsSync(cwd)) {
    return { verdict: "FAIL", status: "ENFORCED", evidence: { reason: `cwd not found: ${cwd}` } };
  }

  const acPath = path.join(cwd, "ac.json");
  if (!fs.existsSync(acPath)) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "ac.json not found", covered_acs: [], uncovered_acs: [] },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(acPath, "utf8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "ac.json is not valid JSON", errors: [msg] },
    };
  }

  const result = validateArtifact({ type: "AC_ARTIFACT", payload: parsed, strict: true });
  if (!result.valid) {
    return { verdict: "FAIL", status: "ENFORCED", evidence: { reason: "ac.json schema invalid" } };
  }

  const payload = parsed as { acs: Array<{ id: string; description: string }> };
  const acIds = payload.acs.map((ac) => ac.id);

  const testFiles = collectTestFiles(cwd);
  if (testFiles.length === 0) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "no test files found", covered_acs: [], uncovered_acs: acIds },
    };
  }

  const allContent = testFiles
    .map((f) => {
      try {
        return fs.readFileSync(f, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");

  const coveredAcs: string[] = [];
  const uncoveredAcs: string[] = [];

  for (const id of acIds) {
    if (allContent.includes(`[${id}]`)) {
      coveredAcs.push(id);
    } else {
      uncoveredAcs.push(id);
    }
  }

  if (uncoveredAcs.length > 0) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { covered_acs: coveredAcs, uncovered_acs: uncoveredAcs },
    };
  }

  return {
    verdict: "PASS",
    status: "ENFORCED",
    evidence: { covered_acs: coveredAcs, uncovered_acs: [] },
  };
}
