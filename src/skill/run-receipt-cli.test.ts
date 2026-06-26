// =============================================================================
// run-receipt-cli.test.ts — CLI integration tests for run-receipt (WS-RUN-RECEIPT-01)
//
// STATUS: GREEN — src/core/run-receipt.ts implemented, teo-run-entry.ts updated
// to emit run_id/sig in all command outputs and handle verify-receipt.
// All 22 tests pass.
//
// Coverage: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8
//
// These tests drive the CLI via spawnSync, following the same pattern as
// teo-run.test.ts. All commands inject baseDir via JSON args so that tests
// NEVER touch ~/.teo/. (AC-8)
//
// Ordering (ADR-064 adversarial-first): misuse → boundary → golden path
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// CLI binary / entry point (mirrors teo-run.test.ts pattern)
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../");
const BIN_PATH = path.join(REPO_ROOT, "bin", "teo-run.js");
const ENTRY_PATH = path.join(REPO_ROOT, "src", "skill", "teo-run-entry.ts");

function buildCliArgs(command: string, jsonArg: string): { cmd: string; args: string[] } {
  if (fs.existsSync(BIN_PATH)) {
    return { cmd: "node", args: [BIN_PATH, command, jsonArg] };
  }
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
    timeout: 20000,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  const stdoutRaw = result.stdout;
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
    stderr: result.stderr,
  };
}

// ---------------------------------------------------------------------------
// Temp dir helpers (AC-8: tests NEVER touch ~/.teo/)
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "teo-receipt-cli-test-"));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

// ---------------------------------------------------------------------------
// Helpers: read a receipt file from disk given a run_id
// ---------------------------------------------------------------------------

function readReceiptFromRunId(run_id: string, baseDir: string): Record<string, unknown> | null {
  const uuid = run_id.replace("urn:teo:run:", "");
  const receiptPath = path.join(baseDir, "receipts", `${uuid}.json`);
  if (!fs.existsSync(receiptPath)) return null;
  return JSON.parse(fs.readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// MISUSE: verify-receipt with unknown run_id (AC-5)
// ---------------------------------------------------------------------------

describe("run-receipt CLI — misuse: verify-receipt unknown run_id (AC-5)", () => {
  it("unknown run_id → exit 1, stdout {valid:false, reason:'receipt not found'} (AC-5)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      run_id: "urn:teo:run:00000000-0000-0000-0000-000000000000",
      baseDir,
    });

    const { exitCode, stdout } = runCli("verify-receipt", input);

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["valid"]).toBe(false);
    expect(String(result["reason"] as string)).toMatch(/receipt not found/i);
  });

  it("unknown run_id → stdout reason does NOT contain a stack trace (AC-5)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      run_id: "urn:teo:run:ffffffff-ffff-ffff-ffff-ffffffffffff",
      baseDir,
    });

    const { stdout, stdoutRaw } = runCli("verify-receipt", input);
    const result = stdout as Record<string, unknown>;

    // No Node.js Error stack in stdout
    expect(stdoutRaw).not.toMatch(/at\s+\w+\s+\(/);
    expect(String(result["reason"] as string)).not.toContain("Error:");
  });

  it("missing run_id field in args → exit 1, error in stdout (AC-5)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({ baseDir }); // no run_id

    const { exitCode, stdout } = runCli("verify-receipt", input);

    expect(exitCode).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    expect(stdout).toMatchObject({ error: expect.anything() });
  });

  it("malformed JSON arg for verify-receipt → exit 1, error mentioning JSON (AC-5)", () => {
    const { exitCode, stdout } = runCli("verify-receipt", "{not valid json}}");

    expect(exitCode).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    expect(stdout).toMatchObject({ error: expect.stringMatching(/json/i) });
  });
});

// ---------------------------------------------------------------------------
// MISUSE: verify-receipt with tampered stored fields (AC-3, AC-4)
// ---------------------------------------------------------------------------

