# TEO 5.0 — Demo Suite + Regression Baseline (Spec)

Status: **PROPOSAL — pending approval**
Step-1 design. No `demo/` or `tests/` code is written until approved.

A set of demos organized **by capability**, each proving one TEO-5 value prop and
producing complete outputs (audit ledger + finance rollup). The suite doubles as a
**golden-snapshot acceptance/regression baseline**: replay a demo, normalize, diff
against a committed golden — drift = failing test.

Decisions baked in (your call): organize **by capability**; regression via **golden
snapshots**; **SCRIPT-only deterministic baseline** (gating) + a **separate non-gating
live tier**; **plan first, approve before build**.

---

## 1. The demo matrix

Tier **B** = SCRIPT baseline (deterministic, 0 tokens, gates CI). Tier **L** = live-agent
(non-gating, skipped when `claude`/`ANTHROPIC_API_KEY` absent). Shape: `S`=SCRIPT, `A`=AGENT, `G`=gate.

| # | Demo | Capability proven | Shape | Audit proof | Regression assertion | Tier |
|---|------|-------------------|-------|-------------|----------------------|------|
| 1 | `script-economics` | Mechanical work = 0 tokens | `S` | TASK_OUTPUT has no `model`; 5 events | `llm_calls.total===0 && total.cost_usd===0 && status==='pending-human'` | B |
| 2 | `signed-gate` | Gate = HMAC verdict tied to one agent id | `S→G→S` | GATE: `actor_id`, `signature` shape, `verdict:pass` | `gate.signature.match(/^[0-9a-f]{64}$/) && gate.signed_by===<qa id>` | B |
| 3 | `full-ledger-rollup` | Complete ledger + finance rollup shape | `S→S→G→S` | seq 1..N contiguous; `finance:{byActor,total,llm_calls}` | `seqsContiguous(events) && phases===GOLDEN && llm_calls.total===0` | B |
| 4 | `human-accept-closed` | Human gate accept → closed (async) | `S→G` + `gate accept` | HUMAN_GATE(accept, signed); stream→`closed` | `gateResult.status==='closed' && statusAfter==='closed'` | B |
| 5 | `human-reject-reopened` | Human gate reject → reopened | reuse #2 plan + `gate reject` | HUMAN_GATE(reject); stream→`reopened` | `gateResult.status==='reopened'` | B |
| 6a | `retry-eventual-pass` | `max_retries` → RETRY events → pass | `S(max_retries:2, flaky)→S` | ≥1 RETRY event; final `pending-human` | `events.filter(RETRY).length>=1 && status==='pending-human'` | B |
| 6b | `retry-exhausted-error` | Retries exhausted → error | `S(max_retries:1, always-fail)` | exactly `max_retries` RETRY events, then ERROR | `events.filter(RETRY).length===1 && status==='error'` | B |
| 7 | `task-failure-error` | Task fails (no retry) → terminal error, halts | `S(fail)→S(never runs)` | TASK_OUTPUT(fail), **no MECH_VERIFY**, ERROR; 2nd task emits 0 events | `status==='error' && !events.some(e=>e.task_id==='second')` | B |
| 8 | `tamper-rejection` | Engine refuses a mutated signed plan | mutate signed plan, `teo run` | non-zero exit; stderr `/signature|verify/i`; no events written | `runExit!==0 && stderr.match(/signature|verify/i)` | B |
| 9 | `unregistered-agent-rejection` | Plan w/ unregistered agent rejected | build-time `validatePlan` | error: `… is not a registered agent` | `validatePlan(bad).ok===false && errors.some(/not a registered agent/)` | B |
| 10 | `parallel-workstreams` | 2 plans, isolated trees, reconcile report-only | 2× `S` via `--workstream --isolation sandbox` | independent ledgers; `workstream list`→2; diff = report, live tree untouched | `listWorkstreams().length===2 && reconcile applied===false` | B |
| 11 | `run-script-parity` | Human runs the exact script the engine runs | `run-script` vs same script in a plan | identical stdout; same `runScript` path | `runScriptStdout===inPlanStdout && exit===0` | B |
| 12 | `validation-rejections` (bundle) | Structural rejections | 4 malformed plans, build-time | errors: SCRIPT-no-script, AGENT-no-actor, duplicate task_order, gate-ref-missing | `each → validatePlan.ok===false w/ expected substring` | B |
| 13 | `live-agent-economics` | Agents only on judgment; every call named/counted/costed | `A→A→A→G→S` (existing live plan) | 3 TASK_OUTPUT carry `model`; `llm_calls.total===3`, 3 actor keys; cost>0 | `llm_calls.total===3 && byActor keys===3` — **skip if no claude** | L |
| 14 | `live-sage-plan` (optional) | Sage classifies script-vs-agent live | `teo plan "<req>"` | resulting plan mixes AGENT + SCRIPT; PLAN event has `model` | `plan.tasks.some(SCRIPT) && some(AGENT) && verifyPlan===true` — **skip if no claude** | L |

