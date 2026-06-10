/**
 * teo-key-generate.mjs — Node.js crypto core for teo-key-generate
 * Called from teo-key-generate (bash) with argv:
 *   node teo-key-generate.mjs <role> <keyDir> <roleDir> <force> <projectRoot> <signPayload>
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateKeypair, fingerprintOf, publicKeyToPEM, atomicWrite, readJsonSafe, isoNow,
  canonicalBytes, sha256Hex, buildSignedEnvelope
} from './teo-key-ops.mjs';
import { performRotation } from './teo-key-rotate-core.mjs';

const [, , agentRole, keyDir, roleDir, forceStr, projectRoot, signPayload] = process.argv;
const force = forceStr === 'true';

// ── SIGN-PAYLOAD path (GOLDEN-G07 envelope schema test) ──────────────────────
if (signPayload && signPayload.length > 0) {
  const privPath = join(keyDir, 'agents', `${agentRole}.ed25519`);
  const pubPath = join(keyDir, 'agents', `${agentRole}.ed25519.pub`);
  if (!existsSync(privPath)) {
    process.stderr.write(`ERROR: No signing key found for role ${agentRole}. Run: teo-key-generate ${agentRole}\n`);
    process.exit(1);
  }
  const secretKey = new Uint8Array(readFileSync(privPath));
  const publicKey = new Uint8Array(readFileSync(pubPath));
  const artifactObj = JSON.parse(signPayload);
  const envelope = await buildSignedEnvelope(artifactObj, secretKey, publicKey);
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
  process.exit(0);
}

const privPath = join(keyDir, 'agents', `${agentRole}.ed25519`);
const pubPath = join(keyDir, 'agents', `${agentRole}.ed25519.pub`);
const fingerprintPath = join(keyDir, 'agents', `${agentRole}.fingerprint`);

// ── If force: perform full rotation sequence ─────────────────────────────────
if (force && existsSync(privPath)) {
  // MISUSE-10: Remediate private key permissions before rotation
  try {
    const { statSync, chmodSync: _chmod } = await import('node:fs');
    const st = statSync(privPath);
    const mode = st.mode & 0o777;
    if (mode !== 0o600) {
      chmodSync(privPath, 0o600);
      process.stderr.write('WARN: private key permissions corrected to 600\n');
    }
  } catch (_e) { /* ignore — best-effort permission fix */ }

  // GAP-4: --force shares the archive-before-activate code path with teo-key-rotate
  const ret = await performRotation(agentRole, keyDir, roleDir, projectRoot, 'scheduled_rotation');
  if (ret.error) {
    // If rotation fails (e.g. no .pub file — stub key scenario), still ensure perms are 600
    try {
      chmodSync(privPath, 0o600);
    } catch (_e) { /* ignore */ }
    process.stderr.write(`ERROR: ${ret.error}\n`);
    process.exit(1);
  }

  // Write cutover.json (NC-4: step 9a, before PEM sync — handled in performRotation)
  writeCutoverIfNeeded(projectRoot);

  process.stdout.write(`Key rotated for role '${agentRole}'.\n`);
  process.stdout.write(`New fingerprint: ${ret.newFingerprint}\n`);
  process.exit(0);
}

// ── Generate fresh keypair ────────────────────────────────────────────────────
let secretKey, publicKey;
try {
  const kp = await generateKeypair();
  secretKey = kp.secretKey;
  publicKey = kp.publicKey;
} catch (err) {
  // MISUSE-11: noble not available
  if (err.message && err.message.includes('@noble/ed25519 not available')) {
    process.stderr.write('WARN: @noble/ed25519 not available — signing disabled\n');
    process.exit(0);
  }
  process.stderr.write(`ERROR: Key generation failed: ${err.message}\n`);
  process.exit(1);
}

const fingerprint = await fingerprintOf(publicKey);