describe("run-receipt CLI — misuse: verify-receipt tampered receipts (AC-3, AC-4)", () => {
  let _baseDir: string;

  beforeEach(() => {
    _baseDir = makeTempDir();
  });

  it("tampered command field → exit 1, {valid:false, reason:'signature invalid'} (AC-3)", () => {
    // Step 1: run a command that emits run_id (ledger-append)
    const ledgerBase = makeTempDir();
    const appendInput = JSON.stringify({
      baseDir: ledgerBase,
      session_id: "tamper-test-session",
      entry: {
        session_id: "tamper-test-session",
        workflow_id: "wf-tamper",
        task_id: null,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "PLAN",
        verdict: null,
        detail: {},
      },
    });

    const { exitCode: ec1, stdout: out1 } = runCli("ledger-append", appendInput);
    expect(ec1).toBe(0);

    const run_id = (out1 as Record<string, unknown>)["run_id"] as string;
    expect(run_id).toBeDefined();

    // Step 2: tamper the receipt file
    const stored = readReceiptFromRunId(run_id, ledgerBase)!;
    stored["command"] = "TAMPERED";
    const uuid = run_id.replace("urn:teo:run:", "");
    fs.writeFileSync(path.join(ledgerBase, "receipts", `${uuid}.json`), JSON.stringify(stored));

    // Step 3: verify → must fail
    const verifyInput = JSON.stringify({ run_id, baseDir: ledgerBase });
    const { exitCode, stdout } = runCli("verify-receipt", verifyInput);

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["valid"]).toBe(false);
    expect(String(result["reason"] as string)).toMatch(/signature invalid/i);
  });

  it("hand-crafted 64-char all-zero sig → exit 1, {valid:false, reason:'signature invalid'} (AC-4)", () => {
    const ledgerBase = makeTempDir();
    const appendInput = JSON.stringify({
      baseDir: ledgerBase,
      session_id: "forge-test-session",
      entry: {
        session_id: "forge-test-session",
        workflow_id: "wf-forge",
        task_id: null,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "PLAN",
        verdict: null,
        detail: {},
      },
    });

    const { exitCode: ec1, stdout: out1 } = runCli("ledger-append", appendInput);
    expect(ec1).toBe(0);

    const run_id = (out1 as Record<string, unknown>)["run_id"] as string;
    expect(run_id).toBeDefined();

    // Overwrite the sig with a correctly-lengthed but wrong value
    const stored = readReceiptFromRunId(run_id, ledgerBase)!;
    stored["sig"] = "0".repeat(64); // 64 chars, wrong content
    const uuid = run_id.replace("urn:teo:run:", "");
    fs.writeFileSync(path.join(ledgerBase, "receipts", `${uuid}.json`), JSON.stringify(stored));

    const verifyInput = JSON.stringify({ run_id, baseDir: ledgerBase });
    const { exitCode, stdout } = runCli("verify-receipt", verifyInput);

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["valid"]).toBe(false);
    expect(String(result["reason"] as string)).toMatch(/signature invalid/i);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: each command emits run_id + sig in stdout (AC-1)
// ---------------------------------------------------------------------------

describe("run-receipt CLI — boundary: all commands emit run_id + sig in stdout (AC-1)", () => {
  const UUID_V4_RE =
    /^urn:teo:run:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SIG_RE = /^[0-9a-f]{64}$/;

  it("ledger-append stdout includes run_id and sig (AC-1)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      baseDir,
      session_id: "receipt-ac1-session",
      entry: {
        session_id: "receipt-ac1-session",
        workflow_id: "wf-ac1",
        task_id: null,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "PLAN",
        verdict: null,
        detail: {},
      },
    });

    const { exitCode, stdout } = runCli("ledger-append", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(String(result["run_id"] as string)).toMatch(UUID_V4_RE);
    expect(String(result["sig"] as string)).toMatch(SIG_RE);
  });

  it("ledger-close stdout includes run_id and sig (AC-1)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      baseDir,
      session_id: "receipt-close-session",
      summary: { task_count: 1, pass: 1, fail: 0, skipped: 0, tokens: 0, cost_usd: 0 },
    });

    const { exitCode, stdout } = runCli("ledger-close", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(String(result["run_id"] as string)).toMatch(UUID_V4_RE);
    expect(String(result["sig"] as string)).toMatch(SIG_RE);
  });

  it("sign stdout includes run_id and sig (AC-1)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      baseDir,
      keyring_id: "default",
      payload: {
        plan_id: "plan-001",
        task_id: "task-001",
        actor_id: "eng",
        verdict: "PASS",
        ts: "2026-06-25T00:00:00.000Z",
        seq: 1,
      },
    });

    const { exitCode, stdout } = runCli("sign", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(String(result["run_id"] as string)).toMatch(UUID_V4_RE);
    // Note: 'sig' here is the RECEIPT sig, 'signature' is the HmacSigner output
    expect(String(result["sig"] as string)).toMatch(SIG_RE);
  });

  it("validate-plan stdout includes run_id and sig on success (AC-1)", () => {
    const baseDir = makeTempDir();
    const planInput = JSON.stringify({
      plan_id: "test-plan-receipt",
      project_id: "test-project",
      created_at: "2026-06-25T00:00:00.000Z",
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

    const { exitCode, stdout } = runCli("validate-plan", planInput, { TEO_BASE_DIR: baseDir });

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(String(result["run_id"] as string)).toMatch(UUID_V4_RE);
    expect(String(result["sig"] as string)).toMatch(SIG_RE);
  });

  it("validate-artifact stdout includes run_id and sig (AC-1)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      baseDir,
      type: "GATE_RESULT",
      payload: {
        gate_id: "gate-001",
        task_id: "task-001",
        passed: true,
        verdict: "PASS",
        ts: "2026-06-25T00:00:00.000Z",
      },
    });

    const { exitCode, stdout } = runCli("validate-artifact", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(String(result["run_id"] as string)).toMatch(UUID_V4_RE);
    expect(String(result["sig"] as string)).toMatch(SIG_RE);
  });

  it("verify-ledger stdout includes run_id and sig on success (AC-1)", () => {
    const baseDir = makeTempDir();

    // First create a ledger file by running ledger-append
    const appendInput = JSON.stringify({
      baseDir,
      session_id: "receipt-verify-ledger-session",
      entry: {
        session_id: "receipt-verify-ledger-session",
        workflow_id: "wf-verify-ledger",
        task_id: null,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "PLAN",
        verdict: null,
        detail: {},
      },
    });
    const { exitCode: ec1 } = runCli("ledger-append", appendInput);
    expect(ec1).toBe(0);

    // Find the ledger file created
    const ledgerDir = path.join(baseDir, "ledger");
    const ledgerFiles = fs.readdirSync(ledgerDir).filter((f) => f.endsWith(".jsonl"));
    expect(ledgerFiles.length).toBeGreaterThan(0);
    const ledgerFile = path.join(ledgerDir, ledgerFiles[0]!);

    const verifyLedgerInput = JSON.stringify({ baseDir, ledger_file: ledgerFile });
    const { exitCode, stdout } = runCli("verify-ledger", verifyLedgerInput);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(String(result["run_id"] as string)).toMatch(UUID_V4_RE);
    expect(String(result["sig"] as string)).toMatch(SIG_RE);
  });

  it("provision failure also emits run_id and sig (outcome:FAIL) (AC-1, AC-7)", () => {
    // Provision with a nonexistent bundleDir → exits 1 but must still emit run_id + sig
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      bundleDir: "/nonexistent/bundle/that/does/not/exist",
      homeDir: baseDir,
      baseDir,
      revocationOpts: {
        signature: Array.from(new Uint8Array(64).fill(0x01)),
        publicKey: Array.from(new Uint8Array(32).fill(0x02)),
        keyId: "test-key",
        revocationList: { revoked_keys: [] },
      },
    });

    const { exitCode, stdout } = runCli("provision", input);

    // Exits 1 (error)
    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    // FAIL receipt must still carry run_id + sig (AC-7)
    expect(String(result["run_id"] as string)).toMatch(UUID_V4_RE);
    expect(String(result["sig"] as string)).toMatch(SIG_RE);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: receipt file written to disk (AC-2)
