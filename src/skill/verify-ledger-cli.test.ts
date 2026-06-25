// =============================================================================
// verify-ledger-cli.test.ts — WS-08: verify-ledger CLI command integration tests
//
// STATUS: FAILING — verify-ledger command not yet implemented in teo-run-entry.ts
//
// CONTRACT (CLI arg protocol):
//   node bin/teo-run.js verify-ledger '<json-string>'
//
// INPUT CONTRACT:
//   {
//     ledger_file: string;   // absolute path to the .jsonl file to verify
//     public_key?: string;   // hex-encoded ed25519 public key (optional — omit to skip sig verification)
//   }
//
// OUTPUT CONTRACT (success):
//   {
//     ok: true;
//     entry_count: number;   // total number of lines in the file
//     chain_intact: true;    // hash chain is valid (or seq monotonic when no prev_hash fields)
//   }
//
// OUTPUT CONTRACT (failure):
//   {
//     ok: false;
//     error: string;           // human-readable error
//     broken_at_seq?: number;  // seq number where chain break detected (when applicable)
//   }
//
// EXIT CODES:
//   0 — valid chain / structurally intact ledger
//   1 — broken chain, missing file, malformed input, or any error
//
// HASH CHAIN SEMANTICS:
//   Two modes:
//   1. No prev_hash fields anywhere → seq-only verification:
//      seq must be monotonically increasing 1..N with no gaps or duplicates.
//   2. prev_hash fields present → hash chain verification:
//      each entry's prev_hash must equal SHA-256 of the prior line's raw JSON.
//      First entry's prev_hash must be null (genesis).
//
// SIGNATURE SEMANTICS:
//   When public_key is provided (hex-encoded), each entry that has a `signature`
//   field (hex-encoded) is verified via ed25519 verifyAsync against the entry's
//   raw JSON line. Any failed verification → {ok:false, error:...}.
//
// Ordering: misuse → boundary → golden path (ADR-064 adversarial-first policy)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AppendOnlyLedger } from "../core/ledger.js";

// ---------------------------------------------------------------------------
// CLI binary / entry point — same resolution strategy as evaluate-gate-cli.test.ts
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
// Temp dir helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "teo-verify-ledger-test-"));
  tempDirs.push(d);
  return d;
}

beforeEach(() => {
  // No shared setup needed — each test configures its own ledger state
});

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore — test may have already cleaned up
    }
  }
});

// ---------------------------------------------------------------------------
// Shared minimal event shape used when writing ledger entries directly
// ---------------------------------------------------------------------------

const MINIMAL_EVENT_BASE = {
  session_id: "session-test",
  workflow_id: "workflow-test",
  task_id: null,
  turn_id: null,
  actor_id: "SYSTEM",
  actor_type: "SYSTEM" as const,
  phase: "PLAN",
  verdict: null,
  detail: null,
};

// =============================================================================
// MISUSE: Missing required fields and malformed input
// =============================================================================

