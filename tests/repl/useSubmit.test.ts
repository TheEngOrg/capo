// tests/repl/useSubmit.test.ts
//
// Pass 2: useSubmit hook tests — T-11, T-12, T-22, T-23, T-24, T-39.
// per M1-test-specs.md Categories B, C, F.
//
// Strategy: test the hook's logic by calling the hook directly in a React component
// wrapper rendered via ink-testing-library. The wrapper calls the hook and exposes
// the submit handler via a ref-like mechanism using module-level state tracking.
//
// @testing-library/react is NOT installed — we use ink-testing-library + a thin
// wrapper component approach to exercise the hook.
//
// Note on T-39 duplication: T-39 also appears in tests/security/policy.test.ts
// at the policy-module layer. The duplication is INTENTIONAL — the hook-layer test
// verifies the 1:1 ratio from the call-site perspective; the policy test verifies
// it from the module perspective. Different layers, different failure modes.

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

import { useSubmit } from '../../src/repl/useSubmit.js';
import { classify } from '../../src/classifier/classifier.js';
import { PolicyEnforcement } from '../../src/security/policy.js';
import { appendHistory } from '../../src/repl/history.js';
import { writeAuditEvent } from '../../src/audit/log.js';
import type { HistoryItem } from '../../src/repl/types.js';

// ============================================================================
// Test wrapper component
// ============================================================================

// We store results in module-level captures to read after render.
// Each test resets these before use.
let capturedSubmit: ((input: string) => void) | null = null;
let capturedHistoryItems: HistoryItem[] = [];

interface WrapperProps {
  token_id: string;
  debug: boolean;
  inputToSubmit?: string;
}

