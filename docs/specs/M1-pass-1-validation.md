# M1 Pass 1 Scaffold — QA Validation Memo

**Date:** 2026-05-28
**Author:** QA
**Workstream:** M1-pass-1-scaffold
**Verdict:** CONDITIONAL-PASS

---

## Verification Summary

The scaffold is structurally sound and passes lint, typecheck, build, and binary smoke tests. The 39 files match spec layout with three deviations noted below. One blocking defect exists: both integration tests (T-04 `cli-version.test.ts`, T-05 `cli-help.test.ts`) fail on `bun run test` because they use `spawnSync('bun', ...)` without resolving the full `bun` path — when `bun` is not on the subprocess PATH, `spawnSync` returns `status: null` and the assertions fail. Dev's go-signal claim of "2 passing (integration)" was incorrect in this environment. The binary itself works correctly (compiled `dist/teo-darwin-arm64` passes both smoke tests manually). The coverage gate fires as designed for Pass 1 stubs. This is a CONDITIONAL-PASS: the integration test PATH defect must be fixed before commit.

---

## Structural Verification

### src/ — Expected vs Actual

| Expected (spec §1) | Present | Notes |
|---|---|---|
| src/index.tsx | YES | |
| src/cli/App.tsx | YES | |
| src/cli/args.ts | YES | |
| src/classifier/classifier.ts | YES | |
| src/classifier/patterns.ts | YES | |
| src/classifier/types.ts | YES | |
| src/pipelines/MechanicalStub.tsx | YES | |
| src/pipelines/ArchitecturalStub.tsx | YES | |
| src/pipelines/types.ts | YES | |
| src/repl/Session.tsx | YES | |
| src/repl/history.ts | YES | |
| src/repl/useSubmit.ts | YES | |
| src/repl/types.ts | YES | Extra — not in spec §1, present in go-signal. Benign. |
| src/security/identity.ts | YES | |
| src/security/policy.ts | YES | |
| src/security/keys.ts | YES | |
| src/audit/log.ts | YES | |
| src/audit/types.ts | YES | Extra — not in spec §1, present in go-signal. Benign. |
| src/ui/RouteIndicator.tsx | YES | |
| src/ui/Prompt.tsx | YES | |
| src/ui/Output.tsx | YES | |
| src/ui/ErrorBoundary.tsx | YES | |

All 20 spec-required src files are present. Two extra files (`src/repl/types.ts`, `src/audit/types.ts`) were added by dev — both sensible additions that centralize type definitions.

Note: spec §1 shows a `src/repl/` entry without `types.ts`; staff-eng's interfaces (Section 3) justify splitting types out. No structural objection.

### tests/ — Expected vs Actual

| Expected (spec §1 + test-spec §3) | Present | Notes |
|---|---|---|
| tests/classifier/classifier.test.ts | YES | Uses `describe.skip` |
| tests/classifier/patterns.test.ts | YES | Uses `describe.skip` |
| tests/repl/history.test.ts | YES | Uses `describe.skip` |
| tests/repl/session.test.tsx | YES | Uses `describe.skip` (named `session.test.tsx` not `useSubmit.test.ts`) |
| tests/security/identity.test.ts | YES | Uses `describe.skip` |
| tests/security/policy.test.ts | YES | Uses `describe.skip` |
| tests/audit/log.test.ts | YES | Uses `describe.skip` |
| tests/ui/RouteIndicator.test.tsx | YES | Uses `describe.skip` |
| tests/cli/main.test.tsx | YES | Uses `describe.skip` |
| tests/integration/cli-version.test.ts | YES | Real tests — FAILING |
| tests/integration/cli-help.test.ts | YES | Real tests — FAILING |
| tests/pipelines/ (any file) | MISSING | spec §1 shows no pipelines test dir; test-spec §3 does not explicitly require it at scaffold stage. Not a blocking defect. |
| tests/repl/useSubmit.test.ts | ABSENT | Covered by session.test.tsx in dev's layout. See NOTE below. |
| tests/ui/Prompt.test.tsx | ABSENT | Spec §1 lists it; not created in Pass 1. See NOTE below. |
| tests/ui/Output.test.tsx | ABSENT | Spec §1 lists it; not created in Pass 1. See NOTE below. |
| tests/ui/ErrorBoundary.test.tsx | ABSENT | Spec §1 lists it; not created in Pass 1. See NOTE below. |
| tests/integration/golden.test.ts | ABSENT | Spec §1 lists it; integration golden test is a Pass 2 deliverable. Intentional. |
| tests/build/long-pem-define.test.sh | ABSENT | ADR-0005 OQ-3 gate test; manual, not scaffold scope. Intentional. |