describe("verify-ledger CLI — misuse: missing required fields and malformed input", () => {
  // M1: missing ledger_file field → exit 1, JSON error
  it("M1. missing ledger_file field → exit 1, JSON { ok: false, error: string }", () => {
    const { exitCode, stdout } = runCli("verify-ledger", JSON.stringify({}));

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(typeof result["error"]).toBe("string");
    expect((result["error"] as string).length).toBeGreaterThan(0);
  });

  // M2: ledger_file is not a string (number) → exit 1, JSON error
  it("M2. ledger_file is not a string (number) → exit 1, JSON { ok: false, error: string }", () => {
    const { exitCode, stdout } = runCli("verify-ledger", JSON.stringify({ ledger_file: 42 }));

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(typeof result["error"]).toBe("string");
  });

  // M3: ledger_file is not a string (null) → exit 1, JSON error
  it("M3. ledger_file is null → exit 1, JSON { ok: false, error: string }", () => {
    const { exitCode, stdout } = runCli("verify-ledger", JSON.stringify({ ledger_file: null }));

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(typeof result["error"]).toBe("string");
  });

  // M4: file does not exist → exit 1, JSON error
  it("M4. ledger_file path does not exist → exit 1, JSON { ok: false, error: string }", () => {
    const baseDir = makeTempDir();
    const nonExistent = path.join(baseDir, "does-not-exist.jsonl");

    const { exitCode, stdout } = runCli(
      "verify-ledger",
      JSON.stringify({ ledger_file: nonExistent })
    );

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(typeof result["error"]).toBe("string");
    // error message should reference the path or indicate file not found
    expect(result["error"]).toBeTruthy();
  });

  // M5: empty JSONL file (zero bytes) → exit 1, a valid ledger has at least 1 entry
  it("M5. empty JSONL file (zero bytes) → exit 1, JSON { ok: false, error: string }", () => {
    const baseDir = makeTempDir();
    const emptyFile = path.join(baseDir, "empty.jsonl");
    fs.writeFileSync(emptyFile, "", "utf8");

    const { exitCode, stdout } = runCli(
      "verify-ledger",
      JSON.stringify({ ledger_file: emptyFile })
    );

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(typeof result["error"]).toBe("string");
  });

  // M6: malformed JSONL (a line that is not valid JSON) → exit 1, JSON error
  it("M6. malformed JSONL (line is not valid JSON) → exit 1, JSON { ok: false, error: string }", () => {
    const baseDir = makeTempDir();
    const badFile = path.join(baseDir, "malformed.jsonl");
    // First line looks valid, second line is garbage
    fs.writeFileSync(badFile, '{"seq":1,"event_id":"abc"}\nnot-valid-json-at-all\n', "utf8");

    const { exitCode, stdout } = runCli("verify-ledger", JSON.stringify({ ledger_file: badFile }));

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(typeof result["error"]).toBe("string");
  });

  // M7: malformed top-level JSON argument to CLI → exit 1, error mentioning JSON
  it("M7. malformed JSON arg to CLI → exit 1, error mentioning 'JSON'", () => {
    const { exitCode, stdout } = runCli("verify-ledger", "not-valid-json{{{");

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result).toHaveProperty("error");
    expect(result["error"]).toMatch(/json/i);
  });
});

// =============================================================================
// BOUNDARY: Edge cases and seq verification
// =============================================================================

