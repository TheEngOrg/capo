// tests/integration/biome-check.test.ts
//
// T-M3-10.3 — biome check src/ exits 0 (no lint violations in current src/).

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';
import { homedir, join } from 'os';

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

describe('Biome check (T-M3-10.3)', () => {
  // T-M3-10.3 — biome check src/ passes clean
  it('T-M3-10.3: biome check passes on all src/ code', () => {
    const bunExec = resolveBun();

    const result = spawnSync(bunExec, ['x', 'biome', 'check', 'src/'], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 30000,
    });

    expect(
      result.status,
      `biome check failed:\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
    ).toBe(0);
  });
});
