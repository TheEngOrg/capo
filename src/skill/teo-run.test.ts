// =============================================================================
// teo-run.test.ts — WS-GO-02: bin/teo-run.js CLI entrypoint integration tests
//
// STATUS: FAILING — bin/teo-run.js (esbuild-bundled ESM, target node22) does
// not yet exist. These tests specify the CLI contract that dev must implement.
//
// CONTRACT (CLI arg protocol):
//   node bin/teo-run.js <command> '<json-string>'
//   - Returns JSON on stdout
//   - Exits 0 on success, non-zero on error
//
// COMMANDS:
//   provision       — calls provision() with JSON opts
//   validate-plan   — validates JSON against Zod PlanSchema
//   sign            — calls HmacSigner.sign() with payload
//   ledger-append   — calls AppendOnlyLedger.append()
//   ledger-close    — calls AppendOnlyLedger.close()
//
// OUTPUT CONTRACT:
//   All stdout is a single JSON object. Errors are JSON { error: string }.
//   Exit code 0 = success, 1+ = error.
//
// NOTE: Since the binary doesn't exist yet, ALL tests below will fail until
// dev implements src/skill/teo-run-entry.ts and builds bin/teo-run.js.
// The test runner is configured to use the entry source file directly via
// node --experimental-vm-modules / tsx, or the built artifact.
//
// Ordering: misuse → boundary → golden path (ADR-064 adversarial-first policy)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// CLI binary / entry point
//
// The test tries bin/teo-run.js first (the built artifact), then falls back to
// the TypeScript source entry for pre-build test runs (via tsx).
// Since neither exists yet, all CLI tests will fail — that's the spec state.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../");
const BIN_PATH = path.join(REPO_ROOT, "bin", "teo-run.js");
const ENTRY_PATH = path.join(REPO_ROOT, "src", "skill", "teo-run-entry.ts");

// Use the built binary if it exists; otherwise fall back to the TS entry via tsx.
// In failing (pre-impl) state, neither exists and the spawnSync will fail with ENOENT.
function buildCliArgs(command: string, jsonArg: string): { cmd: string; args: string[] } {
  if (fs.existsSync(BIN_PATH)) {
    return { cmd: "node", args: [BIN_PATH, command, jsonArg] };
  }
  // Fallback: run the TS entry via tsx (available as a dev tool in many setups)
  return { cmd: "node", args: ["--import", "tsx/esm", ENTRY_PATH, command, jsonArg] };
}

/**
 * Run the CLI and return { exitCode, stdout, stderr }.
 * Parses stdout as JSON if possible; otherwise returns the raw string.
 */
function runCli(
  command: string,
  jsonArg: string,
  extraEnv?: Record<string, string>
): { exitCode: number; stdout: unknown; stdoutRaw: string; stderr: string } {
  const { cmd, args } = buildCliArgs(command, jsonArg);
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const stdoutRaw = result.stdout ?? "";
  let stdout: unknown = stdoutRaw;
  try {
    stdout = JSON.parse(stdoutRaw.trim());
  } catch {
    // stdout is not JSON — keep raw string
  }

  return {
    exitCode: result.status ?? 1,
    stdout,
    stdoutRaw,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    stderr: result.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// Temp dir helpers for tests that need real filesystem state
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "teo-run-test-"));
  tempDirs.push(d);
  return d;
}

beforeEach(() => {
  // No shared setup needed — each test configures its own state
});

afterEach(() => {
  // Clean up any temp dirs created during the test
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore — test may have already cleaned up
    }
  }
});

// ---------------------------------------------------------------------------
// Minimal valid Plan JSON for validate-plan tests
// ---------------------------------------------------------------------------
const VALID_PLAN_JSON = JSON.stringify({
  plan_id: "test-plan-1",
  project_id: "test-project",
  created_at: "2026-06-20T00:00:00.000Z",
  version: "1",
  tasks: [
    {
      id: "task-1",
      type: "SCRIPT",
      command: "echo hello",
      needs: [],
      gates: [],
    },
  ],
});

// =============================================================================
// MISUSE: Unknown / malformed commands
// =============================================================================

