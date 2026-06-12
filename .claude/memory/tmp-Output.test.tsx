// tests/ui/Output.test.tsx
//
// Pass 2: <Output /> component tests.
// M3: Updated HistoryItem construction to include required status field.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Output } from '../../src/ui/Output.js';
import type { HistoryItem } from '../../src/repl/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeMechanicalItem(input: string): HistoryItem {
  return {
    input,
    status: 'done',
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
    status: 'done',
    output: `Response to: ${input}`,
    decision: {
      route: 'ARCHITECTURAL',
      display_route: 'architectural',
      raw_input: input,
      matched_pattern: 'design',
    },
  };
}

function makeUnknownItem(input: string): HistoryItem {
  return {
    input,
    status: 'done',
    output: `Response to: ${input}`,
    decision: {
      route: 'UNKNOWN',
      display_route: 'architectural',
      raw_input: input,
    },
  };
}

describe('Output (Pass 2)', () => {
  it('renders empty state without crashing', () => {
    expect(() => {
      render(React.createElement(Output, { items: [] }));
    }).not.toThrow();
  });

  it('empty items renders blank/empty frame (no visible content)', () => {
    const { lastFrame } = render(React.createElement(Output, { items: [] }));
    const frame = (lastFrame() ?? '').trim();
    expect(frame).not.toMatch(/item\(s\)/);
  });

  it('renders multiple history items in submission order', () => {
    const items: HistoryItem[] = [
      makeMechanicalItem('show me the current directory'),
      makeArchitecturalItem('design a caching layer for a high-traffic API'),
      makeUnknownItem('blorp the fleeb'),
    ];

    const { lastFrame } = render(React.createElement(Output, { items }));
    const frame = lastFrame() ?? '';

    const mechIdx = frame.indexOf('show me the current directory');
    const archIdx = frame.indexOf('design a caching layer');
    const unknIdx = frame.indexOf('blorp the fleeb');

    expect(mechIdx, 'first item not found in Output frame').toBeGreaterThanOrEqual(0);
    expect(archIdx, 'second item not found in Output frame').toBeGreaterThanOrEqual(0);
    expect(unknIdx, 'third item not found in Output frame').toBeGreaterThanOrEqual(0);

    expect(mechIdx).toBeLessThan(archIdx);
    expect(archIdx).toBeLessThan(unknIdx);
  });

  it('T-27 — route label "[→ mechanical]" appears before stub response text', () => {
    const items: HistoryItem[] = [
      makeMechanicalItem('show me the current directory'),
    ];

    const { lastFrame } = render(React.createElement(Output, { items }));
    const frame = lastFrame() ?? '';

    const labelIdx = frame.indexOf('[→ mechanical]');
    const stubIdx = frame.indexOf('[mechanical stub] Received:');

    expect(labelIdx, '[→ mechanical] label not found in Output frame').toBeGreaterThanOrEqual(0);
    expect(stubIdx, '[mechanical stub] Received: not found in Output frame').toBeGreaterThanOrEqual(0);
    expect(labelIdx, 'route label must appear before stub text').toBeLessThan(stubIdx);
  });

  it('T-28 — route label is present in output (dim styling covered in RouteIndicator tests)', () => {
    const items: HistoryItem[] = [
      makeMechanicalItem('show me the current directory'),
    ];

    const { lastFrame } = render(React.createElement(Output, { items }));
    const frame = lastFrame() ?? '';

    expect(frame).toMatch(/\[→ mechanical\]/);
  });

  it('T-33 — Output renders history items atomically (full stub text in single frame)', () => {
    const input = 'show me the current directory';
    const items: HistoryItem[] = [makeMechanicalItem(input)];

    const { lastFrame } = render(React.createElement(Output, { items }));
    const frame = lastFrame() ?? '';

    const fullStubText = `[mechanical stub] Received: ${input}`;
    expect(frame).toContain(fullStubText);
  });
});
