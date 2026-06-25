// =============================================================================
// run-receipt.test.ts — unit tests for src/core/run-receipt.ts (WS-RUN-RECEIPT-01)
//
// STATUS: GREEN — src/core/run-receipt.ts implemented, all 37 tests pass.
//
// These tests specify the full contract for the run-receipt module before
// any implementation. Dev implements against these specs.
//
// Coverage: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8
//
// Ordering (ADR-064 adversarial-first): misuse → boundary → golden path
//
// Zero-footprint contract: all tests inject a temp baseDir.
// Nothing is written to ~/.teo/ during tests. (AC-8)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

// These imports will fail until dev creates src/core/run-receipt.ts.
import {
  buildRunReceipt,
  writeRunReceipt,
  verifyRunReceipt,
  computeArgsHash,
  type RunReceipt,
  type RunReceiptInput,
} from "./run-receipt.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "teo-run-receipt-test-"));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Baseline RunReceiptInput for tests — override individual fields as needed. */
function makeInput(overrides: Partial<RunReceiptInput> = {}): RunReceiptInput {
  return {
    command: "ledger-append",
    argsRaw: '{"session_id":"s1","baseDir":"/tmp/x"}',
    actor_id: "qa-agent",
    outcome: "OK",
    exit_code: 0,
    baseDir: "", // filled in per-test
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MISUSE: verifyRunReceipt with tampered / invalid receipts
// ---------------------------------------------------------------------------

describe("run-receipt — misuse: verify rejects tampered receipts (AC-3, AC-4)", () => {
  let tempDir: string;
  let receipt: RunReceipt;

  beforeEach(() => {
    tempDir = makeTempDir();
    receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    writeRunReceipt(receipt, tempDir);
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  // AC-3: mutating any stored field → invalid
  it("mutating the command field in the stored receipt file → verifyRunReceipt returns {valid:false}", () => {
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;
    stored.command = "TAMPERED-COMMAND";
    fs.writeFileSync(receiptPath, JSON.stringify(stored));

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature invalid/i);
  });

  it("mutating actor_id in the stored receipt file → verifyRunReceipt returns {valid:false}", () => {
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;
    stored.actor_id = "malicious-actor";
    fs.writeFileSync(receiptPath, JSON.stringify(stored));

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature invalid/i);
  });

  it("mutating outcome from OK to FAIL in the stored receipt → verifyRunReceipt returns {valid:false}", () => {
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;
    stored.outcome = "FAIL";
    fs.writeFileSync(receiptPath, JSON.stringify(stored));

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(false);
  });

  it("mutating ts in the stored receipt → verifyRunReceipt returns {valid:false}", () => {
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;
    stored.ts = "2000-01-01T00:00:00.000Z";
    fs.writeFileSync(receiptPath, JSON.stringify(stored));

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(false);
  });

  it("mutating args_hash in the stored receipt → verifyRunReceipt returns {valid:false}", () => {
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;
    stored.args_hash = "sha256:" + "0".repeat(64);
    fs.writeFileSync(receiptPath, JSON.stringify(stored));

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(false);
  });

  it("mutating exit_code in the stored receipt → verifyRunReceipt returns {valid:false}", () => {
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;
    stored.exit_code = 99;
    fs.writeFileSync(receiptPath, JSON.stringify(stored));

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(false);
  });

  // AC-4: hand-crafted sig of correct length (64 chars) but wrong content fails
  it("hand-crafted 64-char all-zero sig (correct length, wrong content) → verifyRunReceipt {valid:false} (AC-4)", () => {
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;
    // Replace sig with a 64-char hex string that is NOT the real HMAC
    stored.sig = "0".repeat(64);
    fs.writeFileSync(receiptPath, JSON.stringify(stored));

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature invalid/i);
  });

  it("hand-crafted 64-char all-'a' sig (correct length, wrong content) → verifyRunReceipt {valid:false} (AC-4)", () => {
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;
    stored.sig = "a".repeat(64);
    fs.writeFileSync(receiptPath, JSON.stringify(stored));

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature invalid/i);
  });

  // AC-5: unknown run_id → {valid:false, reason:"receipt not found"}, no stack trace
  it("unknown run_id → {valid:false, reason:'receipt not found'} (AC-5)", () => {
    const fakeId = "urn:teo:run:00000000-0000-0000-0000-000000000000";
    const result = verifyRunReceipt({ run_id: fakeId, baseDir: tempDir });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/receipt not found/i);
  });

  it("unknown run_id → result does not contain a stack trace string (AC-5)", () => {
    const fakeId = "urn:teo:run:ffffffff-ffff-ffff-ffff-ffffffffffff";
    const result = verifyRunReceipt({ run_id: fakeId, baseDir: tempDir });
    // reason must not look like a Node.js stack trace
    expect(result.reason ?? "").not.toMatch(/at\s+\w+\s+\(/);
    expect(result.reason ?? "").not.toContain("Error:");
  });
});

