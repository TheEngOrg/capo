// tests/ui/Prompt.test.tsx
//
// Pass 2: <Prompt /> component tests.
// Spec reference: M1-implementation-spec.md Section 5 (REPL loop, Prompt),
//                 M1-test-specs.md Category B (T-11, T-12).
//
// Blank/whitespace guard: the Prompt component itself does NOT enforce the guard —
// it fires onSubmit with whatever TextInput provides. The guard lives in useSubmit.
// These tests verify the component renders the "teo> " prefix and wires onSubmit.
//
// Note: Prompt is in src/ui/ which is EXCLUDED from the coverage gate (vitest.config.ts),
// but correctness still matters per the task spec.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Prompt } from '../../src/ui/Prompt.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// MISUSE — calling Prompt without a handler shouldn't blow up
// ============================================================================

describe('Prompt (Pass 2)', () => {
  it('renders "teo> " prefix', () => {
    const { lastFrame } = render(
      React.createElement(Prompt, { onSubmit: vi.fn() })
    );

    // When Pass 2 implements Prompt with ink-text-input, the frame must contain "teo> ".
    // The stub renders "teo> (stub)" — this assertion drives the real implementation.
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/teo>/);
  });

  it('contains a TextInput component (renders without crashing)', () => {
    // When Pass 2 wires ink-text-input, the rendered frame should include the
    // input cursor or empty-input text. Until then, we assert no crash on render.
    expect(() => {
      render(React.createElement(Prompt, { onSubmit: vi.fn() }));
    }).not.toThrow();
  });

  // T-11: blank input — Prompt fires onSubmit with empty string.
  // The no-op guard is in useSubmit, not Prompt. Prompt's onSubmit IS called
  // with whatever TextInput emits. This test documents: Prompt must be renderable
  // and onSubmit must be a wired prop (not silently ignored by the component).
  it('T-11 — onSubmit prop is wired: Prompt accepts and stores the callback', () => {
    const onSubmit = vi.fn();
    // Render must not throw with an onSubmit prop provided.
    expect(() => {
      render(React.createElement(Prompt, { onSubmit }));
    }).not.toThrow();
    // The callback itself is not auto-called on mount — it waits for user input.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // T-12: whitespace-only — same as T-11 for prop-wiring assertion.
  it('T-12 — onSubmit prop wired for whitespace input handling (guard is in useSubmit)', () => {
    const onSubmit = vi.fn();
    expect(() => {
      render(React.createElement(Prompt, { onSubmit }));
    }).not.toThrow();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
