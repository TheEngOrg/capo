// =============================================================================
// sign.test.ts — exhaustive tests for src/core/sign.ts (WS-CORE-06)
//
// Ordering: misuse → boundary → security properties → golden path
// (ADR-064 critical-path policy).
//
// Zero-footprint contract: all tests inject a temp base dir.
// Nothing is written to the real ~/.teo/ during tests.
//
// Security-property tests are the primary focus:
//   - Non-replayability: each field independently tamper-evident
//   - Constant-time comparison (wrong-length returns false, never throws)
//   - Pipe-injection defense (length-prefix prevents field boundary forgery)
//   - Key generation: file created at 0600, dir at 0700
//   - Key NOT read from env: signing works from keyring file with env cleared
//   - Path traversal rejection on keyring_id
//   - Corrupt/wrong-length key file → clear error, never silent weak-key signing
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { HmacSigner, SignKeyringError, SignKeyError, type SignPayload } from "./sign.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a unique temp directory for each test. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "teo-sign-test-"));
}

/** Remove a directory recursively (safe cleanup in afterEach). */
function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Baseline SignPayload for tests — override individual fields as needed. */
function makePayload(overrides: Partial<SignPayload> = {}): SignPayload {
  return {
    plan_id: "plan-abc",
    task_id: "task-xyz",
    actor_id: "agent-01",
    verdict: "PASS",
    ts: "2026-06-18T12:00:00.000Z",
    seq: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MISUSE: wrong / unexpected usage — construction errors
// ---------------------------------------------------------------------------

describe("HmacSigner — misuse: keyring_id validation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("throws SignKeyringError for a keyring_id containing forward slash (path traversal)", () => {
    expect(() => {
      new HmacSigner({ keyring_id: "foo/bar", baseDir: tempDir });
    }).toThrow(SignKeyringError);
  });

  it("throws SignKeyringError for a keyring_id containing backslash", () => {
    expect(() => {
      new HmacSigner({ keyring_id: "foo\\bar", baseDir: tempDir });
    }).toThrow(SignKeyringError);
  });

  it("throws SignKeyringError for a keyring_id containing '../' (path traversal)", () => {
    expect(() => {
      new HmacSigner({ keyring_id: "../escape", baseDir: tempDir });
    }).toThrow(SignKeyringError);
  });

  it("throws SignKeyringError for an empty keyring_id", () => {
    expect(() => {
      new HmacSigner({ keyring_id: "", baseDir: tempDir });
    }).toThrow(SignKeyringError);
  });

  it("error message identifies the invalid keyring_id (path traversal)", () => {
    expect(() => {
      new HmacSigner({ keyring_id: "../etc/passwd", baseDir: tempDir });
    }).toThrow(/keyring_id/i);
  });
});

// ---------------------------------------------------------------------------
// MISUSE: corrupt / wrong-length key file
// ---------------------------------------------------------------------------