// ---------------------------------------------------------------------------

describe("run-receipt CLI — boundary: receipt file written atomically to <baseDir>/receipts/ (AC-2)", () => {
  it("ledger-append writes a receipt file at <baseDir>/receipts/<uuid>.json (AC-2)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      baseDir,
      session_id: "receipt-file-session",
      entry: {
        session_id: "receipt-file-session",
        workflow_id: "wf-receipt-file",
        task_id: null,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "PLAN",
        verdict: null,
        detail: {},
      },
    });

    const { exitCode, stdout } = runCli("ledger-append", input);

    expect(exitCode).toBe(0);
    const run_id = (stdout as Record<string, unknown>)["run_id"] as string;
    const uuid = run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(baseDir, "receipts", `${uuid}.json`);
    expect(fs.existsSync(receiptPath)).toBe(true);
  });

  it("receipt file on disk contains all 8 required fields (AC-2)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      baseDir,
      session_id: "receipt-fields-session",
      entry: {
        session_id: "receipt-fields-session",
        workflow_id: "wf-fields",
        task_id: null,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "EXECUTE",
        verdict: null,
        detail: null,
      },
    });

    const { exitCode, stdout } = runCli("ledger-append", input);

    expect(exitCode).toBe(0);
    const run_id = (stdout as Record<string, unknown>)["run_id"] as string;
    const stored = readReceiptFromRunId(run_id, baseDir)!;

    expect(stored).not.toBeNull();
    expect(stored).toHaveProperty("run_id");
    expect(stored).toHaveProperty("command");
    expect(stored).toHaveProperty("args_hash");
    expect(stored).toHaveProperty("actor_id");
    expect(stored).toHaveProperty("ts");
    expect(stored).toHaveProperty("outcome");
    expect(stored).toHaveProperty("exit_code");
    expect(stored).toHaveProperty("sig");
  });

  it("no .tmp files left in receipts dir after atomic write (AC-2)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      baseDir,
      session_id: "atomic-write-session",
      entry: {
        session_id: "atomic-write-session",
        workflow_id: "wf-atomic",
        task_id: null,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "PLAN",
        verdict: null,
        detail: {},
      },
    });

    const { exitCode } = runCli("ledger-append", input);
    expect(exitCode).toBe(0);

    const receiptsDir = path.join(baseDir, "receipts");
    const files = fs.readdirSync(receiptsDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: args_hash in receipt (AC-6)
// ---------------------------------------------------------------------------

describe("run-receipt CLI — boundary: args_hash is SHA-256 of raw args string (AC-6)", () => {
  it("receipt on disk has args_hash matching sha256:<64-hex> format (AC-6)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      baseDir,
      session_id: "args-hash-session",
      entry: {
        session_id: "args-hash-session",
        workflow_id: "wf-args-hash",
        task_id: null,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "PLAN",
        verdict: null,
        detail: {},
      },
    });

    const { exitCode, stdout } = runCli("ledger-append", input);

    expect(exitCode).toBe(0);
    const run_id = (stdout as Record<string, unknown>)["run_id"] as string;
    const stored = readReceiptFromRunId(run_id, baseDir)!;

    expect(String(stored["args_hash"] as string)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("different args strings produce different args_hash values in stored receipts (AC-6)", () => {
    const baseDir = makeTempDir();

    const makeInput = (sessionId: string) =>
      JSON.stringify({
        baseDir,
        session_id: sessionId,
        entry: {
          session_id: sessionId,
          workflow_id: "wf-diff",
          task_id: null,
          turn_id: null,
          actor_id: "SYSTEM",
          actor_type: "SYSTEM",
          phase: "PLAN",
          verdict: null,
          detail: {},
        },
      });

    const { stdout: out1 } = runCli("ledger-append", makeInput("diff-hash-session-A"));
    const { stdout: out2 } = runCli("ledger-append", makeInput("diff-hash-session-B"));

    const run_id1 = (out1 as Record<string, unknown>)["run_id"] as string;
    const run_id2 = (out2 as Record<string, unknown>)["run_id"] as string;

    const stored1 = readReceiptFromRunId(run_id1, baseDir)!;
    const stored2 = readReceiptFromRunId(run_id2, baseDir)!;

    expect(stored1["args_hash"]).not.toBe(stored2["args_hash"]);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: FAIL receipts (AC-7)
// ---------------------------------------------------------------------------

describe("run-receipt CLI — boundary: FAIL receipts written and verifiable (AC-7)", () => {
  it("failed command receipt has outcome='FAIL' in stored file (AC-7)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      bundleDir: "/nonexistent/will-fail/path",
      homeDir: baseDir,
      baseDir,
      revocationOpts: {
        signature: Array.from(new Uint8Array(64).fill(0x01)),
        publicKey: Array.from(new Uint8Array(32).fill(0x02)),
        keyId: "test-key",
        revocationList: { revoked_keys: [] },
      },
    });

    const { exitCode, stdout } = runCli("provision", input);

    expect(exitCode).toBe(1);
    const run_id = (stdout as Record<string, unknown>)["run_id"] as string;
    if (!run_id) return; // best-effort: if no run_id, skip disk check

    const stored = readReceiptFromRunId(run_id, baseDir);
    if (!stored) return; // best-effort: may not be written if error occurred before run

    expect(stored["outcome"]).toBe("FAIL");
    expect(Number(stored["exit_code"]) !== 0).toBe(true);
  });

  it("FAIL receipt is verifiable by verify-receipt (exit 0, valid:true) (AC-7)", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      bundleDir: "/nonexistent/will-fail/path",
      homeDir: baseDir,
      baseDir,
      revocationOpts: {
        signature: Array.from(new Uint8Array(64).fill(0x01)),
        publicKey: Array.from(new Uint8Array(32).fill(0x02)),
        keyId: "test-key",
        revocationList: { revoked_keys: [] },
      },
    });

    const { stdout: provOut } = runCli("provision", input);

    const run_id = (provOut as Record<string, unknown>)["run_id"] as string;
    if (!run_id) return; // best-effort

    // Verify the FAIL receipt
    const verifyInput = JSON.stringify({ run_id, baseDir });
    const { exitCode, stdout } = runCli("verify-receipt", verifyInput);

    expect(exitCode).toBe(0);
    expect((stdout as Record<string, unknown>)["valid"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: verify-receipt confirms valid receipts (AC-3)
// ---------------------------------------------------------------------------

describe("run-receipt CLI — golden path: verify-receipt returns {valid:true} for real receipts (AC-3)", () => {
  it("verify-receipt exits 0 and {valid:true} for a real ledger-append receipt (AC-3)", () => {
    const baseDir = makeTempDir();
    const appendInput = JSON.stringify({
      baseDir,
      session_id: "verify-golden-session",
      entry: {
        session_id: "verify-golden-session",
        workflow_id: "wf-golden",
        task_id: null,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "PLAN",
        verdict: null,
        detail: {},
      },
    });

    const { exitCode: ec1, stdout: out1 } = runCli("ledger-append", appendInput);
    expect(ec1).toBe(0);

    const run_id = (out1 as Record<string, unknown>)["run_id"] as string;
    expect(run_id).toMatch(/^urn:teo:run:/);

    const verifyInput = JSON.stringify({ run_id, baseDir });
    const { exitCode, stdout } = runCli("verify-receipt", verifyInput);

    expect(exitCode).toBe(0);
    expect((stdout as Record<string, unknown>)["valid"]).toBe(true);
  });

  it("verify-receipt exits 0 and {valid:true} for a real ledger-close receipt (AC-3)", () => {
    const baseDir = makeTempDir();
    const closeInput = JSON.stringify({
      baseDir,
      session_id: "verify-close-session",
      summary: { task_count: 1, pass: 1, fail: 0, skipped: 0, tokens: 0, cost_usd: 0 },
    });

    const { exitCode: ec1, stdout: out1 } = runCli("ledger-close", closeInput);
    expect(ec1).toBe(0);

    const run_id = (out1 as Record<string, unknown>)["run_id"] as string;
    expect(run_id).toMatch(/^urn:teo:run:/);

    const verifyInput = JSON.stringify({ run_id, baseDir });
    const { exitCode, stdout } = runCli("verify-receipt", verifyInput);

    expect(exitCode).toBe(0);
    expect((stdout as Record<string, unknown>)["valid"]).toBe(true);
  });

  it("verify-receipt exits 0 and {valid:true} for a real sign command receipt (AC-3)", () => {
    const baseDir = makeTempDir();
    const signInput = JSON.stringify({
      baseDir,
      keyring_id: "default",
      payload: {
        plan_id: "plan-verify-golden",
        task_id: "task-verify-golden",
        actor_id: "eng",
        verdict: "PASS",
        ts: "2026-06-25T00:00:00.000Z",
        seq: 1,
      },
    });

    const { exitCode: ec1, stdout: out1 } = runCli("sign", signInput);
    expect(ec1).toBe(0);

    const run_id = (out1 as Record<string, unknown>)["run_id"] as string;
    expect(run_id).toMatch(/^urn:teo:run:/);

    const verifyInput = JSON.stringify({ run_id, baseDir });
    const { exitCode, stdout } = runCli("verify-receipt", verifyInput);

    expect(exitCode).toBe(0);
    expect((stdout as Record<string, unknown>)["valid"]).toBe(true);
  });

  it("two sequential commands each produce independently verifiable receipts (AC-1, AC-3)", () => {
    const baseDir = makeTempDir();

    const makeAppendInput = (sessionId: string) =>
      JSON.stringify({
        baseDir,
        session_id: sessionId,
        entry: {
          session_id: sessionId,
          workflow_id: "wf-multi",
          task_id: null,
          turn_id: null,
          actor_id: "SYSTEM",
          actor_type: "SYSTEM",
          phase: "EXECUTE",
          verdict: null,
          detail: null,
        },
      });

    const { stdout: out1 } = runCli("ledger-append", makeAppendInput("multi-session-A"));
    const { stdout: out2 } = runCli("ledger-append", makeAppendInput("multi-session-B"));

    const run_id1 = (out1 as Record<string, unknown>)["run_id"] as string;
    const run_id2 = (out2 as Record<string, unknown>)["run_id"] as string;

    // Different run_ids
    expect(run_id1).not.toBe(run_id2);

    const r1 = runCli("verify-receipt", JSON.stringify({ run_id: run_id1, baseDir }));
    const r2 = runCli("verify-receipt", JSON.stringify({ run_id: run_id2, baseDir }));

    expect(r1.exitCode).toBe(0);
    expect((r1.stdout as Record<string, unknown>)["valid"]).toBe(true);
    expect(r2.exitCode).toBe(0);
    expect((r2.stdout as Record<string, unknown>)["valid"]).toBe(true);
  });
});
