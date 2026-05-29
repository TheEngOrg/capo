// tests/integration/non-tty.test.ts
//
// Misuse-case: non-TTY stdin (piped input).
//
// Defect found during live binary pass (M1 Pass 1): when stdin is not a TTY
// (e.g. `printf 'show me the dir\n' | teo`), the binary produces no output,
// writes no history file, writes no audit log, and exits 0 SILENTLY.
// ink-text-input requires raw TTY mode; with piped stdin, onSubmit never fires.
// The binary silently "succeeds" while doing nothing — a lie of success.
//
// Required behavior (Option a, user-approved):
//   - Detect non-TTY stdin (process.stdin.isTTY is falsy)
//   - Write a non-empty, human-readable message to stderr that mentions
//     a terminal/TTY requirement
//   - Exit with a NON-ZERO code (ideally 1)
//   - Write NO history file (guard fires before any pipeline work)
//
// Guard placement: AFTER Commander flag handling (so --version/--help still
// work with piped stdin), BEFORE the Ink render call in src/index.tsx.
//
// Strategy: spawn the REAL entry (src/index.tsx via bun) with piped stdin
// and a non-empty input string, using D-001 resolveBun pattern.
// XDG_STATE_HOME is isolated to a temp dir to prevent FS pollution.
// Test MUST FAIL against current source (no guard exists).

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir, tmpdir } from 'os';

// ============================================================================
// D-001 resolveBun — see .claude/memory/decisions/D-001-test-binary-spawn-pattern.md
// Vitest workers run under Node, not Bun. process.execPath is Node here.
// Use which + ~/.bun/bin/bun fallback.
// ============================================================================

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
// Misuse case: non-TTY stdin (piped input)
// ============================================================================

describe('Non-TTY stdin guard (misuse case)', () => {
  // When the caller pipes input to teo, the binary must fail honestly, not
  // silently. This is the contract the guard in src/index.tsx must satisfy.
  it('exits non-zero and writes a TTY requirement message to stderr when stdin is piped', () => {
    // Isolate XDG state so no real ~/.local/state/teo pollution.
    const testStateDir = join(
      tmpdir(),
      `teo-non-tty-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    // Spawn with `input` so spawnSync opens a PIPE for stdin — not a TTY.
    // This replicates `printf 'show me the dir\n' | teo`.
    const result = spawnSync(bunExec, [entryPoint], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 10000,
      input: 'show me the dir\n',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, XDG_STATE_HOME: testStateDir },
    });

    // --- Contract assertion 1: non-zero exit ---
    // Current behavior (no guard): exits 0. This assertion is what makes
    // the test RED against current source. Dev's guard must write a non-zero
    // exit (ideally 1) before the Ink render call.
    expect(
      result.status,
      `Expected non-zero exit when stdin is piped, got ${result.status}. ` +
        `stderr: ${result.stderr ?? '(empty)'}`
    ).not.toBe(0);

    // Ideally exactly 1, but "not 0" is the hard contract.
    expect(
      result.status,
      `Expected exit code 1, got ${result.status}`
    ).toBe(1);

    // --- Contract assertion 2: stderr is non-empty and mentions TTY/terminal ---
    // The guard must write a human-readable message so callers know what went wrong.
    const stderr = result.stderr ?? '';
    expect(
      stderr,
      'Expected a non-empty stderr message explaining the TTY requirement'
    ).not.toBe('');

    expect(
      stderr,
      'Expected stderr to mention "terminal" or "tty" or "interactive"'
    ).toMatch(/terminal|tty|interactive/i);

    // --- Contract assertion 3: no stack trace in stderr ---
    // A stack trace means an unhandled exception leaked out — not a clean guard.
    // Pattern matches the shape used in T-50 and golden.test.ts Step 2/6.
    expect(stderr).not.toMatch(/at Object\./);
    expect(stderr).not.toMatch(/\.tsx?:\d+:\d+/);
    expect(stderr).not.toMatch(/Error:\s*\n\s*at/);

    // --- Contract assertion 4: no history file written ---
    // The guard must fire BEFORE any pipeline work. If a history file exists,
    // the REPL partially ran before the guard triggered — that's wrong.
    const historyFile = join(testStateDir, 'teo', 'history');
    expect(
      existsSync(historyFile),
      `History file should NOT exist when guard fires, but found: ${historyFile}`
    ).toBe(false);
  });

  // The interactive TTY path (process.stdin.isTTY === true) cannot be
  // meaningfully automated here — allocating a real PTY in a Vitest worker
  // is non-trivial and the test would be testing the PTY harness, not teo.
  // The happy path is verified in the live human session (golden path Steps 2-8).
  it.todo(
    'interactive TTY path verified in live human session — `time ./dist/teo-darwin-arm64` or `bun run src/index.tsx` at a real terminal'
  );
});

// ============================================================================
// Regression guard: --version and --help must still work with piped stdin
// ============================================================================
//
// The non-TTY guard MUST only trigger when we'd otherwise enter the interactive
// REPL. Commander's --version and --help handlers call process.exit() before
// the guard has a chance to run (guard goes AFTER parseArgs, BEFORE render).
// These tests confirm piped stdin doesn't break flag-based early exits.

describe('Flag handlers are unaffected by non-TTY stdin', () => {
  it('--version exits 0 and prints the version string even with piped stdin', () => {
    const result = spawnSync(bunExec, [entryPoint, '--version'], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 10000,
      input: 'anything\n', // piped stdin — should not matter for --version
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // --version must still work. If this breaks, the guard is in the wrong place.
    expect(
      result.status,
      `--version should exit 0 even with piped stdin, got ${result.status}. stderr: ${result.stderr}`
    ).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('--help exits 0 and prints usage text even with piped stdin', () => {
    const result = spawnSync(bunExec, [entryPoint, '--help'], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 10000,
      input: 'anything\n', // piped stdin — should not matter for --help
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // --help must still work.
    expect(
      result.status,
      `--help should exit 0 even with piped stdin, got ${result.status}. stderr: ${result.stderr}`
    ).toBe(0);
    // Commander writes help to stdout; check it has some usage content.
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    expect(output).toMatch(/usage|options|help/i);
  });
});
