// =============================================================================
// ed25519.test.ts — specs for src/lib/ed25519.ts (WS-LIB-01)
//
// STATUS: PASSING — implementation src/lib/ed25519.ts created (WS-LIB-01 complete).
//
// ORDERING: misuse → boundary → golden path (adversarial-first policy)
//
// CONTRACT (what these tests enforce):
//
//   src/lib/ed25519.ts must re-export from @noble/ed25519:
//     - signAsync(payload, privateKey): Promise<Uint8Array>
//     - verifyAsync(sig, payload, publicKey): Promise<boolean>
//     - getPublicKeyAsync(privateKey): Promise<Uint8Array>
//
//   The wrapper must be transparent — callers get identical behavior to
//   importing @noble/ed25519 directly. No swallowing, no rethrowing, no
//   mutation of inputs or outputs.
//
// SOURCE-SCAN (import hygiene):
//   After implementation, revocation.ts and install-sig.ts must no longer
//   import from "@noble/ed25519" directly — they must import from the wrapper.
//   These tests assert that at the source level.
//
// =============================================================================

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Import the wrapper (will fail until src/lib/ed25519.ts is created by dev)
// ---------------------------------------------------------------------------
import { signAsync, verifyAsync, getPublicKeyAsync } from "./ed25519.js";

// ---------------------------------------------------------------------------
// Test keypair constants — deterministic 32-byte private key for reproducible
// golden-path tests. A real ephemeral key is generated for misuse tests.
// ---------------------------------------------------------------------------
const KNOWN_PRIVATE_KEY = new Uint8Array(32).fill(0x42); // deterministic, non-zero

// =============================================================================
// MISUSE CASES — test error propagation and invalid-input behavior first
// =============================================================================

describe("ed25519 wrapper — misuse cases (adversarial-first)", () => {
  it("verifyAsync returns false (not a throw) for a tampered signature", async () => {
    // Generate a valid keypair and signature, then corrupt one byte of the sig.
    // @noble/ed25519 absorbs malformed sigs and returns false — never throws.
    const privateKey = KNOWN_PRIVATE_KEY;
    const publicKey = await getPublicKeyAsync(privateKey);
    const payload = new Uint8Array(Buffer.from("hello"));

    const validSig = await signAsync(payload, privateKey);
    const tamperedSig = new Uint8Array(validSig);
    tamperedSig[0] ^= 0xff; // flip all bits of first byte

    const result = await verifyAsync(tamperedSig, payload, publicKey);
    expect(result).toBe(false);
  });

  it("verifyAsync returns false for a valid sig verified against wrong payload", async () => {
    const privateKey = KNOWN_PRIVATE_KEY;
    const publicKey = await getPublicKeyAsync(privateKey);
    const payload = new Uint8Array(Buffer.from("original-payload"));
    const otherPayload = new Uint8Array(Buffer.from("tampered-payload"));

    const sig = await signAsync(payload, privateKey);
    const result = await verifyAsync(sig, otherPayload, publicKey);
    expect(result).toBe(false);
  });

  it("verifyAsync returns false for a valid sig verified against wrong public key", async () => {
    const privateKey = KNOWN_PRIVATE_KEY;
    const wrongPrivateKey = new Uint8Array(32).fill(0x99);
    const wrongPublicKey = await getPublicKeyAsync(wrongPrivateKey);
    const payload = new Uint8Array(Buffer.from("payload"));

    const sig = await signAsync(payload, privateKey);
    const result = await verifyAsync(sig, payload, wrongPublicKey);
    expect(result).toBe(false);
  });

  it("verifyAsync propagates errors from the underlying library unchanged (wrong-length public key)", async () => {
    // @noble/ed25519 throws on a public key that is not 32 bytes.
    // The wrapper must NOT swallow or rethrow with a different type.
    const privateKey = KNOWN_PRIVATE_KEY;
    const payload = new Uint8Array(Buffer.from("test"));
    const validSig = await signAsync(payload, privateKey);
    const badPublicKey = new Uint8Array(16); // wrong length — should throw

    // The wrapper must let the error propagate as-is.
    await expect(verifyAsync(validSig, payload, badPublicKey)).rejects.toThrow();
  });

  it("signAsync propagates errors from the underlying library unchanged (wrong-length private key)", async () => {
    // @noble/ed25519 throws on a private key that is not 32 bytes.
    const badPrivateKey = new Uint8Array(16); // wrong length — should throw
    const payload = new Uint8Array(Buffer.from("test"));

    await expect(signAsync(payload, badPrivateKey)).rejects.toThrow();
  });

  it("getPublicKeyAsync propagates errors for a wrong-length private key", async () => {
    const badPrivateKey = new Uint8Array(16);
    await expect(getPublicKeyAsync(badPrivateKey)).rejects.toThrow();
  });
});

// =============================================================================
// BOUNDARY CASES — edge inputs that are valid but minimal/maximal
// =============================================================================

