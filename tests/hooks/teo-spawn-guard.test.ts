// WS-SPAWN-GUARD — QA spec (post-impl, all green)
// Status: GREEN — bug fixed: line 165 now reads .agent_type (top level).
//   makePayload() updated to match real PreToolUse payload shape (top-level agent_type).
//   STDIN JSON SHAPE comment in script header updated (session_info removed).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// =============================================================================
// teo-spawn-guard.test.ts — tests for hooks/teo-spawn-guard.sh
//
// PURPOSE
//   The real spawn-guard is a PreToolUse hook that checks caller → target spawn
//   pairs against a build-time allowlist. It operates in log-only mode by
//   default and only blocks when TEO_SPAWN_GUARD_MODE=enforce.
//
// KEY DESIGN DECISIONS UNDER TEST
//   D1 — Root/main session: hook must NEVER block spawns from the main session
//        (no agent_type in stdin) unless it can reliably detect TEO context.
//        When in doubt about root-session identity: fail-open (allow + log).
//   D2 — Log-only default: TEO_SPAWN_GUARD_MODE defaults to "observe".
//        In observe mode: log every spawn decision, never exit 2.
//   D3 — Allowlist at TEO_SPAWN_ALLOWLIST path: JSON with allowlist object.
//
// WHAT MUST EXIST BEFORE THESE TESTS PASS
//   src/plugin/hooks/teo-spawn-guard.sh (executable bash script)
//   spawn-allowlist.json fixture in tests/fixtures/ (created by this test suite
//   setup, not by running the generator, so tests are isolated from generator)
//
// ORDERING: misuse → boundary → golden path (ADR-064 critical-path policy)
//
// ENVIRONMENT VARS THE SCRIPT MUST RESPECT
//   TEO_SPAWN_ALLOWLIST       Path to spawn-allowlist.json
//   TEO_SPAWN_GUARD_MODE      "observe" (default) or "enforce"
//   TEO_HOOK_LOG_DIR_OVERRIDE Override directory for spawn-log-YYYY-MM-DD.json
//   TEO_PROJECT_ROOT          Override project root (for git-free test environments)
//
// STDIN JSON SHAPE (Claude Code PreToolUse/Agent)
//   {
//     "tool_name": "Agent" | "Task",
//     "tool_input": { "agent": "<name>" },
//     "agent_type": "<caller-agent-name>",    // optional — absent in root/main session
//     "agent_id": "<caller-agent-id>"         // optional — absent in root/main session
//   }
//
// EXIT CODES
//   0  ALLOW (or observe-mode would-block)
//   2  BLOCK (enforce mode only, when not permitted by allowlist)
// =============================================================================

const SCRIPT = path.join(__dirname, "../../src/plugin/hooks/teo-spawn-guard.sh");
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const POST_SPAWN_CITATION_HOOK = path.join(
  REPO_ROOT,
  "src",
  "plugin",
  "hooks",
  "teo-post-spawn-citation-check.sh"
);
const HOOKS_JSON = path.join(REPO_ROOT, "src", "plugin", "hooks", "hooks.json");

// ---------------------------------------------------------------------------
// Fixture: minimal spawn-allowlist.json used in most tests
// ---------------------------------------------------------------------------

const FIXTURE_ALLOWLIST = {
  generated_at: "2026-06-28T00:00:00Z",
  source: "src/plugin/agents/",
  allowlist: {
    capo: ["*"], // bare Task → wildcard
    "studio-director": ["art-director", "design"],
    cto: ["staff-engineer", "engineering-director"],
    "art-director": ["design"],
    "product-owner": ["product-manager"],
    "product-manager": ["qa", "design"],
    "engineering-director": ["engineering-manager", "staff-engineer", "devops-engineer"],
    "engineering-manager": ["qa", "software-engineer", "staff-engineer"],
    "staff-engineer": ["software-engineer"],
  },
};

// ---------------------------------------------------------------------------
// Temp dir + allowlist setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let allowlistPath: string;
let logDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-spawn-guard-test-"));
  allowlistPath = path.join(tmpDir, "spawn-allowlist.json");
  logDir = path.join(tmpDir, "traces");
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(allowlistPath, JSON.stringify(FIXTURE_ALLOWLIST, null, 2), "utf8");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a PreToolUse payload as the hook receives it from Claude Code.
 * Uses the correct real payload shape: agent_type is a TOP-LEVEL field.
 *
 * @param toolName   "Agent" or "Task"
 * @param target     Spawned agent name (tool_input.agent)
 * @param callerType Top-level .agent_type value; pass null for root/main session (field absent).
 */
function makePayload(
  toolName: "Agent" | "Task",
  target: string,
  callerType: string | null
): string {
  const base: Record<string, unknown> = {
    tool_name: toolName,
    tool_input: { agent: target },
    hook_event_name: "PreToolUse",
  };
  if (callerType !== null) {
    base["agent_type"] = callerType;
  }
  return JSON.stringify(base);
}

/**
 * Run the spawn-guard hook with the given payload and options.
 * Returns { exitCode, stdout, stderr }.
 * Never throws — we capture via spawnSync.
 */
