// src/audit/log.ts
//
// writeAuditEvent(): appends a JSONL record to the XDG-compliant audit log.
// Uses node:fs / node:os / node:path — works under both Bun and Node (D-002).
//
// IMPORTANT: The caller is responsible for hashing raw input to SHA-256 before
// building the AuditEvent. Plaintext input MUST NOT appear in the log — only
// the input_hash field (see AuditEvent type). This module does not re-hash;
// it writes whatever is on the event object verbatim. The test contract confirms:
// plaintext is never in the written line, only input_hash.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type { AuditEvent, AuditEventType } from './types.js';
import type { AuditEvent } from './types.js';

export function auditLogPath(): string {
  const stateDir = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(stateDir, 'teo', 'audit.log');
}

export function writeAuditEvent(event: AuditEvent): void {
  const logPath = auditLogPath();
  const dir = join(logPath, '..');
  mkdirSync(dir, { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(event)}\n`, 'utf8');
}