describe("verify-ledger CLI — boundary: edge cases and seq verification", () => {
  // B8: single entry ledger (seq=1, no prev_hash) → exit 0, ok:true, entry_count:1
  it("B8. single-entry ledger → exit 0, { ok: true, entry_count: 1, chain_intact: true }", () => {
    const baseDir = makeTempDir();
    const sessionId = "session-b8-single";
    const ledger = new AppendOnlyLedger({ session_id: sessionId, baseDir });
    ledger.append({ ...MINIMAL_EVENT_BASE, session_id: sessionId, workflow_id: "wf-b8" });

    const ledgerFile = path.join(baseDir, "ledger", `${sessionId}.jsonl`);

    const { exitCode, stdout } = runCli(
      "verify-ledger",
      JSON.stringify({ ledger_file: ledgerFile })
    );

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(true);
    expect(result["entry_count"]).toBe(1);
    expect(result["chain_intact"]).toBe(true);
  });

  // B9: seq gap (entries with seq 1, 2, 4 — missing 3) → exit 1, broken_at_seq: 4
  it("B9. seq gap (1,2,4 — missing 3) → exit 1, { ok: false, broken_at_seq: 4 }", () => {
    const baseDir = makeTempDir();
    const ledgerDir = path.join(baseDir, "ledger");
    fs.mkdirSync(ledgerDir, { recursive: true });
    const ledgerFile = path.join(ledgerDir, "session-b9-gap.jsonl");

    // Write entries manually with non-contiguous seq numbers
    const lines =
      [
        JSON.stringify({ seq: 1, event_id: "e1", session_id: "s", ts: new Date().toISOString() }),
        JSON.stringify({ seq: 2, event_id: "e2", session_id: "s", ts: new Date().toISOString() }),
        // seq 3 intentionally missing
        JSON.stringify({ seq: 4, event_id: "e4", session_id: "s", ts: new Date().toISOString() }),
      ].join("\n") + "\n";
    fs.writeFileSync(ledgerFile, lines, "utf8");

    const { exitCode, stdout } = runCli(
      "verify-ledger",
      JSON.stringify({ ledger_file: ledgerFile })
    );

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(result["broken_at_seq"]).toBe(4);
  });

  // B10: seq out-of-order (1, 3, 2) → exit 1, { ok: false }
  it("B10. seq out-of-order (1,3,2) → exit 1, { ok: false }", () => {
    const baseDir = makeTempDir();
    const ledgerDir = path.join(baseDir, "ledger");
    fs.mkdirSync(ledgerDir, { recursive: true });
    const ledgerFile = path.join(ledgerDir, "session-b10-outoforder.jsonl");

    const lines =
      [
        JSON.stringify({ seq: 1, event_id: "e1", session_id: "s", ts: new Date().toISOString() }),
        JSON.stringify({ seq: 3, event_id: "e3", session_id: "s", ts: new Date().toISOString() }),
        JSON.stringify({ seq: 2, event_id: "e2", session_id: "s", ts: new Date().toISOString() }),
      ].join("\n") + "\n";
    fs.writeFileSync(ledgerFile, lines, "utf8");

    const { exitCode, stdout } = runCli(
      "verify-ledger",
      JSON.stringify({ ledger_file: ledgerFile })
    );

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
  });

  // B11: seq duplicate (two entries with seq=2) → exit 1, { ok: false }
  it("B11. seq duplicate (two entries with seq=2) → exit 1, { ok: false }", () => {
    const baseDir = makeTempDir();
    const ledgerDir = path.join(baseDir, "ledger");
    fs.mkdirSync(ledgerDir, { recursive: true });
    const ledgerFile = path.join(ledgerDir, "session-b11-dup.jsonl");

    const lines =
      [
        JSON.stringify({ seq: 1, event_id: "e1", session_id: "s", ts: new Date().toISOString() }),
        JSON.stringify({ seq: 2, event_id: "e2a", session_id: "s", ts: new Date().toISOString() }),
        JSON.stringify({ seq: 2, event_id: "e2b", session_id: "s", ts: new Date().toISOString() }),
      ].join("\n") + "\n";
    fs.writeFileSync(ledgerFile, lines, "utf8");

    const { exitCode, stdout } = runCli(
      "verify-ledger",
      JSON.stringify({ ledger_file: ledgerFile })
    );

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
  });
});

// =============================================================================
// GOLDEN PATH: Round-trip and tamper detection
// =============================================================================