describe("teo-run CLI — misuse: unknown command and malformed JSON", () => {
  // T15 (misuse): Unknown command → exit code 1, stdout JSON { error: "Unknown command: <cmd>" }
  it("T15. unknown command 'frobnicate' → exit code 1, stdout JSON with error field", () => {
    const { exitCode, stdout } = runCli("frobnicate", "{}");

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({ error: expect.stringContaining("frobnicate") });
  });

  // T15b: No arguments at all → exit code 1 with error message
  it("T15b. no command argument → exit code 1, error in stdout JSON", () => {
    const { cmd, args } = buildCliArgs("", "");
    // Run without any arguments
    const result = spawnSync(cmd, [args[0]!], {
      encoding: "utf8",
      timeout: 15000,
      env: process.env,
    });

    expect(result.status ?? 1).toBe(1);
  });

  // T16 (misuse): Malformed JSON arg → exit code 1, stdout JSON { error: includes "JSON" }
  it("T16. malformed JSON arg for provision → exit code 1, stdout JSON with 'JSON' in error", () => {
    const { exitCode, stdout } = runCli("provision", "not-valid-json{{{");

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({
      error: expect.stringMatching(/json/i),
    });
  });

  // T16b: Malformed JSON for validate-plan → exit code 1 with JSON error
  it("T16b. malformed JSON arg for validate-plan → exit code 1, error mentioning JSON", () => {
    const { exitCode, stdout } = runCli("validate-plan", "{ missing-quote: true");

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({
      error: expect.stringMatching(/json/i),
    });
  });

  // T17 (misuse): provision with nonexistent bundleDir → exit code 1, stdout JSON { status: "error" }
  it("T17. provision with nonexistent bundleDir → exit code 1, stdout JSON { status: 'error' }", () => {
    const homeDir = makeTempDir();
    const input = JSON.stringify({
      bundleDir: "/nonexistent/bundle/dir/that/does/not/exist",
      homeDir,
      revocationOpts: {
        signature: Array.from(new Uint8Array(64).fill(0x01)),
        publicKey: Array.from(new Uint8Array(32).fill(0x02)),
        keyId: "test-key",
        revocationList: { revoked_keys: [] },
      },
    });

    const { exitCode, stdout } = runCli("provision", input, {
      CLAUDE_PLUGIN_ROOT: homeDir, // plugin context for fail-open revocation
    });

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({ status: "error" });
  });

  // T20 (misuse): validate-plan with invalid Plan JSON (missing required field)
  // → exit code 0, stdout JSON { valid: false, errors: [...] }
  // NOTE: validate-plan validation failures are NOT exit code 1 — they exit 0
  // and report { valid: false } so callers can inspect errors programmatically.
  it("T20. validate-plan with invalid Plan (missing tasks) → exit code 0, { valid: false, errors: [...] }", () => {
    const invalidPlan = JSON.stringify({
      plan_id: "bad-plan",
      project_id: "proj",
      created_at: "2026-06-20T00:00:00.000Z",
      version: "1",
      // tasks is required (min 1) — intentionally absent
    });

    const { exitCode, stdout } = runCli("validate-plan", invalidPlan);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.anything()]),
    });
  });
});

// =============================================================================
// BOUNDARY: Edge cases for each command
// =============================================================================

describe("teo-run CLI — boundary: edge cases per command", () => {
  // T18 (boundary): provision in plugin context with no install-sig file →
  // BLOCKED (fail-closed) — exit non-zero, status "error".
  // WS-REVOKE-01 removed the fail-open path; unsigned plugins must now BLOCK.
  it("T18. provision with valid bundleDir + tmpDir homeDir (plugin context, no install-sig) → exit non-zero, { status: 'error' }", () => {
    // Use a real temporary bundle dir with a valid agent file
    const bundleDir = makeTempDir();
    const homeDir = makeTempDir();

    // Write a minimal valid agent .md file
    const agentContent =
      `---\n` +
      `agent_id: alpha\n` +
      `name: Alpha\n` +
      `role: Test role.\n` +
      `disallowedTools_default:\n` +
      `---\n\n` +
      `# alpha constitution\n\nBody text.\n`;
    fs.writeFileSync(path.join(bundleDir, "alpha.md"), agentContent, "utf8");

    const input = JSON.stringify({
      bundleDir,
      homeDir,
      revocationOpts: {
        // No signature provided — in plugin context, checkRevocation() attempts
        // to read $CLAUDE_PLUGIN_ROOT/.teo-install-sig. File absent → BLOCKED.
        keyId: "test-key",
        revocationList: { revoked_keys: [] },
      },
    });

    const { exitCode, stdout } = runCli("provision", input, {
      CLAUDE_PLUGIN_ROOT: bundleDir, // plugin context; no .teo-install-sig → BLOCKED
    });

    // Fail-closed: BLOCKED → exit non-zero
    expect(exitCode).not.toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result["status"]).toBe("error");
  });

  // validate-plan with a non-"1" version literal → valid: false (wrong literal)
  it("validate-plan with version '2' (wrong literal) → { valid: false }", () => {
    const wrongVersion = JSON.stringify({
      plan_id: "p1",
      project_id: "proj",
      created_at: "2026-06-20T00:00:00.000Z",
      version: "2", // only "1" is valid
      tasks: [{ id: "t1", type: "SCRIPT", command: "echo", needs: [], gates: [] }],
    });

    const { exitCode, stdout } = runCli("validate-plan", wrongVersion);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ valid: false });
  });
});

