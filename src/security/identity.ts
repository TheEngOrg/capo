// src/security/identity.ts
//
// Pass 1: issueIdentityToken() returns a static placeholder token.
// Pass 2: Implement UUID v4 generation and HMAC-SHA256 per staff-eng Section 5.

export interface IdentityToken {
  token_id: string;     // UUID v4
  session_id: string;   // UUID v4, per-REPL-launch
  issued_at: string;    // ISO-8601 UTC
  hmac: string;         // HMAC-SHA256 hex digest over token_id + session_id + issued_at
}

export function issueIdentityToken(): IdentityToken {
  // Pass 2: implement real UUID v4 + HMAC-SHA256.
  return {
    token_id: 'placeholder-token-id',
    session_id: 'placeholder-session-id',
    issued_at: new Date().toISOString(),
    hmac: 'placeholder-hmac',
  };
}