Covers every capability you asked for. #1–12 gate CI; #13–14 are the live tier.

## 2. Per-demo outputs (the golden artifacts)

Captured into `tests/acceptance/golden/<demo>.json`:
- **plan.json** — signed plan (or, for #9/#12, the malformed plan + captured `validatePlan` errors).
- **events** — full ledger from `readEvents`, **normalized** (see §4).
- **finance** — `{byActor, total, llm_calls}` (all-zero and exact for Tier B).
- **run-result** — `{plan_id, status, tasks[]}` from `teo run` stdout.

Rejection demos (#8/#9/#12) capture `{exit_code, stderr_substring}` or `{ok:false, errors[]}` instead.

## 3. Determinism — the load-bearing decision (CORRECTED from initial design)

The engine is already mostly deterministic: the orchestrator stamps every event with
`plan.created_at` (a fixed `"2026-06-12T00:00:00.000Z"`), not the wall clock — so all
orchestrator `ts` fields are byte-stable. `project_id` is a fixed hash of `"teo-demo"`.
Agent ids are stable given a stable registry.

**BUT** — `demo/.teo-home/keyring/signing.key` is **gitignored** (verified: not committed,
mode 0600). `build-plans.ts` regenerates it per machine. Therefore:

- **HMAC signatures are NOT portable across machines/CI.** A golden that pins an exact
  signature would fail on a fresh checkout where the key differs.
- **Decision: normalize signatures to shape-only** (`/^[0-9a-f]{64}$/`), exactly as
  `tests/integration/cli-e2e.test.ts` already does. Do **not** golden exact signatures.
  (This reverses the regression-architect's "pin the key" recommendation, which assumed a
  committed key. Keeping the key gitignored is correct — TEO's own rule, architecture §2.)
- `event_id` (`randomUUID()`) and `duration_ms` → always normalized.
- HUMAN_GATE events use a real clock (`nowIso()`) → scrub their `ts` + `signature`; assert
  only `phase/actor_id/actor_type/verdict/detail`.

The deterministic spine that IS goldened: `seq, phase, actor_id, actor_type, verdict,
task_id, detail, model-presence`. That gives an exact seq-count + phase-sequence assertion
per demo — the strongest regression signal — without depending on a portable key.

## 4. Normalization function (the core machinery)

```
normalize(event, tier):
  event_id      -> "<uuid>"
  duration_ms   -> "<duration_ms>"        (if present)
  signature     -> assert /^[0-9a-f]{64}$/ then -> "<sig>"   (never exact-match)
  if phase==="HUMAN_GATE": ts -> "<ts>"   (real-clock; signature already scrubbed)
  if tier==="agent":
    tokens_in/out, cost_usd -> "<n>"; detail.model -> "<model>";
    detail.output (LLM text) -> "<output>"   # hybrid golden: AGENT events shape-only
  else: keep all (SCRIPT 0-token values ARE the regression signal)
finance (agent tier): cost_usd/tokens -> "<n>"; keep llm_calls counts
```

## 5. File / dir layout

```
demo/
  build-plans.ts        EXTEND: add cap-* plans + bad-* malformed fixtures
  reset.ts              EXTEND: clear the flaky-retry sentinel (lives in scripts/, outside the cleared dirs)
  scripts/              ADD: always-fail.sh, flaky-pass.sh (sentinel: fail-then-pass)
  plans/                EXISTING 3 + cap-retry-*/cap-task-failure/cap-parallel-{a,b} + bad-* fixtures
  capture-golden.ts     NEW: run each demo vs .teo-home, normalize, write goldens (mirrors build-plans.ts)
tests/acceptance/       NEW (parallel to tests/integration/)
  demo-suite.e2e.test.ts   #1–12, gating. Spawns node_modules/.bin/tsx — NEVER npx tsx.
  demo-live.e2e.test.ts    #13–14, describe.skipIf(!hasClaude)
  golden/<demo>.json       committed canonical snapshots
  lib/{normalize,diff-golden}.ts
```

Goldens regenerate via `GOLDEN_UPDATE=1 vitest run tests/acceptance/`. Failure UX prints a
semantic path-diff (`seq 3 (GATE): signature expected/actual`) + a hint ("signing key
changed → regenerate").

## 6. Sequencing (build order)

0. **Golden machinery first** — `normalize` + `capture-golden.ts` + `diff-golden`. Validate against the existing simple demo. Nothing is a baseline until this exists.
1. **Absorb the 3 existing demos** → rows #1, #2/#3/#4, #13. #5 reuses #2's plan with `gate reject`.
2. **Failure/retry fixtures** — `always-fail.sh`, `flaky-pass.sh`, plans #6a/#6b/#7.
3. **Validation rejections** (#9/#12) — build-time `validatePlan`, no runs, fastest.
4. **Tamper (#8) + run-script parity (#11)** — lift from existing `cli-e2e.test.ts` precedent.
5. **Parallel workstreams (#10)** — highest complexity, last; assert structural facts not paths.
6. **Live tier (#13/#14)** — `skipIf` guard; golden only structural facts, never cost.

## 7. Gaps / risks (verified)

- **`AGENT_VERIFY` is in the telemetry enum but never emitted** (verified: 0 uses in orchestrator). Do NOT write a demo asserting it — it would fail. Flag as a real schema/runtime gap to close separately, not demo.
- **Stray namespace in the committed demo home:** a `teo plan` live run left `demo/.teo-home/memory/f4aa3c67…/`. `reset.ts` only clears the `teo-demo` namespace. The harness must read only the `teo-demo` (`4557e2a6…`) namespace. **Cleanup item:** remove the stray live-plan namespace from the demo home before capturing goldens.
- **Signatures non-portable** (§3) — handled by shape-normalization.
- **Flaky-retry determinism** — sentinel file (fail-then-pass); `reset.ts` must delete it or #6a won't reproduce.
- **Live tier non-deterministic** — non-gating, structural-only goldens, `skipIf`.
- **Parallel-workstream golden least stable** — assert structural facts (2 ledgers, list length, reconcile report-only), not absolute tree paths.
- **Spawn local `tsx`, never `npx tsx`** — hard-won CI lesson (shared `~/.npm/_npx` race → ENOTEMPTY/exit 190). The runbook's human `npx tsx` is fine; the test harness must not.

## 8. What approval unblocks

On approval, build in §6 order, test-first, keeping the deterministic core at 100% coverage
and the acceptance suite green on both CI runners. The live tier never gates. Estimated:
~12 gating demos, ~2 live, one golden harness, ~6 new plans + 2 scripts.
```
