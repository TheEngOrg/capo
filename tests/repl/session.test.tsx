// tests/repl/session.test.tsx
//
// Pass 2: REPL session lifecycle tests T-07, T-11, T-12, T-13, T-14
// per M1-test-specs.md Category B.
//
// Tool: ink-testing-library for component-level assertions.
//       subprocess (D-001 resolveBun) for process-exit-code assertions.
//
// Manual-TTY cases marked with it.todo() — cannot be automated without a real TTY:
//   T-13 key-event half: actual Ctrl+C signal delivery requires a real TTY.
//   T-06: cold-start timing requires a real TTY.
//
// ============================================================================
// FIDELITY NOTE (FIX cycle, 2026-05-29)
// ============================================================================
//
// T-14 here tests PIPED EOF (stdin receives EOF from `input: ''` → `stdin.on('end')`
// fires → App.tsx useEffect calls exit()). This is NOT the same as an interactive
// Ctrl+D keypress in raw mode:
//   - Piped EOF:      stdin 'end' event  → App.tsx useEffect → exit(). TESTED HERE.
//   - Interactive Ctrl+D: raw \x04 byte → parseKeypress → useInput handler → exit().
//     NOT tested here. Covered by tests/repl/keys.test.tsx BUG-2.
//
// The two tests that spawn a binary with `input: ''` (T-07, T-14 / Step 2 / Step 6)
// are valid — they test the piped-EOF exit path. They are NOT tests of interactive
// Ctrl+D behavior. They were previously mislabeled as "Ctrl+D (EOF)" which implied
// coverage of the interactive key path. Labels corrected below.
//
// T-13 here tests that Session renders without calling process.exit on MOUNT.
// It does NOT deliver a Ctrl+C key event. The interactive Ctrl+C handler contract
// is tested in tests/repl/keys.test.tsx BUG-1.
// ============================================================================

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir, tmpdir } from 'os';

