// src/repl/history.ts
//
// appendHistory(): appends one line to the XDG-compliant history file.
// Uses node:fs / node:os / node:path — works under both Bun and Node (D-002).
//
// Format: `${route}: ${text}\n`
// Parser contract: split on FIRST colon only — colons in text are preserved.
//
// T-42 newline policy (F-05): ESCAPE newlines in input text.
//   '\n' in text → literal two-character sequence '\n' in the file.
//   Guarantees exactly one history line per submission while preserving full input.
//   Round-trip: caller unescapes '\\n' → '\n' when reading back.
//   Alternative (truncate) would silently discard user input — rejected.
//
// T-40: errors from appendFileSync propagate to caller (not swallowed).

import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { DisplayRoute } from '../classifier/types.js';

export function historyPath(): string {
  const stateDir = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(stateDir, 'teo', 'history');
}

export function appendHistory(route: DisplayRoute, text: string): void {
  const filePath = historyPath();
  const dir = dirname(filePath);
  // mkdirSync propagates on permission errors (e.g., path is a file not a dir — T-40).
  mkdirSync(dir, { recursive: true });
  // Escape embedded newlines so each submission occupies exactly one line (T-42).
  const safeText = text.replace(/\n/g, '\\n');
  // appendFileSync propagates on write errors (T-40) — not caught here.
  appendFileSync(filePath, `${route}: ${safeText}\n`, 'utf8');
}
