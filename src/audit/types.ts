// src/audit/types.ts

import type { DisplayRoute } from '../classifier/types.js';

export type AuditEventType =
  | 'token_issued'
  | 'preflight_called'
  | 'preflight_failed'
  | 'route_decision'
  | 'history_written';

export interface AuditEvent {
  type: AuditEventType;
  token_id: string;
  timestamp: string;    // ISO-8601 UTC
  route?: DisplayRoute; // present on route_decision events
  input_hash?: string;  // SHA-256 of raw input — for audit without storing plaintext
}
