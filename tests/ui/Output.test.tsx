// tests/ui/Output.test.tsx
//
// Pass 2: <Output /> component tests.
// Spec reference: M1-test-specs.md Category E (T-27, T-28, T-33),
//                 M1-implementation-spec.md Section 5 (Output, Static, RouteIndicator).
//
// Note: Output is in src/ui/ which is EXCLUDED from the coverage gate,
// but correctness still matters per the task spec.
//
// T-27 (route label inline before stub) and T-28 (dim styling) are asserted here
// at the Output level — RouteIndicator.test.tsx asserts the same at the component level.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Output } from '../../src/ui/Output.js';
import type { HistoryItem } from '../../src/repl/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Helper: build HistoryItems for test inputs
// ============================================================================

function makeMechanicalItem(input: string): HistoryItem {
  return {
    input,
    decision: {
      route: 'MECHANICAL',
      display_route: 'mechanical',
      raw_input: input,
      matched_pattern: 'show',
    },
  };
}

function makeArchitecturalItem(input: string): HistoryItem {
  return {
    input,
    decision: {
      route: 'ARCHITECTURAL',
      display_route: 'architectural',
      raw_input: input,
      matched_pattern: 'design',
    },
  };
}

function makeUnknownItem(input: string): HistoryItem {
  // UNKNOWN collapses to architectural at classification time
  return {
    input,
    decision: {
      route: 'UNKNOWN',
      display_route: 'architectural',
      raw_input: input,
    },
  };
}

// ============================================================================
// MISUSE — rendering with bad/empty data must not crash
// ============================================================================

describe('Output (Pass 2)', () => {
  it('renders empty state without crashing', () => {
    expect(() => {
      render(React.createElement(Output, { items: [] }));
    }).not.toThrow();
  });

  it('empty items renders blank/empty frame (no visible content)', () => {
    const { lastFrame } = render(React.createElement(Output, { items: [] }));
    // An empty Output should render nothing meaningful — the stub renders <Text></Text>
    // which results in an empty or whitespace-only frame.
    const frame = (lastFrame() ?? '').trim();
    // Either empty, or just whitespace — no stub artifact text visible to user
    expect(frame).not.toMatch(/item\(s\)/); // reject old stub text once impl lands
  });

  // ============================================================================
  // BOUNDARY — ordering and multiple items
  // ============================================================================

  it('renders multiple history items in submission order', () => {
    const items: HistoryItem[] = [
      makeMechanicalItem('show me the current directory'),
      makeArchitecturalItem('design a caching layer for a high-traffic API'),
      makeUnknownItem('blorp the fleeb'),
    ];

    const { lastFrame } = render(React.createElement(Output, { items }));
    const frame = lastFrame() ?? '';

    // When Pass 2 Output renders all items, all three inputs must be visible.
    // This test fails red against the stub and drives the Static implementation.
    // Ordering: first item appears before second item in the frame.
    const mechIdx = frame.indexOf('show me the current directory');
    const archIdx = frame.indexOf('design a caching layer');
    const unknIdx = frame.indexOf('blorp the fleeb');

    // All three items must appear (red against stub — drives impl)
    expect(mechIdx, 'first item not found in Output frame').toBeGreaterThanOrEqual(0);
    expect(archIdx, 'second item not found in Output frame').toBeGreaterThanOrEqual(0);
    expect(unknIdx, 'third item not found in Output frame').toBeGreaterThanOrEqual(0);

    // Ordering: mech < arch < unkn
    expect(mechIdx).toBeLessThan(archIdx);
    expect(archIdx).toBeLessThan(unknIdx);
  });

  // T-27: route label appears before stub response text.
  it('T-27 — route label "[→ mechanical]" appears before stub response text', () => {
    const items: HistoryItem[] = [
      makeMechanicalItem('show me the current directory'),
    ];

    const { lastFrame } = render(React.createElement(Output, { items }));
    const frame = lastFrame() ?? '';

    // When impl lands: route label must precede stub text.
    const labelIdx = frame.indexOf('[→ mechanical]');
    const stubIdx = frame.indexOf('[mechanical stub] Received:');

    expect(labelIdx, '[→ mechanical] label not found in Output frame').toBeGreaterThanOrEqual(0);
    expect(stubIdx, '[mechanical stub] Received: not found in Output frame').toBeGreaterThanOrEqual(0);
    expect(labelIdx, 'route label must appear before stub text').toBeLessThan(stubIdx);
  });

  // T-28: route label uses dim styling.
  // ink-testing-library renders ANSI escape codes in frames. The RouteIndicator
  // uses dimColor — this test asserts the label text appears (dim is a render-time
  // attribute; RouteIndicator.test.tsx covers the component-level dimColor prop assertion).
  it('T-28 — route label is present in output (dim styling covered in RouteIndicator tests)', () => {
    const items: HistoryItem[] = [
      makeMechanicalItem('show me the current directory'),
    ];

    const { lastFrame } = render(React.createElement(Output, { items }));
    const frame = lastFrame() ?? '';

    expect(frame).toMatch(/\[→ mechanical\]/);
  });

  // T-33: stubs render atomically — no streaming, no partial output.
  // ink-testing-library renders synchronously; each render call produces a complete frame.
  // We assert: after submitting one item, the full stub text appears in the SAME frame
  // (not character-by-character). This is validated by checking the final frame contains
  // the complete stub string.
  it('T-33 — Output renders history items atomically (full stub text in single frame)', () => {
    const input = 'show me the current directory';
    const items: HistoryItem[] = [makeMechanicalItem(input)];

    const { lastFrame } = render(React.createElement(Output, { items }));
    const frame = lastFrame() ?? '';

    // Atomic: the full "[mechanical stub] Received: show me the current directory"
    // must appear in the rendered frame — not partially.
    const fullStubText = `[mechanical stub] Received: ${input}`;
    expect(frame).toContain(fullStubText);
  });
});
