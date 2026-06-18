// =============================================================================
// verification.ts — VerificationMechanism interface + providers (WS-CORE-04)
//
// ADR-061 (ratified 2026-06-18): the gate engine takes a PLUGGABLE verification
// mechanism. This module defines the interface and ships two providers:
//
//   ScriptMechanism  — runs a shell command; maps exit code → verdict.
//   TasklessMechanism — runs `taskless check --json`; parses JSON → verdict.
//
// FAIL-SAFE CONTRACT (must be visible here — it's on the critical path):
//   An absent, unresolvable, or unparseable verdict is always BLOCKED.
//   BLOCKED is NEVER treated as PASS. No fail-open path exists.
//
// RULES PATH:
//   TasklessMechanism reads rules from ~/.teo/taskless/rules/ (TASKLESS_RULES_PATH).
//   This resolves from os.homedir() at module load time, never a project-local path.
//   `taskless init` is NEVER run against the user's repo.
//
// INJECTABLE RUNNER:
//   Both providers accept a CommandRunner so unit tests can stub subprocesses.
//   Production code uses makeNodeCommandRunner() as the default runner.
// =============================================================================

import * as os from "node:os";
import * as path from "node:path";
import * as child_process from "node:child_process";

// ---------------------------------------------------------------------------
// Rules path — resolved from homedir at load time.
// NEVER a project-local path; NEVER ".taskless/" relative to target.
// ---------------------------------------------------------------------------

/**
 * The canonical path to Taskless rules for TEO.
 * Resolves from os.homedir() so it is machine-portable.
 * Default: ~/.teo/taskless/rules/
 */
export const TASKLESS_RULES_PATH: string = path.join(
  os.homedir(),
  ".teo",
  "taskless",
  "rules"
);

// ---------------------------------------------------------------------------
// CommandRunner — injectable subprocess abstraction
// ---------------------------------------------------------------------------

/** Result returned by a CommandRunner invocation. */
export interface CommandResult {
  /** Process exit code, or null if the process did not exit cleanly. */
  exitCode: number | null;
  /** Captured stdout from the process. */
  stdout: string;
}

/**
 * Abstracts subprocess execution so providers are unit-testable without
 * spawning real processes. Inject a stub in tests; use makeNodeCommandRunner()
 * in production.
 *
 * @param command - The shell command to run.
 * @param cwd    - Working directory for the command.
 * @param context - Caller-supplied context (environment metadata, etc.).
 */
export type CommandRunner = (
  command: string,
  cwd: string,
  context: Record<string, unknown>
) => Promise<CommandResult>;

/**
 * Maps a child_process.exec error object to a numeric exit code or null.
 *
 * child_process.exec sets err.code to the numeric exit code for commands that
 * exit with a non-zero status, but can also set it to a string like
 * "ERR_CHILD_PROCESS_STDIO_MAXBUFFER". We coerce carefully:
 *   - Numeric err.code  → use as exit code
 *   - err.killed        → null (process was killed, no exit code)
 *   - err.exitCode      → use as exit code (Node 12+ populates this)
 *   - otherwise         → null (unknown, fail-safe)
 *
 * Exported for unit-testability — tests exercise this pure mapping directly
 * rather than spawning processes with SIGKILL.
 */
export function mapExecErrorToExitCode(
  err: child_process.ExecException & { exitCode?: number }
): number | null {
  // err.code on ExecException is number | undefined (the process exit code).
  // err.exitCode is also available on Node 12+ and is equivalent.
  const code = err.code;
  if (typeof code === "number") return code;
  if (err.killed) return null;
  return err.exitCode ?? null;
}

/**
 * Production CommandRunner using Node's child_process.exec.
 * Captures stdout; maps non-zero exit to exitCode; maps no-exit (SIGKILL etc.)
 * to exitCode: null.
 */
