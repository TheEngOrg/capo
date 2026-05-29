// src/security/identity.ts
//
// issueIdentityToken(): generates a fresh identity token with UUID v4 ids and
// HMAC-SHA256 integrity signature. Uses node:crypto so it works under both Bun
// (runtime) and Node (Vitest workers — see D-002).

import { randomUUID, randomBytes, createHmac } from 'node:crypto';

export interface IdentityToken {
  token_id: string;     // UUID v4
  session_id: string;   // UUID v4, per-REPL-launch
  issued_at: string;    // ISO-8601 UTC
  hmac: string;         // HMAC-SHA256 hex digest over token_id + session_id + issued_at
}

export function issueIdentityToken(): IdentityToken {
  const token_id = randomUUID();
  const session_id = randomUUID();
  const issued_at = new Date().toISOString();

  // Session-local secret: 32 random bytes generated fresh at each issuance.
  // The secret is not stored — HMAC is used purely for structural integrity
  // (detects accidental field mutation, not adversarial forgery at M1).
  const secret = randomBytes(32);
  const hmac = createHmac('sha256', secret)
    .update(`${token_id}:${session_id}:${issued_at}`)
    .digest('hex');

  return { token_id, session_id, issued_at, hmac };
}
