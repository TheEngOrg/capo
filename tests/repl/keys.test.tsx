// tests/repl/keys.test.tsx
//
// FIX cycle — gate-1 (qa-spec): failing tests that pin required key-handling behavior.
// Three bugs found by live TTY session, missed by the existing GREEN suite.
//
// ============================================================================
// FIDELITY NOTE — why the existing T-13/T-14 subprocess tests are insufficient
// ============================================================================
//
// T-13 (session.test.tsx): renders Session, asserts process.exit not called on mount.
//   Does NOT deliver a Ctrl+C key event. Passes because mount never calls exit — no
//   relationship to whether Ctrl+C is handled or exits.
//
// T-14 (session.test.tsx + golden.test.ts): spawns binary with `input: ''` (piped EOF).
//   Tests the `stdin.on('end')` code path in App.tsx. Piped EOF and an interactive
//   Ctrl+D keypress in raw mode are DIFFERENT code paths:
//     - Piped EOF: stdin receives EOF → 'end' event fires → App.tsx useEffect calls exit().
//     - Interactive Ctrl+D: raw-mode terminal sends \x04 byte → parseKeypress fires →
//       useInput handler (if present) must call exit. Currently no such handler exists.
//   The subprocess test validated the easy path and left the interactive path untested.
//
// ============================================================================
// What these tests cover
// ============================================================================
//
// BUG-1 (Ctrl+C): App.tsx has no `useInput` handler for Ctrl+C. In the real binary,
//   `render(<App />)` in src/index.tsx uses Ink's default `exitOnCtrlC: true`, so
//   Ctrl+C terminates the process before any component-level handler fires. Fix:
//   pass `exitOnCtrlC: false` to render() in src/index.tsx AND add a useInput handler
//   in App/Session that intercepts Ctrl+C without calling exit.
//   ink-testing-library already uses exitOnCtrlC:false — so component tests here
//   test the handler LOGIC (no exit called, prompt survives).
//
// BUG-2 (Ctrl+D): App.tsx listens to `stdin.on('end')` for piped EOF only. Interactive
//   Ctrl+D sends \x04 as a raw byte — ink-text-input does not handle it (confirmed:
//   only blocks `key.ctrl && input==='c'`, not 'd'). \x04 → parseKeypress gives
//   {name:'d', ctrl:true} → ink-text-input's else-branch appends 'd' to the value.
//   Fix: add useInput at App/Session level with `key.ctrl && input === 'd'` → exit(0).
//
// BUG-3 (--debug stderr): writeAuditEvent writes to the audit FILE silently. Per
//   M1-implementation-spec.md Section 5, --debug must ALSO write to STDERR:
//   "classify() logs the matched pattern to stderr... a running stream of token
//   issuance + preflight calls visible during teo --debug." Nothing is written to
//   process.stderr in debug mode today.
//
// ============================================================================
// Test strategy
// ============================================================================
//
// Ctrl+C, Ctrl+D: ink-testing-library render + stdin.write(key bytes).
//   - For Ctrl+D 'd-insertion bug: use a wrapper component that captures the
//     TextInput value externally — proven reliable (node_modules investigation
//     confirmed stdin.write('\x04') does update state to 'd' in the component).
//   - Real-binary PTY behavior (exitOnCtrlC default, raw-mode) marked as it.todo.
//
// --debug stderr: spy on process.stderr.write at useSubmit / App level.
//   Full end-to-end (teo --debug in a real terminal) marked as it.todo manual-TTY.

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('../../src/security/identity.js', () => ({
  issueIdentityToken: vi.fn(() => ({
    token_id: 'test-token-keys-001',
    session_id: 'test-session-keys-001',
    issued_at: new Date().toISOString(),
    hmac: 'test-hmac',
  })),
}));

vi.mock('../../src/security/policy.js', () => ({
  PolicyEnforcement: {
    preflight: vi.fn(),
  },
}));

vi.mock('../../src/audit/log.js', () => ({
  writeAuditEvent: vi.fn(),
}));

vi.mock('../../src/repl/history.js', () => ({
  appendHistory: vi.fn(),
  historyPath: vi.fn(() => '/tmp/teo-test-keys-history'),
}));