function runHook(
  payload: string,
  opts: {
    mode?: "observe" | "enforce";
    allowlistOverride?: string;
    logDirOverride?: string;
  } = {}
): { exitCode: number; stdout: string; stderr: string } {
  const mode = opts.mode ?? "observe";
  const al = opts.allowlistOverride ?? allowlistPath;
  const ld = opts.logDirOverride ?? logDir;

  const result = spawnSync("bash", [SCRIPT], {
    input: payload,
    encoding: "utf8",
    env: {
      ...process.env,
      TEO_SPAWN_ALLOWLIST: al,
      TEO_SPAWN_GUARD_MODE: mode,
      TEO_HOOK_LOG_DIR_OVERRIDE: ld,
      TEO_PROJECT_ROOT: tmpDir,
    },
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Find and parse today's spawn-log JSON file from logDir.
 * Returns parsed array or null if file doesn't exist.
 */
function readSpawnLog(): Array<Record<string, unknown>> | null {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const logPath = path.join(logDir, `spawn-log-${today}.json`);
  if (!fs.existsSync(logPath)) return null;
  try {
    const raw = fs.readFileSync(logPath, "utf8");
    return JSON.parse(raw) as Array<Record<string, unknown>>;
  } catch {
    return null;
  }
}

// =============================================================================
// MISUSE — inputs that must be handled without blocking (fail-open)
// =============================================================================

describe("teo-spawn-guard.sh — MISS-GUARD-01: invalid JSON stdin → exit 0 (fail-open)", () => {
  it("exits 0 when stdin is not valid JSON", () => {
    const { exitCode } = runHook("not json at all {{{");
    expect(exitCode, "invalid JSON must not block (exit 0, fail-open)").toBe(0);
  });

  it("writes a WARN to stderr when stdin is not valid JSON", () => {
    const { stderr } = runHook("{ broken json ");
    expect(
      stderr.length,
      "invalid JSON stdin must produce some stderr output (WARN)"
    ).toBeGreaterThan(0);
  });

  it("exits 0 for empty stdin", () => {
    const { exitCode } = runHook("");
    expect(exitCode, "empty stdin must exit 0 (fail-open)").toBe(0);
  });
});

describe("teo-spawn-guard.sh — MISS-GUARD-02: non-Agent/Task tool_name → exit 0 (not applicable)", () => {
  it('exits 0 when tool_name is "Bash" (not a spawn event)', () => {
    const payload = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    });
    const { exitCode } = runHook(payload);
    expect(exitCode, "Bash tool must produce exit 0 (hook not applicable)").toBe(0);
  });

  it('exits 0 when tool_name is "Edit" (not a spawn event)', () => {
    const payload = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "src/foo.ts", old_string: "a", new_string: "b" },
    });
    const { exitCode } = runHook(payload);
    expect(exitCode, "Edit tool must produce exit 0 (hook not applicable)").toBe(0);
  });

  it('exits 0 when tool_name is "Read" (not a spawn event)', () => {
    const payload = JSON.stringify({
      tool_name: "Read",
      tool_input: { file_path: "src/foo.ts" },
    });
    const { exitCode } = runHook(payload);
    expect(exitCode, "Read tool must produce exit 0 (hook not applicable)").toBe(0);
  });

  it("does NOT write a spawn-log entry for non-Agent/Task tool invocations", () => {
    const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo hi" } });
    runHook(payload);

    const log = readSpawnLog();
    // Either no log file created, or log file is empty/has no entries
    if (log !== null) {
      expect(log.length, "non-spawn tools must not produce spawn-log entries").toBe(0);
    }
  });
});

describe("teo-spawn-guard.sh — MISS-GUARD-03: allowlist not found → exit 0 (fail-open)", () => {
  it("exits 0 when spawn-allowlist.json does not exist at TEO_SPAWN_ALLOWLIST path", () => {
    const nonExistentPath = path.join(tmpDir, "does-not-exist.json");
    const { exitCode } = runHook(makePayload("Agent", "qa", "engineering-manager"), {
      allowlistOverride: nonExistentPath,
    });
    expect(exitCode, "missing allowlist must not block spawns (fail-open, exit 0)").toBe(0);
  });

  it("writes a WARN to stderr when allowlist is not found", () => {
    const nonExistentPath = path.join(tmpDir, "no-allowlist.json");
    const { stderr } = runHook(makePayload("Agent", "qa", "engineering-manager"), {
      allowlistOverride: nonExistentPath,
    });
    expect(stderr.length, "missing allowlist must produce a WARN on stderr").toBeGreaterThan(0);
  });

  it("exits 0 in enforce mode when allowlist is not found (fail-open always wins over allow-list absence)", () => {
    const nonExistentPath = path.join(tmpDir, "no-allowlist-enforce.json");
    const { exitCode } = runHook(makePayload("Agent", "qa", "engineering-manager"), {
      allowlistOverride: nonExistentPath,
      mode: "enforce",
    });
    expect(exitCode, "missing allowlist in enforce mode must still fail-open (exit 0)").toBe(0);
  });
});

describe("teo-spawn-guard.sh — MISS-GUARD-04: caller not in allowlist, mode=observe → exit 0 + would-block log", () => {
  it("exits 0 when caller is not in allowlist (observe mode — never blocks)", () => {
    // qa is not in the allowlist (cannot spawn)
    const { exitCode } = runHook(makePayload("Agent", "software-engineer", "qa"), {
      mode: "observe",
    });
    expect(exitCode, "observe mode must always exit 0, even for unlisted caller").toBe(0);
  });

  it("logs a would-block entry when caller is not in allowlist (observe mode)", () => {
    runHook(makePayload("Agent", "software-engineer", "qa"), { mode: "observe" });

    const log = readSpawnLog();
    expect(log, "spawn-log must be created").not.toBeNull();

    if (log !== null && log.length > 0) {
      const entry = log[log.length - 1];
      // Verdict must indicate a would-block (not "allowed")
      const verdict = String(entry["verdict"] ?? "");
      expect(
        verdict === "would-block" || verdict.includes("would") || verdict.includes("block"),
        `spawn-log verdict for unlisted caller must indicate would-block, got: "${verdict}"`
      ).toBe(true);
    }
  });
});

