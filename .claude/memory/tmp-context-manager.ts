// src/context/manager.ts
//
// M3: In-memory multi-turn context buffer.
// Failed/aborted turns are NEVER committed to history.

import { buildPrompt } from '../llm/context.js';
import type { ContextTurn } from '../llm/context.js';

export type { ContextTurn };

export interface ContextManager {
  /** Directly append a turn (user or assistant) to the committed history. */
  append(turn: ContextTurn): void;
  /** Begin an in-progress turn with user input. Does NOT commit until commitTurn(). */
  beginTurn(input: string): void;
  /** Commit the current in-progress turn with LLM output and route. */
  commitTurn(output: string, route: string): void;
  /** Discard the current in-progress turn on error. */
  failCurrentTurn(): void;
  /** Discard the current in-progress turn on user cancellation (Ctrl+C). */
  abortCurrentTurn(): void;
  /** Return all committed turns in chronological order. */
  getHistory(): ContextTurn[];
  /** Serialize all committed history as a prompt prefix string. */
  serializeForPrompt(): string;
}

export function createContextManager(): ContextManager {
  const history: ContextTurn[] = [];
  let pendingInput: string | null = null;

  return {
    append(turn: ContextTurn): void {
      history.push(turn);
    },

    beginTurn(input: string): void {
      pendingInput = input;
    },

    commitTurn(output: string, route: string): void {
      if (pendingInput === null) return;
      const routeVal = route === 'MECHANICAL' ? 'MECHANICAL' : 'ARCHITECTURAL';
      history.push({ role: 'user', content: pendingInput, route: routeVal });
      history.push({ role: 'assistant', content: output, route: routeVal });
      pendingInput = null;
    },

    failCurrentTurn(): void {
      pendingInput = null;
    },

    abortCurrentTurn(): void {
      pendingInput = null;
    },

    getHistory(): ContextTurn[] {
      return [...history];
    },

    serializeForPrompt(): string {
      return buildPrompt({ input: '', context: history });
    },
  };
}
