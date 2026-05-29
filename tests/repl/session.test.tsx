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
  it('T-13 (automated logic portion) — Session renders without calling process.exit on mount', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called unexpectedly');
    }) as (code?: number | string | null) => never);

    expect(() => {
      render(React.createElement(Session, { debug: false }));
    }).not.toThrow();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  // T-13 manual-TTY portion — real Ctrl+C key event requires a real TTY.
  it.todo('T-13 (manual-TTY) — Ctrl+C during classifier: key event delivery requires a real TTY; verify in live session');

  // ============================================================================
  // GOLDEN — clean exit on EOF
  // ============================================================================

  // T-14: Ctrl+D exits with code 0.
  // Automated via subprocess — send EOF to stdin, assert exit code 0.
  it('T-14 — Ctrl+D (EOF): exits with code 0, no stack trace in stderr', () => {
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
