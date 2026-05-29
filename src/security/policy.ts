// src/security/policy.ts
//
// Pass 1: PolicyEnforcement.preflight() validates token is non-null with non-empty token_id.
// Pass 2: No additional business logic needed in M1 — this is the full M1 spec.

import type { IdentityToken } from './identity.js';

export class PolicyEnforcement {
  static preflight(token: IdentityToken | null | undefined): void {
    if (!token || !token.token_id) {
      throw new Error('preflight failed: invalid or missing identity token');
    }
    // Pass 2: additional policy checks as spec evolves.
  }
}
