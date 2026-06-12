// tests/unit/auth-probe.test.ts
//
// T-M3-6.2: Auth probe failure (exit 127, not found) → error with 'claude auth'.
// T-M3-6.3: Auth probe failure (exit 1, auth error) → error message.
// T-M3-6.4: Auth probe success (exit 0) → ok=true.
// T-M3-6.5: Auth probe invokes `claude --version`.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:child_process before importing the module
vi.mock('node:child_process');

import { runAuthProbe } from '../../src/cli/auth-probe.js';
import { spawnSync } from 'node:child_process';

const mockSpawnSync = vi.mocked(spawnSync);

beforeEach(() => {
  mockSpawnSync.mockReset();
});

describe('Auth probe unit tests', () => {
  // T-M3-6.2 — exit 127 (command not found) → error with 'claude auth'
  it('T-M3-6.2: probe returns ok=false with claude auth hint when claude not found', () => {
    mockSpawnSync.mockReturnValue({
      status: 127,
      stdout: '',
      stderr: 'command not found',
      pid: 0,
      output: [],
      signal: null,
      error: new Error('ENOENT'),
    } as ReturnType<typeof spawnSync>);

    const result = runAuthProbe();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/claude auth/i);
  });

  // T-M3-6.3 — exit 1 (authentication error) → error message
  it('T-M3-6.3: probe returns ok=false when claude exits 1 (authentication error)', () => {
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'authentication required',
      pid: 0,
      output: [],
      signal: null,
      error: undefined,
    } as ReturnType<typeof spawnSync>);

    const result = runAuthProbe();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/claude auth/i);
  });

  // T-M3-6.4 — exit 0 → ok=true
  it('T-M3-6.4: probe returns ok=true when claude --version exits 0', () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: '1.2.3',
      stderr: '',
      pid: 0,
      output: [],
      signal: null,
      error: undefined,
    } as ReturnType<typeof spawnSync>);

    const result = runAuthProbe();

    expect(result.ok).toBe(true);
  });

  // T-M3-6.5 — probe invokes `claude --version`
  it('T-M3-6.5: probe invokes claude --version', () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: '1.2.3',
      stderr: '',
      pid: 0,
      output: [],
      signal: null,
      error: undefined,
    } as ReturnType<typeof spawnSync>);

    runAuthProbe();

    expect(mockSpawnSync).toHaveBeenCalledOnce();
    const [cmd, args] = mockSpawnSync.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('claude');
    expect(args).toContain('--version');
  });
});