describe("verify-ledger CLI — golden path: round-trip and tamper detection", () => {
  // G12: round-trip — write ledger via AppendOnlyLedger (entries + close), verify returns ok:true
  it("G12. round-trip: AppendOnlyLedger 3 entries + close → exit 0, { ok: true, entry_count: 4, chain_intact: true }", () => {
    const baseDir = makeTempDir();
    const sessionId = "session-g12-roundtrip";
    const ledger = new AppendOnlyLedger({ session_id: sessionId, baseDir });

    ledger.append({
      ...MINIMAL_EVENT_BASE,
      session_id: sessionId,
      workflow_id: "wf-g12",
      phase: "PLAN",
    });
    ledger.append({
      ...MINIMAL_EVENT_BASE,
      session_id: sessionId,
      workflow_id: "wf-g12",
      phase: "EXECUTE",
    });
    ledger.append({
      ...MINIMAL_EVENT_BASE,
      session_id: sessionId,
      workflow_id: "wf-g12",
      phase: "GATE",
    });
    ledger.close({
      task_count: 1,
      pass: 1,
      fail: 0,
      skipped: 0,
      tokens: 0,
      cost_usd: 0,
    });

    const ledgerFile = path.join(baseDir, "ledger", `${sessionId}.jsonl`);

    const { exitCode, stdout } = runCli(
      "verify-ledger",
      JSON.stringify({ ledger_file: ledgerFile })
    );

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(true);
    // 3 appends + 1 close = 4 total entries
    expect(result["entry_count"]).toBe(4);
    expect(result["chain_intact"]).toBe(true);
  });

  // G13: round-trip with 5 entries (no close) → exit 0, ok:true, entry_count:5
  it("G13. round-trip: AppendOnlyLedger 5 entries (no close) → exit 0, { ok: true, entry_count: 5, chain_intact: true }", () => {
    const baseDir = makeTempDir();
    const sessionId = "session-g13-fiveentries";
    const ledger = new AppendOnlyLedger({ session_id: sessionId, baseDir });

    for (let i = 0; i < 5; i++) {
      ledger.append({
        ...MINIMAL_EVENT_BASE,
        session_id: sessionId,
        workflow_id: "wf-g13",
        phase: "EXECUTE",
        detail: { step: i + 1 },
      });
    }

    const ledgerFile = path.join(baseDir, "ledger", `${sessionId}.jsonl`);

    const { exitCode, stdout } = runCli(
      "verify-ledger",
      JSON.stringify({ ledger_file: ledgerFile })
    );

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(true);
    expect(result["entry_count"]).toBe(5);
    expect(result["chain_intact"]).toBe(true);
  });

  // G14: tamper detection — modify a field in a middle entry, verify-ledger catches it
  // The verifier must detect the structural corruption (broken seq or hash mismatch).
  it("G14. tamper detection: modify field in middle entry → exit 1, { ok: false }", () => {
    const baseDir = makeTempDir();
    const sessionId = "session-g14-tamper";
    const ledger = new AppendOnlyLedger({ session_id: sessionId, baseDir });

    ledger.append({
      ...MINIMAL_EVENT_BASE,
      session_id: sessionId,
      workflow_id: "wf-g14",
      phase: "PLAN",
    });
    ledger.append({
      ...MINIMAL_EVENT_BASE,
      session_id: sessionId,
      workflow_id: "wf-g14",
      phase: "EXECUTE",
    });
    ledger.append({
      ...MINIMAL_EVENT_BASE,
      session_id: sessionId,
      workflow_id: "wf-g14",
      phase: "GATE",
    });

    const ledgerFile = path.join(baseDir, "ledger", `${sessionId}.jsonl`);

    // Read the file, tamper with the middle entry's seq to break seq monotonicity
    const originalContent = fs.readFileSync(ledgerFile, "utf8");
    const lines = originalContent.trim().split("\n");

    // Parse and modify the second entry (index 1): change seq from 2 to 99
    const secondEntry = JSON.parse(lines[1]!) as Record<string, unknown>;
    secondEntry["seq"] = 99; // breaks seq sequence: 1, 99, 3
    lines[1] = JSON.stringify(secondEntry);

    fs.writeFileSync(ledgerFile, lines.join("\n") + "\n", "utf8");

    const { exitCode, stdout } = runCli(
      "verify-ledger",
      JSON.stringify({ ledger_file: ledgerFile })
    );

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(typeof result["error"]).toBe("string");
  });

  // G15: tamper detection — append an extra duplicate-seq entry to the file
  it("G15. tamper detection: duplicate seq appended to file → exit 1, { ok: false }", () => {
    const baseDir = makeTempDir();
    const sessionId = "session-g15-dupseq";
    const ledger = new AppendOnlyLedger({ session_id: sessionId, baseDir });

    ledger.append({
      ...MINIMAL_EVENT_BASE,
      session_id: sessionId,
      workflow_id: "wf-g15",
      phase: "PLAN",
    });
    ledger.append({
      ...MINIMAL_EVENT_BASE,
      session_id: sessionId,
      workflow_id: "wf-g15",
      phase: "EXECUTE",
    });

    const ledgerFile = path.join(baseDir, "ledger", `${sessionId}.jsonl`);

    // Append a line that duplicates seq=2
    const extraLine = JSON.stringify({
      seq: 2,
      event_id: "fake-event-injected",
      session_id: sessionId,
      ts: new Date().toISOString(),
    });
    fs.appendFileSync(ledgerFile, extraLine + "\n", "utf8");

    const { exitCode, stdout } = runCli(
      "verify-ledger",
      JSON.stringify({ ledger_file: ledgerFile })
    );

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
  });
});