export function makeNodeCommandRunner(): CommandRunner {
  return (command, cwd, _context) =>
    new Promise((resolve) => {
      child_process.exec(command, { cwd }, (err, stdout) => {
        if (err) {
          resolve({ exitCode: mapExecErrorToExitCode(err), stdout });
        } else {
          resolve({ exitCode: 0, stdout });
        }
      });
    });
}

// ---------------------------------------------------------------------------
// VerificationResult — the output of any VerificationMechanism.
// This is a discriminated union — the gate engine pattern-matches on verdict.
// ---------------------------------------------------------------------------

/** A clean verification with no policy violations. Pipeline continues. */
export interface VerificationPass {
  verdict: "PASS";
}

/** Verification found violations. Pipeline halts. Evidence carries details. */
export interface VerificationFail {
  verdict: "FAIL";
  evidence: string;
}

/**
 * Verification could not reach a conclusion (binary absent, timeout, malformed
 * output, missing rules directory, etc.). Pipeline halts — fail-safe.
 * BLOCKED is NEVER coerced to PASS.
 */
export interface VerificationBlocked {
  verdict: "BLOCKED";
  reason: string;
}

/** Discriminated union over all possible verification outcomes. */
export type VerificationResult =
  | VerificationPass
  | VerificationFail
  | VerificationBlocked;

// ---------------------------------------------------------------------------
// VerificationMechanism — the pluggable interface (ADR-061)
// ---------------------------------------------------------------------------

/**
 * A verification provider. The gate engine depends only on this interface,
 * never on a specific provider implementation.
 *
 * @param target  - The project root or artifact path being verified.
 * @param context - Caller-supplied metadata (CI env, plan ID, etc.).
 */
export interface VerificationMechanism {
  verify(
    target: string,
    context: Record<string, unknown>
  ): Promise<VerificationResult>;
}

// ---------------------------------------------------------------------------
// ScriptMechanism — exit-code provider
//
// Maps:
//   exit 0           → PASS
//   exit non-zero    → FAIL  (including exit 127 "command not found")
//   null exit        → BLOCKED  (no conclusion — fail-safe)
//   runner rejection → BLOCKED  (spawn failure — fail-safe)
// ---------------------------------------------------------------------------

export class ScriptMechanism implements VerificationMechanism {
  constructor(
    private readonly command: string,
    private readonly runner: CommandRunner = makeNodeCommandRunner()
  ) {}

  async verify(
    target: string,
    context: Record<string, unknown>
  ): Promise<VerificationResult> {
    let result: CommandResult;
    try {
      result = await this.runner(this.command, target, context);
    } catch (err) {
      // Runner rejected — spawn failed. Fail-safe: BLOCKED.
      const reason =
        err instanceof Error ? err.message : "command runner threw";
      return Object.freeze({ verdict: "BLOCKED" as const, reason });
    }

    if (result.exitCode === null) {
      // No exit code — process did not conclude. Fail-safe: BLOCKED.
      return Object.freeze({
        verdict: "BLOCKED" as const,
        reason: "command did not exit cleanly (null exit code)",
      });
    }

    if (result.exitCode === 0) {
      return Object.freeze({ verdict: "PASS" as const });
    }

    // Non-zero exit — definitive failure.
    return Object.freeze({
      verdict: "FAIL" as const,
      evidence: `exit code ${result.exitCode}${result.stdout ? `: ${result.stdout.trim()}` : ""}`,
    });
  }
}

// ---------------------------------------------------------------------------
// TasklessMechanism — Taskless JSON provider
//
// Runs: taskless check --rules <TASKLESS_RULES_PATH> --json
//
// Rules are read from TASKLESS_RULES_PATH (~/.teo/taskless/rules/).
// NEVER the user's project directory. `taskless init` is NEVER run here.
//
// Exit code + JSON parsing policy:
//   exit 0 + valid JSON + no error-severity findings → PASS
//   exit 0 + valid JSON + error-severity findings    → FAIL
//   exit 0 + valid JSON + only warning findings      → PASS (warnings don't block)
//   exit 0 + invalid / empty JSON                   → BLOCKED (fail-safe)
//   non-zero exit + valid JSON findings             → FAIL (findings trusted)
//   non-zero exit + invalid / empty JSON            → BLOCKED (fail-safe)
//   runner rejection                                → BLOCKED (fail-safe)
//   null exit                                       → BLOCKED (fail-safe)
// ---------------------------------------------------------------------------

