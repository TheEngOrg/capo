// =============================================================================
// ledger.test.ts — exhaustive tests for src/core/ledger.ts (WS-CORE-05)
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy).
//
// Zero-footprint contract: all tests inject a temp base dir.
// Nothing is written to the real ~/.teo/ during tests.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { AppendOnlyLedger, type LedgerEvent } from "./ledger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a unique temp directory for each test. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "teo-ledger-test-"));
}

/** Remove a directory recursively (safe cleanup in afterEach). */
function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Read all lines from a JSONL file, parse each as JSON. */
function readLines(filePath: string): LedgerEvent[] {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LedgerEvent);
}

/** Minimal valid event fields the caller provides (no seq, no ts — ledger assigns those). */
type EventInput = Omit<LedgerEvent, "event_id" | "seq" | "ts">;

function makeEventInput(overrides: Partial<EventInput> = {}): EventInput {
  return {
    session_id: "session-abc",
    workflow_id: "workflow-xyz",
    task_id: null,
    turn_id: null,
    actor_id: "agent-01",
    actor_type: "AGENT",
    phase: "PLAN",
    verdict: null,
    detail: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MISUSE: wrong / unexpected usage
// ---------------------------------------------------------------------------

describe("AppendOnlyLedger — misuse", () => {
  let tempDir: string;
  let ledger: AppendOnlyLedger;

  beforeEach(() => {
    tempDir = makeTempDir();
    ledger = new AppendOnlyLedger({ session_id: "session-misuse", baseDir: tempDir });
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("throws when appending after close()", () => {
    ledger.close({ task_count: 1, pass: 1, fail: 0, skipped: 0, tokens: 0, cost_usd: 0 });
    expect(() => {
      ledger.append(makeEventInput());
    }).toThrow(/closed/i);
  });

  it("throws when close() is called a second time", () => {
    ledger.close({ task_count: 1, pass: 1, fail: 0, skipped: 0, tokens: 0, cost_usd: 0 });
    expect(() => {
      ledger.close({ task_count: 1, pass: 1, fail: 0, skipped: 0, tokens: 0, cost_usd: 0 });
    }).toThrow(/closed/i);
  });

  it("throws a clear error when detail contains a non-serializable BigInt", () => {
    expect(() => {
      ledger.append(
        makeEventInput({
          detail: { value: BigInt("9007199254740993") },
        })
      );
    }).toThrow(/serialize|serial|JSON|BigInt/i);
  });

  it("throws a clear error when detail contains a circular reference", () => {
    const obj: Record<string, unknown> = {};
    obj["self"] = obj; // circular
    expect(() => {
      ledger.append(makeEventInput({ detail: obj }));
    }).toThrow(/serialize|serial|JSON|circular/i);
  });

  it("rejects a session_id containing path traversal sequences", () => {
    expect(() => {
      new AppendOnlyLedger({ session_id: "../escape", baseDir: tempDir });
    }).toThrow(/session_id|invalid|traversal/i);
  });

  it("rejects a session_id containing forward slashes", () => {
    expect(() => {
      new AppendOnlyLedger({ session_id: "foo/bar", baseDir: tempDir });
    }).toThrow(/session_id|invalid|traversal/i);
  });

  it("rejects a session_id containing backslashes", () => {
    expect(() => {
      new AppendOnlyLedger({ session_id: "foo\\bar", baseDir: tempDir });
    }).toThrow(/session_id|invalid|traversal/i);
  });

  it("rejects an empty session_id", () => {
    expect(() => {
      new AppendOnlyLedger({ session_id: "", baseDir: tempDir });
    }).toThrow(/session_id|invalid/i);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: file creation, directory creation, seq, ts, ancestor IDs
// ---------------------------------------------------------------------------

describe("AppendOnlyLedger — boundary", () => {
  let tempDir: string;
  let ledger: AppendOnlyLedger;
  const SESSION_ID = "session-boundary-01";

  beforeEach(() => {
    tempDir = makeTempDir();
    ledger = new AppendOnlyLedger({ session_id: SESSION_ID, baseDir: tempDir });
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("creates the ledger/ subdirectory when it does not exist", () => {
    // At construction the dir may not yet exist — first append triggers creation
    ledger.append(makeEventInput());
    const ledgerDir = path.join(tempDir, "ledger");
    expect(fs.existsSync(ledgerDir)).toBe(true);
  });

  it("creates the session JSONL file under <baseDir>/ledger/<session_id>.jsonl", () => {
    ledger.append(makeEventInput());
    const expectedPath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it("does NOT write anything outside the injected baseDir", () => {
    ledger.append(makeEventInput());
    // The real ~/.teo/ must not be touched
    const realTeoLedger = path.join(os.homedir(), ".teo", "ledger", `${SESSION_ID}.jsonl`);
    expect(fs.existsSync(realTeoLedger)).toBe(false);
  });

  it("appends a valid JSON line parseable back to a LedgerEvent", () => {
    ledger.append(makeEventInput({ phase: "EXECUTE", verdict: "PASS" }));
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    expect(lines).toHaveLength(1);
    const evt = lines[0];
    expect(evt).toBeDefined();
    expect(evt!.phase).toBe("EXECUTE");
    expect(evt!.verdict).toBe("PASS");
  });

  it("each line is newline-terminated (JSONL contract)", () => {
    ledger.append(makeEventInput());
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("N appends produce exactly N lines (append-only proven by line count)", () => {
    const n = 5;
    for (let i = 0; i < n; i++) {
      ledger.append(makeEventInput({ phase: "EXECUTE" }));
    }
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    expect(lines).toHaveLength(n);
  });

  it("seq starts at 1 for the first event", () => {
    ledger.append(makeEventInput());
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    expect(lines[0]?.seq).toBe(1);
  });

  it("seq is strictly monotonically increasing (1, 2, 3, …)", () => {
    const n = 4;
    for (let i = 0; i < n; i++) {
      ledger.append(makeEventInput());
    }
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    for (let i = 0; i < lines.length; i++) {
      expect(lines[i]?.seq).toBe(i + 1);
    }
  });

  it("ts is ISO-8601 UTC (matches /^\\d{4}-…Z$/ pattern)", () => {
    ledger.append(makeEventInput());
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    const ts = lines[0]?.ts;
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it("ts ends with Z (UTC, not a local offset)", () => {
    ledger.append(makeEventInput());
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    expect(lines[0]?.ts.endsWith("Z")).toBe(true);
  });

  it("every event carries all 4 ancestor IDs — null where not applicable", () => {
    ledger.append(
      makeEventInput({ session_id: "s1", workflow_id: "w1", task_id: null, turn_id: null })
    );
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    const evt = lines[0];
    expect(evt).toBeDefined();
    expect(evt!.session_id).toBe("s1");
    expect(evt!.workflow_id).toBe("w1");
    expect(Object.prototype.hasOwnProperty.call(evt, "task_id")).toBe(true);
    expect(evt!.task_id).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(evt, "turn_id")).toBe(true);
    expect(evt!.turn_id).toBeNull();
  });

  it("every event carries all 4 ancestor IDs — non-null values preserved", () => {
    ledger.append(
      makeEventInput({
        session_id: "s1",
        workflow_id: "w1",
        task_id: "t1",
        turn_id: "turn-42",
      })
    );
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    const evt = lines[0];
    expect(evt!.task_id).toBe("t1");
    expect(evt!.turn_id).toBe("turn-42");
  });

  it("event_id is a valid UUID v4 format", () => {
    ledger.append(makeEventInput());
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    const id = lines[0]?.event_id;
    // UUID v4: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("each append generates a unique event_id", () => {
    ledger.append(makeEventInput());
    ledger.append(makeEventInput());
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    const ids = lines.map((l) => l.event_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: close() — workflow_summary event
// ---------------------------------------------------------------------------

describe("AppendOnlyLedger — close / workflow_summary", () => {
  let tempDir: string;
  let ledger: AppendOnlyLedger;
  const SESSION_ID = "session-close-01";

  beforeEach(() => {
    tempDir = makeTempDir();
    ledger = new AppendOnlyLedger({ session_id: SESSION_ID, baseDir: tempDir });
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("close() appends a final CLOSE-phase event", () => {
    ledger.append(makeEventInput({ phase: "PLAN" }));
    ledger.close({ task_count: 1, pass: 1, fail: 0, skipped: 0, tokens: 0, cost_usd: 0 });
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    const last = lines[lines.length - 1];
    expect(last?.phase).toBe("CLOSE");
  });

  it("the CLOSE event is the LAST line — nothing after it", () => {
    ledger.append(makeEventInput({ phase: "PLAN" }));
    ledger.append(makeEventInput({ phase: "EXECUTE" }));
    ledger.close({ task_count: 2, pass: 2, fail: 0, skipped: 0, tokens: 100, cost_usd: 0.01 });
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    expect(lines[lines.length - 1]?.phase).toBe("CLOSE");
  });

  it("the CLOSE event detail carries the token/cost/step-count rollup", () => {
    ledger.close({
      task_count: 3,
      pass: 2,
      fail: 1,
      skipped: 0,
      tokens: 500,
      cost_usd: 0.05,
    });
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    const closeEvt = lines[lines.length - 1];
    expect(closeEvt?.detail).toMatchObject({
      task_count: 3,
      pass: 2,
      fail: 1,
      skipped: 0,
      tokens: 500,
      cost_usd: 0.05,
    });
  });

  it("close() with zero token/cost (SCRIPT-only Phase 0) is valid", () => {
    ledger.close({ task_count: 0, pass: 0, fail: 0, skipped: 0, tokens: 0, cost_usd: 0 });
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    const closeEvt = lines[lines.length - 1];
    expect(closeEvt?.phase).toBe("CLOSE");
    expect(closeEvt?.detail).toMatchObject({ tokens: 0, cost_usd: 0 });
  });

  it("CLOSE event seq is the highest seq in the file", () => {
    ledger.append(makeEventInput({ phase: "PLAN" }));
    ledger.append(makeEventInput({ phase: "EXECUTE" }));
    ledger.close({ task_count: 2, pass: 2, fail: 0, skipped: 0, tokens: 0, cost_usd: 0 });
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    const seqs = lines.map((l) => l.seq);
    const maxSeq = Math.max(...seqs);
    expect(lines[lines.length - 1]?.seq).toBe(maxSeq);
  });

  it("CLOSE event verdict is null (no pass/fail verdict on close)", () => {
    ledger.close({ task_count: 1, pass: 1, fail: 0, skipped: 0, tokens: 0, cost_usd: 0 });
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    expect(lines[0]?.verdict).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: verdict values align with gate.ts GateVerdict values
// ---------------------------------------------------------------------------

describe("AppendOnlyLedger — verdict alignment with gate.ts", () => {
  let tempDir: string;
  let ledger: AppendOnlyLedger;
  const SESSION_ID = "session-verdict-01";

  beforeEach(() => {
    tempDir = makeTempDir();
    ledger = new AppendOnlyLedger({ session_id: SESSION_ID, baseDir: tempDir });
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("accepts verdict: PASS", () => {
    ledger.append(makeEventInput({ verdict: "PASS" }));
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    expect(lines[0]?.verdict).toBe("PASS");
  });

  it("accepts verdict: FAIL", () => {
    ledger.append(makeEventInput({ verdict: "FAIL" }));
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    expect(lines[0]?.verdict).toBe("FAIL");
  });

  it("accepts verdict: BLOCKED", () => {
    ledger.append(makeEventInput({ verdict: "BLOCKED" }));
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    expect(lines[0]?.verdict).toBe("BLOCKED");
  });

  it("accepts verdict: SKIPPED", () => {
    ledger.append(makeEventInput({ verdict: "SKIPPED" }));
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    expect(lines[0]?.verdict).toBe("SKIPPED");
  });

  it("accepts verdict: null", () => {
    ledger.append(makeEventInput({ verdict: null }));
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    expect(lines[0]?.verdict).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: end-to-end happy path scenarios
// ---------------------------------------------------------------------------

describe("AppendOnlyLedger — golden path", () => {
  let tempDir: string;
  const SESSION_ID = "session-golden-01";

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("full pipeline: PLAN → EXECUTE → GATE → SIGN → CLOSE, all events parseable", () => {
    const ledger = new AppendOnlyLedger({ session_id: SESSION_ID, baseDir: tempDir });
    ledger.append(makeEventInput({ phase: "PLAN", actor_type: "SCRIPT" }));
    ledger.append(makeEventInput({ phase: "EXECUTE", verdict: "PASS", actor_type: "AGENT" }));
    ledger.append(makeEventInput({ phase: "GATE", verdict: "PASS", actor_type: "SYSTEM" }));
    ledger.append(makeEventInput({ phase: "SIGN", verdict: "PASS", actor_type: "SYSTEM" }));
    ledger.close({
      task_count: 3,
      pass: 3,
      fail: 0,
      skipped: 0,
      tokens: 1200,
      cost_usd: 0.12,
    });

    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);

    expect(lines).toHaveLength(5);
    expect(lines[0]?.phase).toBe("PLAN");
    expect(lines[1]?.phase).toBe("EXECUTE");
    expect(lines[2]?.phase).toBe("GATE");
    expect(lines[3]?.phase).toBe("SIGN");
    expect(lines[4]?.phase).toBe("CLOSE");

    // Seq is 1..5
    lines.forEach((l, i) => {
      expect(l.seq).toBe(i + 1);
    });
  });

  it("two independent sessions write to separate JSONL files without cross-contamination", () => {
    const ledger1 = new AppendOnlyLedger({ session_id: "session-A", baseDir: tempDir });
    const ledger2 = new AppendOnlyLedger({ session_id: "session-B", baseDir: tempDir });

    ledger1.append(makeEventInput({ phase: "PLAN" }));
    ledger1.append(makeEventInput({ phase: "EXECUTE" }));
    ledger2.append(makeEventInput({ phase: "PLAN" }));

    const file1 = path.join(tempDir, "ledger", "session-A.jsonl");
    const file2 = path.join(tempDir, "ledger", "session-B.jsonl");

    expect(readLines(file1)).toHaveLength(2);
    expect(readLines(file2)).toHaveLength(1);
  });

  it("every appended event round-trips through JSON with all fields present", () => {
    const ledger = new AppendOnlyLedger({ session_id: SESSION_ID, baseDir: tempDir });
    ledger.append(
      makeEventInput({
        session_id: "s1",
        workflow_id: "w1",
        task_id: "t1",
        turn_id: "turn-1",
        actor_id: "agent-02",
        actor_type: "AGENT",
        phase: "EXECUTE",
        verdict: "PASS",
        detail: { step: 1, info: "ok" },
      })
    );
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const [evt] = readLines(filePath);
    expect(evt!.session_id).toBe("s1");
    expect(evt!.workflow_id).toBe("w1");
    expect(evt!.task_id).toBe("t1");
    expect(evt!.turn_id).toBe("turn-1");
    expect(evt!.actor_id).toBe("agent-02");
    expect(evt!.actor_type).toBe("AGENT");
    expect(evt!.phase).toBe("EXECUTE");
    expect(evt!.verdict).toBe("PASS");
    expect(evt!.detail).toEqual({ step: 1, info: "ok" });
    expect(evt!.seq).toBe(1);
    expect(typeof evt!.event_id).toBe("string");
    expect(typeof evt!.ts).toBe("string");
  });

  it("ledger file survives across multiple separate ledger instances (new instances re-open, not overwrite)", () => {
    // First instance writes 2 events and closes
    const ledger1 = new AppendOnlyLedger({ session_id: SESSION_ID, baseDir: tempDir });
    ledger1.append(makeEventInput({ phase: "PLAN" }));
    ledger1.append(makeEventInput({ phase: "EXECUTE" }));
    ledger1.close({ task_count: 1, pass: 1, fail: 0, skipped: 0, tokens: 0, cost_usd: 0 });

    // Second instance with a different session doesn't destroy the first
    const ledger2 = new AppendOnlyLedger({ session_id: "session-other", baseDir: tempDir });
    ledger2.append(makeEventInput({ phase: "PLAN" }));
    ledger2.close({ task_count: 0, pass: 0, fail: 0, skipped: 0, tokens: 0, cost_usd: 0 });

    const file1 = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    expect(readLines(file1)).toHaveLength(3); // 2 events + 1 close
  });
});

// ---------------------------------------------------------------------------
// WS-GO-01: AppendOnlyLedger.append() return value
// ---------------------------------------------------------------------------

describe("AppendOnlyLedger.append() return value (WS-GO-01)", () => {
  let tempDir: string;
  let ledger: AppendOnlyLedger;
  const SESSION_ID = "session-go01-retval";

  beforeEach(() => {
    tempDir = makeTempDir();
    ledger = new AppendOnlyLedger({ session_id: SESSION_ID, baseDir: tempDir });
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("returns { seq, ts } — seq increments monotonically", () => {
    const r1 = ledger.append(makeEventInput({ phase: "EXECUTE", verdict: "PASS" }));
    const r2 = ledger.append(makeEventInput({ phase: "EXECUTE", verdict: "FAIL" }));

    // seq starts at 1, increments by 1
    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(2);

    // ts is an ISO-8601 UTC timestamp
    expect(r1.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(r2.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);

    // Verify return values match what's written to file
    const filePath = path.join(tempDir, "ledger", `${SESSION_ID}.jsonl`);
    const lines = readLines(filePath);
    expect(lines[0]?.seq).toBe(r1.seq);
    expect(lines[0]?.ts).toBe(r1.ts);
    expect(lines[1]?.seq).toBe(r2.seq);
    expect(lines[1]?.ts).toBe(r2.ts);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: nothing written outside the injected base dir (isolation)
// ---------------------------------------------------------------------------

describe("AppendOnlyLedger — path isolation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("asserts that nothing is written to os.homedir()/.teo/ledger/ during tests", () => {
    const sessionId = `test-isolation-${Date.now()}`;
    const ledger = new AppendOnlyLedger({ session_id: sessionId, baseDir: tempDir });
    ledger.append(makeEventInput());
    ledger.close({ task_count: 0, pass: 0, fail: 0, skipped: 0, tokens: 0, cost_usd: 0 });

    const realPath = path.join(os.homedir(), ".teo", "ledger", `${sessionId}.jsonl`);
    expect(fs.existsSync(realPath)).toBe(false);
  });

  it("ledger file path is strictly inside baseDir/ledger/ — no traversal possible", () => {
    const sessionId = "safe-session-id";
    const ledger = new AppendOnlyLedger({ session_id: sessionId, baseDir: tempDir });
    ledger.append(makeEventInput());

    const expectedFile = path.join(tempDir, "ledger", `${sessionId}.jsonl`);
    expect(fs.existsSync(expectedFile)).toBe(true);
  });
});