// D-001 pattern — see .claude/memory/decisions/D-001-test-binary-spawn-pattern.md
function resolveBun(): string {
  const fromPath = spawnSync('which', ['bun'], { encoding: 'utf8' });
  if (fromPath.status === 0 && fromPath.stdout.trim()) {
    return fromPath.stdout.trim();
  }
  const defaultPath = join(homedir(), '.bun', 'bin', 'bun');
  if (existsSync(defaultPath)) {
    return defaultPath;
  }
  throw new Error('bun not found: not in PATH and not at ~/.bun/bin/bun');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');
const entryPoint = resolve(rootDir, 'src/index.tsx');
const bunExec = resolveBun();

// ============================================================================
// Session component import — used for ink-testing-library tests
// ============================================================================

import { Session } from '../../src/repl/Session.js';

// ============================================================================
// XDG isolation helpers
// ============================================================================

let originalXdgStateHome: string | undefined;
let testStateDir: string;

beforeEach(() => {
  originalXdgStateHome = process.env.XDG_STATE_HOME;
  testStateDir = join(tmpdir(), `teo-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.XDG_STATE_HOME = testStateDir;
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
// MISUSE — things that should fail cleanly before anything works
// ============================================================================

describe('Session — REPL lifecycle (Pass 2)', () => {
  // T-07: stdin closed before REPL ready (pipe /dev/null to stdin).
  // Subprocess-level test — ink-testing-library can't exercise real EOF-before-ready.
  it('T-07 — stdin closed before REPL ready: process exits cleanly with code 0', () => {
    const result = spawnSync(bunExec, [entryPoint], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 10000,
      input: '', // empty stdin = EOF immediately
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, XDG_STATE_HOME: testStateDir },
    });

    // Should exit cleanly — no hung process, no error output about stdin
    expect(result.status, `Expected exit 0 on empty stdin, got ${result.status}. stderr: ${result.stderr}`).toBe(0);
    // No unhandled error text in stderr
    expect(result.stderr ?? '').not.toMatch(/Error:/);
    expect(result.stderr ?? '').not.toMatch(/at Object\./);
  });

  // ============================================================================
  // BOUNDARY — blank/whitespace guards
  // ============================================================================

  // T-11: blank input is a no-op — Session must render without crashing on mount.
  // Full blank-input guard is in useSubmit (see useSubmit.test.ts).
  // Here we verify the Session component renders the prompt without crashing.
  it('T-11 — blank input: Session renders prompt, does not crash', () => {
    // Session is a stub in Pass 2 — this test drives the impl requirement:
    // Session must render without throwing, even before useSubmit is wired.
    // When dev implements Session, this test will assert on actual prompt text.
    const { lastFrame } = render(React.createElement(Session, { debug: false }));
    // Must render something — not throw. When impl lands, this will be "teo> ".
    // For now we assert no crash (render returns a frame without throwing).
    expect(lastFrame()).toBeDefined();
  });

  // T-12: whitespace-only input is a no-op.
  // Session mount still renders prompt — same assertion as T-11 for component integrity.
  it('T-12 — whitespace input: Session renders, does not crash', () => {
    const { lastFrame } = render(React.createElement(Session, { debug: false }));
    expect(lastFrame()).toBeDefined();
  });

  // T-13: Ctrl+C during classifier interrupts, returns to prompt.
  // The cancellation LOGIC is unit-testable; the actual key event requires a real TTY.
  // When Session impl lands, the useInput handler for Ctrl+C must: not call process.exit(),
  // and the component must continue accepting input.
  //
  // Automated portion: Session renders without crashing (component exists for hook wiring).
  //
  // FIDELITY NOTE: This test does NOT deliver a Ctrl+C key event. It only verifies
  // that mounting Session does not call process.exit. Interactive Ctrl+C key-handler
  // logic is tested in tests/repl/keys.test.tsx (BUG-1 tests).
  it('T-13 (automated: mount only — does NOT test Ctrl+C key event) — Session renders without calling process.exit on mount', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called unexpectedly');
    }) as (code?: number | string | null) => never);

    expect(() => {
      render(React.createElement(Session, { debug: false }));
    }).not.toThrow();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  // T-13 manual-TTY portion — real Ctrl+C key event requires a real TTY.
  // Key-handler logic (useInput, no exit called) is covered in keys.test.tsx BUG-1.
  it.todo('T-13 (manual-TTY) — Ctrl+C during classifier: key event delivery requires a real TTY; verify in live session. See also keys.test.tsx BUG-1 for handler-logic coverage.');

  // ============================================================================
  // GOLDEN — clean exit on EOF
  // ============================================================================

  // T-14: Piped EOF exits with code 0.
  // Automated via subprocess — send empty piped stdin (EOF), assert exit code 0.
  //
  // FIDELITY NOTE: This tests the PIPED EOF code path (`stdin.on('end')` in App.tsx),
  // NOT the interactive Ctrl+D key event (\x04 byte in raw mode). These are distinct:
  //   - Piped EOF (tested here): `input: ''` → stdin 'end' event → App.tsx useEffect → exit(0).
  //   - Interactive Ctrl+D (NOT tested here): raw \x04 keystroke → useInput handler needed.
  // The interactive Ctrl+D path has a BUG (inserts 'd', does not exit). See keys.test.tsx BUG-2.
  it('T-14 — piped EOF (NOT interactive Ctrl+D): exits with code 0, no stack trace in stderr', () => {
    const result = spawnSync(bunExec, [entryPoint], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 10000,
      input: '', // EOF on stdin
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, XDG_STATE_HOME: testStateDir },
    });

    expect(result.status, `Expected exit 0 on EOF, got ${result.status}. stderr: ${result.stderr}`).toBe(0);

    // No stack trace in stderr (T-50)
    const stderr = result.stderr ?? '';
    expect(stderr).not.toMatch(/at Object\./);
    expect(stderr).not.toMatch(/\.ts:\d+:\d+/);
    expect(stderr).not.toMatch(/at .+\(\s*.+\.tsx?:\d+:\d+\s*\)/);
  });
});