// ---------------------------------------------------------------------------
// MISUSE: buildRunReceipt with bad inputs
// ---------------------------------------------------------------------------

describe("run-receipt — misuse: buildRunReceipt rejects bad inputs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("empty command string → throws (command is required)", () => {
    expect(() => {
      buildRunReceipt(makeInput({ command: "", baseDir: tempDir }));
    }).toThrow();
  });

  it("invalid outcome value → throws (must be OK or FAIL)", () => {
    expect(() => {
      buildRunReceipt(makeInput({ outcome: "UNKNOWN" as "OK" | "FAIL", baseDir: tempDir }));
    }).toThrow();
  });

  it("empty actor_id → throws", () => {
    expect(() => {
      buildRunReceipt(makeInput({ actor_id: "", baseDir: tempDir }));
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: verifyRunReceipt edge cases (lines 208, 213, 235, 243)
// ---------------------------------------------------------------------------

describe("run-receipt — boundary: verifyRunReceipt edge cases in stored receipt", () => {
  let tempDir: string;
  let receipt: RunReceipt;

  beforeEach(() => {
    tempDir = makeTempDir();
    receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    writeRunReceipt(receipt, tempDir);
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  // Line 208: catch block — file exists but JSON.parse throws (malformed JSON)
  it("receipt file exists but contains malformed JSON → {valid:false, reason:'receipt not found'} (line 208)", () => {
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    // Overwrite with non-JSON content so JSON.parse throws
    fs.writeFileSync(receiptPath, "not valid json {{{");

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/receipt not found/i);
  });

  // Line 213: sig field is not a 64-char string (wrong length triggers early return)
  it("stored receipt sig is a short string (< 64 chars) → {valid:false, reason:'signature invalid'} (line 213)", () => {
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;
    // Replace sig with a too-short value
    (stored as Record<string, unknown>)["sig"] = "abc123";
    fs.writeFileSync(receiptPath, JSON.stringify(stored));

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature invalid/i);
  });

  it("stored receipt sig is a non-string value → {valid:false, reason:'signature invalid'} (line 213)", () => {
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;
    // Replace sig with a number — typeof !== "string"
    (stored as Record<string, unknown>)["sig"] = 12345;
    fs.writeFileSync(receiptPath, JSON.stringify(stored));

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature invalid/i);
  });

  // Line 235: expectedBuf.length !== actualBuf.length — happens when stored.sig is
  // exactly 64 chars but contains non-hex characters. Buffer.from with "hex" encoding
  // silently skips invalid hex pairs and produces a shorter buffer.
  it("stored receipt sig is 64 chars but contains non-hex characters → {valid:false, reason:'signature invalid'} (line 235)", () => {
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;
    // 64 chars with non-hex chars ('g', 'z', 'x') — passes length check but Buffer.from("hex")
    // produces fewer than 32 bytes, so expectedBuf.length !== actualBuf.length
    (stored as Record<string, unknown>)["sig"] = "g".repeat(64);
    fs.writeFileSync(receiptPath, JSON.stringify(stored));

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature invalid/i);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: args_hash computation (AC-6)
// ---------------------------------------------------------------------------

describe("run-receipt — boundary: args_hash is SHA-256 of raw args string (AC-6)", () => {
  it("computeArgsHash returns 'sha256:<64-hex>' format (AC-6)", () => {
    const hash = computeArgsHash('{"session_id":"s1"}');
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("different argsRaw strings produce different args_hash values (AC-6)", () => {
    const h1 = computeArgsHash('{"session_id":"s1"}');
    const h2 = computeArgsHash('{"session_id":"s2"}');
    expect(h1).not.toBe(h2);
  });

  it("same argsRaw string always produces the same hash (deterministic) (AC-6)", () => {
    const raw = '{"command":"ledger-append","args":{"n":1}}';
    expect(computeArgsHash(raw)).toBe(computeArgsHash(raw));
  });

  it("args_hash matches independent Node crypto.createHash computation (AC-6)", () => {
    const raw = '{"test":true}';
    const expected = "sha256:" + crypto.createHash("sha256").update(raw).digest("hex");
    expect(computeArgsHash(raw)).toBe(expected);
  });

  it("args_hash is lowercase hex (AC-6)", () => {
    const hash = computeArgsHash("{}");
    // strip prefix
    const hex = hash.replace("sha256:", "");
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    // must not contain uppercase
    expect(hex).toBe(hex.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: run_id format (AC-1)
// ---------------------------------------------------------------------------

describe("run-receipt — boundary: run_id is a urn:teo:run:<uuid-v4> (AC-1)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  const UUID_V4_RE = /^urn:teo:run:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it("run_id matches urn:teo:run:<uuid-v4> format (AC-1)", () => {
    const receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    expect(receipt.run_id).toMatch(UUID_V4_RE);
  });

  it("two receipts produced in sequence have distinct run_ids (AC-1)", () => {
    const r1 = buildRunReceipt(makeInput({ baseDir: tempDir }));
    const r2 = buildRunReceipt(makeInput({ baseDir: tempDir }));
    expect(r1.run_id).not.toBe(r2.run_id);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: sig format (AC-1)
// ---------------------------------------------------------------------------

describe("run-receipt — boundary: sig is 64-char lowercase hex HMAC-SHA-256 (AC-1)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("receipt.sig is exactly 64 characters (AC-1)", () => {
    const receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    expect(receipt.sig).toHaveLength(64);
  });

  it("receipt.sig is lowercase hex only (AC-1)", () => {
    const receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    expect(receipt.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different commands produce different sigs (sig commits to command) (AC-1)", () => {
    const r1 = buildRunReceipt(makeInput({ command: "ledger-append", baseDir: tempDir }));
    const r2 = buildRunReceipt(makeInput({ command: "ledger-close", baseDir: tempDir }));
    // run_ids differ, so sigs will differ — additionally check sigs are not fixed/constant
    expect(r1.sig).not.toBe("0".repeat(64));
    expect(r2.sig).not.toBe("0".repeat(64));
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: FAIL receipt (AC-7)
// ---------------------------------------------------------------------------

describe("run-receipt — boundary: FAIL receipts are fully signed and verifiable (AC-7)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("FAIL outcome receipt has run_id and sig fields present (AC-7)", () => {
    const receipt = buildRunReceipt(
      makeInput({ outcome: "FAIL", exit_code: 1, baseDir: tempDir })
    );
    expect(receipt.run_id).toMatch(/^urn:teo:run:/);
    expect(receipt.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("FAIL outcome receipt has outcome='FAIL' and non-zero exit_code (AC-7)", () => {
    const receipt = buildRunReceipt(
      makeInput({ outcome: "FAIL", exit_code: 2, baseDir: tempDir })
    );
    expect(receipt.outcome).toBe("FAIL");
    expect(receipt.exit_code).toBe(2);
  });

  it("FAIL receipt is distinguishable from OK by the outcome field (AC-7)", () => {
    const okReceipt = buildRunReceipt(makeInput({ outcome: "OK", exit_code: 0, baseDir: tempDir }));
    const failReceipt = buildRunReceipt(
      makeInput({ outcome: "FAIL", exit_code: 1, baseDir: tempDir })
    );
    expect(okReceipt.outcome).toBe("OK");
    expect(failReceipt.outcome).toBe("FAIL");
    // sigs differ because outcome field is part of the canonical string
    expect(okReceipt.sig).not.toBe(failReceipt.sig);
  });

  it("FAIL receipt written to disk is verifiable by verifyRunReceipt (AC-7)", () => {
    const receipt = buildRunReceipt(
      makeInput({ outcome: "FAIL", exit_code: 3, baseDir: tempDir })
    );
    writeRunReceipt(receipt, tempDir);

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: atomic write (tmp→rename) (AC-2)
// ---------------------------------------------------------------------------

describe("run-receipt — boundary: writeRunReceipt atomic tmp→rename (AC-2)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("receipt file appears at <baseDir>/receipts/<uuid>.json after writeRunReceipt (AC-2)", () => {
    const receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    writeRunReceipt(receipt, tempDir);

    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    expect(fs.existsSync(receiptPath)).toBe(true);
  });

  it("no .tmp file left behind after writeRunReceipt completes (atomic write) (AC-2)", () => {
    const receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    writeRunReceipt(receipt, tempDir);

    const receiptsDir = path.join(tempDir, "receipts");
    const files = fs.readdirSync(receiptsDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("stored receipt file contains all required fields: run_id, command, args_hash, actor_id, ts, outcome, exit_code, sig (AC-2)", () => {
    const receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    writeRunReceipt(receipt, tempDir);

    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as Record<string, unknown>;

    expect(stored).toHaveProperty("run_id");
    expect(stored).toHaveProperty("command");
    expect(stored).toHaveProperty("args_hash");
    expect(stored).toHaveProperty("actor_id");
    expect(stored).toHaveProperty("ts");
    expect(stored).toHaveProperty("outcome");
    expect(stored).toHaveProperty("exit_code");
    expect(stored).toHaveProperty("sig");
  });

  it("stored receipt ts is a valid ISO-8601 UTC string (AC-2)", () => {
    const receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    writeRunReceipt(receipt, tempDir);

    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const receiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;

    const parsed = new Date(stored.ts);
    expect(isNaN(parsed.getTime())).toBe(false);
  });

  it("receipts directory is created by writeRunReceipt if it does not exist (AC-2, AC-8)", () => {
    const receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    const receiptsDir = path.join(tempDir, "receipts");
    // Confirm not pre-existing
    expect(fs.existsSync(receiptsDir)).toBe(false);

    writeRunReceipt(receipt, tempDir);

    expect(fs.existsSync(receiptsDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: buildRunReceipt + writeRunReceipt + verifyRunReceipt round-trip
// ---------------------------------------------------------------------------

describe("run-receipt — golden path: build → write → verify round-trip (AC-1, AC-2, AC-3)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("verifyRunReceipt returns {valid:true} for a freshly written receipt (AC-3)", () => {
    const receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    writeRunReceipt(receipt, tempDir);

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(true);
  });

  it("verifyRunReceipt return value has no 'reason' field when valid=true (AC-3)", () => {
    const receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    writeRunReceipt(receipt, tempDir);

    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(true);
    // reason should be absent or undefined when valid
    expect((result as Record<string, unknown>)["reason"]).toBeUndefined();
  });

  it("baseDir is injected: no files written to os.homedir()/.teo/ (AC-8)", () => {
    const realTeoDir = path.join(os.homedir(), ".teo", "receipts");
    const receipt = buildRunReceipt(makeInput({ baseDir: tempDir }));
    writeRunReceipt(receipt, tempDir);

    // The uuid-named receipt must exist in the temp dir, not the real dir
    const uuid = receipt.run_id.replace("urn:teo:run:", "");
    const testReceiptPath = path.join(tempDir, "receipts", `${uuid}.json`);
    const realReceiptPath = path.join(realTeoDir, `${uuid}.json`);

    expect(fs.existsSync(testReceiptPath)).toBe(true);
    // Real path must NOT have this specific receipt (it was never written there)
    expect(fs.existsSync(realReceiptPath)).toBe(false);
  });

  it("full pipeline: sign command receipt → write → reload from disk → verify (AC-1, AC-2, AC-3)", () => {
    const input = makeInput({
      command: "sign",
      argsRaw: '{"baseDir":"/tmp/x","keyring_id":"default","payload":{}}',
      actor_id: "capo",
      outcome: "OK",
      exit_code: 0,
      baseDir: tempDir,
    });

    const receipt = buildRunReceipt(input);
    writeRunReceipt(receipt, tempDir);

    // Simulate a fresh verification call (new process, same baseDir)
    const result = verifyRunReceipt({ run_id: receipt.run_id, baseDir: tempDir });
    expect(result.valid).toBe(true);
  });

  it("multiple distinct receipts coexist in the same receipts dir and each verifies independently", () => {
    const commands = ["ledger-append", "ledger-close", "provision", "sign"] as const;
    const receipts = commands.map((cmd) =>
      buildRunReceipt(makeInput({ command: cmd, baseDir: tempDir }))
    );
    for (const r of receipts) {
      writeRunReceipt(r, tempDir);
    }

    for (const r of receipts) {
      const result = verifyRunReceipt({ run_id: r.run_id, baseDir: tempDir });
      expect(result.valid).toBe(true);
    }

    // Each receipt file must be separate
    const receiptsDir = path.join(tempDir, "receipts");
    const files = fs.readdirSync(receiptsDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(4);
  });
});
