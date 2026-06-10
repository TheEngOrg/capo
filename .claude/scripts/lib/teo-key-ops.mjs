/**
 * teo-key-ops.mjs — Core Ed25519 key operations for WS-E #523 Phase 1
 *
 * Used by teo-key-generate, teo-key-rotate, teo-key-verify, teo-key-sign, teo-key-revoke.
 * All crypto operations use @noble/ed25519 v3 async API exclusively (signAsync/verifyAsync).
 * WebCrypto availability is asserted at module load time.
 *
 * Integration conditions from devops memo:
 *   IC-1: exact version pin (3.1.0) — enforced via package.json
 *   IC-2: async API only (signAsync/verifyAsync)
 *   IC-3: WebCrypto assert at load
 *   IC-4: canonical JSON (sorted keys, no trailing whitespace, UTF-8)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

// ── IC-3: WebCrypto availability check ──────────────────────────────────────
if (!globalThis.crypto?.subtle) {
  process.stderr.write('FATAL: WebCrypto (globalThis.crypto.subtle) is not available. Node 18+ required.\n');
  process.exit(1);
}

// ── Load @noble/ed25519 ──────────────────────────────────────────────────────
let ed;
const ED25519_PATH = new URL('./ed25519/node_modules/@noble/ed25519/index.js', import.meta.url).pathname;

// TEO_NOBLE_DISABLED=1 simulates missing noble (for MISUSE-11 fail-open test)
if (process.env.TEO_NOBLE_DISABLED === '1') {
  process.stderr.write('WARN: @noble/ed25519 not available — signing disabled\n');
  ed = null;
} else {
  try {
    ed = await import(ED25519_PATH);
  } catch (_e) {
    // MISUSE-11: fail-open WARN on absent noble/ed25519
    process.stderr.write('WARN: @noble/ed25519 not available — signing disabled\n');
    ed = null;
  }
}

// ── Canonical JSON (IC-4 / OQ-5) ─────────────────────────────────────────────
/**
 * Returns the canonical UTF-8 bytes of a JSON value with keys sorted
 * lexicographically at all nesting levels. This is the hash input for
 * signing and the payload_hash field.
 */
export function canonicalBytes(obj) {
  const sorted = sortKeys(obj);
  const json = JSON.stringify(sorted);  // no trailing whitespace
  return new TextEncoder().encode(json);
}

function sortKeys(val) {
  if (Array.isArray(val)) return val.map(sortKeys);
  if (val !== null && typeof val === 'object') {
    const out = {};
    for (const k of Object.keys(val).sort()) {
      out[k] = sortKeys(val[k]);
    }
    return out;
  }
  return val;
}

// ── SHA-256 helpers ───────────────────────────────────────────────────────────
export function sha256Hex(data) {
  // data: Uint8Array or Buffer
  return createHash('sha256').update(data).digest('hex');
}

