// src/repl/useSubmit.ts
//
// Pass 2: useSubmit hook — blank-input guard, classify, preflight, history write.
// Steps per M1-implementation-spec.md Section 5 (useSubmit hook, steps 1-6).

import { useCallback } from 'react';
import type { HistoryItem } from './types.js';
import { classify } from '../classifier/classifier.js';
import { PolicyEnforcement } from '../security/policy.js';
import { appendHistory } from './history.js';
import { writeAuditEvent } from '../audit/log.js';
import type { IdentityToken } from '../security/identity.js';

export interface UseSubmitOptions {
  token_id: string;
  debug: boolean;
  onHistory: (item: HistoryItem) => void;
}

export function useSubmit({ token_id, debug, onHistory }: UseSubmitOptions): (input: string) => void {
  return useCallback((input: string): void => {
    // Step 1: blank-input guard — no-op on empty/whitespace input.
    if (input.trim() === '') {
      return;
    }

    // Step 2: classify — RECOVERABLE on failure.
    let decision: ReturnType<typeof classify>;
    try {
      decision = classify(input);
    } catch (err) {
      process.stderr.write(`teo: error: ${String(err)}\n`);
      return; // recoverable — return to prompt, do not exit
    }

    // Step 3: preflight — FATAL on failure (SOC2 requirement).
    // TODO M2+: pass full IdentityToken into hook (not just token_id) when
    // preflight gains timestamp/HMAC validation — this dummy token's issued_at
    // does not reflect the original token's issuance time.
    const token: IdentityToken = {
      token_id,
      session_id: '',
      issued_at: new Date().toISOString(),
      hmac: '',
    };
    try {
      PolicyEnforcement.preflight(token);
    } catch (err) {
      process.stderr.write(`teo: fatal error: preflight failed: ${String(err)}\n`);
      process.exit(1);
    }

    // Step 4: audit log if debug.
    if (debug) {
      writeAuditEvent({ type: 'preflight_called', token_id, timestamp: new Date().toISOString() });
      process.stderr.write('[debug] preflight_called: ' + token_id + '\n');
      process.stderr.write('[debug] classify: matched_pattern=' + String(decision.matched_pattern) + ' route=' + decision.route + '\n');
    }

    // Step 5: append to history state via callback.
    const item: HistoryItem = { decision, input };
    onHistory(item);

    // Step 6: persist to history file.
    appendHistory(decision.display_route, input);
  }, [token_id, debug, onHistory]);
}
