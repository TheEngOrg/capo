# D-003 — Coverage Gate: Tiered Per-File Thresholds

**Date:** 2026-05-29
**Author:** staff-eng (binding decision), technical-writer (record)
**Status:** Active
**Applies to:** `vitest.config.ts` coverage thresholds — all modules in the M1 coverage scope

---

## The Problem

The original `vitest.config.ts` enforced a flat 99% global threshold (lines/functions/branches/statements) across all included modules: `src/classifier/**`, `src/pipelines/**`, `src/security/**`, `src/audit/**`, `src/repl/**`.

The problem is that "99% branches" means something very different depending on what's generating the branches. For a pure-logic module like `src/classifier/classifier.ts`, 99% branches is achievable and arguably too low — we should hit 100%. For `src/repl/Session.tsx`, 99% branches is not reliably achievable under Vitest/Node without a real stdin TTY.

`Session.tsx` is a live Ink component with raw signal handlers for Ctrl+C, Ctrl+D, and terminal resize. `ink-testing-library` exercises the behavior and covers the happy/error paths — but it doesn't drive raw-stdin branch hits on the signal handler paths because there's no real TTY in a Vitest worker under Node (see D-002). V8 sees those branches, counts them, and the coverage math fails.

A flat gate leaves us two bad options: lower the global threshold to something `Session.tsx` can clear (which reduces the bar for classifier, security, and audit — modules that have no excuse for less than 100%), or stall Pass 2 at the finish line trying to manufacture synthetic TTY inputs that give V8 the branch hits it wants.

Neither option is acceptable. The flat gate is the wrong instrument.

---

## The Decision

Replace the flat `thresholds` block in `vitest.config.ts` with a global floor plus per-file overrides.

**Pure-logic files — 100% on all four metrics:**
- `src/classifier/classifier.ts`
- `src/classifier/patterns.ts`
- `src/security/identity.ts`
- `src/security/policy.ts`
- `src/audit/log.ts`
- `src/repl/history.ts`
- `src/pipelines/MechanicalStub.tsx`
- `src/pipelines/ArchitecturalStub.tsx`

**`src/repl/useSubmit.ts` — 99% across all metrics.** One grace branch: React hook teardown if the component unmounts mid-submit. It's not a real synchronous M1 path, but V8 may flag it. Everything else in `useSubmit.ts` — the blank-input guard, the classify call, the preflight call — is a critical path and must be covered.

**`src/repl/Session.tsx` — 90% branches / 100% functions / 95% lines / 95% statements.** The TTY signal-handler branches are behavior-verified via `ink-testing-library` integration tests (T-11 through T-14, T-22 through T-24). They are NOT subject to the branch-% gate. This is an exemption from the branch *metric*, not an exemption from testing. The tests exist and must pass; V8 just can't reliably count those branch hits headlessly.

**Global floor — 95% lines/branches, 99% functions, 95% statements.** This is a safety net, not the primary gate. Once the pure-logic files hit 100%, the aggregate naturally exceeds these numbers. The floor keeps CI red if something regresses badly enough to slip through the per-file gates.

The principle behind the structure, stated directly by Brodie: "If we can hit 100% coverage of critical paths that is worth more than an % of overall coverage." The gate is oriented around critical-path completeness, not aggregate percentage.

`ink-testing-library` is the blessed tool for Ink component tests — not a workaround. It covers behavior. Branch coverage percentage is the wrong proxy for "did we test this."

---

## What We Tried First

**Flat 99% global (Pass 1 status quo)** — Rejected. Ink TTY branch paths aren't headlessly testable in a Vitest/Node worker (D-002), so the gate can't be satisfied without either a real TTY or synthetic stdin faking. Either path is more complexity than the problem warrants. It also conflicts with the critical-path-first priority: lowering the global bar to clear `Session.tsx` means lowering it for classifier and security too, which have no excuse for anything less than 100%.

**Excluding `src/repl/**` from coverage entirely** — Rejected. `history.ts` and the business logic inside `useSubmit.ts` (blank-input guard, classify call, preflight call) are critical paths. They must be covered. Blanket exclusion throws away coverage enforcement for code that's important to get right.

