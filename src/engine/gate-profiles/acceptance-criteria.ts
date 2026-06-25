// =============================================================================
// gate-profiles/acceptance-criteria.ts — WS-06: acceptance-criteria gate profile
//
// STATUS: PASSING — post-impl, CAD gate 2
//
// Validates that ac.json exists, is a valid AC artifact, and all ACs listed
// are non-empty strings. Returns PASS with ac_count or FAIL with reason.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { validateArtifact } from "../../core/artifacts.js";
import type { GateProfileInput, GateProfileResult } from "./types.js";

export function runAcceptanceCriteriaGate(input: GateProfileInput): GateProfileResult {
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
    return { verdict: "FAIL", status: "ENFORCED", evidence: { reason: "ac.json not found" } };
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
    const errors = result.errors?.map((e) => String(e)) ?? ["schema validation failed"];
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "ac.json schema invalid", errors },
    };
  }

  const payload = parsed as { acs: unknown[] };
  return { verdict: "PASS", status: "ENFORCED", evidence: { ac_count: payload.acs.length } };
}
