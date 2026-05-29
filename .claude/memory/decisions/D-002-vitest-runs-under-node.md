# D-002 — Vitest Workers Run Under Node

**Date:** 2026-05-28
**Author:** dev
**Status:** Active
**Applies to:** All tests in `tests/` that run via `bun run test` / `bun run vitest`

---

## The Problem

When you launch tests with `bun run test`, Bun runs the `vitest` binary. But Vitest's worker pool runs test code under **Node**, not Bun. Inside a Vitest worker:

- `process.execPath` is the Node binary path (e.g., `/usr/local/bin/node`) — not the Bun binary
- The `Bun` global is `undefined`
- `Bun.which()`, `Bun.argv`, `Bun.file()` all throw at call time
- `import 'bun:*'` module imports fail with a module-not-found error

This caught us during DEFECT-1 investigation: `process.execPath` inside a Vitest worker returned the Node path, which is why using it to spawn the `teo` binary from a test would have invoked Node on a TypeScript entry point — not Bun.

If you don't know this going in, the failure mode is confusing. The test file itself has no obvious Node dependency. The error often looks like a missing import or a silent wrong-binary spawn rather than "Vitest's worker is Node."

---

## The Decision

For test-side logic inside Vitest workers, use Node-compatible APIs only.

Specifically:

- **Path resolution:** `import { existsSync } from 'fs'`, `import { join } from 'path'`, `import { homedir } from 'os'` — these all work fine
- **Spawning Bun as a subprocess:** use the `resolveBun()` helper from D-001 — it does a `which bun` + `~/.bun/bin/bun` fallback, both of which work from Node
- **Process info:** `process.env`, `process.cwd()`, `process.platform` — all work normally in Node
- **`process.execPath`:** works but points to the Node binary, not Bun — don't use it to spawn Bun subprocesses

If a test genuinely needs to exercise Bun-specific runtime behavior from within the worker (not spawning Bun as a subprocess, but actually running in Bun), Vitest supports `pool: 'forks'` + `runner: 'bun'` in `vitest.config.ts`. The trade-off: you lose Vitest's V8 coverage provider (it doesn't work under the Bun runner), you lose some `@testing-library/react` integration features, and CI gets harder to configure. For M1, none of our tests need Bun-side globals — we test Bun behavior by spawning Bun as a subprocess, which is cleaner anyway.

---

## What We Tried First

**`process.execPath` for binary resolution** — Seemed correct: the binary that launched the process. It isn't, in this context. Vitest hands off worker execution to Node v22, so `process.execPath` inside a worker is the Node binary. We caught this during DEFECT-1 research before it caused a test failure in CI. The D-001 `resolveBun()` pattern is the correct alternative.

**`Bun.which('bun')`** — Bun-specific API. Fails immediately in a Node worker because `Bun` is `undefined`. Would throw at module load time, not at test execution time — so the entire test file would error before any `describe` blocks ran. Not a clean failure.

**`Bun.argv[0]`** — Same issue. Bun-specific global.

**`pool: 'forks'` + `runner: 'bun'`** — Actually works, but we ruled it out for M1 because it breaks coverage reporting. The 99% coverage gate is a hard requirement, and the V8 coverage provider doesn't work under the Bun runner. Not worth the trade-off for M1.

---

## Why This Matters Now

We caught this preemptively, before Pass 2 dev writes 56 test cases. Pass 2 involves tests for modules that do Bun-specific things (history file writes, audit log appends, identity token generation). A test author who doesn't know this will reach for `Bun.file()` or `Bun.which()` inside a Vitest worker, get a confusing error, and spend time debugging the wrong thing.

Better to write it down once here than to explain it repeatedly during Pass 2.

---

## When to Apply

Every Pass 2+ test author should read this before writing integration or unit tests that touch anything Bun-specific.

Concretely:
- **Don't** use `Bun.*` APIs inside Vitest test files
- **Don't** use `process.execPath` to find the Bun binary
- **Do** use `resolveBun()` (D-001) when you need to spawn Bun as a subprocess
- **Do** use standard Node `fs`, `path`, `os`, `child_process` APIs for everything else
- **Consider** `pool: 'forks'` + `runner: 'bun'` only if you hit a case where Node-compatible APIs genuinely can't exercise the behavior under test — and document the coverage trade-off before doing it

---

## Files Changed

None — this is a preemptive decision record, not tied to a code change. The behavior was discovered during DEFECT-1 research (D-001).

---

## Related

- D-001 — the `resolveBun()` spawn pattern (the correct alternative to `process.execPath`)
- `vitest.config.ts` — where `pool` and `runner` options would live if we ever add Bun runner support
- `docs/specs/M1-implementation-spec.md` Section 2 — lists `vitest` as the test runner and explains why (ink-testing-library compatibility, coverage reporting)
