// =============================================================================
// revocation.test.ts — acceptance spec for WS-P1-02: ed25519 bootstrap revocation
//
// STATUS: PASSING — implementation lives in src/bootstrap/revocation.ts,
// @noble/ed25519 is installed, all 41 tests green.
//
// ORDERING: misuse → boundary → golden path (adversarial-first policy).
//
// CONTRACT (enforced by these tests):
//
//   checkRevocation(opts: CheckRevocationOptions): Promise<RevocationResult>
//
//   CheckRevocationOptions = {
//     data:               Uint8Array | Buffer;          // bytes that were signed (tarball)
//     signature:          Uint8Array | Buffer | undefined | null;  // detached ed25519 sig
//     publicKey:          Uint8Array | Buffer;          // ed25519 public key (32 bytes)
//     keyId:              string;                       // stable identifier for the signing key
//     revocationList?:    RevocationList;               // injected list (for tests / offline)
//     revocationListFetcher?: () => Promise<RevocationList>; // async fetcher (stubbed in tests)
//     // Exactly one of revocationList or revocationListFetcher must be provided.
//   }
//
//   RevocationResult = { verdict: "PASS" | "BLOCKED"; reason?: string }
//
//   RevocationList = { revoked_keys: RevokedKey[] }
//   RevokedKey     = { key_id: string; reason?: string }
//
// FAIL-SAFE RULES (all must be BLOCKED, never PASS):
//   - Invalid/garbage signature
//   - Tampered bytes (sig valid for content A, verified against content B)
//   - signing keyId present in revocation list
//   - Missing/undefined/empty signature
//   - Revocation list fetch failure (throws, 404, timeout)
//   - Malformed revocation list JSON / wrong shape
//
// Only valid sig + keyId NOT in a successfully-fetched clean list → PASS.
// BLOCKED results MUST carry a non-empty reason string.
// ZERO live network — all fetchers are injected stubs.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Contract types — declared inline so the contract is explicit and visible
// even before the implementation file exists. Dev must export these exact
// shapes from src/bootstrap/revocation.ts.
// ---------------------------------------------------------------------------

export interface RevokedKey {
  key_id: string;
  reason?: string;
}

export interface RevocationList {
  revoked_keys: RevokedKey[];
}

export type RevocationVerdict = "PASS" | "BLOCKED";

export interface RevocationResult {
  verdict: RevocationVerdict;
  reason?: string;
  warning?: string;
}

export interface CheckRevocationOptions {
  /** The raw bytes that were signed (e.g. tarball content). */
  data: Uint8Array | Buffer;
  /** Detached ed25519 signature over `data`. May be undefined or null for the missing-sig misuse case. */
  signature: Uint8Array | Buffer | undefined | null;
  /** ed25519 public key (32 bytes). Injected for testability — never a hardcoded production key. */
  publicKey: Uint8Array | Buffer;
  /** Stable identifier for the signing key — checked against the revocation list. */
  keyId: string;
  /**
   * Injected revocation list (offline / test mode).
   * Provide EITHER revocationList OR revocationListFetcher, not both.
   */
  revocationList?: RevocationList;
  /**
   * Async fetcher for the revocation list (for production / network mode).
   * Tests MUST pass a stub here — never a real URL fetcher.
   * If the fetcher throws or returns a non-conforming shape → BLOCKED (fail-safe).
   */
  revocationListFetcher?: () => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Import the module under test.
// The .catch() fallback sets checkRevocation to undefined if the module fails
// to load; requireImpl() guards every test and surfaces a clear error in that
// case. Under normal (post-implementation) conditions the import succeeds and
// moduleLoaded is true for all 41 tests.
// ---------------------------------------------------------------------------

const { checkRevocation } = await import("./revocation.js").catch(() => ({
  checkRevocation: undefined,
}));

// ---------------------------------------------------------------------------
// Keypair generation helpers
// Uses Node's built-in crypto.generateKeyPairSync with Ed25519.
// These generate ephemeral test-only keypairs — never commit real key material.
// ---------------------------------------------------------------------------

interface EphemeralKeyPair {
  publicKeyBytes: Uint8Array; // 32-byte ed25519 public key
  privateKeyObject: crypto.KeyObject; // Node crypto KeyObject (for signing)
}

/**
 * Generate a fresh ephemeral ed25519 keypair for each test.
 * Discarded after the test — never committed or stored.
 */
function generateEphemeralKeyPair(): EphemeralKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  // Export raw 32-byte public key
  const publicKeyBytes = publicKey.export({ type: "spki", format: "der" });
  // The last 32 bytes of a DER SPKI-encoded ed25519 key are the raw key material
  const rawPublicKey = new Uint8Array(publicKeyBytes.slice(-32));
  return { publicKeyBytes: rawPublicKey, privateKeyObject: privateKey };
}

/**
 * Sign `data` with an ed25519 private key using Node's built-in crypto.
 * Returns a 64-byte Uint8Array (detached signature).
 */
function signData(data: Uint8Array, privateKey: crypto.KeyObject): Uint8Array {
  const sig = crypto.sign(null, data, privateKey);
  return new Uint8Array(sig);
}

// ---------------------------------------------------------------------------
// Stub builders
// ---------------------------------------------------------------------------

/** Returns a fetcher stub that resolves with a valid, empty revocation list. */
function cleanListFetcher(): () => Promise<RevocationList> {
  return async () => ({ revoked_keys: [] });
}

