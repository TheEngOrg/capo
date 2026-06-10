/**
 * teo-key-rotate-core.mjs — Shared archive-before-activate rotation sequence
 *
 * Used by both teo-key-generate --force and teo-key-rotate.
 * Implements the invariant rotation sequence from contract §3 and QA spec §D.
 *
 * Steps (per spec §D):
 *   PRE-CHECK: 1. verify active key exists; 2. lock acquired by caller
 *   ARCHIVE PHASE: 3-6. archive old key before generating new one
 *   ACTIVATE PHASE: 7-11. generate + write new keypair
 *   AUDIT: 12. rotation-log.jsonl append
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateKeypair, fingerprintOf, publicKeyToPEM, atomicWrite, readJsonSafe, isoNow, sha256Hex
} from './teo-key-ops.mjs';

/**
 * Perform full rotation for a role.
 * Returns { newFingerprint, oldFingerprint, error? }
 */
export async function performRotation(agentRole, keyDir, roleDir, projectRoot, reason) {
  reason = reason || 'scheduled_rotation';

  const privPath = join(keyDir, 'agents', `${agentRole}.ed25519`);
  const pubPath = join(keyDir, 'agents', `${agentRole}.ed25519.pub`);
  const fingerprintPath = join(keyDir, 'agents', `${agentRole}.fingerprint`);

  // Step 1: Verify active key exists
  if (!existsSync(privPath)) {
    return { error: `No active key for role '${agentRole}'. Run: teo-key-generate ${agentRole}` };
  }

  // Read current public key
  let oldPubKeyBytes;
  try {
    oldPubKeyBytes = new Uint8Array(readFileSync(pubPath));
  } catch (err) {
    return { error: `Failed to read existing public key: ${err.message}` };
  }

  // Step 3-4: Compute fingerprint of current public key
  const oldFingerprint = await fingerprintOf(oldPubKeyBytes);

  // Step 3: Create archive directory (GAP-3: chmod 700)
  const archiveRoleDir = join(keyDir, 'archive', agentRole);
  if (!existsSync(archiveRoleDir)) {
    try {
      mkdirSync(archiveRoleDir, { recursive: true });
      chmodSync(archiveRoleDir, 0o700);
    } catch (err) {
      return { error: `Failed to create archive directory: ${err.message}` };
    }
  }

  // Get key creation time (from existing fingerprint file mtime or now)
  let createdAt = isoNow();
  try {
    const { statSync } = await import('node:fs');
    const st = statSync(privPath);
    createdAt = st.birthtime.toISOString().replace(/\.\d+Z$/, 'Z');
  } catch (_e) { /* use isoNow */ }

  const retiredAt = isoNow();

  // Step 4: Write archive .pub (chmod 444 — read-only after write)
  const archivePubPath = join(archiveRoleDir, `${oldFingerprint}.pub`);
  try {
    writeFileSync(archivePubPath, Buffer.from(oldPubKeyBytes));
    chmodSync(archivePubPath, 0o444);
  } catch (err) {
    return { error: `Failed to write archive public key: ${err.message}` };
  }

  // Step 5: Write archive .meta.json (NC-2: count_is_approximate, count_scan_source)
  const archiveMetaPath = join(archiveRoleDir, `${oldFingerprint}.meta.json`);
  const meta = {
    schema_version: '1.0.0',
    fingerprint: oldFingerprint,
    agent_role: agentRole,
    created_at: createdAt,
    retired_at: retiredAt,
    retirement_reason: reason,
    signed_artifact_count: 0,
    count_is_approximate: true,
    count_scan_source: 'unknown',
    last_signed_at: null,
  };
  try {
    writeFileSync(archiveMetaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  } catch (err) {
    return { error: `Failed to write archive metadata: ${err.message}` };
  }

  // ── ARCHIVE PHASE complete. ACTIVATE PHASE begins below. ─────────────────
  // Contract invariant: steps 4-5 MUST complete before step 6 (new keypair gen)

  // Step 6-7: Generate new keypair
  let newSecretKey, newPublicKey;
  try {
    const kp = await generateKeypair();
    newSecretKey = kp.secretKey;
    newPublicKey = kp.publicKey;
  } catch (err) {
    return { error: `Key generation failed: ${err.message}` };
  }

  const newFingerprint = await fingerprintOf(newPublicKey);

  // Step 8: Atomic write new private key (chmod 600)
  const tmpPrivPath = `${privPath}.tmp.${process.pid}`;
  try {
    writeFileSync(tmpPrivPath, Buffer.from(newSecretKey));
    chmodSync(tmpPrivPath, 0o600);
    const { renameSync } = await import('node:fs');
    renameSync(tmpPrivPath, privPath);
  } catch (err) {
    return { error: `Failed to write new private key: ${err.message}` };
  }

  // Step 9: Write new public key (chmod 644)
  try {
    writeFileSync(pubPath, Buffer.from(newPublicKey));
    chmodSync(pubPath, 0o644);
  } catch (err) {
    return { error: `Failed to write new public key: ${err.message}` };
  }

  // Write new fingerprint cache
  writeFileSync(fingerprintPath, newFingerprint, 'utf8');

  // NC-4 (step 9a): Write signing-cutover.json BEFORE PEM sync
  // Caller (teo-key-generate.mjs) handles cutover for generate --force path.
  // For teo-key-rotate path, the cutover is handled after return.

  // Step 10: Sync new public key PEM to repo
  const agentPubKeyDir = join(roleDir, agentRole);
  if (!existsSync(agentPubKeyDir)) {
    mkdirSync(agentPubKeyDir, { recursive: true });
  }
  const pemPath = join(agentPubKeyDir, 'public-key.pem');
  const newPem = publicKeyToPEM(newPublicKey);
  try {
    writeFileSync(pemPath, newPem, 'utf8');
  } catch (err) {
    // Non-fatal — PEM sync failure does not invalidate rotation
    process.stderr.write(`WARN: Failed to sync new public key PEM: ${err.message}\n`);
  }

  // Step 11: Sync archived public key PEM to repo config/key-archive
  const archiveRepoDir = join(projectRoot, '.claude', 'config', 'key-archive', agentRole);
  if (!existsSync(archiveRepoDir)) {
    mkdirSync(archiveRepoDir, { recursive: true });
  }
  const oldPem = publicKeyToPEM(oldPubKeyBytes);
  const archiveRepoPemPath = join(archiveRepoDir, `${oldFingerprint}.pem`);
  try {
    writeFileSync(archiveRepoPemPath, oldPem, 'utf8');
  } catch (err) {
    process.stderr.write(`WARN: Failed to sync archived public key PEM to repo: ${err.message}\n`);
  }

  // Step 12: Append to rotation-log.jsonl
  const rotLogPath = join(keyDir, 'rotation-log.jsonl');
  const rotEntry = JSON.stringify({
    timestamp: isoNow(),
    agent_role: agentRole,
    old_fingerprint: oldFingerprint,
    new_fingerprint: newFingerprint,
    reason,
  });
  try {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(rotLogPath, rotEntry + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(`WARN: Failed to append to rotation-log.jsonl: ${err.message}\n`);
  }

  return { oldFingerprint, newFingerprint };
}
