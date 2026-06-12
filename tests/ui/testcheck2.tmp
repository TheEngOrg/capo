// src/repl/types.ts

import type { RouteDecision } from '../classifier/types.js';

export interface HistoryItem {
  decision: RouteDecision;
  input: string;
  /** LLM or pipeline output text — undefined while pending. */
  output?: string;
  /** Lifecycle status of this history entry. */
  status: 'pending' | 'done' | 'error';
}

export interface SessionState {
  history: HistoryItem[];
  token_id: string;
}

// Pass 2: Add ConversationHook, Session types as needed for useSubmit.
// M3: Added output and status to HistoryItem.