/** Returns a fetcher stub that resolves with a list containing the given keyId as revoked. */
function revokedListFetcher(
  keyId: string,
  reason = "key compromised"
): () => Promise<RevocationList> {
  return async () => ({ revoked_keys: [{ key_id: keyId, reason }] });
}

/** Returns a fetcher stub that throws (simulates network failure / timeout). */
function failingFetcher(message = "fetch failed"): () => Promise<never> {
  return async () => {
    throw new Error(message);
  };
}

/** Returns a fetcher stub that resolves with a non-conforming payload (wrong shape). */
function malformedFetcher(
  payload: unknown = { not_the_right_shape: true }
): () => Promise<unknown> {
  return async () => payload;
}

// ---------------------------------------------------------------------------
// Guard: abort tests gracefully if the module ever fails to load (e.g. during
// future refactors that temporarily break the export). Surfaces a clear error
// message rather than a confusing TypeError on the cast below.
// ---------------------------------------------------------------------------

const moduleLoaded = typeof checkRevocation === "function";

function requireImpl(name: string): void {
  if (!moduleLoaded) {
    throw new Error(
      `[WS-P1-02] ${name}: checkRevocation() not yet implemented. ` +
        `Create src/bootstrap/revocation.ts exporting checkRevocation() to make this test pass.`
    );
  }
}

// ---------------------------------------------------------------------------
// MISUSE: Garbage / corrupt signature → BLOCKED
//
// A caller passes a signature that is not a valid ed25519 signature at all.
// Must never PASS, must carry a reason.
// ---------------------------------------------------------------------------