function HookWrapper({ token_id, debug, inputToSubmit }: WrapperProps): React.ReactElement {
  capturedHistoryItems = [];
  const onHistory = (item: HistoryItem) => {
    capturedHistoryItems.push(item);
  };

  const submit = useSubmit({ token_id, debug, onHistory });
  capturedSubmit = submit;

  // If inputToSubmit provided, call submit immediately on render
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
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));
    expect(capturedSubmit).not.toBeNull();

    capturedSubmit!('');

    expect(vi.mocked(classify)).not.toHaveBeenCalled();
    expect(capturedHistoryItems).toHaveLength(0);
    expect(vi.mocked(appendHistory)).not.toHaveBeenCalled();
  });

  it('T-12 — whitespace-only input is a no-op: classify not called', () => {
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));
    expect(capturedSubmit).not.toBeNull();

    capturedSubmit!('   ');

    expect(vi.mocked(classify)).not.toHaveBeenCalled();
    expect(capturedHistoryItems).toHaveLength(0);
    expect(vi.mocked(appendHistory)).not.toHaveBeenCalled();
  });

  it('T-11 — tab-only input is also a no-op: classify not called', () => {
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));
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

    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));
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

    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));
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

    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));
    capturedSubmit!(input);

    expect(capturedHistoryItems).toHaveLength(1);
    // PM-locked: display_route must NEVER be 'unknown' — always collapses to 'architectural'
    expect(capturedHistoryItems[0].decision.display_route).toBe('architectural');
    expect(capturedHistoryItems[0].decision.display_route).not.toBe('unknown');
    expect(capturedHistoryItems[0].decision.route).toBe('UNKNOWN');
  });

  // ============================================================================
  // BOUNDARY — debug=true writes audit event (T-38, SOC2)
  //
  // T-38: --debug flag causes writeAuditEvent({ type: 'preflight_called' }) to be called
  // on every non-blank pipeline execution. This is SOC2-relevant audit coverage —
  // the branch MUST be covered in tests, not masked with c8 ignore.
  //
  // Misuse mirror: debug=false must NOT call writeAuditEvent (asserted here too).
  // ============================================================================

  it('T-38 — debug=false: writeAuditEvent NOT called on submit', () => {
    vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', 'show files'));
    vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));
    capturedSubmit!('show files');

    expect(vi.mocked(writeAuditEvent)).not.toHaveBeenCalled();
  });

  it('T-38 — debug=true: writeAuditEvent called with type "preflight_called" on submit', () => {
    const input = 'show me the current directory';
    vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', input));
    vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

    render(React.createElement(HookWrapper, { token_id: 'tok-debug-001', debug: true }));
    capturedSubmit!(input);

    // SOC2 assertion: writeAuditEvent must be called with type 'preflight_called'
    // when debug=true. The c8 ignore on this branch is invalid — this test directly
    // covers it. Dev must remove /* c8 ignore next 3 */ from useSubmit.ts.
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

    render(React.createElement(HookWrapper, { token_id: 'tok-debug-multi', debug: true }));

    capturedSubmit!('first command');
    capturedSubmit!('second command');
    capturedSubmit!('third command');

    // 1:1 ratio: 3 submits → 3 writeAuditEvent calls
    expect(vi.mocked(writeAuditEvent)).toHaveBeenCalledTimes(3);
  });

  it('T-38 — debug=true, blank input: writeAuditEvent NOT called (blank guard fires first)', () => {
    render(React.createElement(HookWrapper, { token_id: 'tok-debug-blank', debug: true }));
    capturedSubmit!('');
    capturedSubmit!('   ');

    expect(vi.mocked(writeAuditEvent)).not.toHaveBeenCalled();
  });

  // ============================================================================
  // GOLDEN — SOC2 preflight call count (T-39)
  //
  // Note: T-39 also appears in tests/security/policy.test.ts at the policy-module
  // layer. The duplication is INTENTIONAL — different layers, different failure modes.
  // ============================================================================

  it('T-39 — preflight called exactly once per pipeline execution (3 submits = 3 calls)', () => {
    vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', 'test'));
    vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));

    capturedSubmit!('show me the current directory');
    capturedSubmit!('design a caching layer for a high-traffic API');
    capturedSubmit!('blorp the fleeb');

    // PM SOC2 floor: 1:1 preflight-to-execution ratio.
    expect(vi.mocked(PolicyEnforcement.preflight)).toHaveBeenCalledTimes(3);
  });

  it('T-39 — preflight NOT called for blank/whitespace inputs', () => {
    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));

    capturedSubmit!('');
    capturedSubmit!('   ');

    expect(vi.mocked(PolicyEnforcement.preflight)).not.toHaveBeenCalled();
  });

  it('appendHistory called with display_route and input on each non-blank submit', () => {
    const input = 'show me the current directory';
    vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', input));
    vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

    render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));
    capturedSubmit!(input);

    expect(vi.mocked(appendHistory)).toHaveBeenCalledOnce();
    expect(vi.mocked(appendHistory)).toHaveBeenCalledWith('mechanical', input);
  });

  // ============================================================================
  // T-49 — SOC2 hook throws → FATAL: process must EXIT NON-ZERO
  //
  // Approach: seam-level (Option ii). We spy on process.exit inside useSubmit
  // because:
  //   (a) A subprocess test can't inject a throwing preflight into the compiled
  //       or source-run binary path without special env/source hooks that don't
  //       exist yet.
  //   (b) The fatal-exit decision belongs in useSubmit (the call site of preflight),
  //       not in the ErrorBoundary — event-handler throws do NOT propagate to
  //       React's ErrorBoundary. The spec says useSubmit must call process.exit(1)
  //       (or equivalent) when preflight throws.
  //
  // Key assertions:
  //   (a) preflight throws → process.exit called with non-zero code (FATAL)
  //   (b) classify throws → process.exit NOT called (RECOVERABLE — stays in REPL)
  //   (c) stub throws → process.exit NOT called (RECOVERABLE — same as classifier)
  //
  // This test MUST FAIL against current source. In the current implementation,
  // useSubmit does NOT call process.exit when preflight throws — the error
  // propagates uncaught out of the event handler callback. The test will either:
  //   - See process.exit NOT called (the explicit red-state assertion fails), OR
  //   - The spy intercepts the throw before it propagates (also reveals no exit call).
  //
  // Dev's Option A implementation must:
  //   1. Wrap PolicyEnforcement.preflight() in a try/catch inside useSubmit.
  //   2. On catch: call process.exit(1) (or the Ink useApp().exit() equivalent
  //      with a non-zero code, documented in dev notes below).
  //   3. Wrap classify() / stub rendering in a separate try/catch that does NOT
  //      call process.exit — instead, surfaces via error state → ErrorBoundary.
  //
  // Dev notes:
  //   - process.exit(1) is the simplest correct implementation.
  //   - Ink's useApp().exit(error) does NOT exit with a non-zero code — it calls
  //     the onExit callback but the process stays alive unless something calls
  //     process.exit(). So process.exit(1) is the required path.
  //   - The spec says "REPL exits with non-zero exit code" — process.exit(1) is
  //     the definitive implementation of that requirement.
  //   - The spy uses mockImplementation to prevent actually exiting the test process.
  // ============================================================================

  describe('T-49 — SOC2/preflight failure is FATAL: process must exit non-zero', () => {
    it('T-49 (a) — preflight throws: process.exit called with non-zero code (FATAL path)', () => {
      // Arrange: valid classify, failing preflight
      vi.mocked(classify).mockReturnValue(makeClassifyMockReturn('MECHANICAL', 'show files'));
      vi.mocked(PolicyEnforcement.preflight).mockImplementation(() => {
        throw new Error('preflight failed: SOC2 policy violation');
      });

      // Spy on process.exit — prevent it from actually exiting the test process.
      // We use mockImplementation so the throw doesn't propagate either.
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        // Prevent the process from actually exiting during the test.
        // The test asserts on the spy call, not on actual process termination.
      }) as (code?: number | string | null) => never);

      render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));

      // Act: trigger submit with a valid input — this will call preflight, which throws.
      // The throw is expected; we don't expect capturedSubmit itself to throw
      // in the correct implementation (useSubmit catches it internally and calls exit).
      // In the CURRENT (broken) implementation, this call throws out of useSubmit
      // because there's no try/catch — which means the test assertion below will
      // fail because exitSpy was never called.
      try {
        capturedSubmit!('show files');
      } catch {
        // In current (broken) source: preflight throw propagates uncaught out of
        // the event handler. We swallow it here so the assertion below can run
        // and report the real failure: process.exit was NOT called.
      }

      // PRIMARY ASSERTION (T-49): process.exit must have been called with a non-zero code.
      // FAILS against current source — current useSubmit does not call process.exit.
      expect(exitSpy).toHaveBeenCalled();
      const exitCode = exitSpy.mock.calls[0]?.[0];
      expect(exitCode, 'process.exit must be called with non-zero code on preflight failure').not.toBe(0);
      expect(exitCode, 'process.exit must be called with 1 on preflight failure').toBe(1);
    });

    it('T-49 (b) — preflight throws: error message is surfaced to user (no silent failure)', () => {
      // When preflight throws, the user must see a human-readable error before the process exits.
      // This test verifies that stderr is written (or error state is set) before exit.
      //
      // Approach: spy on process.stderr.write + process.exit. The implementation should
      // write to stderr before calling process.exit(1).
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
        // no-op to prevent actual exit
      }) as (code?: number | string | null) => never);

      render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));

      try {
        capturedSubmit!('show files');
      } catch {
        // swallow propagated throw from broken source
      }

      // process.exit must have been called (covered by T-49a; asserted here too for clarity)
      expect(exitSpy).toHaveBeenCalled();

      // Human-readable error message must be written to stderr before exit (T-50: no stack trace).
      // Combined stderr output must contain a meaningful message.
      const allStderr = stderrMessages.join('');
      expect(
        allStderr.length,
        'process.stderr.write must be called with error details before exit — user must see an error',
      ).toBeGreaterThan(0);
      // T-50: no raw stack trace
      expect(allStderr).not.toMatch(/at Object\./);
      expect(allStderr).not.toMatch(/\.tsx?:\d+:\d+/);

      stderrSpy.mockRestore();
    });

    it('T-49 (c) — RECOVERABLE contrast: classifier throws → process.exit NOT called, REPL survives', () => {
      // T-47/T-48 cover the ErrorBoundary render-level recovery.
      // This test covers the useSubmit seam: classifier/stub throws must NOT call process.exit.
      // They are recoverable — the REPL continues. Only preflight is fatal.
      //
      // Note: in the CURRENT implementation, classify() throws propagate uncaught out of
      // the event handler (same bug as preflight). The correct implementation wraps classify
      // in a try/catch that surfaces the error via onError/state — NOT process.exit.
      //
      // This test PASSES today (process.exit not called when classify throws) but for the
      // wrong reason — the throw propagates out of capturedSubmit and we catch it. The
      // correct impl should catch it internally and set error state without calling exit.
      vi.mocked(classify).mockImplementation(() => {
        throw new Error('internal classifier failure');
      });
      vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        // no-op
      }) as (code?: number | string | null) => never);

      render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));

      try {
        capturedSubmit!('show files');
      } catch {
        // Classifier throw propagates in current impl — swallow here.
        // In correct impl this should NOT throw (caught internally by useSubmit).
      }

      // CRITICAL DISTINCTION: classifier failure must NOT exit the process.
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('T-49 (d) — RECOVERABLE contrast: preflight succeeds, classifier throws → no exit, history NOT written', () => {
      // Belt-and-suspenders: confirm that even when classify throws after a successful preflight,
      // we do NOT exit. History should not be written for a failed classify.
      vi.mocked(classify).mockImplementation(() => {
        throw new Error('classifier blew up');
      });
      vi.mocked(PolicyEnforcement.preflight).mockReturnValue(undefined);

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number | string | null) => never);

      render(React.createElement(HookWrapper, { token_id: 'test-token', debug: false }));

      try {
        capturedSubmit!('some input');
      } catch {
        // swallow in current impl
      }

      expect(exitSpy).not.toHaveBeenCalled();
      // History must not be written when classify failed
      expect(vi.mocked(appendHistory)).not.toHaveBeenCalled();
    });
  });
});
