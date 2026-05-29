// Pass 1 stub — implementation lands in Pass 2
// Tests for the useSubmit hook: blank-input guard and route decision flow.
// Spec reference: M1-implementation-spec.md §1 (tests/repl/useSubmit.test.ts), M1-test-specs.md Categories B and C.

import { describe, it } from 'vitest';

describe.skip('useSubmit (Pass 2)', () => {
  it('T-11 — blank input is a no-op: classify not called', () => {
    // TODO Pass 2: spy on classify(), submit empty string, assert call count === 0
  });

  it('T-12 — whitespace-only input is a no-op: classify not called', () => {
    // TODO Pass 2: spy on classify(), submit "  ", assert call count === 0
  });

  it('T-22 — mechanical input triggers MECHANICAL route decision', () => {
    // TODO Pass 2: submit "show me the current directory", assert decision.route === MECHANICAL
  });

  it('T-23 — architectural input triggers ARCHITECTURAL route decision', () => {
    // TODO Pass 2: submit "design a caching layer for a high-traffic API", assert decision.route === ARCHITECTURAL
  });

  it('T-24 — UNKNOWN input route decision has display_route === architectural', () => {
    // TODO Pass 2: submit "blorp the fleeb", assert decision.display_route === "architectural"
  });

  it('T-39 — preflight called exactly once per submission', () => {
    // TODO Pass 2: spy on PolicyEnforcement.preflight(), submit three inputs, assert call count === 3
  });
});
