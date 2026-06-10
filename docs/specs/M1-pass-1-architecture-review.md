# Pass 1 Architecture Review

**Status:** ACCEPT-WITH-FOLLOWUP  
**Date:** 2026-05-28  
**Reviewer:** Staff Engineer  
**Workstream:** M1-pass-1-scaffold  
**Source:** dev go-signal `M1-pass-1-scaffold-complete.json`

---

## File Structure Compliance

Spec Section 1 defines 39 files. Dev's scaffold has all 29 `src/` files matching exactly — naming, location, and subdirectory hierarchy are correct. No source files are missing or renamed.

Test directory has divergences:

**Missing from spec:**
- `tests/repl/useSubmit.test.ts` — spec called for this; dev shipped `session.test.tsx` instead
- `tests/ui/Prompt.test.tsx` — absent
- `tests/ui/Output.test.tsx` — absent
- `tests/ui/ErrorBoundary.test.tsx` — absent
- `tests/integration/golden.test.ts` — absent
- `tests/build/long-pem-define.test.sh` — absent (no `tests/build/` directory at all)

**Present but not spec'd:**
- `tests/repl/session.test.tsx` — covers T-07/T-11–T-14 (REPL lifecycle); replaces the spec's `useSubmit.test.ts` in terms of surface covered
- `tests/cli/main.test.tsx` — additional CLI test file

Assessment: the missing test files are all `describe.skip` stubs in Pass 1 scope. The pattern holds — dev delivered stub test files for the modules being tested, but not one-for-one with the spec's file list. The session/useSubmit rename is cosmetic. The `tests/build/` gap and the missing `golden.test.ts`, `Prompt.test.tsx`, `Output.test.tsx`, `ErrorBoundary.test.tsx` are Pass 2 deliverables. They should be tracked explicitly in Pass 2.

The `tests/build/long-pem-define.test.sh` is the OQ-3 gate test — this is a manual staff-engineer gate, not a Vitest file. It's not CI-automated and was never going to land as a skip placeholder. This is not a defect for Pass 1.

**Verdict: file structure PASS with Pass 2 follow-up on missing test stubs.**

---

## Type System Soundness

Every type in the spec maps exactly to what dev shipped:

- `src/classifier/types.ts` — `Route`, `DisplayRoute`, `RouteDecision`, `ClassifierConfig` — exact match to spec Section 3
- `src/security/identity.ts` — `IdentityToken` with `token_id`, `session_id`, `issued_at`, `hmac` — exact match
- `src/audit/types.ts` — `AuditEventType` (all 5 event types) and `AuditEvent` with correct optional fields — exact match
- `src/pipelines/types.ts` — `PipelineProps` with `input: string` and `decision: RouteDecision` — exact match
- `src/cli/args.ts` — `ParsedArgs` with `version`, `help`, `debug` — exact match

The `src/repl/types.ts` file is an addition not in the spec's type list. It defines `HistoryItem` and `SessionState`, which `useSubmit.ts` and `Output.tsx` depend on. These are correct derivations from the spec's data flow — `HistoryItem` is the natural shape for the history array in `Session`. No shape mismatch.

Cross-module imports are correct and consistent:
- `classifier.ts` imports from `./patterns.js` and `./types.js`
- `audit/log.ts` imports `AuditEvent` from `./types.js`
- `repl/history.ts` imports `DisplayRoute` from `../classifier/types.js`
- `ui/Output.tsx` imports `HistoryItem` from `../repl/types.js`

Pass 2 implementations can slot directly into the stubs. The interfaces won't require shape changes.

**Verdict: type system PASS.**

---

## JSON-Import Deviation

**ACCEPTED — closes spec inconsistency; dev's call is correct.**

Dev's report is accurate. `src/cli/args.ts` uses:

```typescript
import pkg from '../../package.json' with { type: 'json' };
```

This is consistent with spec Section 5 ("import pkg from '../package.json'"). The spec had an internal inconsistency: Section 5 described the JSON module import pattern, but Section 2 dev note described `package.json` version loading without specifying the import mechanism at the `args.ts` level. Using `createRequire` at compile time fails in `bun build --compile` because `package.json` is not included in the compiled binary's virtual FS. Static JSON module import with `with { type: 'json' }` is inlined by Bun's bundler and survives into the compiled binary. Dev's smoke test confirms `--version` returns `0.1.0` from the compiled binary. This is correct.

