// tests/e2e/active.test.ts
//
// Active Testing Gate — M3 (PM Done Criterion 14).
// These are MANDATORY manual PTY gates. M3 cannot be marked COMPLETE until
// every item has been manually verified in a real PTY session.
// The it.todo() entries are the formal tracking mechanism.

import { describe, it } from 'vitest';

describe('Active Testing Gate — M3 (PM Done Criterion 14)', () => {
  it.todo(
    'GATE-1: teo binary launches in a real PTY and shows "teo> " prompt within 2 seconds. ' +
      'Run: ./dist/teo-darwin-arm64 (or equivalent). ' +
      'Assert: "teo> " appears in terminal output within 2s of launch.'
  );

  it.todo(
    'GATE-2: architectural query returns substantive LLM content (not stub). ' +
      'Run: teo, enter "explain the classifier architecture". ' +
      'Assert: output contains multiple sentences of LLM-generated content. ' +
      'Assert: output does NOT contain "[architectural stub]". '
  );

  it.todo(
    'GATE-3: Ctrl+C during LLM generation returns to prompt without exiting. ' +
      'Run: teo, enter a complex ARCHITECTURAL query, wait >1s, press Ctrl+C. ' +
      'Assert: "teo> " returns within 1 second. ' +
      'Assert: process is still alive (not exited). ' +
      'Assert: no orphaned `claude` subprocess (check: ps aux | grep claude).'
  );

  it.todo(
    'GATE-4: Ctrl+D exits cleanly (exit 0, no stack trace). ' +
      'Run: teo, press Ctrl+D. ' +
      'Assert: process exits with code 0. ' +
      'Assert: no stack trace in terminal. ' +
      'Assert: "d" is NOT visible in the terminal before exit.'
  );

  it.todo(
    'GATE-5: Spinner visible during LLM invocation. ' +
      'Run: teo, enter an architectural query. ' +
      'Assert: a spinning indicator appears within 200ms of Enter. ' +
      'Assert: spinner clears when output is displayed.'
  );

  it.todo(
    'GATE-6: Multi-turn coherence in live session. ' +
      'Run: teo. ' +
      'Turn 1: "what is the classifier?" — note the response. ' +
      'Turn 2: "how does it determine MECHANICAL vs ARCHITECTURAL?" ' +
      'Assert: Turn 2 response references or builds on Turn 1 content (coherent, not starting from scratch).'
  );

  it.todo(
    'GATE-7: Auth startup probe failure. ' +
      'Temporarily rename claude CLI: mv $(which claude) $(which claude).bak ' +
      'Run: teo. ' +
      'Assert: error message appears referencing "claude auth". ' +
      'Assert: "teo> " prompt does NOT appear. ' +
      'Assert: process exits non-zero. ' +
      'Restore: mv $(which claude).bak $(which claude)'
  );
});