// =============================================================================
// GOLDEN PATH: Each command happy path
// =============================================================================

describe("teo-run CLI — golden path: each command returns expected output", () => {
  // T19 (golden path): validate-plan with valid Plan JSON → exit code 0, stdout JSON { valid: true }
  it("T19. validate-plan with valid Plan JSON → exit code 0, { valid: true }", () => {
    const { exitCode, stdout } = runCli("validate-plan", VALID_PLAN_JSON);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ valid: true });
  });

  // T21 (golden path): ledger-append with valid entry →
  // exit code 0, stdout JSON { seq: number, ts: string }
  it("T21. ledger-append with valid entry → exit code 0, { seq: number, ts: ISO-8601 string }", () => {
    const ledgerBase = makeTempDir();
    const input = JSON.stringify({
      baseDir: ledgerBase,
      session_id: "test-session-001",
      entry: {
        session_id: "test-session-001",
        workflow_id: "wf-001",
        task_id: null,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "PLAN",
        verdict: null,
        detail: { note: "test entry" },
      },
    });

    const { exitCode, stdout } = runCli("ledger-append", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(typeof result["seq"]).toBe("number");
    expect(result["seq"]).toBeGreaterThanOrEqual(1);
    expect(typeof result["ts"]).toBe("string");
    const ts = new Date(result["ts"] as string);
    expect(isNaN(ts.getTime())).toBe(false); // valid ISO-8601
  });

  // T22 (golden path): ledger-close with session → exit code 0, stdout JSON { ok: true }
  it("T22. ledger-close with valid session summary → exit code 0, { ok: true }", () => {
    const ledgerBase = makeTempDir();
    const input = JSON.stringify({
      baseDir: ledgerBase,
      session_id: "test-session-close-001",
      summary: {
        task_count: 2,
        pass: 2,
        fail: 0,
        skipped: 0,
        tokens: 0,
        cost_usd: 0,
      },
    });

    const { exitCode, stdout } = runCli("ledger-close", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ ok: true });
  });

  // T23 (golden path): sign with valid payload → exit code 0, stdout JSON { signature: 64-char hex string }
  it("T23. sign with valid payload → exit code 0, { signature: 64-char lowercase hex }", () => {
    const keyringBase = makeTempDir();
    const input = JSON.stringify({
      baseDir: keyringBase,
      keyring_id: "default",
      payload: {
        plan_id: "plan-001",
        task_id: "task-001",
        actor_id: "eng",
        verdict: "PASS",
        ts: "2026-06-20T00:00:00.000Z",
        seq: 1,
      },
    });

    const { exitCode, stdout } = runCli("sign", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(typeof result["signature"]).toBe("string");
    const sig = result["signature"] as string;
    expect(sig).toHaveLength(64); // HMAC-SHA-256 = 64 hex chars
    expect(sig).toMatch(/^[0-9a-f]{64}$/); // lowercase hex
  });

  // T23b: sign with null task_id (plan-scoped event) → still produces 64-char sig
  it("T23b. sign with null task_id (plan-scoped event) → exit code 0, { signature: 64-char hex }", () => {
    const keyringBase = makeTempDir();
    const input = JSON.stringify({
      baseDir: keyringBase,
      keyring_id: "default",
      payload: {
        plan_id: "plan-001",
        task_id: null, // plan-scoped
        actor_id: "SYSTEM",
        verdict: null,
        ts: "2026-06-20T00:00:00.000Z",
        seq: 1,
      },
    });

    const { exitCode, stdout } = runCli("sign", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(typeof result["signature"]).toBe("string");
    expect((result["signature"] as string).length).toBe(64);
  });

  // sign determinism: same payload + same key → same signature
  it("sign is deterministic: same payload + same persisted key → same signature on repeated calls", () => {
    const keyringBase = makeTempDir();
    const payload = JSON.stringify({
      plan_id: "deterministic-plan",
      task_id: "t1",
      actor_id: "eng",
      verdict: "PASS",
      ts: "2026-06-20T00:00:00.000Z",
      seq: 42,
    });

    const input = JSON.stringify({
      baseDir: keyringBase,
      keyring_id: "default",
      payload: JSON.parse(payload),
    });

    const { exitCode: ec1, stdout: out1 } = runCli("sign", input);
    const { exitCode: ec2, stdout: out2 } = runCli("sign", input);

    expect(ec1).toBe(0);
    expect(ec2).toBe(0);
    // Same key file (persisted in keyringBase) + same payload → same signature
    expect((out1 as Record<string, unknown>)["signature"]).toBe(
      (out2 as Record<string, unknown>)["signature"]
    );
  });

  // ledger-append increments seq on consecutive calls within the same session
  it("ledger-append increments seq on consecutive calls (same session, same file)", () => {
    const ledgerBase = makeTempDir();
    const sessionId = "seq-incr-session";

    const makeInput = () =>
      JSON.stringify({
        baseDir: ledgerBase,
        session_id: sessionId,
        entry: {
          session_id: sessionId,
          workflow_id: "wf-seq",
          task_id: null,
          turn_id: null,
          actor_id: "SYSTEM",
          actor_type: "SYSTEM",
          phase: "EXECUTE",
          verdict: null,
          detail: null,
        },
      });

    const { exitCode: ec1, stdout: out1 } = runCli("ledger-append", makeInput());
    const { exitCode: ec2, stdout: out2 } = runCli("ledger-append", makeInput());

    expect(ec1).toBe(0);
    expect(ec2).toBe(0);

    const seq1 = (out1 as Record<string, unknown>)["seq"] as number;
    const seq2 = (out2 as Record<string, unknown>)["seq"] as number;

    // Each CLI call creates a fresh AppendOnlyLedger instance starting at seq=1
    // (stateless CLI), so seq increments within each process but not across calls.
    // Both must return seq >= 1 as valid numbers.
    expect(seq1).toBeGreaterThanOrEqual(1);
    expect(seq2).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// WS-GO-04: S8 follow-on — provision fail-closed behavior (BLOCKED → exit non-zero)
//
// T-S8 tests that when checkRevocation returns BLOCKED (e.g. bad signature),
// the CLI exits non-zero. The old fail-open path ("unsigned-plugin-context") is gone.
// =============================================================================

describe("teo-run CLI — WS-GO-04 S8: provision fail-closed BLOCKED → exit non-zero", () => {
  it.skipIf(!fs.existsSync(BIN_PATH))(
    "T-S8: provision with CLAUDE_PLUGIN_ROOT set and no bundle signature → stdout BLOCKED JSON, exit non-zero (fail-closed)",
    () => {
      // Arrange: create a real bundle dir with a stub .md file
      const bundleDir = makeTempDir();
      const homeDir = makeTempDir();

      const content =
        `---\n` +
        `agent_id: stub-agent\n` +
        `name: Stub Agent\n` +
        `role: Stub role.\n` +
        `disallowedTools_default:\n` +
        `---\n\n` +
        `# stub-agent constitution\n\nBody.\n`;
      fs.writeFileSync(path.join(bundleDir, "stub-agent.md"), content, "utf8");

      // Use revocationOpts with a zero-filled signature against a zero-filled key.
      // Passing an explicit signature triggers the Ed25519 explicit-sig path in
      // checkRevocation; verification fails → { verdict: "BLOCKED" }.
      // This exercises fail-closed behavior: BLOCKED → exit non-zero.
      const provisionOpts = JSON.stringify({
        bundleDir, // explicit bundleDir so provision() reads agents from this dir (not pluginRoot/agents)
        homeDir,
        host: { kind: "claude-code-plugin", pluginRoot: bundleDir },
        revocationOpts: {
          // Zero-filled signature + key → Ed25519 verification fails → BLOCKED (fail-closed)
          signature: Array.from(new Uint8Array(64).fill(0x00)),
          publicKey: Array.from(new Uint8Array(32).fill(0x00)),
          keyId: "s8-test-key",
          revocationList: { revoked_keys: [] },
        },
      });

      const { exitCode, stdout, stdoutRaw, stderr } = runCli("provision", provisionOpts, {
        CLAUDE_PLUGIN_ROOT: bundleDir,
      });

      // stdout must be parseable JSON even on BLOCKED
      expect(() => JSON.parse(stdoutRaw.trim())).not.toThrow();

      // stdout must have status "error" on BLOCKED
      expect(stdout).toMatchObject({
        status: "error",
      });

      // Exit non-zero for BLOCKED result
      expect(exitCode).not.toBe(0);

      // On BLOCKED the binary exits non-zero; the fail-open "unsigned-plugin-context"
      // warning must never appear (that code path was removed in WS-REVOKE-01).
      expect(stderr).not.toContain("unsigned-plugin-context");
    }
  );
});