All test files use `describe.skip` correctly for Pass 1 placeholder structure. The integration tests have real assertions — but those assertions are currently failing (see Findings).

---

## CI Dependency Verification

### CI-FU-1 — `lint` script

PASS. `package.json` contains `"lint": "tsc --noEmit"` at `scripts.lint`. This matches Brodie's specified default. Running `bun run lint` exits 0 with no errors.

### CI-FU-2 — vitest coverage thresholds

PASS. `vitest.config.ts` thresholds:
- `lines: 99` ✓
- `functions: 99` ✓
- `branches: 99` ✓
- `statements: 99` ✓

Coverage `include` list:
- `src/classifier/**` ✓
- `src/pipelines/**` ✓
- `src/security/**` ✓
- `src/audit/**` ✓
- `src/repl/**` ✓

Coverage `exclude` list:
- `src/index.tsx` ✓
- `src/ui/**` ✓
- `src/cli/**` ✓ (added vs spec, reasonable — CLI entry parsing is hard to cover in isolation)
- `node_modules/**` ✓

One deviation: `src/cli/**` is excluded but spec only mentioned `src/index.tsx` and `src/ui/**`. This is not blocking — the CLI arg parsing layer is genuinely thin glue code. Flagged as NOTE.

CI will be red on Push 2 coverage gate (stubs have 0% coverage). This is the designed behavior: Pass 1 scaffold → CI passes lint/typecheck/test/build/smoke but fails the coverage gate. Pass 2 ships real implementations + real tests, which turns coverage green. The 99% threshold is mechanically enforced and will fire correctly when Pass 2 lands.

---

## Local Verification Results

| Command | Exit Code | Observable Output |
|---|---|---|
| `bun install --frozen-lockfile` | 0 | "Checked 162 installs across 208 packages (no changes)" |
| `bun run lint` | 0 | No output (tsc --noEmit clean) |
| `bun run typecheck` | 0 | No output (tsc --noEmit clean) |
| `bun run test` | **1 (FAIL)** | 2 integration tests FAIL, 48 skipped |
| `bun build --compile darwin` | 0 | `dist/teo-darwin-arm64` produced (65MB) |
| `bun build --compile linux` | 0 | `dist/teo-linux-x64` produced (96MB) |
| `./dist/teo-darwin-arm64 --version` | 0 | Prints `0.1.0` |
| `./dist/teo-darwin-arm64 --help` | 0 | Prints usage with options |

Note: `bun run build:darwin` and `bun run build:linux` scripts fail in this shell because the npm script calls `bun` which is not on PATH. The underlying `bun build --compile` commands succeed when invoked with full path. Same PATH issue as the integration test failure. CI will not have this problem because the CI runner installs bun and sets PATH correctly.

**Integration test failure detail:**
Both `cli-version.test.ts` and `cli-help.test.ts` call `spawnSync('bun', [...])`. When `bun` is not on the subprocess PATH, `spawnSync` returns `status: null` (ENOENT — process never started). The test asserts `result.status === 0`, which fails with `expected null to be +0`. Dev's go-signal claimed "2 passing (integration)" — this was measured in dev's environment where `bun` was on PATH. The tests work end-to-end in that environment but are fragile as written.

---

## Specification Compliance

| Check | Expected | Actual | Status |
|---|---|---|---|
| `ink` version | `7.0.4` (pinned) | `7.0.4` | PASS |
| `react` version | `19.2.0` (pinned) | `19.2.0` | PASS |
| `ink-text-input` version | `6.0.0` (pinned) | `6.0.0` | PASS |
| `ink-spinner` version | `5.0.0` (pinned) | `5.0.0` | PASS |
| `typescript` version | `5.4.5` (pinned) | `5.4.5` | PASS |
| `react-devtools-core` location | `optionalDependencies: 7.0.1` | `optionalDependencies: 7.0.1` | PASS |
| `react-devtools-core` NOT in `dependencies` | true | true | PASS |
| `type: "module"` set | required | present | PASS |
| `bin` field | `{"teo": "./dist/teo"}` | `{"teo": "./dist/teo"}` | PASS |
| `scripts.lint` | `tsc --noEmit` | `tsc --noEmit` | PASS |
| `scripts.test` | `vitest run` | `vitest run` | PASS |
| `scripts.build:darwin` | correct bun compile command | correct | PASS |
| `scripts.build:linux` | correct bun compile command | correct | PASS |

