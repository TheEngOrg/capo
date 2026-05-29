// Pass 1 stub — implementation lands in Pass 2
// Tests for the <Prompt /> component: rendering and TextInput presence.
// Spec reference: M1-implementation-spec.md §1 (tests/ui/Prompt.test.tsx), M1-test-specs.md Category B.

import { describe, it } from 'vitest';

describe.skip('Prompt (Pass 2)', () => {
  it('renders "teo> " prefix', () => {
    // TODO Pass 2: ink-testing-library render of <Prompt />, assert "teo> " in output
  });

  it('contains a TextInput component', () => {
    // TODO Pass 2: assert TextInput is present in the component tree
  });

  it('T-11 — onSubmit not called when input is blank', () => {
    // TODO Pass 2: ink-testing-library — fire Enter with empty input, assert onSubmit not called
  });

  it('T-12 — onSubmit not called when input is whitespace-only', () => {
    // TODO Pass 2: fire Enter with "  " input, assert onSubmit not called
  });
});
