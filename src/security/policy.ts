// src/security/policy.ts
//
// PolicyEnforcement.preflight() validates that the identity token is non-null with a non-empty token_id.
// This is the complete M1 implementation per M1-implementation-spec.md Section 5.
// Additional policy checks land in a future milestone when the spec evolves beyond the SOC2 baseline.

import type { IdentityToken } from './identity.js';

export class PolicyEnforcement {
  // Tightened in Pass 2: whitespace-only token_id is truthy in JS but not a valid
  // non-empty id per spec "token_id is non-empty." Use .trim() to reject '   '.
  // All existing passing tests (empty string, null, undefined) remain covered.
  // The test at T-36/whitespace documents observed behavior — it allows either
  // throw or pass, so tightening is safe and more correct.
  static preflight(token: IdentityToken | null | undefined): void {
    if (!token || !token.token_id || !token.token_id.trim()) {
      throw new Error('preflight failed: invalid or missing identity token');
    }
  }
}
