// tests/ui/ErrorBoundary.test.tsx
//
// Pass 2: <ErrorBoundary /> component tests.
// Spec reference: M1-test-specs.md Category H (T-47, T-48, T-50),
//                 M1-implementation-spec.md Section 5 (ErrorBoundary).
//
// ErrorBoundary is DONE (real implementation). These tests should be GREEN.
//
// Note: ErrorBoundary is in src/ui/ — excluded from the coverage gate,
// but correctness still matters per the task spec.
//
// T-50 (no stack trace) is applied to all error paths in this file.
// Stack trace patterns: "at Object.", "Error:", file paths ending in .ts/.tsx,
// and line:col references (:<N>:<N>).

import React from 'react';
import { Text } from 'ink';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ErrorBoundary } from '../../src/ui/ErrorBoundary.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Helper: component that throws on render
// ============================================================================

function ThrowingComponent({ message }: { message: string }): React.ReactElement {
  throw new Error(message);
}

function SafeChild({ text }: { text: string }): React.ReactElement {
  return React.createElement(Text, null, text);
}

// Stack trace pattern — T-50 assertion helper
const STACK_TRACE_PATTERNS = [
  /at Object\./,
  /at .+\(\s*.+\.tsx?:\d+:\d+\s*\)/,  // "at functionName (file.ts:N:N)"
  /\.tsx?:\d+:\d+/,                    // bare file.ts:N:N reference
];

function assertNoStackTrace(frame: string): void {
  for (const pattern of STACK_TRACE_PATTERNS) {
    expect(frame, `Stack trace pattern ${pattern} found in output`).not.toMatch(pattern);
  }
}

// ============================================================================
// MISUSE — T-47, T-48: catch thrown errors from classifier/stub renders
// ============================================================================

describe('ErrorBoundary (Pass 2)', () => {
  // Suppress React's console.error for expected error-boundary throws in tests
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('T-47 — classifier throws: REPL recovers, human-readable message shown', () => {
    // Simulate: a classifier result triggers a render error (e.g., bad data prop)
    const { lastFrame } = render(
      React.createElement(ErrorBoundary, null,
        React.createElement(ThrowingComponent, { message: 'internal classifier failure' })
      )
    );

    const frame = lastFrame() ?? '';

    // Must show a human-readable error message
    expect(frame).toContain('internal classifier failure');
    // Must not show raw stack trace (T-50)
    assertNoStackTrace(frame);
  });

  it('T-48 — stub throws: REPL recovers, human-readable message shown', () => {
    const { lastFrame } = render(
      React.createElement(ErrorBoundary, null,
        React.createElement(ThrowingComponent, { message: 'stub render failure' })
      )
    );

    const frame = lastFrame() ?? '';

    expect(frame).toContain('stub render failure');
    assertNoStackTrace(frame);
  });

  // ============================================================================
  // BOUNDARY — T-50: no stack trace text on any error path
  // ============================================================================

  it('T-50 — no stack trace text: no "at Object.", no .ts line refs, no :<N>:<N>', () => {
    const { lastFrame } = render(
      React.createElement(ErrorBoundary, null,
        React.createElement(ThrowingComponent, { message: 'something went wrong internally' })
      )
    );

    const frame = lastFrame() ?? '';
    assertNoStackTrace(frame);

    // Also assert "Error:" as a prefix is shown but no raw stack dump follows
    // The ErrorBoundary renders: "Error: <message>" — that's acceptable (it's the message).
    // What's NOT acceptable is a stack dump below the message.
    const lines = frame.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    // At most 1-2 lines of error output — not a multi-line stack trace dump
    const stackLikeLines = lines.filter(l =>
      /at \w+/.test(l) || /\.tsx?:\d+/.test(l)
    );
    expect(stackLikeLines.length, 'Stack-trace-like lines found in error output').toBe(0);
  });

  it('T-25 — corrupted classifier return (null error message): safe fallback, no crash', () => {
    // ErrorBoundary must handle errors with unusual messages gracefully.
    const { lastFrame } = render(
      React.createElement(ErrorBoundary, null,
        React.createElement(ThrowingComponent, { message: '' })
      )
    );

    const frame = lastFrame() ?? '';
    // Must render something (not blank) and not crash
    expect(frame.trim().length, 'ErrorBoundary rendered empty frame for empty error message').toBeGreaterThan(0);
    assertNoStackTrace(frame);
  });

  // ============================================================================
  // GOLDEN — children pass-through when no error
  // ============================================================================

  it('renders children when no error occurs', () => {
    const { lastFrame } = render(
      React.createElement(ErrorBoundary, null,
        React.createElement(SafeChild, { text: 'Hello from child' })
      )
    );

    const frame = lastFrame() ?? '';
    // Child output is visible — no error message shown
    expect(frame).toContain('Hello from child');
    // No error prefix — clean render must not trigger ErrorBoundary
    expect(frame).not.toMatch(/^Error: /m);
  });

  it('does not show error message when children render cleanly', () => {
    const { lastFrame } = render(
      React.createElement(ErrorBoundary, null,
        React.createElement(SafeChild, { text: 'clean render' })
      )
    );

    const frame = lastFrame() ?? '';
    // Must not contain the ErrorBoundary error prefix
    expect(frame).not.toMatch(/^Error: /m);
  });
});
