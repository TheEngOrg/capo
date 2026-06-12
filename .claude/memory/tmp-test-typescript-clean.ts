// tests/integration/typescript-clean.test.ts
//
// T-M3-11.1 — tsc --noEmit passes with exit code 0.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';
import { homedir } from 'os';
import { join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');

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

describe('TypeScript compilation (T-M3-11.1)', () => {
  it('T-M3-11.1: tsc --noEmit passes with exit code 0', () => {
    const bunExec = resolveBun();

    const result = spawnSync(bunExec, ['x', 'tsc', '--noEmit'], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 60000,
    });

    expect(
      result.status,
      `tsc --noEmit failed:\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
    ).toBe(0);
  });
});
