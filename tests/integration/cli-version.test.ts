import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');
const pkgPath = resolve(rootDir, 'package.json');
const entryPoint = resolve(rootDir, 'src/index.tsx');

/**
 * Resolve the absolute path to the bun binary.
 *
 * Vitest workers run under Node.js even when launched via `bun run test`,
 * so process.execPath points to Node — not bun. We can't rely on ambient
 * PATH either (bun is often installed to ~/.bun/bin which isn't exported
 * to non-interactive subprocesses). Try PATH lookup first (works on CI
 * and standard installs), then fall back to the default bun install path.
 *
 * See .claude/memory/decisions/D-001-test-binary-spawn-pattern.md.
 */
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

// T-04 — --version matches package.json
// Runs against `bun src/index.tsx --version` in dev mode.
// Pass 2: also run against the compiled binary.
describe('CLI --version (T-04)', () => {
  it('exits 0 with the correct version string', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

    const result = spawnSync(bunExec, [entryPoint, '--version'], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 10000,
    });

    expect(result.status, `process exited with code ${result.status}: ${result.stderr}`).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });
});
