import { describe, it } from 'vitest';

// Pass 2: REPL session lifecycle tests T-07 through T-14 per M1-test-specs.md Category B.
describe.skip('Session (Pass 2)', () => {
  it('T-07 — stdin closed before REPL ready, exits cleanly', () => {
    // TODO Pass 2
  });

  it('T-11 — blank input is a no-op', () => {
    // TODO Pass 2: classifier call count === 0
  });

  it('T-12 — whitespace-only input is a no-op', () => {
    // TODO Pass 2
  });

  it('T-13 — Ctrl+C during classifier interrupts, returns to prompt', () => {
    // TODO Pass 2
  });

  it('T-14 — Ctrl+D exits with code 0', () => {
    // TODO Pass 2
  });
});
