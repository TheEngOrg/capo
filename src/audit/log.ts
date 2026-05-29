// src/audit/log.ts
//
// Pass 1: writeAuditEvent() is a stub — no-op.
// Pass 2: Implement XDG-compliant JSONL append per staff-eng Section 5.

import type { AuditEvent } from './types.js';

export type { AuditEvent, AuditEventType } from './types.js';

export function writeAuditEvent(_event: AuditEvent): void {
  // Pass 2: implement fs.appendFileSync writing ${JSON.stringify(event)}\n
  // Path: ${XDG_STATE_HOME ?? ~/.local/state}/teo/audit.log
  // Input is hashed (SHA-256) before inclusion — plaintext never written.
  return;
}
