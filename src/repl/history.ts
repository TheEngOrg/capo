// src/repl/history.ts
//
// Pass 1: appendHistory() and historyPath() are stubs — no-ops.
// Pass 2: Implement XDG-compliant file append per staff-eng Section 5.

import type { DisplayRoute } from '../classifier/types.js';

export function historyPath(): string {
  // Pass 2: implement XDG path resolution.
  // ${XDG_STATE_HOME ?? ~/.local/state}/teo/history
  return '';
}

export function appendHistory(_route: DisplayRoute, _text: string): void {
  // Pass 2: implement fs.appendFileSync with atomic per-entry write.
  // Format: `${route}: ${text}\n`
  // Creates directory recursively if absent.
  return;
}
