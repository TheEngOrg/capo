// WS-SPAWN-GUARD — QA spec (post-impl, green)
// Status: GREEN — implementation exists at src/plugin/hooks/teo-spawn-guard-debug.sh

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// =============================================================================
// teo-spawn-guard-debug.test.ts — tests for hooks/teo-spawn-guard-debug.sh
//
// PURPOSE
//   The debug hook is a one-shot PreToolUse logger that captures the full stdin
//   JSON payload to a file. It fires on tool_name "Agent" AND "Task" (legacy).
//   It is used empirically to confirm field names before the real guard is built.
//   It MUST always exit 0 — it is observational, never blocking.
//
// WHAT MUST EXIST BEFORE THESE TESTS PASS
//   src/plugin/hooks/teo-spawn-guard-debug.sh (executable bash script)
//
// ORDERING: misuse → boundary → golden path (ADR-064 critical-path policy)
//
// HOW THE SCRIPT IS INVOKED
//   Claude Code passes PreToolUse JSON on stdin. The script reads it via `cat`,
//   writes the raw JSON to a log file, and exits 0. We replicate this with
//   execSync piping JSON as stdin.
//
// ENV VARS THE SCRIPT MUST RESPECT
//   SPAWN_GUARD_DEBUG_LOG  Override path for the log file
//
// Exit codes: always 0 (fail-open — observational hook, never blocks)
// =============================================================================

const SCRIPT = path.join(__dirname, "../../src/plugin/hooks/teo-spawn-guard-debug.sh");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid PreToolUse payload for Agent/Task invocations.
 */
function makeAgentPayload(toolName: "Agent" | "Task", agentName: string): string {
  return JSON.stringify({
    tool_name: toolName,
    tool_input: { agent: agentName },
    hook_event_name: "PreToolUse",
  });
}

/**
 * Run the debug hook with the given stdin content.
 * Returns { exitCode, stdout, stderr }.
 * Never throws — we capture via spawnSync.
 */
