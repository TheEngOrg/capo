/**
 * teo-key-rotate.mjs — Node.js crypto core for teo-key-rotate
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { performRotation } from './teo-key-rotate-core.mjs';
import { readJsonSafe, isoNow, atomicWrite } from './teo-key-ops.mjs';

const [, , agentRole, keyDir, roleDir, reason, projectRoot] = process.argv;

const result = await performRotation(agentRole, keyDir, roleDir, projectRoot, reason);

if (result.error) {
  process.stderr.write(`ERROR: ${result.error}\n`);
  process.exit(1);
}

// NC-4: Write signing-cutover.json BEFORE returning (step 9a)
writeCutoverIfNeeded(projectRoot);

process.stdout.write(`Key rotated for role '${agentRole}'.\n`);
process.stdout.write(`Old fingerprint: ${result.oldFingerprint}\n`);
process.stdout.write(`New fingerprint: ${result.newFingerprint}\n`);
process.exit(0);

function writeCutoverIfNeeded(projRoot) {
  const cutoverPath = join(projRoot, '.claude', 'config', 'signing-cutover.json');
  const installerPath = join(projRoot, '.claude', 'config', '.teo-installed');

  if (existsSync(cutoverPath)) return;

  if (existsSync(installerPath)) {
    const marker = readJsonSafe(installerPath);
    if (marker && marker.teo_version) {
      const parts = marker.teo_version.split('.').map(Number);
      const [maj, min] = parts;
      if (maj > 3 || (maj === 3 && min >= 3)) return;
    }
  }

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
