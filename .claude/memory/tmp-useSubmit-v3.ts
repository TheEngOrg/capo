// src/repl/useSubmit.ts
//
// M3: useSubmit hook — async LLM dispatch, context manager, subprocess controller.
// Returns fire-and-forget (input: string) => void.

import { useCallback } from 'react';
import type { HistoryItem } from './types.js';
import { classify } from '../classifier/classifier.js';
import { PolicyEnforcement } from '../security/policy.js';
import { appendHistory } from './history.js';
import { writeAuditEvent } from '../audit/log.js';
import type { IdentityToken } from '../security/identity.js';
import { invokeClaude } from '../llm/claude-runtime.js';
import { createContextManager } from '../context/manager.js';
import type { ContextManager } from '../context/manager.js';
import { createSubprocessController } from './SubprocessController.js';
import type { SubprocessController } from './SubprocessController.js';

export interface UseSubmitOptions {
  token_id: string;
  debug: boolean;
  onHistory: (item: HistoryItem) => void;
  contextManager?: ContextManager;
  subprocessController?: SubprocessController;
}

// Module-level fallback instances for callers that don't pass the new M3 params.
const _fallbackContextManager = createContextManager();
const _fallbackSubprocessController = createSubprocessController();

export function useSubmit({
  token_id,
  debug,
  onHistory,
  contextManager = _fallbackContextManager,
}: UseSubmitOptions): (input: string) => void {
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
      process.stderr.write(
        '[debug] classify: matched_pattern=' +
          String(decision.matched_pattern) +
          ' route=' +
          decision.route.toLowerCase() +
          '\n',
      );
    }

    // Step 5: persist to history file.
    appendHistory(decision.display_route, input);

    // Step 6: dispatch based on route.
    if (decision.display_route === 'mechanical') {
      // MECHANICAL: not yet implemented — push immediate done item.
      const item: HistoryItem = {
        decision,
        input,
        output: '[mechanical operations not yet implemented in this build]',
        status: 'done',
      };
      onHistory(item);
      return;
    }

    // ARCHITECTURAL: push pending item, invoke LLM async.
    const pendingItem: HistoryItem = { decision, input, status: 'pending' };
    onHistory(pendingItem);
    contextManager.beginTurn(input);

    // Fire and forget — async IIFE.
    void (async () => {
      try {
        const output = await invokeClaude(input, contextManager.getHistory(), { debug });
        contextManager.commitTurn(output, 'ARCHITECTURAL');
        const doneItem: HistoryItem = { decision, input, output, status: 'done' };
        onHistory(doneItem);
      } catch (err) {
        contextManager.failCurrentTurn();
        const errorItem: HistoryItem = {
          decision,
          input,
          output: String(err),
          status: 'error',
        };
        onHistory(errorItem);
      }
    })();
  }, [token_id, debug, onHistory, contextManager]);
}

// Re-export for external use (SubprocessController users).
export { _fallbackSubprocessController };