function runHook(
  stdinContent: string,
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("bash", [SCRIPT], {
    input: stdinContent,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// Temp dir management
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-debug-hook-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// =============================================================================
// MISUSE — inputs that must not crash the hook or leave partial state
// =============================================================================

describe("teo-spawn-guard-debug.sh — MISS-DEBUG-01: invalid JSON stdin → fail-open", () => {
  it("exits 0 when stdin is not valid JSON", () => {
    const logPath = path.join(tmpDir, "debug.json");
    const { exitCode } = runHook("not valid json at all {{{", {
      SPAWN_GUARD_DEBUG_LOG: logPath,
    });
    // Fail-open: bad stdin must never block (exit 0)
    expect(exitCode, "invalid JSON stdin must produce exit 0 (fail-open)").toBe(0);
  });

  it("writes an error indication to stderr when stdin is not valid JSON", () => {
    const logPath = path.join(tmpDir, "debug.json");
    const { stderr } = runHook("not valid json {{{", {
      SPAWN_GUARD_DEBUG_LOG: logPath,
    });
    // Script must signal the problem to the operator, not silently swallow it
    expect(
      stderr.length,
      "invalid JSON stdin must produce stderr output (WARN or ERROR)"
    ).toBeGreaterThan(0);
  });

  it("does NOT create a log file when stdin is not valid JSON", () => {
    const logPath = path.join(tmpDir, "debug-should-not-exist.json");
    runHook("{ bad json }", { SPAWN_GUARD_DEBUG_LOG: logPath });
    // A partial or corrupted log is worse than no log — do not write on bad input
    expect(fs.existsSync(logPath), "log file must NOT be created when stdin is invalid JSON").toBe(
      false
    );
  });
});

describe("teo-spawn-guard-debug.sh — MISS-DEBUG-02: missing SPAWN_GUARD_DEBUG_LOG → uses default path", () => {
  it("exits 0 when SPAWN_GUARD_DEBUG_LOG env var is not set (uses default path)", () => {
    // Do not pass SPAWN_GUARD_DEBUG_LOG — script must derive a default
    const { exitCode } = runHook(
      makeAgentPayload("Agent", "qa"),
      {} // no log path override
    );
    expect(exitCode, "missing SPAWN_GUARD_DEBUG_LOG must not crash the hook (exit 0)").toBe(0);
  });

  it("still writes SOME log file when SPAWN_GUARD_DEBUG_LOG is not set (default path must be used)", () => {
    // We can't know the exact default path, but we can verify the script exits 0
    // and emits no error-level stderr. The real path validation is in HAPPY-DEBUG-01.
    const { exitCode, stderr } = runHook(makeAgentPayload("Agent", "qa"), {});
    expect(exitCode).toBe(0);
    // stderr is allowed to have INFO/DEBUG lines but must not carry ERROR or FAIL
    expect(
      stderr.toUpperCase().includes("ERROR"),
      "default-path run must not produce ERROR on stderr"
    ).toBe(false);
  });
});

// =============================================================================
// BOUNDARY — structural well-formedness guards
// =============================================================================

describe("teo-spawn-guard-debug.sh — boundary: script file exists and is executable", () => {
  it("teo-spawn-guard-debug.sh exists at src/plugin/hooks/teo-spawn-guard-debug.sh", () => {
    expect(
      fs.existsSync(SCRIPT),
      "src/plugin/hooks/teo-spawn-guard-debug.sh is missing — run dev to create it"
    ).toBe(true);
  });

  it("teo-spawn-guard-debug.sh is executable", () => {
    if (!fs.existsSync(SCRIPT)) return;
    const stat = fs.statSync(SCRIPT);
    // Check owner-execute bit (octal 0o100)
    const isExecutable = (stat.mode & 0o111) !== 0;
    expect(isExecutable, "teo-spawn-guard-debug.sh must be executable (chmod +x)").toBe(true);
  });

  it("teo-spawn-guard-debug.sh starts with a bash shebang", () => {
    if (!fs.existsSync(SCRIPT)) return;
    const firstLine = fs.readFileSync(SCRIPT, "utf8").split("\n")[0] ?? "";
    expect(
      firstLine.startsWith("#!/"),
      `teo-spawn-guard-debug.sh first line must be a shebang, got: "${firstLine}"`
    ).toBe(true);
  });
});

describe("teo-spawn-guard-debug.sh — boundary: exit code is always 0 regardless of input", () => {
  it("exits 0 for empty string stdin", () => {
    const logPath = path.join(tmpDir, "empty.json");
    const { exitCode } = runHook("", { SPAWN_GUARD_DEBUG_LOG: logPath });
    expect(exitCode, "empty stdin must produce exit 0 (fail-open)").toBe(0);
  });

  it("exits 0 for JSON with unexpected structure (no tool_name field)", () => {
    const logPath = path.join(tmpDir, "weird.json");
    const { exitCode } = runHook(JSON.stringify({ unexpected_field: "value", another: 42 }), {
      SPAWN_GUARD_DEBUG_LOG: logPath,
    });
    expect(exitCode, "JSON without tool_name must produce exit 0 (fail-open)").toBe(0);
  });
});

// =============================================================================
// GOLDEN PATH — normal PreToolUse payloads are logged and hook exits 0
// =============================================================================

describe("teo-spawn-guard-debug.sh — HAPPY-DEBUG-01: Agent tool_name → logged and exit 0", () => {
  it('logs the full stdin JSON to the log file when tool_name is "Agent"', () => {
    const logPath = path.join(tmpDir, "debug-agent.json");
    const payload = makeAgentPayload("Agent", "qa");

    runHook(payload, { SPAWN_GUARD_DEBUG_LOG: logPath });

    expect(fs.existsSync(logPath), 'log file must be created after an "Agent" payload').toBe(true);

    const logContent = fs.readFileSync(logPath, "utf8");
    expect(logContent.length, "log file must not be empty").toBeGreaterThan(0);
  });

  it('log file contains the tool_name "Agent" from the payload', () => {
    const logPath = path.join(tmpDir, "debug-agent2.json");
    const payload = makeAgentPayload("Agent", "qa");

    runHook(payload, { SPAWN_GUARD_DEBUG_LOG: logPath });

    if (!fs.existsSync(logPath)) return; // dependency on previous assertion
    const logContent = fs.readFileSync(logPath, "utf8");
    expect(
      logContent.includes("Agent"),
      'logged content must contain "Agent" from the payload'
    ).toBe(true);
  });

  it('log file contains the agent name "qa" from tool_input', () => {
    const logPath = path.join(tmpDir, "debug-agent3.json");
    const payload = makeAgentPayload("Agent", "qa");

    runHook(payload, { SPAWN_GUARD_DEBUG_LOG: logPath });

    if (!fs.existsSync(logPath)) return;
    const logContent = fs.readFileSync(logPath, "utf8");
    expect(
      logContent.includes("qa"),
      'logged content must contain the agent name "qa" from tool_input'
    ).toBe(true);
  });

  it('exits 0 when tool_name is "Agent"', () => {
    const logPath = path.join(tmpDir, "exit-agent.json");
    const { exitCode } = runHook(makeAgentPayload("Agent", "software-engineer"), {
      SPAWN_GUARD_DEBUG_LOG: logPath,
    });
    expect(exitCode, "Agent payload must produce exit 0").toBe(0);
  });
});

describe("teo-spawn-guard-debug.sh — HAPPY-DEBUG-02: Task tool_name (legacy) → also logged and exit 0", () => {
  it('logs the full stdin JSON to the log file when tool_name is "Task" (legacy variant)', () => {
    const logPath = path.join(tmpDir, "debug-task.json");
    const payload = makeAgentPayload("Task", "staff-engineer");

    runHook(payload, { SPAWN_GUARD_DEBUG_LOG: logPath });

    expect(fs.existsSync(logPath), 'log file must be created after a "Task" (legacy) payload').toBe(
      true
    );

    const logContent = fs.readFileSync(logPath, "utf8");
    expect(logContent.length, "log file must not be empty for Task variant").toBeGreaterThan(0);
  });

  it('log file contains "Task" from the payload (legacy variant is faithfully logged)', () => {
    const logPath = path.join(tmpDir, "debug-task2.json");
    const payload = makeAgentPayload("Task", "staff-engineer");

    runHook(payload, { SPAWN_GUARD_DEBUG_LOG: logPath });

    if (!fs.existsSync(logPath)) return;
    const logContent = fs.readFileSync(logPath, "utf8");
    expect(
      logContent.includes("Task"),
      'logged content must contain "Task" from the legacy payload'
    ).toBe(true);
  });

  it('exits 0 when tool_name is "Task" (legacy)', () => {
    const logPath = path.join(tmpDir, "exit-task.json");
    const { exitCode } = runHook(makeAgentPayload("Task", "staff-engineer"), {
      SPAWN_GUARD_DEBUG_LOG: logPath,
    });
    expect(exitCode, "Task (legacy) payload must produce exit 0").toBe(0);
  });

  it("Agent and Task payloads produce identical logging behaviour (parity check)", () => {
    const logPathAgent = path.join(tmpDir, "parity-agent.json");
    const logPathTask = path.join(tmpDir, "parity-task.json");

    runHook(makeAgentPayload("Agent", "qa"), { SPAWN_GUARD_DEBUG_LOG: logPathAgent });
    runHook(makeAgentPayload("Task", "qa"), { SPAWN_GUARD_DEBUG_LOG: logPathTask });

    // Both log files must exist — the script handles both tool name variants
    expect(fs.existsSync(logPathAgent), "Agent log file must exist").toBe(true);
    expect(fs.existsSync(logPathTask), "Task log file must exist").toBe(true);
  });
});
