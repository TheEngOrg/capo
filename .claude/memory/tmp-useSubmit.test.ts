// tests/repl/useSubmit.test.ts
//
// Pass 2: useSubmit hook tests — T-11, T-12, T-22, T-23, T-24, T-39.
// M3 update: hook now requires contextManager + subprocessController; tests
// provide minimal stubs for these. Async LLM dispatch is tested in
// tests/unit/llm-runtime.test.ts; existing synchronous-path tests are preserved.

import React from 'react';
import { Text } from 'ink';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================================================
// Module mocks — wired before importing hook so vi.mock hoisting applies
// ============================================================================

vi.mock('../../src/classifier/classifier.js', () => ({
  classify: vi.fn(),
}));

vi.mock('../../src/security/policy.js', () => ({
  PolicyEnforcement: {
    preflight: vi.fn(),
  },
}));

vi.mock('../../src/repl/history.js', () => ({
  appendHistory: vi.fn(),
  historyPath: vi.fn(() => '/tmp/teo-test-history'),
}));

vi.mock('../../src/audit/log.js', () => ({
  writeAuditEvent: vi.fn(),
}));

vi.mock('../../src/llm/claude-runtime.js', () => ({
  invokeClaude: vi.fn(() => Promise.resolve('mock llm response')),
}));

import { useSubmit } from '../../src/repl/useSubmit.js';
import { classify } from '../../src/classifier/classifier.js';
import { PolicyEnforcement } from '../../src/security/policy.js';
import { appendHistory } from '../../src/repl/history.js';
import { writeAuditEvent } from '../../src/audit/log.js';
import type { HistoryItem } from '../../src/repl/types.js';
import type { ContextManager } from '../../src/context/manager.js';
import type { SubprocessController } from '../../src/repl/SubprocessController.js';

// ============================================================================
// Minimal stubs for M3 seam dependencies
// ============================================================================

function makeContextManagerStub(): ContextManager {
  const history: import('../../src/context/manager.js').ContextTurn[] = [];
  return {
    append: vi.fn(),
    beginTurn: vi.fn(),
    commitTurn: vi.fn(),
    failCurrentTurn: vi.fn(),
    abortCurrentTurn: vi.fn(),
    getHistory: vi.fn(() => [...history]),
    serializeForPrompt: vi.fn(() => ''),
  };
}

function makeSubprocessControllerStub(): SubprocessController {
  return {
    setActiveProcess: vi.fn(),
    getActiveProcess: vi.fn(() => null),
    cancel: vi.fn(),
  };
}

// ============================================================================
// Test wrapper component
// ============================================================================

let capturedSubmit: ((input: string) => void) | null = null;
let capturedHistoryItems: HistoryItem[] = [];

interface WrapperProps {
  token_id: string;
  debug: boolean;
  inputToSubmit?: string;
  contextManager: ContextManager;
  subprocessController: SubprocessController;
}

function HookWrapper({ token_id, debug, inputToSubmit, contextManager, subprocessController }: WrapperProps): React.ReactElement {
  capturedHistoryItems = [];
  const onHistory = (item: HistoryItem) => {
    capturedHistoryItems.push(item);
  };

  const submit = useSubmit({ token_id, debug, onHistory, contextManager, subprocessController });
  capturedSubmit = submit;

  if (inputToSubmit !== undefined) {
    submit(inputToSubmit);
  }

  return React.createElement(Text, null, 'hook-wrapper');
}

// ============================================================================
// Helpers
// ============================================================================

function makeClassifyMockReturn(route: 'MECHANICAL' | 'ARCHITECTURAL' | 'UNKNOWN', input: string) {
  const display_route = route === 'MECHANICAL' ? 'mechanical' : 'architectural';
  return {
    route,
    display_route,
    raw_input: input,
    matched_pattern: route === 'UNKNOWN' ? undefined : 'test-pattern',
  } as const;
}

let testStateDir: string;
let originalXdgStateHome: string | undefined;

