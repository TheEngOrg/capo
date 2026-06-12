// tests/integration/auth-probe.test.ts
//
// T-M3-6.1: Auth probe failure path — spawn binary with PATH=/nonexistent.
//   claude unreachable → exit 1, stderr contains 'claude auth', no 'teo>' prompt.
// T-M3-6.6: Auth probe success path — spawn binary with real PATH.
//   Skip if SKIP_LLM_INTEGRATION=1.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');
const entryPoint = resolve(rootDir, 'src/index.tsx');

// D-001 pattern
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

const bunExec = resolveBun();

describe('Auth probe integration (T-M3-6.1, T-M3-6.6)', () => {
  // T-M3-6.1 — Auth probe fails when claude is unreachable
  // PATH=/nonexistent makes `claude --version` exit with ENOENT/127.
  // The binary must: exit 1, write 'claude auth' to stderr, not show 'teo>'.
  it('T-M3-6.1: binary exits 1 with claude auth hint when PATH has no claude', () => {
    const testStateDir = join(
      tmpdir(),
      `teo-auth-probe-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    const result = spawnSync(bunExec, [entryPoint], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 10000,
      input: '',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: '/nonexistent',
        XDG_STATE_HOME: testStateDir,
      },
    });

    // Exit non-zero (must be 1 per spec)
    expect(result.status, `Expected exit 1, got ${result.status}. stderr: ${result.stderr ?? ''}`).toBe(1);

    // Must mention 'claude auth' in stderr
    expect(
      result.stderr ?? '',
      'Expected stderr to contain "claude auth"'
    ).toContain('claude auth');

    // REPL prompt must NOT appear
    expect(result.stdout ?? '').not.toContain('teo>');

    // No stack trace
    expect(result.stderr ?? '').not.toMatch(/at Object\./);
    expect(result.stderr ?? '').not.toMatch(/\.tsx?:\d+:\d+/);
  });

  // T-M3-6.6 — Auth probe succeeds → no auth error output (skip if no claude)
  it('T-M3-6.6: binary exits 0 without auth error when claude is available', () => {
    if (process.env.SKIP_LLM_INTEGRATION === '1') {
      console.log('Skipping T-M3-6.6: SKIP_LLM_INTEGRATION=1');
      return;
    }

    // Check if claude is available in PATH
    const whichClaude = spawnSync('which', ['claude'], { encoding: 'utf8' });
    if (whichClaude.status !== 0) {
      console.log('Skipping T-M3-6.6: claude not in PATH');
      return;
    }

    const testStateDir = join(
      tmpdir(),
      `teo-auth-probe-success-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );

    const result = spawnSync(bunExec, [entryPoint], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 10000,
      input: '', // EOF immediately
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, XDG_STATE_HOME: testStateDir },
    });

    // When auth succeeds and stdin is EOF, binary exits 0
    expect(result.status, `Expected exit 0, got ${result.status}. stderr: ${result.stderr ?? ''}`).toBe(0);

    // No auth error message
    expect(result.stderr ?? '').not.toContain('claude auth');
  });
});