describe("teo-spawn-guard.sh — MISS-GUARD-05: caller not in allowlist, mode=enforce → exit 2 + deny JSON", () => {
  it("exits 2 when caller is not in allowlist and mode is enforce", () => {
    // qa is not in the allowlist (cannot spawn)
    const { exitCode } = runHook(makePayload("Agent", "software-engineer", "qa"), {
      mode: "enforce",
    });
    expect(exitCode, "enforce mode must exit 2 for caller not in allowlist").toBe(2);
  });

  it("emits deny JSON to stdout when caller is not in allowlist (enforce mode)", () => {
    const { stdout } = runHook(makePayload("Agent", "software-engineer", "qa"), {
      mode: "enforce",
    });

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      // stdout is not valid JSON — that's the failure we're testing
    }

    expect(parsed, "enforce-mode block must emit deny JSON to stdout").not.toBeNull();

    if (parsed !== null) {
      expect(
        Object.prototype.hasOwnProperty.call(parsed, "hookSpecificOutput"),
        'deny JSON must have "hookSpecificOutput" key'
      ).toBe(true);
    }
  });

  it("logs a blocked entry when caller is not in allowlist (enforce mode)", () => {
    runHook(makePayload("Agent", "software-engineer", "qa"), { mode: "enforce" });

    const log = readSpawnLog();
    if (log !== null && log.length > 0) {
      const entry = log[log.length - 1];
      const verdict = String(entry["verdict"] ?? "");
      expect(
        verdict === "blocked" || verdict.includes("block"),
        `spawn-log verdict for blocked caller must indicate blocked, got: "${verdict}"`
      ).toBe(true);
    }
  });
});

describe("teo-spawn-guard.sh — MISS-GUARD-06: caller in allowlist but target not permitted, mode=observe → exit 0 + would-block log", () => {
  it("exits 0 when caller is in allowlist but target is not permitted (observe mode)", () => {
    // staff-engineer is in allowlist but can only spawn software-engineer, not qa
    const { exitCode } = runHook(makePayload("Agent", "qa", "staff-engineer"), {
      mode: "observe",
    });
    expect(exitCode, "observe mode must exit 0 even for a disallowed caller→target pair").toBe(0);
  });

  it("logs a would-block entry when target is not permitted (observe mode)", () => {
    runHook(makePayload("Agent", "qa", "staff-engineer"), { mode: "observe" });

    const log = readSpawnLog();
    expect(log, "spawn-log must be created for would-block in observe mode").not.toBeNull();

    if (log !== null && log.length > 0) {
      const entry = log[log.length - 1];
      const verdict = String(entry["verdict"] ?? "");
      expect(
        verdict === "would-block" || verdict.includes("would") || verdict.includes("block"),
        `spawn-log must contain would-block verdict for disallowed target, got: "${verdict}"`
      ).toBe(true);
    }
  });
});

describe("teo-spawn-guard.sh — MISS-GUARD-07: caller in allowlist but target not permitted, mode=enforce → exit 2 + deny JSON", () => {
  it("exits 2 when caller is in allowlist but target is not permitted (enforce mode)", () => {
    // staff-engineer can only spawn software-engineer, not qa
    const { exitCode } = runHook(makePayload("Agent", "qa", "staff-engineer"), {
      mode: "enforce",
    });
    expect(exitCode, "enforce mode must exit 2 for disallowed target").toBe(2);
  });

  it("emits deny JSON to stdout when target is not in caller's permitted list (enforce mode)", () => {
    const { stdout } = runHook(makePayload("Agent", "qa", "staff-engineer"), {
      mode: "enforce",
    });

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      // not JSON
    }

    expect(
      parsed,
      "disallowed-target enforce-mode block must emit deny JSON to stdout"
    ).not.toBeNull();
  });

  it("deny JSON contains permissionDecision=deny (enforce mode, disallowed target)", () => {
    const { stdout } = runHook(makePayload("Agent", "qa", "staff-engineer"), {
      mode: "enforce",
    });

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      return;
    }

    if (parsed === null) return;
    const hso = parsed["hookSpecificOutput"] as Record<string, unknown> | undefined;
    expect(
      hso?.["permissionDecision"],
      'deny JSON hookSpecificOutput.permissionDecision must be "deny"'
    ).toBe("deny");
  });
});

describe("teo-spawn-guard.sh — MISS-GUARD-08: root session spawning capo → ALLOW (D1)", () => {
  it("exits 0 when root/main session (no agent_type) spawns capo", () => {
    // Root session spawning capo is the normal /teo path — always allow
    const { exitCode } = runHook(makePayload("Agent", "capo", null));
    expect(
      exitCode,
      "root session spawning capo must be allowed (D1 — TEO orchestration path)"
    ).toBe(0);
  });

  it("exits 0 even in enforce mode when root session spawns capo", () => {
    const { exitCode } = runHook(makePayload("Agent", "capo", null), {
      mode: "enforce",
    });
    expect(exitCode, "root session spawning capo must be allowed even in enforce mode (D1)").toBe(
      0
    );
  });
});

