# D-001 — Test Binary Spawn Pattern

**Date:** 2026-05-28
**Author:** dev
**Status:** Active
**Applies to:** Integration tests that spawn the bun runtime as a subprocess

---

## The Problem

When an integration test needs to invoke `bun src/index.tsx --flag` as a subprocess, the naive approach is:

```ts
spawnSync('bun', ['run', entryPoint, '--flag'], { ... })
```

This works locally when `bun` is on the developer's `PATH`. It fails silently on machines where `bun` isn't on the subprocess `PATH` at Vitest runtime — CI runners, fresh installs, and environments where `bun` is installed under a user-local path (like `~/.bun/bin/`) that isn't exported to non-interactive shells.

When `spawnSync` can't find the executable, it returns `status: null` and sets `error.code = 'ENOENT'`. The test assertion `expect(result.status).toBe(0)` then fails with `expected null to be +0` — which is confusing because it looks like a runtime error, not a path resolution failure.

---

## The Decision

Use a `resolveBun()` helper that tries PATH lookup first, then falls back to the default Bun install location.

```ts
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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

// Then in the test:
const result = spawnSync(bunExec, [entryPoint, '--flag'], {
  cwd: rootDir,
  encoding: 'utf8',
  timeout: 10000,
});
```

Note: invoke `bunExec` directly with the entrypoint path — no `'run'` subcommand. Bun executes `.tsx` files directly. `run` is for npm scripts.

---

## Why resolveBun() (not process.execPath)

### What we tried first

**`process.execPath`** — Seemed right: it's the path of the binary that launched the process. But it failed in practice. When `bun run test` launches Vitest, Bun hands off execution to Vitest which runs its worker threads under Node.js (v22 in this project). `process.execPath` inside a Vitest worker is the Node binary — not Bun. Calling `spawnSync(nodePath, [entryPoint, '--version'])` invokes Node on the entrypoint, which fails because Node can't handle the Bun-specific imports in `src/index.tsx`.

**`'bun'` (ambient PATH)** — The original defect. Works in dev environments where `bun` was installed via Homebrew or Volta (both put binaries in PATH). Fails on machines where Bun was installed via the default installer (`curl https://bun.sh/install | bash`), which puts the binary in `~/.bun/bin/` — a path not exported to non-interactive subprocess environments.

**`Bun.which('bun')`** — Bun-specific API. Vitest workers run under Node, so `Bun` is undefined. Would throw at module load time.

**`Bun.argv[0]`** — Same problem. Bun-specific global, unavailable in Node-based Vitest workers.

### Why resolveBun() wins

It's not clever — that's the point. Two ordered fallbacks that cover every realistic environment:

1. **`which bun`** — Works on CI (bun is installed and in PATH by the CI setup step) and on dev machines with Homebrew/Volta/nvm-bun installs that put the binary in a PATH-visible location.

2. **`~/.bun/bin/bun`** — Works on dev machines that used the default Bun install script (`curl https://bun.sh/install | bash`), which puts bun here. Not in PATH for non-interactive subprocesses, but the path is deterministic.

3. **Throw with a clear error** — If neither works, the test fails with a message that says exactly why and what to do, instead of a cryptic `ENOENT` or `status: null`.

The three cases it covers cleanly: CI runner, default bun install, PATH-based install. That's the full real-world distribution.

---

## When to Apply This Pattern

Use `resolveBun()` any time an integration test needs to spawn the bun runtime as a subprocess:

- Invoking the CLI in dev mode: `spawnSync(bunExec, ['src/index.tsx', ...])`
- Running a bun script from a test
- Any integration test that needs to run TypeScript source directly via bun

**Don't** use this for spawning unrelated binaries (`git`, `tsc`, `curl`). Those resolve fine via ambient PATH. `resolveBun()` is specifically for cases where the test needs the bun runtime itself.

**Don't duplicate `resolveBun()`** — if this pattern grows across many integration test files, extract it into `tests/helpers/bun.ts` and import from there. For now (two files), inline is fine.

---

## Files Changed

- `tests/integration/cli-version.test.ts` — replaced `spawnSync('bun', ...)` with `spawnSync(bunExec, ...)` using the `resolveBun()` helper
- `tests/integration/cli-help.test.ts` — same

---

## Related

- DEFECT-1 in `docs/specs/M1-pass-1-validation.md` — the qa finding that prompted this fix
- FU-7 in `.claude/memory/project-context-current-session.md` — the "decisions-as-common-knowledge" framework this file is the first instance of