The `--define VERSION="..."` alternative would require changing `args.ts` to reference a declared constant instead of `pkg.version` — more coupling, no benefit over static import for this use case.

---

## Dependency Manifest Fidelity

Cross-checking against spec Section 2 and SPIKE-002 sandbox:

| Dep | Spec pin | Actual | Status |
|-----|----------|--------|--------|
| `ink` | `7.0.4` | `7.0.4` | PASS |
| `react` | `19.2.0` | `19.2.0` | PASS |
| `ink-text-input` | `6.0.0` | `6.0.0` | PASS |
| `ink-spinner` | `5.0.0` | `5.0.0` | PASS |
| `react-devtools-core` | `7.0.1` in `optionalDependencies` | `7.0.1` in `optionalDependencies` | PASS |
| `typescript` | `5.4.5` | `5.4.5` | PASS |
| `@types/react` | `19.1.0` | `19.1.0` | PASS |
| `ink-testing-library` | `4.0.0` | `4.0.0` | PASS |
| `commander` | `^12.1.0` | `^12.1.0` | PASS |

One addition not in spec: `@vitest/coverage-v8: ^1.6.0` in `devDependencies`. This is required for `vitest --coverage` with the v8 provider. The spec had `vitest: ^1.6.0` but the coverage provider is a separate package in Vitest 1.x — this is a correct mechanical addition.

`package.json` also adds a `test:coverage` script (`vitest run --coverage`). CI invokes `bun run test -- --coverage` per the workflow, which passes `--coverage` to the `test` script's `vitest run` invocation. This works. The additional `test:coverage` convenience script is harmless.

**Verdict: dependency manifest PASS.**

---

## Configuration Soundness

**vitest.config.ts:**
- `provider: 'v8'` — PASS
- `reporter: ['text', 'json-summary', 'lcov']` — PASS (CI needs json-summary + lcov)
- `include` covers `classifier`, `pipelines`, `security`, `audit`, `repl` — PASS
- `exclude` covers `src/index.tsx`, `src/ui/**` — PASS
- Note: `src/cli/**` is also excluded. This is correct — `args.ts` and `App.tsx` are entry-point glue, not logic modules. Consistent with the spec intent.
- Thresholds: 99% on `lines`, `functions`, `branches`, `statements` — PASS
- Test discovery glob: `tests/**/*.{test,spec}.{ts,tsx}` — PASS

**tsconfig.json:**
- `strict: true` — PASS (implies `noImplicitAny`)
- `jsx: "react-jsx"` with `jsxImportSource: "react"` — PASS (React 19 compatible)
- `moduleResolution: "bundler"` — PASS (correct for Bun)
- `target: "ESNext"` — PASS
- `resolveJsonModule: true` — required for the JSON import; present — PASS
- `noEmit: true` — correct for typecheck-only compilation
- `include` covers `src/**/*` and `tests/**/*` — PASS

**bunfig.toml:**
- `[install] optional = true` — ensures `react-devtools-core` installs — PASS
- `[install.lockfile] save = true` — lockfile committed — PASS

**Verdict: configuration PASS.**

---

## CI Workflow Compatibility

Walking every `bun run X` in `.github/workflows/ci.yml`:

| CI step | Script in package.json | Status |
|---------|----------------------|--------|
| `bun run lint` | `"lint": "tsc --noEmit"` | PASS |
| `bun run typecheck` | `"typecheck": "tsc --noEmit"` | PASS |
| `bun run test -- --coverage` | `"test": "vitest run"` — passes `--coverage` to vitest | PASS |
| `bun run build:darwin` | `"build:darwin": "bun build --compile..."` | PASS |
| `bun run build:linux` | `"build:linux": "bun build --compile..."` | PASS |

All CI invocations are satisfied. `lint` and `typecheck` map to the same `tsc --noEmit` command — this is intentional (CI comment in the workflow documents this is the M1 approach, with a dedicated linter to be added in M2+).

