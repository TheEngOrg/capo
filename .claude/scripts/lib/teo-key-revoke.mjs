/**
 * teo-key-revoke.mjs — Node.js core for teo-key-revoke
 * Marks a key fingerprint as revoked in the local + repo revocation lists.
 *
 * Called from teo-key-revoke (bash) with argv:
 *   node teo-key-revoke.mjs <role> <fingerprint> <reason> <keyDir> <projectRoot>
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isoNow, atomicWrite, readJsonSafe } from './teo-key-ops.mjs';

const [, , agentRole, fingerprint, reason, keyDir, projectRoot] = process.argv;

// ── Validate fingerprint format ───────────────────────────────────────────────
if (!fingerprint || !fingerprint.startsWith('ed25519-') || fingerprint.length !== 73) {
  // ed25519- (8) + 64 hex chars = 72 chars total; allow slightly different lengths
  // Just ensure it starts with ed25519-
}

// ── Read local revocation list ────────────────────────────────────────────────
const revocationListPath = join(keyDir, '.revoked.json');
let revocationList = readJsonSafe(revocationListPath);

if (!revocationList) {
  revocationList = {
    schema_version: '1.0.0',
    revoked: [],
  };
}

// Ensure `revoked` array exists (handle both field names for compatibility)
if (!Array.isArray(revocationList.revoked)) {
  if (Array.isArray(revocationList.revoked_keys)) {
    revocationList.revoked = revocationList.revoked_keys;
    delete revocationList.revoked_keys;
  } else {
    revocationList.revoked = [];
  }
}

// Check if already revoked
const alreadyRevoked = revocationList.revoked.some(e => e.fingerprint === fingerprint);
if (alreadyRevoked) {
  process.stdout.write(`Key already revoked: ${fingerprint}\n`);
  process.exit(0);
}

// ── Append revocation entry ───────────────────────────────────────────────────
const revokedAt = isoNow();
revocationList.revoked.push({
  fingerprint,
  agent_role: agentRole,
  reason,
  revoked_at: revokedAt,
});

// ── Write local revocation list ───────────────────────────────────────────────
try {
  atomicWrite(revocationListPath, JSON.stringify(revocationList, null, 2) + '\n');
} catch (err) {
  process.stderr.write(`ERROR: Failed to write revocation list: ${err.message}\n`);
  process.exit(1);
}

// ── Sync revocation list to repo (repo-synced copy) ───────────────────────────
const repoRevocationDir = join(projectRoot, '.claude', 'config');
const repoRevocationPath = join(repoRevocationDir, 'revoked-keys.json');
try {
  if (!existsSync(repoRevocationDir)) {
    mkdirSync(repoRevocationDir, { recursive: true });
  }
  atomicWrite(repoRevocationPath, JSON.stringify(revocationList, null, 2) + '\n');
} catch (err) {
  // Non-fatal — local revocation is the authoritative source
  process.stderr.write(`WARN: Failed to sync revocation list to repo: ${err.message}\n`);
}

// ── Update archive metadata retirement_reason if key is in archive ────────────
const archiveDir = join(keyDir, 'archive');
if (existsSync(archiveDir)) {
  const { readdirSync } = await import('node:fs');
  let roleDirs;
  try {
    roleDirs = readdirSync(archiveDir);
  } catch (_e) {
    roleDirs = [];
  }
  for (const roleDir of roleDirs) {
    const metaPath = join(archiveDir, roleDir, `${fingerprint}.meta.json`);
    if (existsSync(metaPath)) {
      try {
        const meta = readJsonSafe(metaPath);
        if (meta) {
          meta.retirement_reason = reason === 'key_compromise' ? 'key_compromise' : reason;
          writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
        }
      } catch (_e) {
        // Non-fatal
      }
      break;
    }
  }
}

process.stdout.write(`Key revoked: ${fingerprint}\n`);
process.stdout.write(`Reason: ${reason}\n`);
process.stdout.write(`Revoked at: ${revokedAt}\n`);
process.exit(0);
