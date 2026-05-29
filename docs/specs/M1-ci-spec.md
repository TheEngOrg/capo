# TEO M1 — CI Specification

**Status:** COMPLETE
**Date:** 2026-05-28
**Author:** DevOps Engineer
**Source:** `docs/specs/M1-implementation-spec.md` Section 7, ADR-0005, SPIKE-002
**Workflow file:** `.github/workflows/ci.yml`

---

## CI Architecture

Six jobs, five of which do real work, one that aggregates:

```
lint ──────────────┐
typecheck ─────────┤
test (matrix) ─────┼──► gate
build (matrix) ────┤
smoke (matrix) ────┘
  └── depends on build
```

**Triggers:** `push` to main, `pull_request` targeting main, `workflow_dispatch` (manual).

**Concurrency:** Cancels in-progress runs when a new push lands on the same PR/branch.

**Runners:** `ubuntu-latest` for Linux x64 work. `macos-14` for darwin-arm64 work (the GitHub-hosted arm64 runner — not `macos-latest`, which may resolve to x86 depending on the pool).

---

## What Each Job Does

**lint** — runs `bun run lint` on Linux. M1 ships without a separate linter config; the lint script in `package.json` should minimally alias `tsc --noEmit` until a dedicated linter (biome, oxlint) is added. Fails on any TypeScript error or lint violation.

**typecheck** — runs `bun run typecheck` (`tsc --noEmit`) on Linux. Strict mode per `tsconfig.json`. Separate from lint so the failure reason is unambiguous in the CI log.

**test** — runs `bun run test -- --coverage` on both platforms (Linux x64 and macOS arm64). Uses Vitest, not `bun test` — ink-testing-library compatibility requires it (M1 implementation spec Section 2). Coverage report uploaded as an artifact. The 99% gate is enforced via `vitest.config.ts` thresholds — if they're not defined, Vitest won't enforce the number; that's dev's responsibility when writing `vitest.config.ts`.

**build** — matrix: one entry per target platform. Runs `bun run build:darwin` on `macos-14`, `bun run build:linux` on `ubuntu-latest`. Logs binary size and SHA-256 to the job output. Binary uploaded as a workflow artifact (14-day retention).

**smoke** — downloads the compiled binary artifact from `build`, makes it executable, runs `--version` and `--help`. Asserts exit code 0 and non-empty stdout. Does not run the interactive REPL (requires a real TTY).

**gate** — depends on all five jobs, runs `if: always()`. Checks each upstream job's result field. Fails if any is not `success`. This is the single status check that branch protection should require for PR merges.

---

## CAD Gate Mapping

| CAD Gate | CI Enforcement |
|----------|---------------|
| Gate 1: Tests Exist | Not CI — that's a PR review check |
| Gate 2: Tests Pass | `test` job — fails on any Vitest failure |
| Gate 3: QA Sign-off (99% coverage) | `test` job — coverage thresholds in `vitest.config.ts` |
| Gate 4: Staff Review | Not CI — human review step |
| Gate 5: Build artifacts present | `build` job — fails if binary not produced |
| Smoke / runtime correctness | `smoke` job — `--version` and `--help` pass |
| Final gate | `gate` job — single required status check |

CI enforces the mechanical, automatable gates. Human gates (Staff Review, Leadership Approval) are PR review steps, not CI checks.

---

## Interpreting a Failure

**lint fails** — TypeScript errors or lint violations. Check the lint job log for the file and line. Fix, push.

**typecheck fails** — Type errors. Same as lint but from `tsc --noEmit` specifically. If both lint and typecheck fail and they share the same underlying script, that's fine — fix the errors and both will clear.

**test fails** — One of two things: a test assertion failed, or coverage dropped below the 99% threshold on a gated module. Check the test job log. Coverage report artifact has the breakdown. If it's a coverage miss, the newly added code needs more tests before the PR can merge.

**build fails** — Binary didn't compile. Check for: missing `react-devtools-core` optional dep (should not happen if `bun install --frozen-lockfile` ran first), a TypeScript compile error the typecheck job didn't catch (unlikely but possible if `tsconfig.json` excludes a build path), or a Bun version mismatch. The job explicitly pins Bun 1.3.14.

**smoke fails** — Binary compiled but doesn't run correctly. Most likely cause: a startup error that exits non-zero, or `--version` / `--help` returning empty output. Run `dist/teo-<platform> --version` locally to reproduce.

**gate fails** — Any of the above failed. The gate job's log shows which job result was not `success`. Fix that job.

---

## Running Locally

CI doesn't require `act`. The equivalent manual commands:

```sh
# Install (must include optional deps — react-devtools-core is required for build)
bun install

# Lint
bun run lint

# Typecheck
bun run typecheck

# Test with coverage
bun run test -- --coverage

# Build (macOS arm64)
bun run build:darwin

# Build (Linux x64)
bun run build:linux

# Smoke (after build)
./dist/teo-darwin-arm64 --version
./dist/teo-darwin-arm64 --help
```

If you want to run with `act` (local GitHub Actions runner), the matrix jobs require Docker images for `ubuntu-latest`. The `macos-14` runner can't be replicated with `act` on a non-macOS machine.

**Coverage thresholds:** Vitest enforces these via `vitest.config.ts`. If you want to see coverage without the gate, run `bun run test -- --coverage --coverage.thresholds.enabled=false`.

---

## Future Work Hooks

**M1 release signing** — The `build` job already has an `env.RELEASE_PUBLIC_KEY` block. When the real Ed25519 key is ready, configure it as a GitHub Actions secret and update the build scripts to pass `--define "RELEASE_PUBLIC_KEY=..."`. A separate release workflow (not this file) will handle codesigning, notarization, and tarball publishing.

**M2 verb-prefix routing** — When `mechanical: <input>` and `architectural: <input>` override syntax lands, add a non-interactive smoke test to the `smoke` job that pipes a classify call and asserts the routing label in stdout.

**M3 streaming** — Streaming response tests will need a PTY-capable test runner or a mock. `ink-testing-library` handles virtual rendering; real streaming latency tests will need a separate performance CI step.

**Linter upgrade** — M1's lint step is minimal (tsc-backed). When biome or oxlint is added, update the lint job command. The job structure doesn't need to change.

**Test result annotations** — When the PR annotation volume justifies it, add `--reporter=junit` to the test command and wire the XML output to a test summary action.

**Startup latency gate** — ADR-0005 OQ-2 (< 2000ms cold start) is a manual measurement on M1 day 1. If we want to gate on it in CI, it requires timing the binary launch in the smoke job and comparing against the threshold. That's low-priority for M1 but the smoke job is the right place for it.
