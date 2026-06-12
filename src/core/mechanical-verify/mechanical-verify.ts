/**
 * mechanical-verify — runs a task's verifications[] and maps results to a verdict.
 *
 * These are MECHANICAL checks: shell commands whose exit code is the verdict.
 * No LLM judges them. Every verification runs (no short-circuit) so the report
 * carries full diagnostics; the verdict is "pass" only if all match. See TEO-5.md §3.
 */
import type { Verification } from "../plan/plan.js";
import { runScript } from "../script-runner/script-runner.js";

export interface VerifyResult {
  cmd: string;
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

export interface VerifyReport {
  verdict: "pass" | "fail";
  results: VerifyResult[];
}

export interface VerifyOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout_ms?: number;
}

/**
 * Run every verification (shell command via `sh -c`), collect results, and
 * return a verdict that is "pass" only when all match their expected exit code.
 * An empty list passes vacuously.
 */
export function runVerifications(
  verifications: Verification[],
  opts: VerifyOptions = {},
): VerifyReport {
  const results: VerifyResult[] = [];
  for (const v of verifications) {
    const r = runScript(
      { path: "/bin/sh", args: ["-c", v.cmd], expect_exit: v.expect_exit },
      { cwd: opts.cwd, env: opts.env, timeout_ms: opts.timeout_ms },
    );
    results.push({
      cmd: v.cmd,
      ok: r.ok,
      exit_code: r.exit_code,
      stdout: r.stdout,
      stderr: r.stderr,
      duration_ms: r.duration_ms,
    });
  }
  const verdict = results.every((r) => r.ok) ? "pass" : "fail";
  return { verdict, results };
}
