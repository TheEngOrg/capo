// tests/integration/debug-flag.test.ts
//
// T-M3-7.5 — GOLDEN: --debug integration (binary subprocess).
// Requires TEO_TEST_MODE or PTY spawner. Currently todo until Spawn 3.

import { describe, it } from 'vitest';

describe('Debug flag integration (T-M3-7.5)', () => {
  it.todo(
    'T-M3-7.5 (manual PTY REQUIRED or TEO_TEST_MODE): ' +
      'Run: teo --debug, enter "git status". ' +
      'Assert stderr contains: [debug] classify: matched_pattern=... route=mechanical, ' +
      '[debug] mechanical: operation=git_status. ' +
      'Run: teo --debug, enter "explain the architecture". ' +
      'Assert stderr contains: [debug] llm_invoke: claude --print. ' +
      'CANNOT AUTOMATE without PTY spawner or TEO_TEST_MODE bypass.'
  );
});