beforeEach(() => {
  originalXdgStateHome = process.env.XDG_STATE_HOME;
  testStateDir = join(tmpdir(), `teo-submit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.XDG_STATE_HOME = testStateDir;

  capturedSubmit = null;
  capturedHistoryItems = [];

  vi.mocked(classify).mockReset();
  vi.mocked(PolicyEnforcement.preflight).mockReset();
  vi.mocked(appendHistory).mockReset();
  vi.mocked(writeAuditEvent).mockReset();
});

afterEach(() => {
  if (originalXdgStateHome === undefined) {
    delete process.env.XDG_STATE_HOME;
  } else {
    process.env.XDG_STATE_HOME = originalXdgStateHome;
  }
  vi.restoreAllMocks();
});

// ============================================================================
// MISUSE — blank and whitespace-only inputs must never reach the classifier
// ============================================================================

describe('useSubmit (Pass 2)', () => {
  it('T-11 — blank input is a no-op: classify not called', () => {
    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));
    expect(capturedSubmit).not.toBeNull();

    capturedSubmit!('');

    expect(vi.mocked(classify)).not.toHaveBeenCalled();
    expect(capturedHistoryItems).toHaveLength(0);
    expect(vi.mocked(appendHistory)).not.toHaveBeenCalled();
  });

  it('T-12 — whitespace-only input is a no-op: classify not called', () => {
    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));
    expect(capturedSubmit).not.toBeNull();

    capturedSubmit!('   ');

    expect(vi.mocked(classify)).not.toHaveBeenCalled();
    expect(capturedHistoryItems).toHaveLength(0);
    expect(vi.mocked(appendHistory)).not.toHaveBeenCalled();
  });

  it('T-11 — tab-only input is also a no-op: classify not called', () => {
    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));
    capturedSubmit!('\t\t');

    expect(vi.mocked(classify)).not.toHaveBeenCalled();
    expect(capturedHistoryItems).toHaveLength(0);
  });

  // ============================================================================
  // BOUNDARY — route decisions for each classifier outcome
  // ============================================================================

  it('T-22 — mechanical input triggers MECHANICAL route decision', () => {
    const input = 'show me the current directory';
    vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', input));
    vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));
    capturedSubmit!(input);

    expect(vi.mocked(classify)).toHaveBeenCalledWith(input);
    expect(capturedHistoryItems).toHaveLength(1);
    expect(capturedHistoryItems[0].decision.route).toBe('MECHANICAL');
    expect(capturedHistoryItems[0].decision.display_route).toBe('mechanical');
    expect(capturedHistoryItems[0].input).toBe(input);
  });

  it('T-23 — architectural input triggers ARCHITECTURAL route decision', () => {
    const input = 'design a caching layer for a high-traffic API';
    vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('ARCHITECTURAL', input));
    vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));
    capturedSubmit!(input);

    expect(vi.mocked(classify)).toHaveBeenCalledWith(input);
    expect(capturedHistoryItems).toHaveLength(1);
    expect(capturedHistoryItems[0].decision.route).toBe('ARCHITECTURAL');
    expect(capturedHistoryItems[0].decision.display_route).toBe('architectural');
  });

  it('T-24 — UNKNOWN input: display_route is "architectural" (never "unknown")', () => {
    const input = 'blorp the fleeb';
    vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('UNKNOWN', input));
    vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));
    capturedSubmit!(input);

    expect(capturedHistoryItems).toHaveLength(1);
    expect(capturedHistoryItems[0].decision.display_route).toBe('architectural');
    expect(capturedHistoryItems[0].decision.display_route).not.toBe('unknown');
    expect(capturedHistoryItems[0].decision.route).toBe('UNKNOWN');
  });

  // ============================================================================
  // BOUNDARY — debug=true writes audit event (T-38, SOC2)
  // ============================================================================

  it('T-38 — debug=false: writeAuditEvent NOT called on submit', () => {
    vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', 'show files'));
    vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));
    capturedSubmit!('show files');

    expect(vi.mocked(writeAuditEvent)).not.toHaveBeenCalled();
  });

  it('T-38 — debug=true: writeAuditEvent called with type "preflight_called" on submit', () => {
    const input = 'show me the current directory';
    vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', input));
    vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'tok-debug-001', debug: true, contextManager: ctx, subprocessController: ctrl }));
    capturedSubmit!(input);

    expect(vi.mocked(writeAuditEvent)).toHaveBeenCalledOnce();
    expect(vi.mocked(writeAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'preflight_called',
        token_id: 'tok-debug-001',
      }),
    );
  });

  it('T-38 — debug=true, multiple submits: writeAuditEvent called once per non-blank submit', () => {
    vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', 'test'));
    vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'tok-debug-multi', debug: true, contextManager: ctx, subprocessController: ctrl }));

    capturedSubmit!('first command');
    capturedSubmit!('second command');
    capturedSubmit!('third command');

    expect(vi.mocked(writeAuditEvent)).toHaveBeenCalledTimes(3);
  });

  it('T-38 — debug=true, blank input: writeAuditEvent NOT called (blank guard fires first)', () => {
    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'tok-debug-blank', debug: true, contextManager: ctx, subprocessController: ctrl }));
    capturedSubmit!('');
    capturedSubmit!('   ');

    expect(vi.mocked(writeAuditEvent)).not.toHaveBeenCalled();
  });

  // ============================================================================
  // GOLDEN — SOC2 preflight call count (T-39)
  // ============================================================================

  it('T-39 — preflight called exactly once per pipeline execution (3 submits = 3 calls)', () => {
    vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', 'test'));
    vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));

    capturedSubmit!('show me the current directory');
    capturedSubmit!('design a caching layer for a high-traffic API');
    capturedSubmit!('blorp the fleeb');

    expect(vi.mocked(PolicyEnforcement.preflight)).toHaveBeenCalledTimes(3);
  });

  it('T-39 — preflight NOT called for blank/whitespace inputs', () => {
    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));

    capturedSubmit!('');
    capturedSubmit!('   ');

    expect(vi.mocked(PolicyEnforcement.preflight)).not.toHaveBeenCalled();
  });

  it('appendHistory called with display_route and input on each non-blank submit', () => {
    const input = 'show me the current directory';
    vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', input));
    vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

    const ctx = makeContextManagerStub();
    const ctrl = makeSubprocessControllerStub();
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));
    capturedSubmit!(input);

    expect(vi.mocked(appendHistory)).toHaveBeenCalledOnce();
    expect(vi.mocked(appendHistory)).toHaveBeenCalledWith('mechanical', input);
  });

  // ============================================================================
  // T-49 — SOC2/preflight failure is FATAL: process must exit non-zero
  // ============================================================================

  describe('T-49 — SOC2/preflight failure is FATAL: process must exit non-zero', () => {
    it('T-49 (a) — preflight throws: process.exit called with non-zero code (FATAL path)', () => {
      vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', 'show files'));
      vi.mocked(PolicyEnforcement.preflight).mockImplementation(() => {
        throw new Error('preflight failed: SOC2 policy violation');
      });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      }) as (code?: number | string | null) => never);

      const ctx = makeContextManagerStub();
      const ctrl = makeSubprocessControllerStub();
      render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));

      try {
        capturedSubmit!('show files');
      } catch {
        // swallow
      }

      expect(exitSpy).toHaveBeenCalled();
      const exitCode = exitSpy.mock.calls[0]?.[0];
      expect(exitCode, 'process.exit must be called with non-zero code on preflight failure').not.toBe(0);
      expect(exitCode, 'process.exit must be called with 1 on preflight failure').toBe(1);
    });

    it('T-49 (b) — preflight throws: error message is surfaced to user (no silent failure)', () => {
      vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', 'show files'));
      vi.mocked(PolicyEnforcement.preflight).mockImplementation(() => {
        throw new Error('preflight failed: SOC2 policy violation');
      });

      const stderrMessages: string[] = [];
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg) => {
        stderrMessages.push(String(msg));
        return true;
      });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      }) as (code?: number | string | null) => never);

      const ctx = makeContextManagerStub();
      const ctrl = makeSubprocessControllerStub();
      render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));

      try {
        capturedSubmit!('show files');
      } catch {
        // swallow
      }

      expect(exitSpy).toHaveBeenCalled();

      const allStderr = stderrMessages.join('');
      expect(
        allStderr.length,
        'process.stderr.write must be called with error details before exit',
      ).toBeGreaterThan(0);
      expect(allStderr).not.toMatch(/at Object\./);
      expect(allStderr).not.toMatch(/\.tsx?:\d+:\d+/);

      stderrSpy.mockRestore();
    });

    it('T-49 (c) — RECOVERABLE contrast: classifier throws → process.exit NOT called, REPL survives', () => {
      vi.mocked(classify).mockImplementation(() => {
        throw new Error('internal classifier failure');
      });
      vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      }) as (code?: number | string | null) => never);

      const ctx = makeContextManagerStub();
      const ctrl = makeSubprocessControllerStub();
      render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));

      try {
        capturedSubmit!('show files');
      } catch {
        // swallow
      }

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('T-49 (d) — RECOVERABLE contrast: preflight succeeds, classifier throws → no exit, history NOT written', () => {
      vi.mocked(classify).mockImplementation(() => {
        throw new Error('classifier blew up');
      });
      vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number | string | null) => never);

      const ctx = makeContextManagerStub();
      const ctrl = makeSubprocessControllerStub();
      render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false, contextManager: ctx, subprocessController: ctrl }));

      try {
        capturedSubmit!('some input');
      } catch {
        // swallow
      }

      expect(exitSpy).not.toHaveBeenCalled();
      expect(vi.mocked(appendHistory)).not.toHaveBeenCalled();
    });
  });
});