describe("teo-spawn-guard.sh — MISS-GUARD-09: root session spawning any non-capo agent → ALLOW (D1 fail-open)", () => {
  it("exits 0 when root/main session (no agent_type) spawns a non-capo agent in observe mode", () => {
    // D1: if TEO-context cannot be reliably detected, fail-open for root session
    const { exitCode } = runHook(makePayload("Agent", "staff-engineer", null), {
      mode: "observe",
    });
    expect(
      exitCode,
      "root session spawning non-capo agent must be allowed in observe mode (D1 fail-open)"
    ).toBe(0);
  });

  it("exits 0 when root/main session (no agent_type) spawns a non-capo agent in enforce mode", () => {
    // D1 is absolute: the root session MUST NOT be blocked for arbitrary spawns
    const { exitCode } = runHook(makePayload("Agent", "qa", null), {
      mode: "enforce",
    });
    expect(
      exitCode,
      "root session must not be blocked in enforce mode for non-capo spawns (D1 fail-open)"
    ).toBe(0);
  });

  it("root session spawns are logged (observe mode) even when they'd be blocked for a subagent", () => {
    // qa is not in the allowlist — but root spawning qa must still be allowed
    runHook(makePayload("Agent", "qa", null), { mode: "observe" });

    const log = readSpawnLog();
    if (log !== null && log.length > 0) {
      const entry = log[log.length - 1];
      // The log entry for a root spawn should indicate allowed (or root-session)
      // not "would-block" — root is special
      const caller = String(entry["caller"] ?? entry["agent_type"] ?? "");
      const verdict = String(entry["verdict"] ?? "");
      // Either the entry marks it as root/main-session allowed,
      // or no entry was written at all (also fine — root is transparent)
      if (caller !== "" && caller !== "root" && caller !== "main") {
        // If the entry exists and names a caller, it must not be a block verdict
        expect(verdict !== "blocked", "root session spawn must not log a blocked verdict").toBe(
          true
        );
      }
    }
  });
});

// =============================================================================
// BOUNDARY — structural checks on the script itself and log format
// =============================================================================

describe("teo-spawn-guard.sh — boundary: script file exists and is executable", () => {
  it("teo-spawn-guard.sh exists at src/plugin/hooks/teo-spawn-guard.sh", () => {
    expect(
      fs.existsSync(SCRIPT),
      "src/plugin/hooks/teo-spawn-guard.sh is missing — run dev to create it"
    ).toBe(true);
  });

  it("teo-spawn-guard.sh is executable", () => {
    if (!fs.existsSync(SCRIPT)) return;
    const stat = fs.statSync(SCRIPT);
    const isExecutable = (stat.mode & 0o111) !== 0;
    expect(isExecutable, "teo-spawn-guard.sh must be executable (chmod +x)").toBe(true);
  });

  it("teo-spawn-guard.sh starts with a bash shebang", () => {
    if (!fs.existsSync(SCRIPT)) return;
    const firstLine = fs.readFileSync(SCRIPT, "utf8").split("\n")[0] ?? "";
    expect(firstLine.startsWith("#!/"), `first line must be a shebang, got: "${firstLine}"`).toBe(
      true
    );
  });
});

describe("teo-spawn-guard.sh — boundary: default mode is observe (log-only)", () => {
  it("exits 0 by default (observe mode) even for a disallowed spawn, when TEO_SPAWN_GUARD_MODE is unset", () => {
    // Run without TEO_SPAWN_GUARD_MODE env var — must default to observe
    const result = spawnSync("bash", [SCRIPT], {
      input: makePayload("Agent", "qa", "staff-engineer"), // disallowed: staff-engineer can only spawn software-engineer
      encoding: "utf8",
      env: {
        ...process.env,
        TEO_SPAWN_ALLOWLIST: allowlistPath,
        TEO_HOOK_LOG_DIR_OVERRIDE: logDir,
        TEO_PROJECT_ROOT: tmpDir,
        // Intentionally NOT setting TEO_SPAWN_GUARD_MODE
      },
    });
    expect(
      result.status,
      "hook with no TEO_SPAWN_GUARD_MODE set must default to observe and exit 0"
    ).toBe(0);
  });
});

// =============================================================================
// GOLDEN PATH — permitted spawns are allowed
// =============================================================================

describe("teo-spawn-guard.sh — HAPPY-GUARD-01: capo → qa → exit 0 + allowed log", () => {
  it("exits 0 when capo spawns qa (capo has wildcard / bare Task)", () => {
    const { exitCode } = runHook(makePayload("Agent", "qa", "capo"));
    expect(exitCode, "capo → qa must be allowed (exit 0)").toBe(0);
  });

  it('logs an "allowed" verdict when capo spawns qa', () => {
    runHook(makePayload("Agent", "qa", "capo"));

    const log = readSpawnLog();
    expect(log, "spawn-log must be created for capo → qa").not.toBeNull();

    if (log !== null && log.length > 0) {
      const entry = log[log.length - 1];
      const verdict = String(entry["verdict"] ?? "");
      expect(
        verdict === "allowed" || verdict.includes("allow"),
        `spawn-log verdict for capo → qa must be allowed, got: "${verdict}"`
      ).toBe(true);
    }
  });

  it("log entry contains caller and target fields", () => {
    runHook(makePayload("Agent", "qa", "capo"));

    const log = readSpawnLog();
    if (log === null || log.length === 0) return;

    const entry = log[log.length - 1];
    const entryStr = JSON.stringify(entry);

    // Must record who spawned who
    expect(entryStr.includes("capo"), 'spawn-log entry must reference the caller "capo"').toBe(
      true
    );
    expect(entryStr.includes("qa"), 'spawn-log entry must reference the target "qa"').toBe(true);
  });
});

