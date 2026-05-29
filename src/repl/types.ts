// src/repl/types.ts

import type { RouteDecision } from '../classifier/types.js';

export interface HistoryItem {
  decision: RouteDecision;
  input: string;
}

export interface SessionState {
  history: HistoryItem[];
  token_id: string;
}

// Pass 2: Add ConversationHook, Session types as needed for useSubmit.
