/**
 * teo-key-status.mjs — Node.js core for teo-key-status
 * Reports key inventory: active key + archived keys for one or all roles.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprintOf, readJsonSafe } from './teo-key-ops.mjs';

const [, , agentRole, keyDir, jsonModeStr, warningsOnlyStr, createdOverride] = process.argv;
const jsonMode = jsonModeStr === 'true';
const warningsOnly = warningsOnlyStr === 'true';

const agentsDir = join(keyDir, 'agents');
const archiveDir = join(keyDir, 'archive');
const revocationPath = join(keyDir, '.revoked.json');
const schedPath = join(keyDir, 'rotation-schedule.json');

// Load revocation list (GAP-5 schema: revoked_keys[])
const revocationData = readJsonSafe(revocationPath);
const revokedFingerprints = new Set();
if (revocationData && Array.isArray(revocationData.revoked_keys)) {
  for (const entry of revocationData.revoked_keys) {
    if (entry.fingerprint) revokedFingerprints.add(entry.fingerprint);
  }
}

// Load rotation schedule
const schedData = readJsonSafe(schedPath);
const DEFAULT_ROTATION_DAYS = 90;

function getRotationDays(role) {
  if (schedData && schedData.schedule && schedData.schedule[role]) {
    return schedData.schedule[role].rotation_days || DEFAULT_ROTATION_DAYS;
  }
  return DEFAULT_ROTATION_DAYS;
}

// Collect roles to check
let rolesToCheck = [];
if (agentRole) {
  rolesToCheck = [agentRole];
} else {
  // All roles with active keys
  if (existsSync(agentsDir)) {
    const entries = readdirSync(agentsDir);
    const roles = new Set();
    for (const e of entries) {
      if (e.endsWith('.ed25519')) roles.add(e.replace(/\.ed25519$/, ''));
    }
    rolesToCheck = [...roles];
  }
}

if (agentRole && rolesToCheck.length === 1) {
  // Check if role has a key
  const privPath = join(agentsDir, `${agentRole}.ed25519`);
  if (!existsSync(privPath)) {
    process.stderr.write(`ERROR: No key found for role '${agentRole}'\n`);
    process.exit(1);
  }
}

const results = [];
let hasWarnings = false;

for (const role of rolesToCheck) {
  const privPath = join(agentsDir, `${role}.ed25519`);
  const pubPath = join(agentsDir, `${role}.ed25519.pub`);
  const fpCachePath = join(agentsDir, `${role}.fingerprint`);

  if (!existsSync(privPath)) continue;

  // Get active key fingerprint
  let activeFingerprint = '';
  if (existsSync(fpCachePath)) {
    activeFingerprint = readFileSync(fpCachePath, 'utf8').trim();
  } else if (existsSync(pubPath)) {
    const pubBytes = new Uint8Array(readFileSync(pubPath));
    activeFingerprint = await fingerprintOf(pubBytes);
  }

  // Get key creation date
  let createdAt;
  if (createdOverride) {
    createdAt = new Date(createdOverride);
  } else {
    try {
      const st = statSync(privPath);
      createdAt = st.birthtime || st.mtime;
    } catch (_e) {
      createdAt = new Date();
    }
  }

  const rotationDays = getRotationDays(role);
  const expiresAt = new Date(createdAt.getTime() + rotationDays * 24 * 60 * 60 * 1000);
  const now = new Date();
  const ageMs = now - createdAt;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  let warning = '';
  if (ageDays >= rotationDays) {
    warning = ageDays > rotationDays
      ? `rotation overdue for role '${role}'`
      : `scheduled rotation recommended for role '${role}'`;
    hasWarnings = true;
    process.stderr.write(`WARN: ${warning}.\n`);
  }

  // Collect archived keys
  const archiveRoleDir = join(archiveDir, role);
  const archivedKeys = [];
  if (existsSync(archiveRoleDir)) {
    const archEntries = readdirSync(archiveRoleDir);
    for (const ae of archEntries) {
      if (!ae.endsWith('.meta.json')) continue;
      const fp = ae.replace(/\.meta\.json$/, '');
      const meta = readJsonSafe(join(archiveRoleDir, ae)) || {};
      archivedKeys.push({
        fingerprint: fp,
        retired_at: meta.retired_at || 'unknown',
        retirement_reason: meta.retirement_reason || 'unknown',
        revoked: revokedFingerprints.has(fp),
      });
    }
  }

  // Format display fingerprint (first 16 chars for human display)
  const dispFp = (fp) => fp.length > 24 ? fp.substring(0, 24) + '...' : fp;

  const createdStr = createdAt.toISOString().slice(0, 10);
  const expiresStr = expiresAt.toISOString().slice(0, 10);

  results.push({
    role,
    active: {
      fingerprint: activeFingerprint,
      display_fingerprint: dispFp(activeFingerprint),
      created_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      rotation_days: rotationDays,
      warning: warning || null,
    },
    archived: archivedKeys,
  });

  if (!jsonMode && (!warningsOnly || warning)) {
    process.stdout.write(`ROLE: ${role}\n`);
    process.stdout.write(`  ACTIVE  ${dispFp(activeFingerprint)}  created ${createdStr}  expires ${expiresStr} (${rotationDays}d rotation)\n`);
    for (const ak of archivedKeys) {
      const retiredStr = ak.retired_at !== 'unknown' ? ak.retired_at.slice(0, 10) : 'unknown';
      const revokedTag = ak.revoked ? '  [REVOKED]' : '';
      process.stdout.write(`  ARCHIVE ${dispFp(ak.fingerprint)}  retired ${retiredStr}  reason: ${ak.retirement_reason}${revokedTag}\n`);
    }
    process.stdout.write('\n');
  }
}

if (jsonMode) {
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}

process.exit(0);
