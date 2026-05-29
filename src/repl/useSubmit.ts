// src/repl/useSubmit.ts
//
// Pass 1: useSubmit hook stub — returns a no-op handler.
// Pass 2: Implement blank-input guard, classify, preflight, history write.

import type { HistoryItem } from './types.js';

export interface UseSubmitOptions {
  token_id: string;
  debug: boolean;
  onHistory: (item: HistoryItem) => void;
}

export function useSubmit(_options: UseSubmitOptions): (input: string) => void {
  // Pass 2: implement full submit flow per staff-eng Section 5 (useSubmit hook).
  return (_input: string): void => {
    return;
  };
}