One observation: the CI build scripts don't inject `--define RELEASE_PUBLIC_KEY=...`. Per the workflow comment and CI spec Section 7, the `RELEASE_PUBLIC_KEY` secret must be set in CI for the `--define` flag. The current build scripts don't include `--define` in `package.json` — when the secret is absent or empty, the build succeeds but `RELEASE_PUBLIC_KEY` is undefined at runtime (caught by the try/catch in `keys.ts`). This is documented behavior for dev CI. The M1 release build that actually injects the real key is a separate workflow. No defect.

**Verdict: CI compatibility PASS.**

---

## Additions Beyond Spec

**`src/ui/ErrorBoundary.tsx`:** Was implicit in the spec (Section 5 explicitly describes `<ErrorBoundary />` behavior and `src/ui/ErrorBoundary.tsx` is listed in the Section 1 file tree). Dev shipped a full working implementation (not a stub) — correct call, this is pure React class component boilerplate with no business logic. The `getDerivedStateFromError` pattern is appropriate. Error message is rendered as `<Text color="red">Error: {message}</Text>` — matches PM AC. ACCEPTED.

**`src/repl/types.ts`:** Not in spec's file tree, but the types it defines (`HistoryItem`, `SessionState`) are necessary for the data flow between `useSubmit`, `Session`, and `Output`. Clean addition. ACCEPTED.

**`tests/cli/main.test.tsx`:** Extra test file. Needs to be reviewed in Pass 2 to confirm it doesn't duplicate or conflict with the spec's test plan. Low risk. ACCEPTED for now, flag for Pass 2 rationalization.

**`src/ui/RouteIndicator.tsx` has a functional implementation:** Dev implemented the `dimColor` prop in the Pass 1 stub rather than deferring it. This is fine — `RouteIndicator` is a trivial one-line component and having it work correctly in Pass 1 costs nothing.

---

## Pass 2 Readiness

The scaffold is structured to support all Pass 2 work without significant refactoring:

- `patterns.ts` — fill the empty arrays; no interface changes
- `classifier.ts` — logic already correct, just needs populated arrays
- `Session.tsx` — full replacement of the stub body with `<Output>` + `<Prompt>` + state hooks
- `useSubmit.ts` — fill in the hook body; `UseSubmitOptions` interface is correct
- `history.ts` / `log.ts` — fill in the `fs.appendFileSync` bodies; XDG path logic is documented in comments
- `identity.ts` — replace placeholder return with UUID v4 + HMAC-SHA256
- `Prompt.tsx` — wire in `ink-text-input`; stub body replaced

One structural note: `PolicyEnforcement.preflight()` already has the correct M1 implementation (null/empty `token_id` throws, otherwise returns). Dev's comment says "Pass 2: additional policy checks" but per the spec this is the complete M1 implementation. Pass 2 should note this is already done.

Missing test stubs that Pass 2 must add:
- `tests/repl/useSubmit.test.ts` (or reconcile with `session.test.tsx`)
- `tests/ui/Prompt.test.tsx`
- `tests/ui/Output.test.tsx`
- `tests/ui/ErrorBoundary.test.tsx`
- `tests/integration/golden.test.ts`

The 99% coverage gate will fire on Pass 2 — that's by design. Pass 1's `coverage_gate: "fires as designed"` result confirms the plumbing works.

---

## Verdict

**ACCEPT-WITH-FOLLOWUP**

The scaffold is structurally sound. The foundation matches the spec across source files, type system, dependency pinning, build configuration, and CI compatibility. The two working deliverables (`--version`, `--help`) are verified functional. JSON-import deviation is accepted.

**Follow-ups for Pass 2 (not blocking commit):**

1. Add missing test stub files: `tests/repl/useSubmit.test.ts`, `tests/ui/Prompt.test.tsx`, `tests/ui/Output.test.tsx`, `tests/ui/ErrorBoundary.test.tsx`, `tests/integration/golden.test.ts`
2. Rationalize `tests/cli/main.test.tsx` against the spec's test plan — confirm it maps to a test ID or merge into another file
3. Note in `policy.ts` that the M1 implementation is already complete — remove the "Pass 2" comment to avoid confusion
4. The `tests/build/long-pem-define.test.sh` OQ-3 gate test is a staff-engineer manual gate, not a Vitest file. It should be documented as a separate deliverable in the M1 release checklist, not as a missing scaffold file.