// ── Write private key (atomic, chmod 600) ────────────────────────────────────
try {
  atomicWrite(privPath, Buffer.from(secretKey));
  chmodSync(privPath, 0o600);
} catch (err) {
  process.stderr.write(`ERROR: Failed to write private key: ${err.message}\n`);
  process.exit(1);
}

// ── MISUSE-10: Verify chmod 600 after write (remediate if wrong) ─────────────
try {
  const st = (await import('node:fs')).statSync(privPath);
  const mode = st.mode & 0o777;
  if (mode !== 0o600) {
    chmodSync(privPath, 0o600);
    process.stderr.write('WARN: private key permissions corrected to 600\n');
  }
} catch (_e) { /* ignore */ }

// ── Write public key (chmod 644) ──────────────────────────────────────────────
try {
  writeFileSync(pubPath, Buffer.from(publicKey));
  chmodSync(pubPath, 0o644);
} catch (err) {
  process.stderr.write(`ERROR: Failed to write public key: ${err.message}\n`);
  process.exit(1);
}

// ── Write fingerprint cache file ──────────────────────────────────────────────
writeFileSync(fingerprintPath, fingerprint, 'utf8');

// ── NC-4: Write signing-cutover.json BEFORE PEM sync (step 9a) ───────────────
writeCutoverIfNeeded(projectRoot);

// ── Sync public key PEM to repo agents dir ────────────────────────────────────
const agentPubKeyDir = join(roleDir, agentRole);
if (!existsSync(agentPubKeyDir)) {
  mkdirSync(agentPubKeyDir, { recursive: true });
}
const pemPath = join(agentPubKeyDir, 'public-key.pem');
const pem = publicKeyToPEM(publicKey);
writeFileSync(pemPath, pem, 'utf8');

process.stdout.write(`Keypair generated for role '${agentRole}'.\n`);
process.stdout.write(`Fingerprint: ${fingerprint}\n`);
process.stdout.write(`Private key: ${privPath} (chmod 600)\n`);
process.stdout.write(`Public key:  ${pubPath}\n`);
process.stdout.write(`PEM synced:  ${pemPath}\n`);
process.exit(0);

// ── NC-1 / NC-4: signing-cutover.json write logic ────────────────────────────
function writeCutoverIfNeeded(projRoot) {
  const cutoverPath = join(projRoot, '.claude', 'config', 'signing-cutover.json');
  const installerPath = join(projRoot, '.claude', 'config', '.teo-installed');

  // If cutover already exists, never overwrite
  if (existsSync(cutoverPath)) return;

  // Check installer marker — if installer marker >= 3.3.0 present, do NOT write
  // (installer is the authoritative writer per NC-1 ruling)
  if (existsSync(installerPath)) {
    const marker = readJsonSafe(installerPath);
    if (marker && marker.teo_version) {
      const parts = marker.teo_version.split('.').map(Number);
      const [maj, min] = parts;
      if (maj > 3 || (maj === 3 && min >= 3)) {
        // Installer already wrote or will write cutover — skip
        return;
      }
    }
  }

  // Write cutover (installer absent or pre-3.3.0)
  const cutoverDir = join(projRoot, '.claude', 'config');
  if (!existsSync(cutoverDir)) mkdirSync(cutoverDir, { recursive: true });

  const cutover = {
    schema_version: '1.0.0',
    cutover_at: isoNow(),
    cutover_teo_version: '3.3.0',
    pre_signing_era_note: 'Audit entries before this date have null signatures. They are valid continuity records but carry no cryptographic attribution.',
    enforced_paths: [
      '.claude/scripts/**',
      '.claude/hooks/**',
      '.claude/shared/**',
      'docs/**',
      'src/**',
      'packages/**',
    ],
  };
  try {
    atomicWrite(cutoverPath, JSON.stringify(cutover, null, 2) + '\n');
  } catch (_e) {
    process.stderr.write('WARN: Could not write signing-cutover.json — non-fatal\n');
  }
}