describe("ed25519 wrapper — boundary cases", () => {
  it("signAsync and verifyAsync handle an empty payload (zero-length bytes)", async () => {
    const privateKey = KNOWN_PRIVATE_KEY;
    const publicKey = await getPublicKeyAsync(privateKey);
    const emptyPayload = new Uint8Array(0);

    const sig = await signAsync(emptyPayload, privateKey);
    const result = await verifyAsync(sig, emptyPayload, publicKey);
    expect(result).toBe(true);
  });

  it("signAsync and verifyAsync handle a large payload (1 MiB)", async () => {
    const privateKey = KNOWN_PRIVATE_KEY;
    const publicKey = await getPublicKeyAsync(privateKey);
    const largePayload = new Uint8Array(1024 * 1024).fill(0xab);

    const sig = await signAsync(largePayload, privateKey);
    const result = await verifyAsync(sig, largePayload, publicKey);
    expect(result).toBe(true);
  });

  it("signAsync produces a 64-byte signature (ed25519 invariant)", async () => {
    const privateKey = KNOWN_PRIVATE_KEY;
    const payload = new Uint8Array(Buffer.from("boundary-check"));
    const sig = await signAsync(payload, privateKey);
    expect(sig).toHaveLength(64);
  });

  it("getPublicKeyAsync produces a 32-byte public key (ed25519 invariant)", async () => {
    const publicKey = await getPublicKeyAsync(KNOWN_PRIVATE_KEY);
    expect(publicKey).toHaveLength(32);
  });
});

// =============================================================================
// GOLDEN PATH — round-trip correctness and structural equivalence
// =============================================================================

describe("ed25519 wrapper — golden path", () => {
  it("signAsync produces a signature that verifyAsync confirms as valid", async () => {
    const privateKey = KNOWN_PRIVATE_KEY;
    const publicKey = await getPublicKeyAsync(privateKey);
    const payload = new Uint8Array(Buffer.from("hello-world"));

    const sig = await signAsync(payload, privateKey);
    const valid = await verifyAsync(sig, payload, publicKey);
    expect(valid).toBe(true);
  });

  it("getPublicKeyAsync derives the same public key for the same private key on repeated calls", async () => {
    const pk1 = await getPublicKeyAsync(KNOWN_PRIVATE_KEY);
    const pk2 = await getPublicKeyAsync(KNOWN_PRIVATE_KEY);
    expect(Buffer.from(pk1).toString("hex")).toBe(Buffer.from(pk2).toString("hex"));
  });

  it("signAsync is deterministic — same private key + payload produces same signature", async () => {
    // Ed25519 with SHA-512 is deterministic (RFC 8032).
    const payload = new Uint8Array(Buffer.from("deterministic-test"));
    const sig1 = await signAsync(payload, KNOWN_PRIVATE_KEY);
    const sig2 = await signAsync(payload, KNOWN_PRIVATE_KEY);
    expect(Buffer.from(sig1).toString("hex")).toBe(Buffer.from(sig2).toString("hex"));
  });

  it("wrapper exports are functions (structural duck-type check)", () => {
    expect(typeof signAsync).toBe("function");
    expect(typeof verifyAsync).toBe("function");
    expect(typeof getPublicKeyAsync).toBe("function");
  });

  it("wrapper behaves identically to @noble/ed25519 direct import for a known sig", async () => {
    // Cross-check: sign via the wrapper, verify via the raw library.
    // This confirms the wrapper is not injecting any transformation.
    const {
      signAsync: rawSign,
      verifyAsync: rawVerify,
      getPublicKeyAsync: rawGetPub,
    } = await import("@noble/ed25519");

    const privateKey = KNOWN_PRIVATE_KEY;
    const publicKey = await rawGetPub(privateKey);
    const payload = new Uint8Array(Buffer.from("cross-check"));

    // Sign with wrapper, verify with raw
    const wrapperSig = await signAsync(payload, privateKey);
    const rawVerifyResult = await rawVerify(wrapperSig, payload, publicKey);
    expect(rawVerifyResult).toBe(true);

    // Sign with raw, verify with wrapper
    const rawSig = await rawSign(payload, privateKey);
    const wrapperVerifyResult = await verifyAsync(rawSig, payload, publicKey);
    expect(wrapperVerifyResult).toBe(true);
  });
});

// =============================================================================
// SOURCE-SCAN — import hygiene: consuming modules must use the wrapper
// =============================================================================

describe("ed25519 wrapper — import hygiene (source-scan)", () => {
  const srcRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

  it("src/bootstrap/revocation.ts does NOT import from @noble/ed25519 directly", () => {
    const filePath = path.join(srcRoot, "bootstrap", "revocation.ts");
    const source = fs.readFileSync(filePath, "utf8");
    expect(source).not.toMatch(/from\s+["']@noble\/ed25519["']/);
  });

  it("src/bootstrap/install-sig.ts does NOT import from @noble/ed25519 directly", () => {
    const filePath = path.join(srcRoot, "bootstrap", "install-sig.ts");
    const source = fs.readFileSync(filePath, "utf8");
    expect(source).not.toMatch(/from\s+["']@noble\/ed25519["']/);
  });
});
