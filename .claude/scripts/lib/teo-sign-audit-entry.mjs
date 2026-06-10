/**
 * teo-sign-audit-entry.mjs — Sign an audit log entry and emit a JSONL-compatible signed entry.
 *
 * Called from teo-apply-edit and teo-create-document when --key-dir is provided post-cutover.
 *
 * Usage (argv):
 *   node teo-sign-audit-entry.mjs <keyDir> <agentRole> <entryJson>
 *
 * Stdout: single-line JSON with signing fields merged into entry + schema_version:"1.1.0"
 * Exit 0: success
 * Exit 1: signing failed (key not found, crypto error)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalBytes, sha256Hex, sign, fingerprintOf } from './teo-key-ops.mjs';

const [, , keyDir, agentRole, entryJson] = process.argv;

if (!keyDir || !agentRole || !entryJson) {
  process.stderr.write('Usage: teo-sign-audit-entry.mjs <keyDir> <agentRole> <entryJson>\n');
  process.exit(1);
}

const privPath = join(keyDir, 'agents', `${agentRole}.ed25519`);
const pubPath = join(keyDir, 'agents', `${agentRole}.ed25519.pub`);

if (!existsSync(privPath) || !existsSync(pubPath)) {
  process.stderr.write(`ERROR: No signing key found for role ${agentRole} in ${keyDir}\n`);
  process.exit(1);
}

let entry;
try {
  entry = JSON.parse(entryJson);
} catch (e) {
  process.stderr.write('ERROR: entryJson is not valid JSON: ' + e.message + '\n');
  process.exit(1);
}

const secretKey = new Uint8Array(readFileSync(privPath));
const publicKey = new Uint8Array(readFileSync(pubPath));

// Compute payload hash from the entry (canonical sorted JSON)
const payloadBytes = canonicalBytes(entry);
const payloadHash = sha256Hex(payloadBytes);

// Sign
const sigBytes = await sign(payloadBytes, secretKey);
const signature = Buffer.from(sigBytes).toString('base64');
const fingerprint = await fingerprintOf(publicKey);
const signedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

// Merge signing fields into the entry; bump schema_version to 1.1.0
const signed = {
  ...entry,
  schema_version: '1.1.0',
  signature,
  signing_fingerprint: fingerprint,
  signed_at: signedAt,
  payload_hash: payloadHash,
};

process.stdout.write(JSON.stringify(signed) + '\n');
process.exit(0);
