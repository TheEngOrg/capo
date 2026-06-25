// =============================================================================
// gate-profiles/dev.ts — WS-06: dev gate profile
//
// STATUS: FAILING — implement in dev gate (WS-06)
//
// Runs the test suite with coverage via the injectable runner. Checks that
// coverage meets the 99% threshold. Returns test_count, coverage_pct, threshold.
// =============================================================================

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import type { GateProfileInput, GateProfileResult, GateProfileRunner } from "./types.js";

function defaultRunner(
  command: string,
  args: string[],
  cwd: string
): ReturnType<GateProfileRunner> {
  const result = childProcess.spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120000 });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseCoverage(output: string): number {
  const allFilesMatch = output.match(/All files\s*\|\s*([\d.]+)/);
  if (allFilesMatch) {
    const n = parseFloat(allFilesMatch[1] ?? "0");
    if (!isNaN(n)) return n;
  }
  const coverageMatch = output.match(/Coverage[:\s]+([\d.]+)%/i);
  if (coverageMatch) {
    const n = parseFloat(coverageMatch[1] ?? "0");
    if (!isNaN(n)) return n;
  }
  return 0;
}

function parseTestCount(output: string): number {
  const passedMatch = output.match(/(\d+)\s+passed/);
  if (passedMatch) {
    const n = parseInt(passedMatch[1] ?? "0", 10);
    if (!isNaN(n)) return n;
  }
  return 0;
}

export function runDevGate(input: GateProfileInput): GateProfileResult {
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

  const runner: GateProfileRunner = input.runner ?? defaultRunner;
  const threshold =
    typeof input.context?.["coverage_threshold"] === "number"
      ? input.context["coverage_threshold"]
      : 99;

  const result = runner("npm", ["run", "test:cov"], cwd);

  if (result.exitCode !== 0) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "test suite failed", raw_output: result.stdout.slice(0, 500) },
    };
  }

  const coverage_pct = parseCoverage(result.stdout);
  const test_count = parseTestCount(result.stdout);

  if (coverage_pct < threshold) {
    return {
      verdict: "FAIL",
      status: "ENFORCED",
      evidence: { reason: "coverage below threshold", coverage_pct, threshold, test_count },
    };
  }

  return { verdict: "PASS", status: "ENFORCED", evidence: { test_count, coverage_pct, threshold } };
}