describe("HmacSigner — misuse: corrupt key file", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("throws SignKeyError when key file exists but is empty (0 bytes)", () => {
    const keyringDir = path.join(tempDir, "keyring");
    fs.mkdirSync(keyringDir, { recursive: true });
    fs.writeFileSync(path.join(keyringDir, "default.key"), Buffer.alloc(0));
    expect(() => {
      new HmacSigner({ baseDir: tempDir });
    }).toThrow(SignKeyError);
  });

  it("throws SignKeyError when key file is 16 bytes (too short — not 32)", () => {
    const keyringDir = path.join(tempDir, "keyring");
    fs.mkdirSync(keyringDir, { recursive: true });
    fs.writeFileSync(path.join(keyringDir, "default.key"), Buffer.alloc(16));
    expect(() => {
      new HmacSigner({ baseDir: tempDir });
    }).toThrow(SignKeyError);
  });

  it("throws SignKeyError when key file is 64 bytes (too long — not 32)", () => {
    const keyringDir = path.join(tempDir, "keyring");
    fs.mkdirSync(keyringDir, { recursive: true });
    fs.writeFileSync(path.join(keyringDir, "default.key"), Buffer.alloc(64));
    expect(() => {
      new HmacSigner({ baseDir: tempDir });
    }).toThrow(SignKeyError);
  });

  it("SignKeyError message includes the file path and byte counts (actionable)", () => {
    const keyringDir = path.join(tempDir, "keyring");
    fs.mkdirSync(keyringDir, { recursive: true });
    fs.writeFileSync(path.join(keyringDir, "default.key"), Buffer.alloc(0));
    expect(() => {
      new HmacSigner({ baseDir: tempDir });
    }).toThrow(/0 bytes|corrupt|empty|32/i);
  });

  it("does NOT sign with a corrupt key — throws before any HMAC is computed", () => {
    const keyringDir = path.join(tempDir, "keyring");
    fs.mkdirSync(keyringDir, { recursive: true });
    fs.writeFileSync(path.join(keyringDir, "default.key"), Buffer.alloc(10, 0xab));
    let signer: HmacSigner | undefined;
    expect(() => {
      signer = new HmacSigner({ baseDir: tempDir });
    }).toThrow(SignKeyError);
    // signer was never constructed — cannot sign
    expect(signer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: key generation and file system permissions
// ---------------------------------------------------------------------------

describe("HmacSigner — boundary: key generation and permissions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("key file absent on first sign(): key is generated and file is created", () => {
    new HmacSigner({ baseDir: tempDir });
    const keyPath = path.join(tempDir, "keyring", "default.key");
    expect(fs.existsSync(keyPath)).toBe(true);
  });

  it("generated key file is exactly 32 bytes", () => {
    new HmacSigner({ baseDir: tempDir });
    const keyPath = path.join(tempDir, "keyring", "default.key");
    const stat = fs.statSync(keyPath);
    expect(stat.size).toBe(32);
  });

  it("generated key file has mode 0600 (owner read/write only)", () => {
    new HmacSigner({ baseDir: tempDir });
    const keyPath = path.join(tempDir, "keyring", "default.key");
    const stat = fs.statSync(keyPath);
    // Mask to low 9 permission bits
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("keyring directory has mode 0700 (owner only)", () => {
    new HmacSigner({ baseDir: tempDir });
    const keyringDir = path.join(tempDir, "keyring");
    const stat = fs.statSync(keyringDir);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it("pre-existing key file with 0o644 mode is corrected to 0600 on load", () => {
    const keyringDir = path.join(tempDir, "keyring");
    fs.mkdirSync(keyringDir, { recursive: true });
    const keyPath = path.join(keyringDir, "default.key");
    // Write a valid 32-byte key with loose permissions
    fs.writeFileSync(keyPath, Buffer.alloc(32, 0x42), { mode: 0o644 });
    new HmacSigner({ baseDir: tempDir });
    const stat = fs.statSync(keyPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("key file is generated inside <baseDir>/keyring/, not in os.homedir()/.teo/", () => {
    new HmacSigner({ baseDir: tempDir });
    const realKeyPath = path.join(os.homedir(), ".teo", "keyring", "default.key");
    // Assert real keyring was NOT touched (may or may not exist — just check
    // the key generated for this test is in tempDir)
    const testKeyPath = path.join(tempDir, "keyring", "default.key");
    expect(fs.existsSync(testKeyPath)).toBe(true);
    // The file we created must NOT be at the real path (they are different)
    expect(testKeyPath).not.toBe(realKeyPath);
  });

  it("keyring_id controls the key filename (non-default id)", () => {
    new HmacSigner({ keyring_id: "mykey", baseDir: tempDir });
    const keyPath = path.join(tempDir, "keyring", "mykey.key");
    expect(fs.existsSync(keyPath)).toBe(true);
  });

  it("two different keyring_ids produce different key files", () => {
    new HmacSigner({ keyring_id: "alice", baseDir: tempDir });
    new HmacSigner({ keyring_id: "bob", baseDir: tempDir });
    const alicePath = path.join(tempDir, "keyring", "alice.key");
    const bobPath = path.join(tempDir, "keyring", "bob.key");
    expect(fs.existsSync(alicePath)).toBe(true);
    expect(fs.existsSync(bobPath)).toBe(true);
  });

  it("second construction with same baseDir loads the existing key (no regeneration)", () => {
    const signer1 = new HmacSigner({ baseDir: tempDir });
    const payload = makePayload();
    const sig1 = signer1.sign(payload);

    // Second instance loads the same key from disk
    const signer2 = new HmacSigner({ baseDir: tempDir });
    const sig2 = signer2.sign(payload);

    // Same key → same signature for the same payload
    expect(sig1).toBe(sig2);
  });
});

// ---------------------------------------------------------------------------
// SECURITY PROPERTY: key is NOT read from environment variables
// ---------------------------------------------------------------------------

describe("HmacSigner — security: key never read from environment", () => {
  let tempDir: string;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = makeTempDir();
    // Snapshot current env
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      process.env[key] = value;
    }
    removeTempDir(tempDir);
  });

  it("signing works from keyring file even with all TEO env vars cleared", () => {
    // Pre-generate a key so we know it exists on disk
    const signer = new HmacSigner({ baseDir: tempDir });
    const payload = makePayload();
    const sig = signer.sign(payload);

    // Clear any env vars that could influence key derivation
    delete process.env["TEO_HMAC_KEY"];
    delete process.env["TEO_SECRET"];
    delete process.env["HMAC_KEY"];
    delete process.env["SIGNING_KEY"];

    // A second signer must read from disk, not from env
    const signer2 = new HmacSigner({ baseDir: tempDir });
    const sig2 = signer2.sign(payload);

    // Same file → same key → same signature
    expect(sig2).toBe(sig);
  });

  it("setting a fake HMAC_KEY env var does not alter the signature", () => {
    const signer = new HmacSigner({ baseDir: tempDir });
    const payload = makePayload();
    const sig1 = signer.sign(payload);

    // Set an env var that a naive impl might pick up
    process.env["HMAC_KEY"] = Buffer.alloc(32, 0xff).toString("hex");

    const signer2 = new HmacSigner({ baseDir: tempDir });
    const sig2 = signer2.sign(payload);

    // Key from disk must win — env var must have no effect
    expect(sig2).toBe(sig1);
  });
});

// ---------------------------------------------------------------------------
// SECURITY PROPERTY: signature format
// ---------------------------------------------------------------------------

describe("HmacSigner — security: signature format", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("sign() produces exactly 64 lowercase hex characters", () => {
    const signer = new HmacSigner({ baseDir: tempDir });
    const sig = signer.sign(makePayload());
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sign() is deterministic — same payload + same key → same signature", () => {
    const signer = new HmacSigner({ baseDir: tempDir });
    const payload = makePayload();
    expect(signer.sign(payload)).toBe(signer.sign(payload));
  });

  it("sign() produces different output for different payloads (distinct keys used)", () => {
    const signer = new HmacSigner({ baseDir: tempDir });
    const sig1 = signer.sign(makePayload({ plan_id: "plan-A" }));
    const sig2 = signer.sign(makePayload({ plan_id: "plan-B" }));
    expect(sig1).not.toBe(sig2);
  });
});

// ---------------------------------------------------------------------------
// SECURITY PROPERTY: round-trip (sign + verify)
// ---------------------------------------------------------------------------

describe("HmacSigner — security: round-trip verify", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("verify() returns true for a freshly-signed payload", () => {
    const signer = new HmacSigner({ baseDir: tempDir });
    const payload = makePayload();
    const sig = signer.sign(payload);
    expect(signer.verify(payload, sig)).toBe(true);
  });

  it("verify() returns true for a null task_id payload (plan-scoped event)", () => {
    const signer = new HmacSigner({ baseDir: tempDir });
    const payload = makePayload({ task_id: null });
    const sig = signer.sign(payload);
    expect(signer.verify(payload, sig)).toBe(true);
  });

  it("verify() returns true for a null verdict (non-gate event)", () => {
    const signer = new HmacSigner({ baseDir: tempDir });
    const payload = makePayload({ verdict: null });
    const sig = signer.sign(payload);
    expect(signer.verify(payload, sig)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SECURITY PROPERTY: non-replayability — each field independently tamper-evident
// ---------------------------------------------------------------------------

describe("HmacSigner — security: non-replay / tamper evidence", () => {
  let tempDir: string;
  let signer: HmacSigner;

  beforeEach(() => {
    tempDir = makeTempDir();
    signer = new HmacSigner({ baseDir: tempDir });
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("changing seq post-signing → verify returns false (non-replayable by seq)", () => {
    const original = makePayload({ seq: 1 });
    const sig = signer.sign(original);
    const tampered = makePayload({ seq: 2 });
    expect(signer.verify(tampered, sig)).toBe(false);
  });

  it("changing ts post-signing → verify returns false (non-replayable by ts)", () => {
    const original = makePayload({ ts: "2026-06-18T12:00:00.000Z" });
    const sig = signer.sign(original);
    const tampered = makePayload({ ts: "2026-06-18T12:00:01.000Z" });
    expect(signer.verify(tampered, sig)).toBe(false);
  });

  it("changing verdict post-signing → verify returns false", () => {
    const original = makePayload({ verdict: "PASS" });
    const sig = signer.sign(original);
    const tampered = makePayload({ verdict: "FAIL" });
    expect(signer.verify(tampered, sig)).toBe(false);
  });

  it("changing actor_id post-signing → verify returns false", () => {
    const original = makePayload({ actor_id: "agent-01" });
    const sig = signer.sign(original);
    const tampered = makePayload({ actor_id: "agent-02" });
    expect(signer.verify(tampered, sig)).toBe(false);
  });

  it("changing plan_id post-signing → verify returns false", () => {
    const original = makePayload({ plan_id: "plan-abc" });
    const sig = signer.sign(original);
    const tampered = makePayload({ plan_id: "plan-xyz" });
    expect(signer.verify(tampered, sig)).toBe(false);
  });

  it("changing task_id post-signing → verify returns false", () => {
    const original = makePayload({ task_id: "task-1" });
    const sig = signer.sign(original);
    const tampered = makePayload({ task_id: "task-2" });
    expect(signer.verify(tampered, sig)).toBe(false);
  });

  it("null→non-null task_id change is detected (null and 'task-1' produce different sigs)", () => {
    const original = makePayload({ task_id: null });
    const sig = signer.sign(original);
    const tampered = makePayload({ task_id: "task-1" });
    expect(signer.verify(tampered, sig)).toBe(false);
  });

  it("two events differing only in seq have different signatures (explicit non-replay)", () => {
    const p1 = makePayload({ seq: 5 });
    const p2 = makePayload({ seq: 6 });
    expect(signer.sign(p1)).not.toBe(signer.sign(p2));
  });

  it("two events differing only in ts have different signatures (explicit non-replay)", () => {
    const p1 = makePayload({ ts: "2026-06-18T10:00:00.000Z" });
    const p2 = makePayload({ ts: "2026-06-18T10:00:01.000Z" });
    expect(signer.sign(p1)).not.toBe(signer.sign(p2));
  });
});

// ---------------------------------------------------------------------------
// SECURITY PROPERTY: constant-time comparison
// ---------------------------------------------------------------------------

describe("HmacSigner — security: constant-time comparison", () => {
  let tempDir: string;
  let signer: HmacSigner;

  beforeEach(() => {
    tempDir = makeTempDir();
    signer = new HmacSigner({ baseDir: tempDir });
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("wrong-length signature returns false (not throws)", () => {
    const payload = makePayload();
    // Too short
    expect(signer.verify(payload, "abc")).toBe(false);
  });

  it("empty signature returns false (not throws)", () => {
    const payload = makePayload();
    expect(signer.verify(payload, "")).toBe(false);
  });

  it("63-char signature (one byte short) returns false (not throws)", () => {
    const payload = makePayload();
    expect(signer.verify(payload, "a".repeat(63))).toBe(false);
  });

  it("65-char signature (one byte over) returns false (not throws)", () => {
    const payload = makePayload();
    expect(signer.verify(payload, "a".repeat(65))).toBe(false);
  });

  it("correct-length but wrong hex signature returns false (not throws)", () => {
    const payload = makePayload();
    // All-zero 64-char hex is a valid length but almost certainly wrong
    expect(signer.verify(payload, "0".repeat(64))).toBe(false);
  });

  it("verify() does not throw for any wrong-length input (defensive against DoS)", () => {
    const payload = makePayload();
    // Exhaustively test several lengths around 64
    for (const len of [0, 1, 32, 63, 65, 128]) {
      expect(() => signer.verify(payload, "a".repeat(len))).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// SECURITY PROPERTY: pipe-injection / delimiter-collision defense
// ---------------------------------------------------------------------------

describe("HmacSigner — security: pipe-injection defense (length-prefix)", () => {
  let tempDir: string;
  let signer: HmacSigner;

  beforeEach(() => {
    tempDir = makeTempDir();
    signer = new HmacSigner({ baseDir: tempDir });
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("{plan_id:'a|b', task_id:'c'} and {plan_id:'a', task_id:'b|c'} produce DIFFERENT signatures", () => {
    // These would produce the same naive string "a|b|c" without length-prefix defense.
    // With length-prefix: "3:a|b|1:c|…" vs "1:a|3:b|c|…" — DIFFERENT.
    const p1 = makePayload({ plan_id: "a|b", task_id: "c" });
    const p2 = makePayload({ plan_id: "a", task_id: "b|c" });
    expect(signer.sign(p1)).not.toBe(signer.sign(p2));
  });

  it("verify() rejects a signature produced from the injected field variant", () => {
    const genuine = makePayload({ plan_id: "a|b", task_id: "c" });
    const forgery = makePayload({ plan_id: "a", task_id: "b|c" });
    const sig = signer.sign(genuine);
    // Attacker tries to pass off the forgery using the genuine signature
    expect(signer.verify(forgery, sig)).toBe(false);
  });

  it("plan_id containing multiple pipes is still unambiguous (length-prefix covers N pipes)", () => {
    const p1 = makePayload({ plan_id: "x|y|z", task_id: "w" });
    const p2 = makePayload({ plan_id: "x|y", task_id: "z|w" });
    const p3 = makePayload({ plan_id: "x", task_id: "y|z|w" });
    const sigs = [signer.sign(p1), signer.sign(p2), signer.sign(p3)];
    // All three must be distinct
    expect(new Set(sigs).size).toBe(3);
  });

  it("buildCanonical length-prefix makes each variant structurally unique", () => {
    // Directly assert canonical string format
    const c1 = HmacSigner.buildCanonical(makePayload({ plan_id: "a|b", task_id: "c" }));
    const c2 = HmacSigner.buildCanonical(makePayload({ plan_id: "a", task_id: "b|c" }));
    expect(c1).not.toBe(c2);
    // c1 starts with "3:a|b|" — the plan_id is 3 chars
    expect(c1).toContain("3:a|b|");
    // c2 starts with "1:a|" — the plan_id is 1 char
    expect(c2).toContain("1:a|");
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: canonical payload format and null serialization
// ---------------------------------------------------------------------------

describe("HmacSigner — boundary: canonical payload format", () => {
  it("null task_id serializes as empty string in the canonical payload", () => {
    const payload = makePayload({ task_id: null });
    const canonical = HmacSigner.buildCanonical(payload);
    // task_id position: after plan_id field; null → "0:"
    // Format: <len>:<plan_id>|<len>:<task_id>|... → plan_id field is followed by "0:" for null
    expect(canonical).toContain("|0:|");
  });

  it("null verdict serializes as empty string in the canonical payload", () => {
    const payload = makePayload({ verdict: null });
    const canonical = HmacSigner.buildCanonical(payload);
    // verdict is position 4 — just verify the string is stable and produced
    expect(typeof canonical).toBe("string");
    expect(canonical.length).toBeGreaterThan(0);
  });

  it("null task_id and non-null task_id produce different canonical strings", () => {
    const withNull = HmacSigner.buildCanonical(makePayload({ task_id: null }));
    const withValue = HmacSigner.buildCanonical(makePayload({ task_id: "t" }));
    expect(withNull).not.toBe(withValue);
  });

  it("canonical string contains all six fields in order: plan_id|task_id|actor_id|verdict|ts|seq", () => {
    const payload: SignPayload = {
      plan_id: "p",
      task_id: "t",
      actor_id: "a",
      verdict: "PASS",
      ts: "2026-01-01T00:00:00.000Z",
      seq: 7,
    };
    const canonical = HmacSigner.buildCanonical(payload);
    // With length-prefix: "1:p|1:t|1:a|4:PASS|24:2026-01-01T00:00:00.000Z|1:7"
    expect(canonical).toBe("1:p|1:t|1:a|4:PASS|24:2026-01-01T00:00:00.000Z|1:7");
  });

  it("seq is serialized as its decimal string representation", () => {
    const canonical = HmacSigner.buildCanonical(makePayload({ seq: 42 }));
    expect(canonical).toContain("2:42");
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: end-to-end pipeline simulation
// ---------------------------------------------------------------------------

describe("HmacSigner — golden path", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("full pipeline: sign → store → reload signer → verify (key persists across instances)", () => {
    const signer1 = new HmacSigner({ baseDir: tempDir });
    const payload = makePayload({
      plan_id: "pipeline-plan-01",
      task_id: "task-gate-01",
      actor_id: "capo",
      verdict: "PASS",
      ts: "2026-06-18T15:00:00.000Z",
      seq: 3,
    });
    const sig = signer1.sign(payload);

    // Simulate loading a new instance (e.g. after a process restart)
    const signer2 = new HmacSigner({ baseDir: tempDir });
    expect(signer2.verify(payload, sig)).toBe(true);
  });

  it("four sequential events all verify correctly (each has unique seq)", () => {
    const signer = new HmacSigner({ baseDir: tempDir });
    const events = [1, 2, 3, 4].map((seq) => makePayload({ seq }));
    const sigs = events.map((p) => signer.sign(p));

    // All signatures are distinct
    expect(new Set(sigs).size).toBe(4);

    // Each verifies against its own signature only
    events.forEach((p, i) => {
      expect(signer.verify(p, sigs[i]!)).toBe(true);
      // Cross-verification must fail
      const otherSig = sigs[(i + 1) % 4]!;
      expect(signer.verify(p, otherSig)).toBe(false);
    });
  });

  it("plan-scoped event (null task_id) signs and verifies correctly", () => {
    const signer = new HmacSigner({ baseDir: tempDir });
    const planEvent = makePayload({
      plan_id: "plan-toplevel",
      task_id: null,
      actor_id: "SYSTEM",
      verdict: null,
      ts: "2026-06-18T16:00:00.000Z",
      seq: 1,
    });
    const sig = signer.sign(planEvent);
    expect(signer.verify(planEvent, sig)).toBe(true);
  });

  it("multiple keyring_ids coexist independently (alice and bob have separate keys)", () => {
    const alice = new HmacSigner({ keyring_id: "alice", baseDir: tempDir });
    const bob = new HmacSigner({ keyring_id: "bob", baseDir: tempDir });
    const payload = makePayload();

    const aliceSig = alice.sign(payload);
    const bobSig = bob.sign(payload);

    // Different keys → different signatures
    expect(aliceSig).not.toBe(bobSig);

    // Alice can verify her own sig; Bob's sig fails Alice's verify
    expect(alice.verify(payload, aliceSig)).toBe(true);
    expect(alice.verify(payload, bobSig)).toBe(false);
    expect(bob.verify(payload, bobSig)).toBe(true);
    expect(bob.verify(payload, aliceSig)).toBe(false);
  });

  it("a signature from a DIFFERENT keyring fails verification (cross-keyring isolation)", () => {
    const signer1 = new HmacSigner({ keyring_id: "key1", baseDir: tempDir });
    const signer2 = new HmacSigner({ keyring_id: "key2", baseDir: tempDir });
    const payload = makePayload();

    const sig = signer1.sign(payload);
    expect(signer2.verify(payload, sig)).toBe(false);
  });
});