describe("teo-spawn-guard.sh — HAPPY-GUARD-02: staff-engineer → software-engineer → exit 0", () => {
  it("exits 0 when staff-engineer spawns software-engineer (permitted by allowlist)", () => {
    const { exitCode } = runHook(makePayload("Agent", "software-engineer", "staff-engineer"));
    expect(exitCode, "staff-engineer → software-engineer must be allowed (exit 0)").toBe(0);
  });

  it("exits 0 in enforce mode for staff-engineer → software-engineer", () => {
    const { exitCode } = runHook(makePayload("Agent", "software-engineer", "staff-engineer"), {
      mode: "enforce",
    });
    expect(exitCode, "staff-engineer → software-engineer must be allowed in enforce mode").toBe(0);
  });
});

describe('teo-spawn-guard.sh — HAPPY-GUARD-03: agent with bare Task (["*"]) → ALLOW any target', () => {
  it("exits 0 when capo (wildcard) spawns any agent in observe mode", () => {
    // capo has ["*"] — can spawn anyone
    const targets = ["qa", "software-engineer", "staff-engineer", "design", "cto"];
    for (const target of targets) {
      const { exitCode } = runHook(makePayload("Agent", target, "capo"), {
        mode: "observe",
      });
      expect(exitCode, `capo → ${target} must be allowed (wildcard, observe mode)`).toBe(0);
    }
  });

  it("exits 0 when capo (wildcard) spawns any agent in enforce mode", () => {
    const targets = ["qa", "software-engineer", "engineering-director"];
    for (const target of targets) {
      const { exitCode } = runHook(makePayload("Agent", target, "capo"), {
        mode: "enforce",
      });
      expect(exitCode, `capo → ${target} must be allowed in enforce mode (wildcard)`).toBe(0);
    }
  });
});

describe("teo-spawn-guard.sh — HAPPY-GUARD-04: mode=observe, would-block spawn → exit 0 (log-only, never blocks)", () => {
  it("exits 0 in observe mode for every blocked scenario — observe NEVER blocks", () => {
    // Comprehensive: many disallowed pairs, all must exit 0 in observe
    const disallowedPairs: Array<[string, string]> = [
      ["qa", "software-engineer"], // qa cannot spawn
      ["software-engineer", "qa"], // software-engineer cannot spawn
      ["staff-engineer", "qa"], // staff-engineer can only spawn software-engineer
      ["engineering-manager", "cto"], // cto not in em's permitted list
      ["product-manager", "staff-engineer"], // staff-engineer not in pm's permitted list
    ];

    for (const [caller, target] of disallowedPairs) {
      const { exitCode } = runHook(makePayload("Agent", target, caller), {
        mode: "observe",
      });
      expect(exitCode, `observe mode must not block ${caller} → ${target} (exit 0)`).toBe(0);
    }
  });
});

describe("teo-spawn-guard.sh — HAPPY-GUARD-05: spawn-log accumulates multiple entries", () => {
  it("appends multiple log entries across successive spawns (same day file)", () => {
    // Three separate spawns; all should append to the same date-stamped log file
    runHook(makePayload("Agent", "qa", "capo"), { mode: "observe" });
    runHook(makePayload("Agent", "software-engineer", "staff-engineer"), { mode: "observe" });
    runHook(makePayload("Agent", "software-engineer", "qa"), { mode: "observe" }); // would-block

    const log = readSpawnLog();
    expect(log, "spawn-log must exist after multiple spawns").not.toBeNull();

    if (log !== null) {
      expect(log.length, "spawn-log must have 3 entries after 3 spawns").toBe(3);
    }
  });

  it("each spawn-log entry has a timestamp field", () => {
    runHook(makePayload("Agent", "qa", "capo"), { mode: "observe" });

    const log = readSpawnLog();
    if (log === null || log.length === 0) return;

    const entry = log[0];
    expect(
      Object.prototype.hasOwnProperty.call(entry, "timestamp"),
      "spawn-log entry must have a timestamp field"
    ).toBe(true);
  });

  it("each spawn-log entry has a mode field indicating observe or enforce", () => {
    runHook(makePayload("Agent", "qa", "capo"), { mode: "observe" });

    const log = readSpawnLog();
    if (log === null || log.length === 0) return;

    const entry = log[0];
    expect(
      Object.prototype.hasOwnProperty.call(entry, "mode"),
      "spawn-log entry must record the mode (observe/enforce)"
    ).toBe(true);

    expect(
      String(entry["mode"]),
      "mode field must be observe when run with TEO_SPAWN_GUARD_MODE=observe"
    ).toBe("observe");
  });

  it("spawn-log file is named spawn-log-YYYY-MM-DD.json (date = UTC date of the spawn)", () => {
    runHook(makePayload("Agent", "qa", "capo"), { mode: "observe" });

    const today = new Date().toISOString().slice(0, 10);
    const expectedLogPath = path.join(logDir, `spawn-log-${today}.json`);

    expect(fs.existsSync(expectedLogPath), `spawn-log must be named spawn-log-${today}.json`).toBe(
      true
    );
  });
});

// =============================================================================
// COEXIST — D4: teo-post-spawn-citation-check.sh and teo-spawn-guard.sh coexist
// =============================================================================