describe("checkRevocation — misuse: garbage/corrupt signature → BLOCKED", () => {
  let kp: EphemeralKeyPair;
  const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

  beforeEach(() => {
    kp = generateEphemeralKeyPair();
  });

  it("returns BLOCKED when signature is 64 random garbage bytes", async () => {
    requireImpl("garbage signature");
    const garbleSig = crypto.randomBytes(64);
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: garbleSig,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it("returns BLOCKED when signature is all zeros (64 bytes)", async () => {
    requireImpl("all-zeros signature");
    const zeroSig = new Uint8Array(64);
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: zeroSig,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when signature has wrong length (32 bytes instead of 64)", async () => {
    requireImpl("wrong-length signature");
    const shortSig = crypto.randomBytes(32);
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: shortSig,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when signature has wrong length (128 bytes)", async () => {
    requireImpl("oversized signature");
    const longSig = crypto.randomBytes(128);
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: longSig,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when signature is a valid sig from a DIFFERENT keypair", async () => {
    requireImpl("wrong-key signature");
    const otherKp = generateEphemeralKeyPair();
    const sigFromOtherKey = signData(data, otherKp.privateKeyObject);
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sigFromOtherKey,
      publicKey: kp.publicKeyBytes, // mismatch: sig is from otherKp, key is kp
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MISUSE: Tampered data — sig valid for content A, verified against content B
//
// The canonical supply-chain attack: attacker substitutes the payload after
// signing. Must never PASS on tampered bytes.
// ---------------------------------------------------------------------------

describe("checkRevocation — misuse: tampered data → BLOCKED", () => {
  let kp: EphemeralKeyPair;

  beforeEach(() => {
    kp = generateEphemeralKeyPair();
  });

  it("returns BLOCKED when data differs by one byte (signed A, checking B)", async () => {
    requireImpl("tampered data: single byte diff");
    const originalData = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50]);
    const tamperedData = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0xff]); // last byte changed
    const sig = signData(originalData, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data: tamperedData, // different from what was signed
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when data is entirely replaced (signed A, checking C)", async () => {
    requireImpl("tampered data: full replacement");
    const originalData = new Uint8Array([0x01, 0x02, 0x03]);
    const differentData = new Uint8Array([0x04, 0x05, 0x06]);
    const sig = signData(originalData, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data: differentData,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when data is empty but was originally non-empty", async () => {
    requireImpl("tampered data: empty vs non-empty");
    const originalData = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const emptyData = new Uint8Array(0);
    const sig = signData(originalData, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data: emptyData,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when data has bytes prepended (length-extension-style tamper)", async () => {
    requireImpl("tampered data: bytes prepended");
    const originalData = new Uint8Array([0xca, 0xfe]);
    const prependedData = new Uint8Array([0x00, 0xca, 0xfe]);
    const sig = signData(originalData, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data: prependedData,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MISUSE: Signing keyId is in the revocation list → BLOCKED
//
// Even a cryptographically valid signature must be blocked if the signing key
// has been revoked. Revocation takes precedence over signature validity.
// ---------------------------------------------------------------------------

describe("checkRevocation — misuse: revoked keyId → BLOCKED", () => {
  let kp: EphemeralKeyPair;
  const data = new Uint8Array([0xab, 0xcd, 0xef]);

  beforeEach(() => {
    kp = generateEphemeralKeyPair();
  });

  it("returns BLOCKED (with reason) when keyId is in injected revocation list", async () => {
    requireImpl("revoked keyId: injected list");
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "compromised-key-01",
      revocationList: {
        revoked_keys: [{ key_id: "compromised-key-01", reason: "private key leaked 2026-06-01" }],
      },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it("returns BLOCKED when keyId matches one entry among several revoked keys", async () => {
    requireImpl("revoked keyId: multi-entry list");
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "key-b",
      revocationList: {
        revoked_keys: [
          { key_id: "key-a", reason: "expired" },
          { key_id: "key-b", reason: "compromised" },
          { key_id: "key-c", reason: "superseded" },
        ],
      },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when keyId is revoked even if signature is cryptographically valid", async () => {
    requireImpl("revoked keyId: valid sig still blocked");
    // This is the critical invariant: revocation wins over sig validity.
    const sig = signData(data, kp.privateKeyObject); // valid sig
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "my-key",
      revocationList: { revoked_keys: [{ key_id: "my-key" }] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when revoked key is fetched via fetcher stub (not injected)", async () => {
    requireImpl("revoked keyId: via fetcher");
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "revoked-via-fetcher",
      revocationListFetcher: revokedListFetcher("revoked-via-fetcher"),
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MISUSE: Missing signature (undefined / null / empty) → BLOCKED
//
// Callers that fail to provide a signature at all must be blocked.
// There is no "unauthenticated PASS" path — missing sig = BLOCKED.
// ---------------------------------------------------------------------------

describe("checkRevocation — misuse: missing/empty signature → BLOCKED", () => {
  let kp: EphemeralKeyPair;
  const data = new Uint8Array([0x11, 0x22, 0x33]);

  beforeEach(() => {
    kp = generateEphemeralKeyPair();
  });

  it("returns BLOCKED when signature is undefined", async () => {
    requireImpl("missing sig: undefined");
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: undefined,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when signature is null", async () => {
    requireImpl("missing sig: null");
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: null,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when signature is empty Uint8Array (0 bytes)", async () => {
    requireImpl("missing sig: empty Uint8Array");
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: new Uint8Array(0),
      publicKey: kp.publicKeyBytes,
      keyId: "test-key",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when signature is empty Buffer", async () => {
    requireImpl("missing sig: empty Buffer");
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: Buffer.alloc(0),
      publicKey: kp.publicKeyBytes,
      keyId: "test-key",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: Revocation list fetch failures → BLOCKED (fail-safe)
//
// Any fetch failure — throw, timeout simulation, 404 simulation — must block.
// The system never fails open: if we can't confirm the key is clean, we block.
// Zero live network — all fetchers are injected stubs.
// ---------------------------------------------------------------------------

describe("checkRevocation — boundary: fetch failure → BLOCKED (fail-safe)", () => {
  let kp: EphemeralKeyPair;
  const data = new Uint8Array([0x55, 0x66, 0x77]);

  beforeEach(() => {
    kp = generateEphemeralKeyPair();
  });

  it("returns BLOCKED when fetcher throws (simulates network error)", async () => {
    requireImpl("fetch failure: throws");
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "valid-key",
      revocationListFetcher: failingFetcher("Network error: ECONNREFUSED"),
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when fetcher simulates timeout (throws with timeout message)", async () => {
    requireImpl("fetch failure: timeout");
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "valid-key",
      revocationListFetcher: failingFetcher("Request timeout after 5000ms"),
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when fetcher simulates a 404 (throws with 404 message)", async () => {
    requireImpl("fetch failure: 404");
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "valid-key",
      revocationListFetcher: failingFetcher("HTTP 404: revocation list not found"),
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("BLOCKED verdict must have a non-empty reason on fetch failure (diagnosable)", async () => {
    requireImpl("fetch failure: reason present");
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "any-key",
      revocationListFetcher: failingFetcher("connection refused"),
    });
    expect(result.verdict).toBe("BLOCKED");
    // reason must be a non-empty string so operations can diagnose the failure
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: Malformed revocation list → BLOCKED
//
// If the fetcher returns something that is not a valid RevocationList shape,
// the function must block rather than proceeding with an unverified list.
// ---------------------------------------------------------------------------

describe("checkRevocation — boundary: malformed revocation list → BLOCKED", () => {
  let kp: EphemeralKeyPair;
  const data = new Uint8Array([0x88, 0x99, 0xaa]);

  beforeEach(() => {
    kp = generateEphemeralKeyPair();
  });

  it("returns BLOCKED when fetcher returns null", async () => {
    requireImpl("malformed list: null");
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "valid-key",
      revocationListFetcher: malformedFetcher(null),
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when fetcher returns an empty object {}", async () => {
    requireImpl("malformed list: empty object");
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "valid-key",
      revocationListFetcher: malformedFetcher({}),
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when revoked_keys field is missing", async () => {
    requireImpl("malformed list: missing revoked_keys");
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "valid-key",
      revocationListFetcher: malformedFetcher({ wrong_field: [] }),
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when revoked_keys is not an array", async () => {
    requireImpl("malformed list: revoked_keys is not array");
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "valid-key",
      revocationListFetcher: malformedFetcher({ revoked_keys: "not-an-array" }),
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("returns BLOCKED when revocation list is a raw string (not parsed JSON)", async () => {
    requireImpl("malformed list: raw string");
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "valid-key",
      revocationListFetcher: malformedFetcher('{"revoked_keys":[]}'),
    });
    // A raw JSON string (not parsed object) is wrong shape → BLOCKED
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY: Empty revocation list + valid signature → PASS
//
// An explicitly empty list (no revoked keys) is a valid, clean state.
// A valid sig over the correct bytes + keyId not in empty list = PASS.
// ---------------------------------------------------------------------------

describe("checkRevocation — boundary: empty revocation list + valid sig → PASS", () => {
  let kp: EphemeralKeyPair;

  beforeEach(() => {
    kp = generateEphemeralKeyPair();
  });

  it("returns PASS for valid sig + empty injected revocation list", async () => {
    requireImpl("empty list: injected");
    const data = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "clean-key",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("PASS");
  });

  it("returns PASS for valid sig + empty list via fetcher stub", async () => {
    requireImpl("empty list: fetcher stub");
    const data = new Uint8Array([0xfe, 0xdc, 0xba]);
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "clean-key",
      revocationListFetcher: cleanListFetcher(),
    });
    expect(result.verdict).toBe("PASS");
  });

  it("PASS result does not need a reason (reason is optional on PASS)", async () => {
    requireImpl("empty list: PASS reason optional");
    const data = new Uint8Array([0x42]);
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "any-clean-key",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("PASS");
    // reason is optional on PASS — we only assert it's not required, not that it's absent
  });

  it("PASS for Buffer input (not just Uint8Array) — input type agnostic", async () => {
    requireImpl("empty list: Buffer input");
    const data = Buffer.from([0x11, 0x22, 0x33, 0x44]);
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data, // Buffer
      signature: Buffer.from(sig), // Buffer
      publicKey: Buffer.from(kp.publicKeyBytes), // Buffer
      keyId: "buffer-key",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: Valid signature + keyId NOT in a clean fetched list → PASS
//
// The only scenario that must produce PASS: a cryptographically valid ed25519
// signature over the exact bytes provided, with the signing key absent from
// a successfully resolved revocation list.
// ---------------------------------------------------------------------------

describe("checkRevocation — golden path: valid sig + clean fetched list → PASS", () => {
  let kp: EphemeralKeyPair;

  beforeEach(() => {
    kp = generateEphemeralKeyPair();
  });

  it("returns PASS for valid sig + non-empty list that does NOT contain keyId", async () => {
    requireImpl("golden: valid sig, other keys revoked but not ours");
    const data = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "our-key-id",
      revocationList: {
        // Other keys are revoked but not ours
        revoked_keys: [
          { key_id: "some-other-key", reason: "compromised" },
          { key_id: "yet-another-key", reason: "expired" },
        ],
      },
    });
    expect(result.verdict).toBe("PASS");
  });

  it("returns PASS via fetcher stub with non-empty clean list", async () => {
    requireImpl("golden: via fetcher, keyId not in list");
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00]);
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "bootstrap-v2-key",
      revocationListFetcher: async () => ({
        revoked_keys: [{ key_id: "bootstrap-v1-key", reason: "superseded by v2" }],
      }),
    });
    expect(result.verdict).toBe("PASS");
  });

  it("verdict is exactly 'PASS' (string equality — no extra whitespace or casing variants)", async () => {
    requireImpl("golden: verdict shape exactness");
    const data = new Uint8Array([0xc0, 0xff, 0xee]);
    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "exact-key",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("PASS");
    // Ensure result shape matches RevocationResult exactly
    expect(Object.keys(result).every((k) => ["verdict", "reason"].includes(k))).toBe(true);
  });

  it("different data payloads each PASS when signed correctly (not a one-off)", async () => {
    requireImpl("golden: multiple valid payloads pass");
    const payloads = [
      new Uint8Array([0x01]),
      new Uint8Array([0xff, 0xfe, 0xfd]),
      new Uint8Array(1024).fill(0x42), // 1 KB of data
      crypto.randomBytes(512), // random large payload
    ];

    for (const data of payloads) {
      const sig = signData(data, kp.privateKeyObject);
      const result = await (
        checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
      )({
        data,
        signature: sig,
        publicKey: kp.publicKeyBytes,
        keyId: "multi-payload-key",
        revocationList: { revoked_keys: [] },
      });
      expect(result.verdict).toBe("PASS");
    }
  });

  it("two independent keypairs each sign their own data and both PASS", async () => {
    requireImpl("golden: two keypairs, two passes");
    const kp2 = generateEphemeralKeyPair();
    const data1 = new Uint8Array([0xaa, 0xbb]);
    const data2 = new Uint8Array([0xcc, 0xdd]);

    const sig1 = signData(data1, kp.privateKeyObject);
    const sig2 = signData(data2, kp2.privateKeyObject);

    const [res1, res2] = await Promise.all([
      (checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>)({
        data: data1,
        signature: sig1,
        publicKey: kp.publicKeyBytes,
        keyId: "keypair-1",
        revocationList: { revoked_keys: [] },
      }),
      (checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>)({
        data: data2,
        signature: sig2,
        publicKey: kp2.publicKeyBytes,
        keyId: "keypair-2",
        revocationList: { revoked_keys: [] },
      }),
    ]);

    expect(res1.verdict).toBe("PASS");
    expect(res2.verdict).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// SECURITY INVARIANT: BLOCKED results always carry a non-empty reason
//
// Cross-cutting assertion: every BLOCKED path must produce a diagnosable reason.
// This suite probes a representative set to confirm the invariant holds.
// ---------------------------------------------------------------------------

describe("checkRevocation — security invariant: BLOCKED always has non-empty reason", () => {
  let kp: EphemeralKeyPair;
  const data = new Uint8Array([0x99]);

  beforeEach(() => {
    kp = generateEphemeralKeyPair();
  });

  it("garbage sig BLOCKED has a non-empty string reason", async () => {
    requireImpl("invariant: garbage sig reason");
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: crypto.randomBytes(64),
      publicKey: kp.publicKeyBytes,
      keyId: "key",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).trim().length).toBeGreaterThan(0);
  });

  it("missing sig BLOCKED has a non-empty string reason", async () => {
    requireImpl("invariant: missing sig reason");
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: undefined,
      publicKey: kp.publicKeyBytes,
      keyId: "key",
      revocationList: { revoked_keys: [] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).trim().length).toBeGreaterThan(0);
  });

  it("revoked key BLOCKED has a non-empty string reason", async () => {
    requireImpl("invariant: revoked key reason");
    const sig = signData(data, kp.privateKeyObject);
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "revoked-key",
      revocationList: { revoked_keys: [{ key_id: "revoked-key", reason: "leaked" }] },
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).trim().length).toBeGreaterThan(0);
  });

  it("fetch failure BLOCKED has a non-empty string reason", async () => {
    requireImpl("invariant: fetch failure reason");
    const sig = signData(data, kp.privateKeyObject);
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "key",
      revocationListFetcher: failingFetcher("network down"),
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).trim().length).toBeGreaterThan(0);
  });

  it("malformed list BLOCKED has a non-empty string reason", async () => {
    requireImpl("invariant: malformed list reason");
    const sig = signData(data, kp.privateKeyObject);
    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "key",
      revocationListFetcher: malformedFetcher(42),
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// WS-REVOKE-01: Plugin-context fail-closed path for checkRevocation()
//
// UPDATED (WS-REVOKE-01): The old WS-GO-02 fail-open path (returning PASS with
// warning for unsigned plugin bundles) has been removed. Plugin context is now
// FAIL-CLOSED — an absent signature in plugin context MUST return BLOCKED, just
// like the non-plugin path. There is no "unsigned-plugin-context" escape hatch.
//
// T5: CLAUDE_PLUGIN_ROOT set + signature absent → BLOCKED (updated: was PASS, now BLOCKED)
// T6: CLAUDE_PLUGIN_ROOT unset + signature absent → BLOCKED (unchanged)
// T7: CLAUDE_PLUGIN_ROOT set + valid 64-byte signature present → Ed25519 path runs → PASS
// ---------------------------------------------------------------------------

describe("checkRevocation — WS-REVOKE-01: plugin-context fail-closed (CLAUDE_PLUGIN_ROOT env var)", () => {
  let kp: EphemeralKeyPair;
  const data = new Uint8Array([0x01, 0x02, 0x03]);

  // Save and restore CLAUDE_PLUGIN_ROOT across each test.
  let savedPluginRoot: string | undefined;

  beforeEach(() => {
    kp = generateEphemeralKeyPair();
    savedPluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];
  });

  afterEach(() => {
    if (savedPluginRoot === undefined) {
      delete process.env["CLAUDE_PLUGIN_ROOT"];
    } else {
      process.env["CLAUDE_PLUGIN_ROOT"] = savedPluginRoot;
    }
  });

  // T5 (misuse — plugin context): signature absent in plugin context →
  // BLOCKED (WS-REVOKE-01 fix: plugin context is no longer a bypass).
  // The old WS-GO-02 fail-open path that returned { verdict: "PASS", warning:
  // "unsigned-plugin-context" } has been removed. An unsigned plugin MUST block.
  it("T5. CLAUDE_PLUGIN_ROOT set + signature undefined → BLOCKED (WS-REVOKE-01: fail-open removed, now fail-closed)", async () => {
    requireImpl("T5: plugin context fail-closed");
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/plugin/root";

    const result = (await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: undefined,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    })) as RevocationResult;

    // Plugin context is no longer a bypass — missing sig MUST be BLOCKED.
    expect(result.verdict).toBe("BLOCKED");
    // Must carry a diagnosable reason, not the old warning
    expect(result.reason).toBeTruthy();
    // The unsigned-plugin-context escape hatch is gone
    expect(result.warning).toBeUndefined();
  });

  // T6 (misuse — standalone regression guard): signature absent outside plugin context →
  // { verdict: "BLOCKED" } (unchanged from existing fail-safe behaviour).
  // This is the critical regression guard: the plugin-context change must NOT
  // affect the standalone path. Standalone must remain fail-safe BLOCKED.
  it("T6. CLAUDE_PLUGIN_ROOT unset + signature undefined → { verdict: 'BLOCKED' } (existing fail-safe unchanged)", async () => {
    requireImpl("T6: standalone fail-safe regression guard");
    delete process.env["CLAUDE_PLUGIN_ROOT"];

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: undefined,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });

    // Standalone path must remain BLOCKED — never fail-open
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
    expect((result as RevocationResult).warning).toBeUndefined();
  });

  // T7 (boundary): CLAUDE_PLUGIN_ROOT set + valid 64-byte signature present →
  // Ed25519 verify path runs (not short-circuited to PASS).
  // When a real signature IS present, even in plugin context, the crypto verification
  // path must run. A valid sig over matching data must PASS.
  // (If the sig were invalid, it would still BLOCK — but we test with a valid sig
  // to confirm the verify path actually executes rather than being bypassed.)
  it("T7. CLAUDE_PLUGIN_ROOT set + valid 64-byte signature → Ed25519 verify path runs, valid sig → PASS", async () => {
    requireImpl("T7: plugin context + valid sig runs Ed25519 verify");
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/plugin/root";

    const sig = signData(data, kp.privateKeyObject);

    const result = (await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    })) as RevocationResult;

    // A valid sig in plugin context → PASS (via normal crypto path, not short-circuit)
    expect(result.verdict).toBe("PASS");
    // No unsigned-plugin-context warning — the sig IS present
    expect(result.warning).toBeUndefined();
  });

  // T7b (boundary): CLAUDE_PLUGIN_ROOT set + invalid 64-byte signature → BLOCKED
  // Confirms the Ed25519 path is not bypassed when a bad sig is present.
  it("T7b. CLAUDE_PLUGIN_ROOT set + invalid 64-byte signature → BLOCKED (crypto path not bypassed)", async () => {
    requireImpl("T7b: plugin context + invalid sig → BLOCKED");
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/plugin/root";

    // A garbage signature — not a valid Ed25519 sig for our data/key
    const garbageSig = new Uint8Array(64).fill(0x42);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: garbageSig,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });

    // Even in plugin context, an invalid sig must BLOCK (not fail-open)
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ZERO NETWORK ASSERTION
// The no-network.ts setup file blocks global fetch. These tests confirm that
// no test in this suite attempts a live network call.
// All fetchers used above are injected stubs — none hit a real URL.
// ---------------------------------------------------------------------------

import { getNetworkCallCount } from "../../tests/acceptance/support/no-network.js";

describe("checkRevocation — zero network calls", () => {
  it("no live network calls were made across the entire revocation test suite", () => {
    // The no-network setup file counts any call to globalThis.fetch.
    // All our fetchers are injected stubs that never use fetch.
    // If this fails, a test is accidentally hitting the network.
    expect(getNetworkCallCount()).toBe(0);
  });
});

// =============================================================================
// WS-REVOKE-01: Post-install signature verification — fail-closed plugin context
//
// STATUS: FAILING (tests written before implementation — this is the QA gate)
//
// BUG BEING FIXED:
//   When CLAUDE_PLUGIN_ROOT is set AND signature is undefined/null, the current
//   code at revocation.ts lines ~108-110 returns { verdict: "PASS", warning:
//   "unsigned-plugin-context" } — bypassing all crypto verification.
//
//   This is a security vulnerability: any unsigned payload can load in plugin
//   context with no verification whatsoever.
//
// DECIDED FIX (Option B — Post-install signatures):
//   At plugin install time, sign the plugin root path (or bundle content).
//   On load, checkRevocation() verifies that signature.
//   FAIL-CLOSED if signature is absent OR mismatches in a plugin context.
//   There is no longer any "unsigned-plugin-context" PASS escape hatch.
//
// CONFLICT WITH EXISTING TESTS:
//   Existing test T5 (line ~1079) asserts the OLD broken behavior:
//     expect(result.verdict).toBe("PASS")  // fail-open — this was wrong
//   After dev implements the fix, T5 MUST be updated to:
//     expect(result.verdict).toBe("BLOCKED")
//   Dev is responsible for updating T5. Staff review must verify T5 was updated,
//   not silently deleted.
//
// TEST ORDER: misuse → boundary → golden path
// =============================================================================

describe("checkRevocation — WS-REVOKE-01: plugin context MUST be fail-closed (FAILING AGAINST CURRENT CODE)", () => {
  let kp: EphemeralKeyPair;
  const data = new Uint8Array([0x01, 0x02, 0x03]);

  let savedPluginRoot: string | undefined;

  beforeEach(() => {
    kp = generateEphemeralKeyPair();
    savedPluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];
  });

  afterEach(() => {
    if (savedPluginRoot === undefined) {
      delete process.env["CLAUDE_PLUGIN_ROOT"];
    } else {
      process.env["CLAUDE_PLUGIN_ROOT"] = savedPluginRoot;
    }
  });

  // ---------------------------------------------------------------------------
  // MISUSE: signature absent in plugin context → BLOCKED (fails now, returns PASS)
  //
  // These are the primary bug-exposure tests. They MUST fail against current code
  // (current code returns PASS). They MUST pass after dev implements Option B.
  // ---------------------------------------------------------------------------

  it("REVOKE-01-M1. CLAUDE_PLUGIN_ROOT set + signature undefined → BLOCKED (currently returns PASS — BUG)", async () => {
    requireImpl("REVOKE-01-M1: plugin context + undefined sig → BLOCKED");
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/plugin/root";

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: undefined,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });

    // MUST be BLOCKED — plugin context is NOT a bypass. An unsigned plugin is
    // not a trusted plugin. Currently returns PASS (the bug).
    expect(result.verdict).toBe("BLOCKED");
    // Must carry a diagnosable reason — never a silent failure
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).trim().length).toBeGreaterThan(0);
    // Must NOT carry the old unsigned-plugin-context warning (that escape hatch is gone)
    expect((result as RevocationResult).warning).toBeUndefined();
  });

  it("REVOKE-01-M2. CLAUDE_PLUGIN_ROOT set + signature null → BLOCKED (currently returns PASS — BUG)", async () => {
    requireImpl("REVOKE-01-M2: plugin context + null sig → BLOCKED");
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/plugin/root";

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: null,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });

    // MUST be BLOCKED — null signature is as dangerous as undefined.
    // Currently returns PASS (the bug).
    expect(result.verdict).toBe("BLOCKED");
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).trim().length).toBeGreaterThan(0);
    expect((result as RevocationResult).warning).toBeUndefined();
  });

  it("REVOKE-01-M3. CLAUDE_PLUGIN_ROOT set + empty string plugin root + signature undefined → BLOCKED", async () => {
    requireImpl("REVOKE-01-M3: empty-string plugin root + undefined sig → BLOCKED");
    // Empty string is NOT a valid CLAUDE_PLUGIN_ROOT — the current isPluginContext
    // check already guards this (length > 0). This test confirms empty string does
    // NOT trigger the plugin-context path and falls through to normal BLOCKED.
    process.env["CLAUDE_PLUGIN_ROOT"] = "";

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: undefined,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });

    // Empty-string CLAUDE_PLUGIN_ROOT must NOT trigger any plugin-context path.
    // Both current and post-fix code should return BLOCKED here.
    // (This test should pass now AND after the fix — it is a regression guard.)
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // MISUSE: invalid sig in plugin context → BLOCKED
  //
  // This should already work (current code only bypasses when sig IS absent).
  // Included as an explicit regression guard to confirm the crypto path is not
  // accidentally removed when dev strips the fail-open block.
  // ---------------------------------------------------------------------------

  it("REVOKE-01-M4. CLAUDE_PLUGIN_ROOT set + 64-byte garbage signature → BLOCKED (regression guard, should pass now)", async () => {
    requireImpl("REVOKE-01-M4: plugin context + garbage sig → BLOCKED");
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/plugin/root";

    const garbageSig = crypto.randomBytes(64);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: garbageSig,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });

    // Bad sig in plugin context was never bypassed — should BLOCK now and after fix.
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  it("REVOKE-01-M5. CLAUDE_PLUGIN_ROOT set + sig for WRONG keypair → BLOCKED (regression guard, should pass now)", async () => {
    requireImpl("REVOKE-01-M5: plugin context + wrong-key sig → BLOCKED");
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/plugin/root";

    const otherKp = generateEphemeralKeyPair();
    const sigFromOtherKey = signData(data, otherKp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sigFromOtherKey,
      publicKey: kp.publicKeyBytes, // mismatch: sig is from otherKp
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });

    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // REGRESSION GUARD: non-plugin context (CLAUDE_PLUGIN_ROOT unset) behavior
  // must not be affected by the fix.
  //
  // These should pass now AND after the fix. If they break, the fix is too broad.
  // ---------------------------------------------------------------------------

  it("REVOKE-01-R1. CLAUDE_PLUGIN_ROOT unset + signature undefined → BLOCKED (regression guard, non-plugin path unchanged)", async () => {
    requireImpl("REVOKE-01-R1: no plugin context + undefined sig → BLOCKED");
    delete process.env["CLAUDE_PLUGIN_ROOT"];

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: undefined,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });

    // Non-plugin path was already BLOCKED — must stay BLOCKED after fix.
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
    // No warning of any kind on non-plugin path
    expect((result as RevocationResult).warning).toBeUndefined();
  });

  it("REVOKE-01-R2. CLAUDE_PLUGIN_ROOT unset + valid signature → PASS (regression guard, golden path unchanged)", async () => {
    requireImpl("REVOKE-01-R2: no plugin context + valid sig → PASS");
    delete process.env["CLAUDE_PLUGIN_ROOT"];

    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    });

    // Non-plugin context + valid sig must still PASS after the fix.
    expect(result.verdict).toBe("PASS");
  });

  // ---------------------------------------------------------------------------
  // GOLDEN PATH: valid signature in plugin context → PASS
  //
  // After Option B is implemented, a validly-signed plugin must still load.
  // The signing payload is the plugin root path at install time.
  // The exact mechanism (where the sig lives, what key signs it, what the
  // signed payload is) is NOT YET DESIGNED — see acceptance criteria below.
  //
  // REVOKE-01-G1 is a concrete test using the existing checkRevocation() interface
  // (data = pluginRoot path bytes, sig = ed25519 over those bytes).
  // This describes the post-fix contract even if the install-time signing
  // infrastructure doesn't exist yet.
  // ---------------------------------------------------------------------------

  it("REVOKE-01-G1. CLAUDE_PLUGIN_ROOT set + valid signature over plugin-root-path bytes → PASS (regression guard, should pass now)", async () => {
    requireImpl("REVOKE-01-G1: plugin context + valid sig → PASS");
    const pluginRoot = "/fake/plugin/root";
    process.env["CLAUDE_PLUGIN_ROOT"] = pluginRoot;

    // Option B: the signed payload is the plugin root path as UTF-8 bytes.
    // At install time, the installer signs this path. On load, checkRevocation()
    // verifies the sig over the same path bytes.
    const pluginRootBytes = new Uint8Array(Buffer.from(pluginRoot, "utf8"));
    const sig = signData(pluginRootBytes, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data: pluginRootBytes, // signed payload = plugin root path
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "install-signing-key-v1",
      revocationList: { revoked_keys: [] },
    });

    // A validly signed plugin in plugin context must PASS (not be blocked).
    // No warning — this is properly signed.
    expect(result.verdict).toBe("PASS");
    expect((result as RevocationResult).warning).toBeUndefined();
  });

  it("REVOKE-01-G2. CLAUDE_PLUGIN_ROOT set + valid signature over plugin-root-path bytes + key revoked → BLOCKED", async () => {
    requireImpl("REVOKE-01-G2: plugin context + valid sig + revoked key → BLOCKED");
    const pluginRoot = "/fake/plugin/root";
    process.env["CLAUDE_PLUGIN_ROOT"] = pluginRoot;

    const pluginRootBytes = new Uint8Array(Buffer.from(pluginRoot, "utf8"));
    const sig = signData(pluginRootBytes, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data: pluginRootBytes,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "compromised-install-key",
      // The install signing key has been revoked — block even in plugin context
      revocationList: {
        revoked_keys: [
          { key_id: "compromised-install-key", reason: "install key leaked 2026-06-23" },
        ],
      },
    });

    // Revocation takes precedence over sig validity, even in plugin context.
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reason).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // PENDING: install-time signing infrastructure (Option B — not yet designed)
  //
  // These todo tests document the acceptance criteria for the install-time
  // signing mechanism that Option B requires. Dev must design the mechanism
  // before these can be written as executable tests.
  // ---------------------------------------------------------------------------

  it.todo(
    "REVOKE-01-TODO-1. Install-time signer: plugin install generates ed25519 keypair and signs plugin root path"
    // Acceptance criteria:
    //   - A one-time ed25519 keypair is generated at install time
    //   - The plugin root path is signed with the private key
    //   - The signature is stored in a known location (design decision: where?)
    //     Options: manifest.json, .teo/install-sig, CLAUDE_PLUGIN_ROOT/.teo-sig
    //   - The public key + key_id are embedded in the plugin bundle or fetched
    //     from a well-known URL
    //   - Private key is NEVER stored (ephemeral, used once at install)
  );

  it.todo(
    "REVOKE-01-TODO-2. checkRevocation() in plugin context reads install-time sig from known location"
    // Acceptance criteria:
    //   - When CLAUDE_PLUGIN_ROOT is set, checkRevocation() (or its caller in provision.ts)
    //     automatically reads the install-time signature from the known location
    //   - If the sig file is absent → BLOCKED (not PASS)
    //   - If the sig file is present but malformed → BLOCKED
    //   - The signed payload is deterministic: e.g. canonicalized plugin root path bytes
    //   - The public key used to verify is pinned (not provided by the attacker)
  );

  it.todo(
    "REVOKE-01-TODO-3. Sig file tamper: install sig replaced with different sig → BLOCKED"
    // Acceptance criteria:
    //   - If the sig file is overwritten with a sig for a different path → BLOCKED
    //   - If the sig file is overwritten with a sig from a different keypair → BLOCKED
    //   - Plugin root path must be re-verified on every provision() call (not cached)
  );

  it.todo(
    "REVOKE-01-TODO-4. Sig file permissions: sig file readable only by install user"
    // Acceptance criteria:
    //   - Sig file is created with mode 0o600 at install time
    //   - provision() fails gracefully (BLOCKED) if sig file is unreadable (EACCES)
  );
});

// =============================================================================
// WS-REVOKE-01: SECURITY INVARIANTS — plugin context
//
// Cross-cutting: the plugin-context changes must not loosen any existing
// security invariant. All BLOCKED paths must still carry non-empty reasons.
// =============================================================================

describe("checkRevocation — WS-REVOKE-01: security invariants hold in plugin context after fix", () => {
  let kp: EphemeralKeyPair;
  const data = new Uint8Array([0x12, 0x34, 0x56]);

  let savedPluginRoot: string | undefined;

  beforeEach(() => {
    kp = generateEphemeralKeyPair();
    savedPluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/plugin/root";
  });

  afterEach(() => {
    if (savedPluginRoot === undefined) {
      delete process.env["CLAUDE_PLUGIN_ROOT"];
    } else {
      process.env["CLAUDE_PLUGIN_ROOT"] = savedPluginRoot;
    }
  });

  it("REVOKE-01-SI1. plugin context + undefined sig → BLOCKED has non-empty reason (currently FAILS — returns PASS with no reason)", async () => {
    requireImpl("REVOKE-01-SI1: plugin context + undefined sig → BLOCKED with reason");

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: undefined,
      publicKey: kp.publicKeyBytes,
      keyId: "key",
      revocationList: { revoked_keys: [] },
    });

    // Security invariant: every BLOCKED result must have a non-empty diagnosable reason.
    // Current code returns PASS (the bug) — after fix, must return BLOCKED with reason.
    expect(result.verdict).toBe("BLOCKED");
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).trim().length).toBeGreaterThan(0);
  });

  it("REVOKE-01-SI2. plugin context + null sig → BLOCKED has non-empty reason (currently FAILS — returns PASS with no reason)", async () => {
    requireImpl("REVOKE-01-SI2: plugin context + null sig → BLOCKED with reason");

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: null,
      publicKey: kp.publicKeyBytes,
      keyId: "key",
      revocationList: { revoked_keys: [] },
    });

    expect(result.verdict).toBe("BLOCKED");
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).trim().length).toBeGreaterThan(0);
  });

  it("REVOKE-01-SI3. plugin context + fetch failure → BLOCKED with reason (regression guard, should pass now)", async () => {
    requireImpl("REVOKE-01-SI3: plugin context + fetch failure → BLOCKED with reason");

    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "key",
      revocationListFetcher: failingFetcher("ECONNREFUSED in plugin context"),
    });

    expect(result.verdict).toBe("BLOCKED");
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).trim().length).toBeGreaterThan(0);
  });

  it("REVOKE-01-SI4. plugin context + revoked key → BLOCKED with reason (regression guard, should pass now)", async () => {
    requireImpl("REVOKE-01-SI4: plugin context + revoked key → BLOCKED with reason");

    const sig = signData(data, kp.privateKeyObject);

    const result = await (
      checkRevocation as (opts: CheckRevocationOptions) => Promise<RevocationResult>
    )({
      data,
      signature: sig,
      publicKey: kp.publicKeyBytes,
      keyId: "revoked-plugin-key",
      revocationList: {
        revoked_keys: [{ key_id: "revoked-plugin-key", reason: "compromised at install" }],
      },
    });

    expect(result.verdict).toBe("BLOCKED");
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).trim().length).toBeGreaterThan(0);
  });
});
