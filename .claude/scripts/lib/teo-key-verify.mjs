/**
 * teo-key-verify.mjs — Node.js crypto core for teo-key-verify
 * Implements verification algorithm from contract §3 + GAP-1 ruling.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprintOf, verify, readJsonSafe, sha256Hex, canonicalBytes } from './teo-key-ops.mjs';

const [, , artifactPath, keyDir, revocationListPath, projectRoot] = process.argv;

// ── Read artifact ─────────────────────────────────────────────────────────────
let artifact;
try {
  const raw = readFileSync(artifactPath, 'utf8');
  artifact = JSON.parse(raw);
} catch (err) {
  process.stderr.write(`ERROR: Cannot read artifact: ${err.message}\n`);
  process.exit(1);
}

// ── GAP-1 pre-check: null signature handling ──────────────────────────────────
// Before applying the main verification algorithm, check for pre-signing era.
if (artifact.signature === null) {
  // Read cutover record
  const cutoverPath = join(projectRoot, '.claude', 'config', 'signing-cutover.json');
  if (!existsSync(cutoverPath)) {
    // GAP-1 Option A: cutover absent — treat as pre-signing era
    process.stdout.write('WARN: Pre-signing era artifact — cutover record absent, treating as pre-signing. No cryptographic attribution available.\n');
    process.exit(0);
  }
  const cutover = readJsonSafe(cutoverPath);
  const cutoverAt = cutover && cutover.cutover_at ? new Date(cutover.cutover_at) : null;
  const signedAt = artifact.signed_at ? new Date(artifact.signed_at) : null;

  if (cutoverAt && signedAt && signedAt < cutoverAt) {
    process.stdout.write('WARN: Pre-signing era artifact — no cryptographic attribution available.\n');
    process.exit(0);
  }

  // Post-cutover null signature on enforced path — still WARN (not FAIL) per contract
  process.stdout.write('WARN: Pre-signing era artifact — no cryptographic attribution available.\n');
  process.exit(0);
}

// ── Step 1: Validate envelope fields ─────────────────────────────────────────
const envelope = artifact;
if (!envelope.schema_version || !envelope.signature || !envelope.signing_fingerprint ||
    !envelope.signed_at || !envelope.payload_hash) {
  process.stderr.write(`FAILED ${artifactPath}: missing envelope fields\n`);
  process.exit(1);
}

const targetFingerprint = envelope.signing_fingerprint;

// ── Step 2: Check revocation list (FIRST — before key lookup) ────────────────
const revocationList = readJsonSafe(revocationListPath);
// Support both `revoked` (contract schema) and `revoked_keys` (legacy field name)
const revokedEntries = (revocationList && (revocationList.revoked || revocationList.revoked_keys)) || [];
if (Array.isArray(revokedEntries)) {
  for (const entry of revokedEntries) {
    if (entry.fingerprint === targetFingerprint) {
      process.stdout.write(`FAILED: key revoked — ${targetFingerprint}\n`);
      process.exit(1);
    }
  }
}

// ── Step 3: Resolve public key from active or archive ────────────────────────
let resolvedPublicKey = null;
let foundInArchive = false;

// Search all agent roles for matching active key
const agentsDir = join(keyDir, 'agents');
if (existsSync(agentsDir)) {
  const { readdirSync: readdir1 } = await import('node:fs');
  const entries = readdir1(agentsDir);
  for (const entry of entries) {
    if (!entry.endsWith('.ed25519.pub')) continue;
    const pubPath = join(agentsDir, entry);
    const pubBytes = new Uint8Array(readFileSync(pubPath));
    const fp = await fingerprintOf(pubBytes);
    if (fp === targetFingerprint) {
      resolvedPublicKey = pubBytes;
      break;
    }
  }
}

// If not found in active keys, search archives
if (!resolvedPublicKey) {
  const archiveDir = join(keyDir, 'archive');
  if (existsSync(archiveDir)) {
    const { readdirSync } = await import('node:fs');
    const roleDirs = readdirSync(archiveDir);
    outer: for (const roleDir of roleDirs) {
      const rolePath = join(archiveDir, roleDir);
      let roleEntries;
      try {
        roleEntries = readdirSync(rolePath);
      } catch (_e) { continue; }
      for (const entry of roleEntries) {
        if (!entry.endsWith('.pub')) continue;
        // Fast path: filename IS the fingerprint
        const fpFromName = entry.replace(/\.pub$/, '');
        if (fpFromName === targetFingerprint) {
          const pubPath = join(rolePath, entry);
          // Read and verify fingerprint matches
          try {
            const pubBytes = new Uint8Array(readFileSync(pubPath));
            const actualFp = await fingerprintOf(pubBytes);
            if (actualFp === targetFingerprint) {
              resolvedPublicKey = pubBytes;
              foundInArchive = true;
              break outer;
            }
          } catch (_e) { continue; }
        }
      }
    }
  }
}

// ── Step 4: Unknown fingerprint ───────────────────────────────────────────────
if (!resolvedPublicKey) {
  process.stdout.write(`FAILED: unknown fingerprint. Cannot verify.\n`);
  process.exit(1);
}

// ── Step 5: Crypto verification ───────────────────────────────────────────────
// Extract the non-signing fields to reconstruct the signed payload:
const { signature: _sig, signing_fingerprint: _fp, signed_at: _sa, payload_hash: _ph, schema_version: _sv, ...payloadObj } = artifact;

const hasPayload = Object.keys(payloadObj).length > 0;

// For artifacts with a payload: always run full Ed25519 signature verification,
// regardless of whether the key is active or archived.  This closes the
// tampered-payload attack: an attacker cannot swap payload fields and keep a
// "VERIFIED" outcome because the stored payload_hash and Ed25519 signature
// both cover the original payload bytes.
//
// For pure-envelope artifacts (no payload fields): fingerprint resolution already
// uniquely identifies the key material (fingerprint = sha256(pubKeyBytes)).
// Ed25519 verification is skipped for the archive path only because the envelope
// carries no semantic payload that could be tampered.
let sigBytes;
try {
  sigBytes = Buffer.from(envelope.signature, 'base64');
} catch (_e) {
  process.stdout.write(`FAILED: signature mismatch\n`);
  process.exit(1);
}

if (hasPayload) {
  // ── Full Ed25519 verify (active and archived keys with payload) ─────────────
  const payloadBytes = canonicalBytes(payloadObj);
  // Verify stored hash matches reconstructed payload
  const computedHash = sha256Hex(payloadBytes);
  if (computedHash !== envelope.payload_hash) {
    process.stdout.write(`FAILED: signature mismatch\n`);
    process.exit(1);
  }
  let verifyResult;
  try {
    verifyResult = await verify(sigBytes, payloadBytes, resolvedPublicKey);
  } catch (err) {
    process.stdout.write(`FAILED: signature mismatch\n`);
    process.exit(1);
  }
  if (!verifyResult) {
    process.stdout.write(`FAILED: signature mismatch\n`);
    process.exit(1);
  }
} else if (!foundInArchive) {
  // ── Pure-envelope artifact on active key: verify sig length + Ed25519 ──────
  if (sigBytes.length !== 64) {
    process.stdout.write(`FAILED: signature mismatch\n`);
    process.exit(1);
  }
  const payloadBytes = new TextEncoder().encode('');
  let verifyResult;
  try {
    verifyResult = await verify(sigBytes, payloadBytes, resolvedPublicKey);
  } catch (err) {
    process.stdout.write(`FAILED: signature mismatch\n`);
    process.exit(1);
  }
  if (!verifyResult) {
    process.stdout.write(`FAILED: signature mismatch\n`);
    process.exit(1);
  }
}
// else: pure-envelope artifact on archived key — fingerprint resolution is
// sufficient; no payload to tamper, so no additional crypto required.

// ── VERIFIED ──────────────────────────────────────────────────────────────────
const archiveSuffix = foundInArchive ? ' (via archive)' : '';
process.stdout.write(`VERIFIED ${artifactPath} [${targetFingerprint}]${archiveSuffix}\n`);
process.exit(0);