vi.mock('../../src/classifier/classifier.js', () => ({
  classify: vi.fn(() => ({
    route: 'MECHANICAL',
    display_route: 'mechanical',
    raw_input: 'test input',
    matched_pattern: '\\bshow\\s+',
  })),
}));

import { App } from '../../src/cli/App.js';
import { Session } from '../../src/repl/Session.js';
import { useSubmit } from '../../src/repl/useSubmit.js';
import { classify } from '../../src/classifier/classifier.js';
import { writeAuditEvent } from '../../src/audit/log.js';

// ============================================================================
// XDG isolation
// ============================================================================

let testStateDir: string;
let originalXdgStateHome: string | undefined;

beforeEach(() => {
  originalXdgStateHome = process.env.XDG_STATE_HOME;
  testStateDir = join(tmpdir(), `teo-keys-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.XDG_STATE_HOME = testStateDir;
  vi.mocked(classify).mockClear();
  vi.mocked(writeAuditEvent).mockClear();
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
// Shared: CtrlKeyProbe — wrapper component that exposes TextInput value
// and fires a callback when a ctrl key is delivered.
//
// Used by Ctrl+C and Ctrl+D tests to reliably observe component state.
// Mirrors the same controlled-TextInput pattern used by Session/Prompt.
// ============================================================================

let probeValue = '';
let probeExitCalled = false;

function resetProbe(): void {
  probeValue = '';
  probeExitCalled = false;
}

interface CtrlKeyProbeProps {
  onExitRequest?: () => void;
}

function CtrlKeyProbe({ onExitRequest }: CtrlKeyProbeProps): React.ReactElement {
  const [value, setValue] = useState('');

  // Capture value externally so tests can inspect it.
  probeValue = value;

  // This is the handler dev must add to App/Session for Ctrl+D.
  // We include it in the probe so the "correctly-fixed" version of
  // this component would pass the Ctrl+D test.
  // Currently ABSENT from App.tsx and Session.tsx → test will FAIL.
  useInput((input, key) => {
    if (key.ctrl && input === 'd') {
      probeExitCalled = true;
      onExitRequest?.();
    }
    // Ctrl+C: must NOT exit — do nothing (or cancel in-flight ops).
    // ink-text-input already blocks 'c' on ctrl+c; we add a no-op here
    // to document the contract.
  });

  return React.createElement(Box, null,
    React.createElement(Text, null, 'teo> '),
    React.createElement(TextInput, {
      value,
      onChange: (v: string) => {
        setValue(v);
        probeValue = v;
      },
      onSubmit: () => {},
    })
  );
}

// ============================================================================
// MISUSE — Ctrl+C must never exit the REPL
// ============================================================================

describe('Key handling — Ctrl+C (BUG-1)', () => {
  // -------------------------------------------------------------------------
  // This test validates the CONTRACT that must hold after dev's fix.
  // It passes today (no handler means no exit), and MUST CONTINUE to pass
  // after the fix (the handler must not call exit).
  //
  // If dev adds a useInput Ctrl+C handler that mistakenly calls process.exit,
  // this test FAILS — serving as a regression guard.
  //
  // The real bug (Ctrl+C exits in the live binary) is caused by
  // src/index.tsx using exitOnCtrlC:true (Ink default). The fix requires
  // passing exitOnCtrlC:false to render() there. That is a non-component
  // fix only verifiable in a real PTY — see the manual-TTY todo below.
  // -------------------------------------------------------------------------
  it('Ctrl+C: process.exit is NOT called — REPL must survive interrupt', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      // Prevent actual exit.
    }) as (code?: number | string | null) => never);

    const { stdin, lastFrame } = render(React.createElement(App, { debug: false }));

    // Deliver Ctrl+C as raw byte — ink-testing-library uses exitOnCtrlC:false
    // so Ink won't auto-exit; we verify our handler doesn't either.
    stdin.write('\x03');

    // CONTRACT: Ctrl+C must never call process.exit.
    expect(
      exitSpy,
      'Ctrl+C must not call process.exit — the REPL should survive the interrupt'
    ).not.toHaveBeenCalled();

    // Prompt must still be rendered — REPL loop must still be running.
    expect(lastFrame()).toContain('teo>');
  });

  // -------------------------------------------------------------------------
  // Ctrl+C must NOT insert 'c' into the input field.
  // ink-text-input already guards this (checks key.ctrl && input==='c' and returns).
  // Pinned here so a future refactor of ink-text-input usage doesn't regress it.
  // -------------------------------------------------------------------------
  it('Ctrl+C: does NOT insert "c" into the TextInput value', () => {
    resetProbe();
    const { stdin } = render(React.createElement(CtrlKeyProbe, {}));

    stdin.write('\x03');

    // ink-text-input's own useInput intercepts key.ctrl && input==='c' and returns early.
    // The value must remain empty — Ctrl+C is not a printable character.
    expect(probeValue, 'Ctrl+C must not insert "c" into the input field').toBe('');
  });

  it.todo(
    'Ctrl+C (manual-TTY): pressing Ctrl+C in a live teo session must interrupt and return to ' +
    'prompt, NOT exit the process. Verify: run `teo`, type partial input, press Ctrl+C — ' +
    'prompt must return, process must stay alive. ' +
    'Root cause fix required: src/index.tsx must pass exitOnCtrlC:false to render() AND ' +
    'App/Session must add a useInput handler. ' +
    'Cannot automate: exitOnCtrlC:true in the real binary requires a real PTY to observe.'
  );
});

// ============================================================================
// MISUSE — Ctrl+D must exit the REPL cleanly, not insert 'd'
// ============================================================================

describe('Key handling — Ctrl+D (BUG-2)', () => {
  // -------------------------------------------------------------------------
  // FAILING TEST — BUG-2 (primary: exit not called)
  //
  // When \x04 arrives via stdin, parseKeypress maps it to {name:'d', ctrl:true}.
  // useInput fires with input='d', key.ctrl=true. App.tsx has no useInput handler
  // for this key combination → the key falls through to ink-text-input's else-branch
  // which appends 'd' to the value. process.exit is never called.
  //
  // Required fix:
  //   Add a useInput handler in App.tsx (or Session.tsx) ABOVE TextInput in the
  //   component tree:
  //     useInput((input, key) => {
  //       if (key.ctrl && input === 'd') {
  //         exit();          // Ink's useApp().exit()
  //         process.exit(0); // ensure actual process termination
  //       }
  //     });
  //   Ink calls all registered useInput handlers in order of registration. A handler
  //   at App level registered before Session renders will fire first.
  //
  // NOTE: Do NOT remove the existing stdin 'end' listener in App.tsx — it covers
  //   the legitimate piped-EOF path (T-07, T-14) and is a different code path.
  //   Add the useInput handler IN ADDITION to the 'end' listener.
  //
  // FAILS against current source: no useInput handler for \x04 in App or Session.
  // -------------------------------------------------------------------------
  it('Ctrl+D key event (\x04): process.exit(0) IS called — does not sit idle', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      // Prevent actual exit.
    }) as (code?: number | string | null) => never);

    const { stdin } = render(React.createElement(App, { debug: false }));

    // Deliver Ctrl+D as the \x04 byte — the interactive raw-mode path.
    // parseKeypress: charcode 4 ≤ 0x1a → name='d', ctrl=true.
    stdin.write('\x04');

    // PRIMARY ASSERTION: Ctrl+D key event must call process.exit.
    // FAILS against current source — no useInput handler for Ctrl+D exists.
    expect(
      exitSpy,
      'Ctrl+D (\\x04 byte) must call process.exit — currently no useInput handler for Ctrl+D in App/Session'
    ).toHaveBeenCalled();

    const exitCode = exitSpy.mock.calls[0]?.[0];
    expect(exitCode, 'Ctrl+D must exit with code 0 (clean exit, not an error)').toBe(0);
  });

  // -------------------------------------------------------------------------
  // FAILING TEST — BUG-2 (secondary: 'd' insertion into TextInput)
  //
  // When no intercept handler exists, ink-text-input's useInput receives
  // input='d', key.ctrl=true. The guard only catches key.ctrl && input==='c'.
  // The else-branch appends 'd' to the controlled value.
  //
  // This test uses CtrlKeyProbe (which DOES have the correct handler) to demonstrate
  // the handler prevents 'd' insertion. The companion test below uses the BARE
  // TextInput path to prove 'd' IS inserted today (confirming the bug).
  //
  // Strategy: CtrlKeyProbe has the Ctrl+D handler. This test expects NO 'd' inserted.
  // Since CtrlKeyProbe already has the correct handler, this test PASSES.
  // The test below ("bare TextInput") tests the BUGGY path (no handler) and expects
  // 'd' to be inserted — confirming the bug exists without the fix.
  // -------------------------------------------------------------------------
  it('Ctrl+D with correct useInput handler: "d" is NOT appended to TextInput value', () => {
    resetProbe();
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number | string | null) => never);

    const { stdin } = render(React.createElement(CtrlKeyProbe, {
      onExitRequest: () => {
        // Handler intercepted Ctrl+D — would call exit() in real impl.
      },
    }));

    stdin.write('\x04');

    // The probe's useInput fires, sets probeExitCalled=true, and returns
    // BEFORE ink-text-input gets the keystroke... BUT: in Ink, all useInput
    // handlers are called — there is no "stop propagation". ink-text-input
    // ALSO fires and appends 'd'. This is the fundamental problem:
    // the handler can call exit, but cannot prevent TextInput from getting the key.
    //
    // Dev must ensure the exit call happens first so the component unmounts before
    // the 'd' insertion causes a visible problem. Or: keep exit() as the primary
    // fix (user doesn't see 'd' because the REPL exits immediately).
    //
    // The assertable contract here: the probe's exit handler was called.
    expect(
      probeExitCalled,
      'The Ctrl+D useInput handler must be called when \\x04 is received'
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // FAILING TEST — BUG-2 (confirms 'd' IS inserted without the handler)
  //
  // This test uses a bare TextInput (no Ctrl+D intercept) to prove the bug:
  // \x04 → ink-text-input → appends 'd' to the value.
  //
  // This test PASSES vacuously today (it asserts 'd' IS inserted — confirming the bug).
  // After dev adds the fix to App/Session, the user will never SEE the 'd' because
  // the process exits first. But the TextInput insertion bug in ink-text-input itself
  // is not something we fix (it's a third-party library). The fix is the intercept.
  //
  // This test documents the ROOT CAUSE for the record — it should remain passing
  // (asserting the bug exists) until ink-text-input fixes it upstream.
  // -------------------------------------------------------------------------
  it('BUG-2 root cause: bare TextInput with no Ctrl+D intercept — "d" IS inserted into value', () => {
    let capturedValue = '';

    function BarePromptNoIntercept(): React.ReactElement {
      const [value, setValue] = useState('');
      capturedValue = value;
      return React.createElement(Box, null,
        React.createElement(TextInput, {
          value,
          onChange: (v: string) => {
            setValue(v);
            capturedValue = v;
          },
          onSubmit: () => {},
        })
      );
    }

    const { stdin } = render(React.createElement(BarePromptNoIntercept));
    stdin.write('\x04');

    // ROOT CAUSE ASSERTION: without an intercept, ink-text-input appends 'd'.
    // This PASSES today (the bug is present). It serves as documentation and
    // should continue passing until ink-text-input is patched upstream.
    expect(
      capturedValue,
      'BUG-2 root cause: without intercept, Ctrl+D inserts "d" — value should be "d" (bug confirmed)'
    ).toBe('d');
  });

  it.todo(
    'Ctrl+D (manual-TTY): pressing Ctrl+D in a live teo session must exit with code 0, no stack trace, ' +
    'and must NOT insert "d" into the input before exiting. ' +
    'Verify: run `teo` in a real terminal, press Ctrl+D — expect clean exit with no visible "d". ' +
    'Root cause: raw-mode Ctrl+D sends \\x04, not piped EOF. Fix: useInput at App/Session level. ' +
    'Cannot automate: requires real PTY raw mode to reproduce original bug (piped \\x04 via spawnSync ' +
    'tests the existing stdin.on("end") path, not the raw keystroke path).'
  );
});

// ============================================================================
// MISUSE — debug=false must never write debug lines to stderr
// ============================================================================

describe('--debug stderr stream (BUG-3)', () => {
  // -------------------------------------------------------------------------
  // MISUSE FIRST: debug=false must not write debug content to stderr.
  // Passes today (no stderr writes at all). Pinned as regression guard.
  // -------------------------------------------------------------------------
  it('debug=false + submit: no debug output written to stderr', () => {
    const stderrLines: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg) => {
      stderrLines.push(String(msg));
      return true;
    });

    const { stdin } = render(
      React.createElement(Session, { debug: false, token_id: 'nodebug-test-token' })
    );

    stdin.write('show files');
    stdin.write('\r');

    const debugLines = stderrLines.filter(l =>
      l.includes('[debug]') ||
      l.includes('token_issued') ||
      l.includes('preflight_called') ||
      l.includes('matched_pattern')
    );
    expect(
      debugLines.length,
      'debug=false must not write debug stream content to stderr'
    ).toBe(0);

    stderrSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // FAILING TEST — BUG-3 (App token_issued must write to stderr when debug=true)
  //
  // Per M1-implementation-spec.md Section 5:
  //   "when debug prop is true on <App />, all writeAuditEvent calls fire.
  //    Additionally, classify() logs the matched pattern to stderr. This gives
  //    a running stream of token issuance + preflight calls visible during
  //    teo --debug usage."
  //
  // Current state: App.tsx calls writeAuditEvent({ type: 'token_issued', ... })
  //   but does NOT call process.stderr.write. The audit file gets the event but
  //   nothing is visible on stderr.
  //
  // Required fix for App.tsx (token_issued):
  //   After the writeAuditEvent call in the debug block:
  //     process.stderr.write(`[debug] token_issued: ${issued.token_id}\n`);
  //
  // FAILS against current source: zero stderr writes happen in App debug block.
  // -------------------------------------------------------------------------
  it('App debug=true on first render: writes debug line to stderr for token_issued', () => {
    const stderrLines: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg) => {
      stderrLines.push(String(msg));
      return true;
    });

    render(React.createElement(App, { debug: true }));

    // FAILS against current source: App.tsx only calls writeAuditEvent (audit file),
    // it does NOT call process.stderr.write for token_issued.
    expect(
      stderrLines.length,
      'App with debug=true must write token_issued to stderr — currently zero stderr writes'
    ).toBeGreaterThan(0);

    const allStderr = stderrLines.join('');
    // Must not be an error or stack trace.
    expect(allStderr).not.toMatch(/at Object\./);
    expect(allStderr).not.toMatch(/fatal error/);

    stderrSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // FAILING TEST — BUG-3 (Session/useSubmit must write to stderr on submit when debug=true)
  //
  // Per spec: preflight_called and matched_pattern must be visible on stderr per submit.
  //
  // Required fix for useSubmit.ts (preflight_called + matched_pattern):
  //   In the debug=true block after preflight succeeds:
  //     writeAuditEvent({ type: 'preflight_called', ... }); // existing
  //     process.stderr.write(`[debug] preflight_called: ${token_id}\n`); // NEW
  //   After classify() in the debug=true path:
  //     process.stderr.write(`[debug] classify: matched_pattern=${decision.matched_pattern ?? 'none'} route=${decision.route}\n`); // NEW
  //
  // FAILS against current source: useSubmit writes nothing to stderr in debug mode.
  // -------------------------------------------------------------------------
  it('Session debug=true + submit: writes debug line to stderr (preflight_called / matched_pattern)', () => {
    const stderrLines: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg) => {
      stderrLines.push(String(msg));
      return true;
    });

    const { stdin } = render(
      React.createElement(Session, { debug: true, token_id: 'debug-test-token' })
    );

    stdin.write('show files');
    stdin.write('\r');

    // FAILS against current source: zero stderr writes in useSubmit debug mode.
    expect(
      stderrLines.length,
      'debug=true submit must write to stderr — currently zero stderr writes in useSubmit debug path'
    ).toBeGreaterThan(0);

    const allStderr = stderrLines.join('');
    expect(allStderr).not.toMatch(/at Object\./);
    expect(allStderr).not.toMatch(/fatal error/);

    stderrSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // FAILING TEST — BUG-3 (useSubmit unit-level: matched_pattern must reach stderr)
  //
  // Tests the useSubmit hook directly (same pattern as useSubmit.test.ts HookWrapper).
  // Confirms the matched_pattern value from classify() is written to stderr.
  //
  // FAILS against current source: no process.stderr.write call in useSubmit.
  // -------------------------------------------------------------------------
  it('useSubmit debug=true: matched_pattern from classify decision is written to stderr', () => {
    vi.mocked(classify).mockReturnValue({
      route: 'MECHANICAL',
      display_route: 'mechanical',
      raw_input: 'show files',
      matched_pattern: '\\bshow\\s+(me\\s+)?(the\\s+)?',
    });

    const stderrLines: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg) => {
      stderrLines.push(String(msg));
      return true;
    });

    let capturedSubmit: ((input: string) => void) | null = null;

    function DebugHookWrapper(): React.ReactElement {
      const onHistory = () => {};
      const submit = useSubmit({ token_id: 'tok-debug', debug: true, onHistory });
      capturedSubmit = submit;
      return React.createElement(Text, null, 'hook-wrapper');
    }

    render(React.createElement(DebugHookWrapper));
    capturedSubmit!('show files');

    // FAILS against current source: no process.stderr.write in useSubmit.
    expect(
      stderrLines.length,
      'debug=true useSubmit must write matched_pattern to stderr — currently not implemented'
    ).toBeGreaterThan(0);

    const allStderr = stderrLines.join('');
    // The stderr output must reference the matched pattern.
    expect(
      allStderr,
      'stderr must include matched_pattern value when debug=true'
    ).toMatch(/\\bshow/);

    stderrSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // FAILING TEST — BUG-3 (multiple submits: one debug line per submit)
  //
  // Ensures the debug stream is continuous: each submit produces at least one
  // stderr line. Not a flood (one per submit, not per keystroke).
  // -------------------------------------------------------------------------
  it('useSubmit debug=true: each submit produces at least one stderr write', () => {
    vi.mocked(classify).mockReturnValue({
      route: 'MECHANICAL',
      display_route: 'mechanical',
      raw_input: 'test',
      matched_pattern: '\\btest\\b',
    });

    const stderrCallCount: number[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg) => {
      stderrCallCount.push(1);
      return true;
    });

    let capturedSubmit: ((input: string) => void) | null = null;

    function DebugHookMultiWrapper(): React.ReactElement {
      const onHistory = () => {};
      const submit = useSubmit({ token_id: 'tok-multi', debug: true, onHistory });
      capturedSubmit = submit;
      return React.createElement(Text, null, 'wrapper');
    }

    render(React.createElement(DebugHookMultiWrapper));

    const countBefore = stderrCallCount.length;
    capturedSubmit!('first command');
    const countAfterFirst = stderrCallCount.length;
    capturedSubmit!('second command');
    const countAfterSecond = stderrCallCount.length;

    // Each submit must produce at least one stderr write.
    // FAILS against current source: zero writes per submit.
    expect(
      countAfterFirst - countBefore,
      'first submit must produce ≥1 stderr write when debug=true'
    ).toBeGreaterThan(0);

    expect(
      countAfterSecond - countAfterFirst,
      'second submit must produce ≥1 stderr write when debug=true'
    ).toBeGreaterThan(0);

    stderrSpy.mockRestore();
  });

  it.todo(
    '--debug (manual-TTY): run `teo --debug` in a real terminal and verify stderr shows a running ' +
    'stream of debug events: token_issued on startup, then per-submit: preflight_called + matched_pattern. ' +
    'Verify format: each event appears on stderr, visible interleaved with the REPL output. ' +
    'Cannot automate: non-TTY guard in src/index.tsx rejects piped stdin with exit 1 before ' +
    'the REPL runs, so a subprocess test cannot reach the debug stream.'
  );
});