/** Shape of a single Taskless finding returned in JSON output. */
interface TasklessFinding {
  rule: string;
  severity: string;
  message: string;
}

/** Expected top-level shape of taskless --json output. */
interface TasklessJsonOutput {
  findings: TasklessFinding[];
}

export class TasklessMechanism implements VerificationMechanism {
  /**
   * @param runner - Injectable command runner. Defaults to the Node runner.
   * @param rulesPath - Override the rules path (for testing path assertions).
   *   Defaults to TASKLESS_RULES_PATH.
   */
  constructor(
    private readonly runner: CommandRunner = makeNodeCommandRunner(),
    private readonly rulesPath: string = TASKLESS_RULES_PATH
  ) {}

  async verify(
    target: string,
    context: Record<string, unknown>
  ): Promise<VerificationResult> {
    // Construct the command using the configured rules path.
    const command = `taskless check --rules ${this.rulesPath} --json`;

    let result: CommandResult;
    try {
      result = await this.runner(command, target, context);
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : "taskless runner threw";
      return Object.freeze({ verdict: "BLOCKED" as const, reason });
    }

    // Null exit — process did not conclude. Fail-safe: BLOCKED.
    if (result.exitCode === null) {
      return Object.freeze({
        verdict: "BLOCKED" as const,
        reason: "taskless did not exit cleanly (null exit code)",
      });
    }

    // Parse JSON output. Malformed or empty output → BLOCKED (fail-safe).
    let parsed: TasklessJsonOutput;
    try {
      const trimmed = result.stdout.trim();
      if (!trimmed) {
        return Object.freeze({
          verdict: "BLOCKED" as const,
          reason: "taskless produced no output — cannot determine verdict",
        });
      }
      const raw: unknown = JSON.parse(trimmed);
      if (!isTasklessJsonOutput(raw)) {
        return Object.freeze({
          verdict: "BLOCKED" as const,
          reason: "taskless JSON output did not match expected shape",
        });
      }
      parsed = raw;
    } catch {
      // JSON.parse threw — malformed output. Fail-safe: BLOCKED.
      return Object.freeze({
        verdict: "BLOCKED" as const,
        reason: `taskless output was not valid JSON (exit ${result.exitCode})`,
      });
    }

    // Non-zero exit with parseable findings — report FAIL.
    // (Findings are the authoritative source when parseable.)
    if (result.exitCode !== 0) {
      const errorFindings = parsed.findings.filter(
        (f) => f.severity === "error"
      );
      if (errorFindings.length > 0) {
        return Object.freeze({
          verdict: "FAIL" as const,
          evidence: formatFindings(errorFindings),
        });
      }
      // Non-zero + no error findings → still FAIL (non-zero is definitive).
      return Object.freeze({
        verdict: "FAIL" as const,
        evidence: `taskless exited ${result.exitCode} with no parseable error findings`,
      });
    }

    // Exit 0 — check findings for error severity.
    const errorFindings = parsed.findings.filter((f) => f.severity === "error");
    if (errorFindings.length > 0) {
      return Object.freeze({
        verdict: "FAIL" as const,
        evidence: formatFindings(errorFindings),
      });
    }

    // Exit 0 + no error-severity findings → PASS.
    // Warning-severity findings do not block.
    return Object.freeze({ verdict: "PASS" as const });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isTasklessJsonOutput(value: unknown): value is TasklessJsonOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    "findings" in value &&
    Array.isArray((value as Record<string, unknown>)["findings"])
  );
}

function formatFindings(findings: TasklessFinding[]): string {
  return findings
    .map((f) => `[${f.rule}] ${f.message}`)
    .join("; ");
}