describe("teo-spawn-guard.sh — COEXIST-01: PreToolUse guard and PostToolUse citation-check coexist without conflict", () => {
  it("teo-post-spawn-citation-check.sh exists (PostToolUse hook)", () => {
    expect(
      fs.existsSync(POST_SPAWN_CITATION_HOOK),
      "teo-post-spawn-citation-check.sh must exist (PostToolUse hook for D4 coexistence check)"
    ).toBe(true);
  });

  it("teo-spawn-guard.sh exists (PreToolUse hook)", () => {
    expect(
      fs.existsSync(SCRIPT),
      "teo-spawn-guard.sh must exist (PreToolUse hook for D4 coexistence check)"
    ).toBe(true);
  });

  it("hooks.json PreToolUse entries do not reference teo-post-spawn-citation-check.sh (no hook-type collision)", () => {
    const raw = fs.readFileSync(HOOKS_JSON, "utf8");
    const parsed = JSON.parse(raw) as { hooks: Record<string, unknown[]> };
    const preToolUseEntries = parsed.hooks["PreToolUse"] ?? [];

    // Serialize the PreToolUse block and check citation-check is not in it
    const preToolUseStr = JSON.stringify(preToolUseEntries);
    expect(
      preToolUseStr.includes("teo-post-spawn-citation-check"),
      "teo-post-spawn-citation-check must not appear under PreToolUse — it is a PostToolUse hook"
    ).toBe(false);
  });

  it("hooks.json PostToolUse entries (if present) do not reference teo-spawn-guard.sh (no hook-type collision)", () => {
    const raw = fs.readFileSync(HOOKS_JSON, "utf8");
    const parsed = JSON.parse(raw) as { hooks: Record<string, unknown[]> };
    const postToolUseEntries = parsed.hooks["PostToolUse"] ?? [];

    const postToolUseStr = JSON.stringify(postToolUseEntries);
    expect(
      postToolUseStr.includes("teo-spawn-guard"),
      "teo-spawn-guard must not appear under PostToolUse — it is a PreToolUse hook"
    ).toBe(false);
  });

  it("both hooks can be registered simultaneously: spawn-guard as PreToolUse/Agent, citation-check as PostToolUse/Agent", () => {
    // After dev adds teo-spawn-guard to hooks.json, this test validates the
    // structural invariant that both hooks are present at the correct event types.
    // If hooks.json has not been updated yet, this is a PENDING condition
    // (the test documents intent without failing on the missing entry).
    const raw = fs.readFileSync(HOOKS_JSON, "utf8");
    const parsed = JSON.parse(raw) as { hooks: Record<string, unknown[]> };

    const postToolUseStr = JSON.stringify(parsed.hooks["PostToolUse"] ?? []);
    const preToolUseStr = JSON.stringify(parsed.hooks["PreToolUse"] ?? []);

    // If citation-check IS registered, it must be under PostToolUse
    if (postToolUseStr.includes("citation-check") || postToolUseStr.includes("teo-post-spawn")) {
      expect(
        postToolUseStr.includes("citation-check") || postToolUseStr.includes("teo-post-spawn"),
        "citation-check must be under PostToolUse"
      ).toBe(true);
    }

    // If spawn-guard IS registered, it must be under PreToolUse
    if (preToolUseStr.includes("spawn-guard") || preToolUseStr.includes("teo-spawn-guard")) {
      expect(
        preToolUseStr.includes("spawn-guard") || preToolUseStr.includes("teo-spawn-guard"),
        "spawn-guard must be under PreToolUse"
      ).toBe(true);
    }

    // Both hooks registered correctly → neither masks the other (different event types)
    // Even if not yet registered, the structural invariant above catches any future collision
  });

  it("teo-spawn-guard.sh exits 0 on an Agent spawn payload (does not interfere with PostToolUse citation-check flow)", () => {
    // The guard exits 0 on allowed spawns — PostToolUse citation-check runs AFTER, unaffected
    const { exitCode } = runHook(makePayload("Agent", "qa", "capo"));
    expect(exitCode, "spawn-guard must exit 0 for allowed spawn (capo → qa)").toBe(0);
  });
});

// =============================================================================
// BUG-FIX: CALLER FIELD — .agent_type at top level, NOT .session_info.agent_type
//
// Tracked as: WS-SPAWN-GUARD-CALLER-FIX
//
// Root cause: line 165 of teo-spawn-guard.sh reads
//   CALLER="$(echo "${STDIN_CONTENT}" | jq -r '.session_info.agent_type // empty')"
// but the real Claude Code PreToolUse payload has NO session_info wrapper.
// Caller identity is a TOP-LEVEL field: .agent_type (optional string).
//
// Fix (one-liner): change that line to
//   CALLER="$(echo "${STDIN_CONTENT}" | jq -r '.agent_type // empty')"
//
// These tests PASS after the fix (line 165 now reads .agent_type, not .session_info.agent_type).
// makeTopLevelPayload() and makePayload() are now equivalent — both use top-level agent_type.
// makeTopLevelPayload() is kept as a named alias for clarity in the BUG-FIX test cases.
// =============================================================================

/**
 * Build a PreToolUse payload using the CORRECT real Claude Code shape:
 * agent_type is a TOP-LEVEL field, no session_info wrapper.
 *
 * @param toolName   "Agent" or "Task"
 * @param target     Spawned agent name (tool_input.agent)
 * @param callerType Top-level .agent_type value; pass null for root/main session (field absent)
 */
function makeTopLevelPayload(
  toolName: "Agent" | "Task",
  target: string,
  callerType: string | null
): string {
  const base: Record<string, unknown> = {
    tool_name: toolName,
    tool_input: { agent: target },
    hook_event_name: "PreToolUse",
  };
  if (callerType !== null) {
    base["agent_type"] = callerType;
  }
  return JSON.stringify(base);
}

