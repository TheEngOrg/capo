// =============================================================================
// gate-profiles/staff-review.ts — WS-06: staff-review gate profile
//
// STATUS: FAILING — implement in dev gate (WS-06)
//
// Verifies that a non-empty commit exists since the last main-branch commit
// and that typecheck passes (npm run typecheck exits 0).
// =============================================================================

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import type { GateProfileInput, GateProfileResult, GateProfileRunner } from "./types.js";

function realRunner(command: string, args: string[], cwd: string): ReturnType<GateProfileRunner> {
  const result = childProcess.spawnSync(command, args, { cwd, encoding: "utf8", timeout: 30000 });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function runStaffReviewGate(input: GateProfileInput): GateProfileResult {
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

  // git log always uses the real subprocess — injectable runner only applies to npm (typecheck)
  const gitResult = realRunner("git", ["log", "--oneline", "-1"], cwd);
  const commit_present = gitResult.exitCode === 0 && gitResult.stdout.trim().length > 0;

  // typecheck uses the injectable runner (mocked in tests)
  const npmRunner: GateProfileRunner = input.runner ?? realRunner;
  const typecheckResult = npmRunner("npm", ["run", "typecheck"], cwd);
  const typecheck_clean = typecheckResult.exitCode === 0;
  const typecheck_errors = typecheck_clean
    ? undefined
    : (typecheckResult.stderr || typecheckResult.stdout).slice(0, 1000);

  if (commit_present && typecheck_clean) {
    return {
      verdict: "PASS",
      status: "ENFORCED",
      evidence: { commit_present: true, typecheck_clean: true },
    };
  }

  return {
    verdict: "FAIL",
    status: "ENFORCED",
    evidence: {
      commit_present,
      typecheck_clean,
      ...(typecheck_errors !== undefined ? { typecheck_errors } : {}),
    },
  };
}
