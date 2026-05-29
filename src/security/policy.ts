// src/security/policy.ts
//
// PolicyEnforcement.preflight() validates that the identity token is non-null with a non-empty token_id.
// This is the complete M1 implementation per M1-implementation-spec.md Section 5.
// Additional policy checks land in a future milestone when the spec evolves beyond the SOC2 baseline.

import type { IdentityToken } from './identity.js';

export class PolicyEnforcement {
  static preflight(token: IdentityToken | null | undefined): void {
    if (!token || !token.token_id) {
      throw new Error('preflight failed: invalid or missing identity token');
    }
  }
}