export async function sha256Async(data) {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Fingerprint ───────────────────────────────────────────────────────────────
/** Compute fingerprint from raw 32-byte public key. Full 64-char hex, no truncation. */
export async function fingerprintOf(pubKeyBytes) {
  const hex = await sha256Async(pubKeyBytes);
  return `ed25519-${hex}`;
}

// ── Key generation ────────────────────────────────────────────────────────────
/** Generate a new Ed25519 keypair. Returns {secretKey: Uint8Array, publicKey: Uint8Array} */
export async function generateKeypair() {
  if (!ed) throw new Error('WARN: @noble/ed25519 not available');
  return ed.keygenAsync();
}

// ── Signing ───────────────────────────────────────────────────────────────────
/**
 * Sign a canonical payload.
 * @param {Uint8Array} payloadBytes - canonical UTF-8 bytes
 * @param {Uint8Array} secretKey - raw 32-byte Ed25519 private key
 * @returns {Promise<Uint8Array>} 64-byte signature
 */
export async function sign(payloadBytes, secretKey) {
  if (!ed) throw new Error('WARN: @noble/ed25519 not available');
  return ed.signAsync(payloadBytes, secretKey);
}

/**
 * Verify an Ed25519 signature.
 * @param {Uint8Array} sig - 64-byte signature
 * @param {Uint8Array} payloadBytes - canonical UTF-8 bytes
 * @param {Uint8Array} publicKey - raw 32-byte public key
 * @returns {Promise<boolean>}
 */
export async function verify(sig, payloadBytes, publicKey) {
  if (!ed) throw new Error('WARN: @noble/ed25519 not available');
  return ed.verifyAsync(sig, payloadBytes, publicKey);
}

// ── Signing envelope ──────────────────────────────────────────────────────────
/**
 * Build a signed envelope for an artifact object.
 * Returns the envelope JSON object (schema_version 1.1.0).
 */
export async function buildSignedEnvelope(artifactObj, secretKey, publicKey) {
  const payloadBytes = canonicalBytes(artifactObj);
  const payloadHash = sha256Hex(payloadBytes);
  const sigBytes = await sign(payloadBytes, secretKey);
  const signature = Buffer.from(sigBytes).toString('base64');
  const fingerprint = await fingerprintOf(publicKey);
  const signedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return {
    schema_version: '1.1.0',
    signature,
    signing_fingerprint: fingerprint,
    signed_at: signedAt,
    payload_hash: payloadHash,
  };
}

// ── Envelope verification ─────────────────────────────────────────────────────
/**
 * Verify a signing envelope given the raw public key bytes.
 * @param {object} envelope - the envelope object
 * @param {Uint8Array} publicKeyBytes - raw 32-byte public key
 * @param {object} artifactObj - the artifact to re-canonical and hash
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
export async function verifyEnvelope(envelope, publicKeyBytes, artifactObj) {
  if (!envelope || !envelope.signature || !envelope.payload_hash) {
    return { ok: false, reason: 'missing envelope fields' };
  }
  const payloadBytes = canonicalBytes(artifactObj);
  const expectedHash = sha256Hex(payloadBytes);
  if (envelope.payload_hash !== expectedHash) {
    return { ok: false, reason: 'payload_hash mismatch' };
  }
  let sigBytes;
  try {
    sigBytes = Buffer.from(envelope.signature, 'base64');
  } catch (_e) {
    return { ok: false, reason: 'signature decode failed' };
  }
  const ok = await verify(sigBytes, payloadBytes, publicKeyBytes);
  if (!ok) return { ok: false, reason: 'signature mismatch' };
  return { ok: true, reason: 'ok' };
}

// ── PEM encoding for SubjectPublicKeyInfo (Ed25519) ───────────────────────────
/**
 * Wrap raw 32-byte Ed25519 public key in SubjectPublicKeyInfo PEM.
 * Per RFC 8410: OID 1.3.101.112 (id-EdDSA / Ed25519).
 */
export function publicKeyToPEM(pubKeyBytes) {
  // SubjectPublicKeyInfo DER for Ed25519:
  // SEQUENCE {
  //   SEQUENCE { OID 1.3.101.112 }
  //   BIT STRING (0 unused bits + 32 key bytes)
  // }
  // DER encoding: 302a300506032b6570032100 + <32 pubkey bytes>
  const header = Buffer.from('302a300506032b6570032100', 'hex');
  const der = Buffer.concat([header, Buffer.from(pubKeyBytes)]);
  const b64 = der.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----\n`;
}

/**
 * Parse a SubjectPublicKeyInfo PEM back to raw 32-byte public key bytes.
 */
export function pemToPublicKey(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Buffer.from(b64, 'base64');
  // Skip 12-byte header (302a300506032b6570032100) to get raw 32-byte key
  return new Uint8Array(der.slice(12));
}

// ── ISO timestamp ─────────────────────────────────────────────────────────────
export function isoNow() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

// ── Atomic file write ─────────────────────────────────────────────────────────
export function atomicWrite(targetPath, content) {
  const tmpPath = `${targetPath}.tmp.${process.pid}`;
  const dir = dirname(targetPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, targetPath);
}

// ── Safe JSON read ────────────────────────────────────────────────────────────
export function readJsonSafe(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (_e) {
    return null;
  }
}

export { ed };