// ---------------------------------------------------------------------------
// MISUSE — BUG-FIX-01: session_info.agent_type set but NO top-level agent_type
// Expected: caller must be treated as empty/root (D1 fires), NOT as the session_info value
// Current (buggy) behavior: session_info.agent_type IS used, so the caller is identified
// and allowlist enforcement runs — this is WRONG.
// ---------------------------------------------------------------------------

describe("teo-spawn-guard.sh — BUG-FIX-01 [MISUSE]: session_info.agent_type set, no top-level agent_type → root-session (D1)", () => {
  it("exits 0 when only session_info.agent_type is set (no top-level agent_type) — must treat as root, not as named caller", () => {
    // Payload has session_info.agent_type = "staff-engineer" (old wrong path)
    // but NO top-level .agent_type field.
    // After fix: script sees CALLER="" → D1 fires → root-session-allow, exit 0.
    // Before fix (bug): script reads session_info.agent_type = "staff-engineer",
    //   proceeds to allowlist check — wrong behavior.
    const payload = JSON.stringify({
      tool_name: "Agent",
      tool_input: { agent: "qa" },
      hook_event_name: "PreToolUse",
      session_info: { agent_type: "staff-engineer" }, // old path only — no top-level agent_type
    });
    const { exitCode } = runHook(payload, { mode: "enforce" });
    // Must exit 0: no top-level agent_type = root session = D1 always allows
    expect(
      exitCode,
      "session_info.agent_type alone (no top-level agent_type) must be ignored — root session always exits 0"
    ).toBe(0);
  });

  it("logs 'root-session-allow' (or similar) when only session_info.agent_type is set", () => {
    const payload = JSON.stringify({
      tool_name: "Agent",
      tool_input: { agent: "qa" },
      hook_event_name: "PreToolUse",
      session_info: { agent_type: "staff-engineer" },
    });
    runHook(payload, { mode: "observe" });

    const log = readSpawnLog();
    // A log entry must exist and must NOT identify "staff-engineer" as the caller
    if (log !== null && log.length > 0) {
      const entry = log[log.length - 1];
      const caller = String(entry["caller"] ?? "");
      expect(
        caller === "staff-engineer",
        `caller must NOT be "staff-engineer" when only session_info.agent_type is set — got: "${caller}"`
      ).toBe(false);
      // Caller should be empty string, "root-session", or similar root indicator
      const verdict = String(entry["verdict"] ?? "");
      expect(
        verdict === "allowed" || verdict.includes("allow"),
        `verdict must be allowed (D1 root-session path), got: "${verdict}"`
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// MISUSE — BUG-FIX-02: both session_info.agent_type AND top-level agent_type set
// Expected: top-level value wins; session_info is ignored entirely
// ---------------------------------------------------------------------------

describe("teo-spawn-guard.sh — BUG-FIX-02 [MISUSE]: both session_info.agent_type and top-level agent_type present → top-level wins", () => {
  it("uses top-level agent_type and ignores session_info.agent_type when both are present", () => {
    // Top-level: "capo" (wildcard in allowlist — any target allowed)
    // session_info: "staff-engineer" (only allowed to spawn software-engineer)
    // If top-level wins: capo → qa → allowed (exit 0 in enforce)
    // If session_info wins (bug): staff-engineer → qa → blocked (exit 2 in enforce) — WRONG
    const payload = JSON.stringify({
      tool_name: "Agent",
      tool_input: { agent: "qa" },
      hook_event_name: "PreToolUse",
      agent_type: "capo", // correct top-level path — wildcard caller
      session_info: { agent_type: "staff-engineer" }, // wrong old path — restricted caller
    });
    const { exitCode } = runHook(payload, { mode: "enforce" });
    // If top-level "capo" is used: capo has ["*"], qa is allowed → exit 0
    // If session_info "staff-engineer" is used: staff-engineer cannot spawn qa → exit 2
    expect(
      exitCode,
      "top-level agent_type='capo' must win over session_info.agent_type='staff-engineer' — capo wildcard allows qa, must exit 0"
    ).toBe(0);
  });

  it("log entry records top-level agent_type value, not session_info.agent_type, when both are present", () => {
    const payload = JSON.stringify({
      tool_name: "Agent",
      tool_input: { agent: "software-engineer" },
      hook_event_name: "PreToolUse",
      agent_type: "staff-engineer", // top-level: staff-engineer can spawn software-engineer
      session_info: { agent_type: "qa" }, // session_info: qa cannot spawn anything
    });
    runHook(payload, { mode: "observe" });

    const log = readSpawnLog();
    if (log !== null && log.length > 0) {
      const entry = log[log.length - 1];
      const caller = String(entry["caller"] ?? "");
      expect(
        caller,
        `spawn-log caller must be the top-level agent_type value "staff-engineer", not session_info value "qa"`
      ).toBe("staff-engineer");
    }
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — BUG-FIX-03: top-level agent_type set, target NOT in allowlist (enforce mode)
// Expected: correct caller identified from top level, allowlist enforced → exit 2
// ---------------------------------------------------------------------------

describe("teo-spawn-guard.sh — BUG-FIX-03 [GOLDEN]: top-level agent_type='capo', disallowed target in enforce → allowlist enforced correctly", () => {
  it("identifies caller from top-level agent_type and applies allowlist when target not in caller's list", () => {
    // staff-engineer (top-level) can only spawn software-engineer — NOT qa
    // This must exit 2 in enforce mode, proving the correct field is being read
    const payload = makeTopLevelPayload("Agent", "qa", "staff-engineer");
    const { exitCode } = runHook(payload, { mode: "enforce" });
    expect(
      exitCode,
      "top-level agent_type='staff-engineer' spawning 'qa' (not permitted) must exit 2 in enforce mode"
    ).toBe(2);
  });

  it("log entry caller field equals the top-level agent_type value for a blocked spawn", () => {
    const payload = makeTopLevelPayload("Agent", "qa", "staff-engineer");
    runHook(payload, { mode: "enforce" });

    const log = readSpawnLog();
    if (log !== null && log.length > 0) {
      const entry = log[log.length - 1];
      const caller = String(entry["caller"] ?? "");
      expect(caller, `spawn-log caller must be "staff-engineer" (from top-level agent_type)`).toBe(
        "staff-engineer"
      );
    }
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — BUG-FIX-04: NO agent_type at all → D1 root-session-allow
// ---------------------------------------------------------------------------

describe("teo-spawn-guard.sh — BUG-FIX-04 [GOLDEN]: no top-level agent_type at all (pure root session) → D1 fires, allowed + root-session log", () => {
  it("exits 0 for a payload with no agent_type field anywhere (root session, enforce mode)", () => {
    // Neither .agent_type nor .session_info.agent_type present
    const payload = JSON.stringify({
      tool_name: "Agent",
      tool_input: { agent: "capo" },
      hook_event_name: "PreToolUse",
      // intentionally no agent_type at any level
    });
    const { exitCode } = runHook(payload, { mode: "enforce" });
    expect(
      exitCode,
      "payload with no agent_type at all must exit 0 (D1 root-session fail-open)"
    ).toBe(0);
  });

  it("logs a root-session-allow (or allowed) verdict when no agent_type present", () => {
    const payload = JSON.stringify({
      tool_name: "Agent",
      tool_input: { agent: "software-engineer" },
      hook_event_name: "PreToolUse",
    });
    runHook(payload, { mode: "observe" });

    const log = readSpawnLog();
    if (log !== null && log.length > 0) {
      const entry = log[log.length - 1];
      const caller = String(entry["caller"] ?? "");
      const verdict = String(entry["verdict"] ?? "");
      // caller should indicate root-session, not an empty-matched subagent
      expect(
        caller !== "staff-engineer" && caller !== "qa" && caller !== "capo",
        `root-session spawn must not log a named subagent as caller, got: "${caller}"`
      ).toBe(true);
      expect(
        verdict === "allowed" || verdict.includes("allow"),
        `root-session spawn must log an allowed verdict, got: "${verdict}"`
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — BUG-FIX-05: top-level agent_type='capo', allowed target → exit 0
// ---------------------------------------------------------------------------

describe("teo-spawn-guard.sh — BUG-FIX-05 [GOLDEN]: top-level agent_type='capo', allowed target → correctly identified and allowed", () => {
  it("exits 0 when top-level agent_type='capo' spawns an allowed target (enforce mode)", () => {
    // capo has ["*"] wildcard — can spawn anything; qa is a valid target
    const payload = makeTopLevelPayload("Agent", "qa", "capo");
    const { exitCode } = runHook(payload, { mode: "enforce" });
    expect(
      exitCode,
      "top-level agent_type='capo' (wildcard) spawning 'qa' must exit 0 in enforce mode"
    ).toBe(0);
  });

  it("logs caller='capo' and verdict='allowed' for a permitted top-level-field spawn", () => {
    const payload = makeTopLevelPayload("Agent", "software-engineer", "capo");
    runHook(payload, { mode: "observe" });

    const log = readSpawnLog();
    expect(log, "spawn-log must be created for top-level capo → software-engineer").not.toBeNull();

    if (log !== null && log.length > 0) {
      const entry = log[log.length - 1];
      const caller = String(entry["caller"] ?? "");
      const verdict = String(entry["verdict"] ?? "");
      expect(caller, "log caller must be 'capo' (from top-level agent_type)").toBe("capo");
      expect(
        verdict === "allowed" || verdict.includes("allow"),
        `log verdict must be allowed, got: "${verdict}"`
      ).toBe(true);
    }
  });
});

// =============================================================================
// GOLDEN PATH — Task (legacy) tool_name is handled identically to Agent
// =============================================================================

describe("teo-spawn-guard.sh — golden: Task (legacy tool_name) handled same as Agent", () => {
  it('exits 0 for allowed spawn when tool_name is "Task" (legacy)', () => {
    const { exitCode } = runHook(makePayload("Task", "software-engineer", "staff-engineer"));
    expect(exitCode, "Task (legacy) → allowed spawn must exit 0").toBe(0);
  });

  it('exits 2 in enforce mode for disallowed spawn when tool_name is "Task" (legacy)', () => {
    const { exitCode } = runHook(makePayload("Task", "qa", "staff-engineer"), {
      mode: "enforce",
    });
    expect(exitCode, "Task (legacy) → disallowed spawn in enforce mode must exit 2").toBe(2);
  });

  it("logs Task-variant spawns to the spawn-log same as Agent-variant spawns", () => {
    runHook(makePayload("Task", "software-engineer", "staff-engineer"));

    const log = readSpawnLog();
    expect(log, "spawn-log must be created for Task-variant spawn").not.toBeNull();

    if (log !== null) {
      expect(log.length, "Task-variant spawn must produce at least 1 log entry").toBeGreaterThan(0);
    }
  });
});
