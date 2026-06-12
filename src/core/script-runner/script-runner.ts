/**
 * script-runner — runs a SCRIPT task's executable directly. ZERO LLM TOKENS.
 *
 * This is the spine of the script-over-agent principle: mechanical work (deploy,
 * build, migrate) is a script the orchestrator runs here, identically to how a
 * human runs it by hand. The orchestrator adds telemetry + signoff; this module
 * just executes and captures. Also backs mechanical-verify and `teo run-script`.
 * See TEO-5.md §1, §6.
 */
import { spawnSync } from "node:child_process";

export interface ScriptSpec {
  path: string;
  args?: string[];
  /** Exit code that counts as success. Defaults to 0. */
  expect_exit?: number;
}

export interface RunOptions {
  cwd?: string;
  /** Extra env merged over process.env. */
  env?: Record<string, string>;
  /** Hard timeout in ms. */
  timeout_ms?: number;
}

export interface ScriptResult {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

/**
 * Run a script synchronously and capture its outcome. Never throws on a failed
 * script — a non-zero exit or a missing binary comes back as ok:false so the
 * orchestrator can record the verdict and move on deterministically.
 */
export function runScript(spec: ScriptSpec, opts: RunOptions = {}): ScriptResult {
  const expect = spec.expect_exit ?? 0;
  const startHr = process.hrtime.bigint();

  const proc = spawnSync(spec.path, spec.args ?? [], {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    encoding: "utf8",
    timeout: opts.timeout_ms,
  });

  const duration_ms = Number((process.hrtime.bigint() - startHr) / 1000000n);

  // spawnSync sets .error (ENOENT when the binary is missing, ETIMEDOUT when it
  // is killed by the timeout). We surface 127 and put the error message in
  // stderr alongside whatever the process emitted before dying.
  if (proc.error) {
    const prior = proc.stderr ?? "";
    return {
      ok: false,
      exit_code: 127,
      stdout: proc.stdout ?? "",
      stderr: `${prior}${proc.error.message}`,
      duration_ms,
    };
  }

  // Process ran. With encoding:"utf8", stdout/stderr are strings. status is null
  // only when killed by a signal — map that to a non-zero exit.
  const exit_code = proc.status ?? 1;
  return { ok: exit_code === expect, exit_code, stdout: proc.stdout, stderr: proc.stderr, duration_ms };
}