---

## Critical Paths — Must Hit 100%

These paths are what the gate is actually protecting. Per-file thresholds are the mechanism; these are the goal.

| Path | Test IDs |
|------|----------|
| `classify()` full decision tree (MECHANICAL / ARCHITECTURAL / UNKNOWN) | T-15..T-21 |
| UNKNOWN → `display_route: 'architectural'` collapse | T-21, T-24 |
| `PolicyEnforcement.preflight()` pass + throw paths, 1:1 call ratio | T-35, T-36, T-39 |
| `issueIdentityToken()` structure / HMAC / uniqueness | T-34 |
| `writeAuditEvent()` JSONL append + required fields | T-37, T-38 |
| `appendHistory()` format, first-colon parse, UNKNOWN→architectural | T-41, T-44, T-45, T-46 |
| `useSubmit()` blank-input guard | T-11, T-12 |
| Preflight throw propagates to ErrorBoundary | T-49 |

---

## Why This Matters Now

Pass 2 test authors need to know what threshold their file is held to before they write tests, not after CI fails. Writing tests to 99% branch coverage on `Session.tsx` is wasted effort and likely impossible in a headless environment. Writing tests to 100% on `classifier.ts` is the right bar and achievable.

Also: without this record, a future agent or engineer will look at the per-file threshold for `Session.tsx`, see 90% branch, and assume we under-invested in testing the REPL. The context — that T-11 through T-14, T-22 through T-24 cover the behavior, and the branch% gap is a V8 instrumentation artifact — needs to live somewhere explicit.

---

## When to Apply

**Adding a new source file to the coverage scope:** give it a per-file override at the appropriate tier. If it's pure logic with no external I/O or TTY dependency, it belongs at 100%. If it has headless-untestable branch paths, document which paths and why, then set the branch threshold accordingly.

**Adjusting thresholds:** don't lower thresholds on pure-logic files to make CI green. Fix the coverage gap instead. If a threshold genuinely needs to change, write a new D-file or amend this one.

**`Session.tsx` branch threshold specifically:** the 90% branch gate is not a target — it's a floor. The target is "all behavior tested." Adding new TTY-adjacent behavior to `Session.tsx` means adding tests for it, not adjusting the threshold.

**Don't** treat the global floor (95%/99%/95%) as the primary gate. It's a canary. Per-file overrides are where the real enforcement happens.

---

## Implementation Delta

Only `vitest.config.ts` changes. The `include`/`exclude`/`provider`/`reporter` config is unchanged.

Replace the flat `thresholds` block with a global-floor object plus per-file override entries.

One caveat for the implementer: Vitest ^1.6.0 per-file threshold key syntax should be validated on first run. Bare paths like `'src/classifier/classifier.ts'` may need glob form (`'**/classifier.ts'`). The intent is unambiguous regardless of exact key syntax — verify against the Vitest docs for the installed version.

CI (`.github/workflows/ci.yml`) needs no change. Thresholds are enforced by Vitest from the config. But devops must confirm the CI test step actually runs with `--coverage` — if it doesn't, thresholds silently never fire. That's a pre-existing CI correctness question, not a change introduced here.

---

## Phasing Note

Per-file gates let Phase 2a's six pure-logic files independently satisfy their 100% thresholds once tested. But the global floor keeps CI red until Phase 2b (Session.tsx, useSubmit.ts, stubs) also lands. Partial greens are diagnostic — you can see exactly which file is failing its threshold — not independently shippable. Don't interpret a passing per-file gate on classifier as "ready to merge" until the full threshold picture is green.

---

## Files Changed

- `vitest.config.ts` — replace flat `thresholds` block with global floor + per-file overrides

---

## Related

- [[D-002-vitest-runs-under-node]] — Vitest workers run under Node; `Bun.*` globals unavailable. Root cause of the Ink TTY branch-coverage problem that makes the flat 99% gate unworkable for `Session.tsx`.
- `docs/specs/M1-test-specs.md` Section 3 — coverage target wording
- `docs/specs/M1-implementation-spec.md` Section 7 — CI requirements (confirms `--coverage` must be present in the CI test step)