One addition in package.json relative to spec: `"test:coverage": "vitest run --coverage"` script was added. This is non-breaking and useful.

`@vitest/coverage-v8` is correctly in `devDependencies` — required for `--coverage` mode.

---

## Findings

**DEFECT-1 (blocking) — Integration tests fail: `bun` not on PATH in spawnSync subprocess**

Both `tests/integration/cli-version.test.ts` and `tests/integration/cli-help.test.ts` call `spawnSync('bun', [...])`. The test suite exits code 1 with 2 failures. These are the only real (non-skipped) tests in Pass 1 and they represent the M1 deliverables T-04 and T-05. Dev's go-signal claim of "2 passing (integration)" was incorrect in the local environment where `bun` is not on the default PATH.

Fix: use the full resolved path to bun in the spawnSync call, or resolve `bun` from `process.execPath` / `Bun.argv[0]`, or add a `PATH` env to the spawnSync options that includes `dirname(process.execPath)`. This is a 2-line fix in each integration test file.

Dev must fix before commit. QA cannot approve the scaffold gate with `bun run test` exiting 1.

**WARNING-1 (non-blocking) — Missing test files from spec §1 layout**

Implementation spec §1 lists `tests/repl/useSubmit.test.ts`, `tests/ui/Prompt.test.tsx`, `tests/ui/Output.test.tsx`, and `tests/ui/ErrorBoundary.test.tsx`. None were created in Pass 1. Dev appears to have consolidated REPL tests into `session.test.tsx` and deferred UI component tests. These are all `describe.skip` placeholder files in the spec's intent, so this doesn't block Pass 1 — but the structure diverges. Sage should decide whether to enforce spec §1's exact file list or accept dev's consolidation before Pass 2 authors tests into those paths.

**WARNING-2 (non-blocking) — `bin` field points to `./dist/teo` (no arch suffix)**

The `bin` field in `package.json` is `"teo": "./dist/teo"`. The actual build outputs are `dist/teo-darwin-arm64` and `dist/teo-linux-x64`. There is no `dist/teo` produced. This matters only for `npm install -g` / `bun install -g` workflows — the M1 distribution is tarball-only, so users run the binary directly. If npm global install is ever intended, this will silently fail. Matches spec §1's `package.json` template exactly — the spec has this same discrepancy. Flagged for Sage awareness but not a commit blocker for M1.

**NOTE-1 — `src/cli/**` excluded from coverage**

`vitest.config.ts` excludes `src/cli/**` from coverage thresholds. The spec only called out `src/index.tsx` and `src/ui/**` for exclusion. `src/cli/args.ts` and `src/cli/App.tsx` are the two CLI layer files excluded. Both are thin wrappers (args.ts is Commander setup; App.tsx is a React component wrapper). The exclusion is reasonable but wasn't explicitly authorized by spec. Staff-eng should confirm in Pass 2.

**NOTE-2 — `tests/pipelines/` directory absent**

Implementation spec §1 does not list a `tests/pipelines/` directory, but the test-spec (Category E: T-29 through T-33) covers pipeline stub tests. No scaffold file exists for pipelines tests. This is consistent with Pass 1 scope — but when Pass 2 authors the Category E tests, they'll need to create `tests/pipelines/MechanicalStub.test.tsx` and `ArchitecturalStub.test.tsx`. Flag this for Pass 2 planning.

**NOTE-3 — Dev's local verification was environment-dependent**

Dev's go-signal reports local_verifications.test as "pass — 2 passing (integration), 48 skipped". This was accurate in dev's shell environment where `bun` was on PATH. The test failure is a portability defect, not a fabrication. CI will pass if the runner sets PATH correctly — but the test code should not depend on ambient PATH.

---

## Verdict

**CONDITIONAL-PASS**

Scaffold structure is sound. Config files (package.json, tsconfig.json, vitest.config.ts, bunfig.toml) are spec-compliant. Build and binary smoke pass. The 99% coverage threshold is mechanically wired.

One blocking defect must be resolved before commit: DEFECT-1 (integration tests fail on `bun run test` due to PATH-sensitive `spawnSync` calls). This is a 2-line fix per integration test file.

Two warnings for Sage to adjudicate: missing test scaffold files from spec §1 layout (WARNING-1), and the `bin` field pointing to a non-existent `dist/teo` path (WARNING-2).

After DEFECT-1 is fixed and verified, this scaffold is ready to commit.
