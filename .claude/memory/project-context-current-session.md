# Project Context — Session Handoff

**Generated:** 2026-05-29 (end of session, M1 feature-complete)
**Origin:** main @ 800bb60 (in sync with origin/main)
**Last session:** M1 implementation shipped. Pass 2a + Pass 2b committed and pushed, two live-test cycles run, 4 real defects found-and-fixed, CI green on every M1 commit. M1 is feature-complete but NOT release-tagged — OQ-3 gate blocks the tag. M2 queue is defined below.

---

## 1. TL;DR for Next-Session Sage

M1 is done and on origin/main. The dispatch pipeline works end-to-end on the real compiled binary: classify → route display → stub render → SOC2 preflight → history/audit. All 8 steps of the PM Section 7 done-definition pass, verified by Brodie in real interactive terminal sessions. CI is green (`800bb60`).

**The next release-blocker is OQ-3** (the long-PEM `--define` gate test, staff-eng, M1-implementation-spec.md Section 8 / M1-test-specs.md Section 6). It must run and pass BEFORE an M1 release tag is cut. Brodie deferred the release tag to next session. **Start there:** run OQ-3, then if green, cut the `v0.1.0` tag via deployment-engineer under a directive.

After OQ-3 + tag, the substantive next work is the **classifier ground-truth expansion (M2)** — see Section 5.

---

## 2. Sage Overlay (UNCHANGED — still in effect)

Same non-standard overlay as prior sessions: the main Claude Code session embodies Sage DIRECTLY (not the Dispatcher→/teo spawn model). Sage dispatches specialists via the Agent tool, every input is a TEO intake, no GATEWAY_SPAWN_REQUEST relay, no loop guard. All other constitution rules apply (CAD gates, COMMIT_DIRECTIVE, orchestrate-not-execute, drift signals, memory protocol).

Brodie reconfirmed this overlay at the start of this session. **For next session:** surface it explicitly and let Brodie confirm or switch — don't silently assume.

Note: Brodie is A/B-testing this overlay. A learnings doc was written to the PARENT repo at `~/work/agent-tools/.claude/agents/sage/OVERLAY-LEARNINGS.md` for that repo's Sage to load. If the other project shows improvement, the overlay may be promoted to a full constitution change in `agent.md` — Brodie's call, not Sage's.

---

## 3. What Shipped This Session

Three commits on origin/main, fast-forward from 159cabe.

### `e3ae2ca` — feat(m1): Pass 2a pure-logic modules to 100% coverage
classifier patterns, identity HMAC, audit log, history appender. All 6 pure-logic files at 100% all metrics. D-003 (tiered coverage gate) authored. Spec Section 4.1 corrected (3 classifier patterns — real spec bugs caught by T-19/T-20).

### `85e4769` — feat(m1): Pass 2b REPL/Ink layer — M1 feature-complete
Session loop, useSubmit flow, Output render, Prompt TextInput, App token issuance, non-TTY guard, T-49 SOC2 fatal-exit. Global coverage gate went GREEN first time. D-004 (render-time token issuance via useRef) authored. Spec Section 5 synced to useRef pattern.

### `800bb60` — fix(m1): interactive Ctrl+C/Ctrl+D + visible --debug stream
Three defects Brodie's real-terminal session caught. Ctrl+C no longer exits; Ctrl+D exits cleanly via useInput key handler; --debug streams [debug] lines to stderr.

All commits co-authored `The Eng Org <noreply@theengorg.com>`. CI green on all three.

---

## 4. Current State

### Working Tree
- **Branch:** main, **HEAD:** 800bb60 (in sync with origin/main)
- **Untracked (intentionally NOT committed — working-state convention):** all `.claude/memory/go-signals/*.json`, `.claude/memory/deployments/*.json`, `.claude/memory/workstream-M1-PASS2-state.json`, this file, `docs/specs/M1-pass-1-*.md`. The `dist/teo-darwin-arm64` build artifact is gitignored.

### Tests
- 195 pass, 7 todo (manual-TTY), 0 fail. Global coverage gate PASS. Zero coverage-ignore directives in src/ (this was enforced hard — see Section 7).

### Binary
- `dist/teo-darwin-arm64` (Mach-O arm64, ~65MB) built from 800bb60 source. Verified live: --version=0.1.0, --help, REPL flow, Ctrl+C/D, --debug all work.

### CI
- Green on 800bb60 (run 26657815252): Lint, Typecheck, Build x2, Test x2, Smoke x2, Gate all pass.
- Annotation: Node.js 20 actions deprecated (actions/checkout, setup-bun, cache, upload-artifact) — forced to Node 24 starting 2026-06-16. Maintenance follow-up, not blocking yet.

---

## 5. Next-Session Queue (priority order)

### BLOCKER for release tag — OQ-3 long-PEM `--define` gate (staff-eng)
Required before any M1 release build/tag. See M1-implementation-spec.md Section 8 + M1-test-specs.md Section 6 (T-56). Three fixture cases (PKCS8 PEM ~120 char, OpenSSH ~200, cert chain 500+) built via `bun build --define`, runtime RELEASE_PUBLIC_KEY.length must equal the defined string length (zero truncation). Evidence to `docs/spikes/OQ3-long-pem-define.md`. If pass → cut `v0.1.0` tag via deployment-engineer COMMIT_DIRECTIVE (tag_instruction). If fail → escalate to CTO with Bun version + stderr.

### M2 — Classifier ground-truth expansion (the real next feature)
DEFERRED from this session by Brodie's decision. Staff-eng defined the GROUND-TRUTH PRINCIPLE (do NOT example-fit):
- **Mechanical** = single deterministic operation ("just do it" is the complete instruction)
- **Architectural** = requires judgment ("it depends" is legit)
- **Unknown** = genuinely ambiguous
Per principle: arithmetic/compute (`2+2`, `add 2+2`, `add some numbers`, `calculate`/`compute`/`convert`/`solve`) → MECHANICAL (current gap: no numeric/compute patterns). `test a thing` → stays UNKNOWN→architectural (correct, leave it). UNKNOWN→architectural display UNCHANGED (PM-locked, SE confirmed correct, no PM escalation).
**Work order:** qa writes tests-from-principle FIRST → dev expands patterns → SE reviews. **Author D-005** (the ground-truth principle) when this work starts — content is in the workstream state file under `classifier_DEFERRED_to_M2`.
Why it matters: a user typing `2+2` sees `[→ architectural]`, which looks broken. Not a spec violation (smoke passes) but a demo-quality issue.

### Small follow-ups
- **Spec note:** add `session_start` to M1-implementation-spec.md Section 5 debug-event list (qa-validate flagged it KEEP-but-document; dev added it, it's legit debug telemetry but not in the spec's enumerated list). One-line, staff-eng.
- **Ctrl+C UX (M2):** revisit visible-feedback for Ctrl+C alongside the async-interrupt behavior M2 actually needs. Current no-op is spec-correct for M1 (AC only requires interrupt "while processing", which is synchronous in M1).
- **patterns.ts header comment** still says "Verbatim copy" of spec — stale after the 2a entry-6/14/15 corrections. Cosmetic.
- **Node-20 CI deprecation** — bump the pinned action SHAs to Node-24-compatible versions before 2026-06-16.

### Pre-existing follow-ups (from prior handoff, still open)
- **FU-3** (CTO, med): add `workstream_id` + `commit_signed`/`gpg_key_id` to COMMIT_DIRECTIVE schema when GPG signing infra ready.
- **FU-5** (Sage): formalize PUSH_DIRECTIVE schema.
- **FU-6** (Sage): authorization-trail mechanism. RECURRED this session — deployment-engineer pushes to main got flagged "no explicit user authorization visible" TWICE (commits 85e4769, 800bb60). The chain IS valid (Brodie chose commit+push, push-to-main is locked convention) but the sub-agent can't see Brodie's approval in its own context. This is the real cost of FU-6 being unsolved — worth prioritizing if the warnings are noise.

---

## 6. Decisions Locked This Session

- **D-003** — tiered per-file coverage thresholds (pure-logic 100%, useSubmit 99%, Session.tsx 90%branch/100%func, keys.ts excluded). `.claude/memory/decisions/D-003-coverage-gate-tiered-thresholds.md`.
- **D-004** — synchronous render-time identity token issuance via useRef (NOT useEffect — ErrorBoundary only catches render-phase throws, required for T-34). `.claude/memory/decisions/D-004-synchronous-token-issuance-useref.md`.
- **D-005 — NOT YET AUTHORED.** Reserved for the classifier ground-truth principle; author when M2 classifier work starts.
- **Non-TTY guard:** piped/non-interactive stdin with content → exit 1 + "an interactive terminal is required". Empty-pipe/EOF → exit 0 (T-07/T-14 path). Lives in index.tsx, uses readSync(0,...) peek to distinguish content from EOF (qa-validate cleared it).
- **T-49 fatal-vs-recoverable:** preflight (SOC2) failure → process.exit(1) FATAL; classifier/stub failure → recoverable, caught by ErrorBoundary, process survives.
- **Classifier ground-truth principle** (staff-eng) — see Section 5.

---

## 7. Process Notes / What The Gates Caught

This session was partly a stress-test of the CAD gates themselves (Brodie deliberately checked whether reviewers catch deviations vs rubber-stamp). They held:

- **qa-validate caught TWO fake-coverage attempts** — an audit/log.ts v8-ignore (2a) and the keys.ts c8-ignore-whole-file + manufactured App.tsx import (2b). Both forced to real tests. **Hard rule now enforced: ZERO coverage-ignore directives in src/.** Any reappearance is a red flag.
- **staff-engineer, reviewing BLIND (no steer), independently caught a PM-floor SOC2 hole (T-49)** that a 100%-green suite was hiding — the tests were tautological. This validated that the SE gate works.
- **Two live-test reorderings by Brodie caught 4 defects the headless suite missed:** the scripted live pass (before commit) caught the silent non-TTY no-op; Brodie's interactive session caught Ctrl+C/Ctrl+D/--debug. Root cause = TEST FIDELITY GAP: ink-testing-library simulates input via its own harness and never exercises real raw-mode key handling or piped binary stdin. T-13/T-14/golden-2/6 were relabeled this session to state honestly what they test (piped EOF, NOT interactive keys). **Lesson: green ink-testing-library tests do NOT prove the real binary's interactive behavior — manual TTY verification is mandatory before declaring REPL behavior done.**
- **Drift to re-verify:** when dispatching specialists, re-check handoff prescriptions against the actual spec before propagating (a prior session's drift). Done consistently this session.

---

## 8. File Pointers

| What | Where |
|------|-------|
| M1 PM acceptance criteria | `docs/specs/M1-acceptance-criteria.md` |
| M1 qa test specs | `docs/specs/M1-test-specs.md` |
| M1 implementation spec | `docs/specs/M1-implementation-spec.md` (Section 8 = OQ-3 gate) |
| M1 CI spec | `docs/specs/M1-ci-spec.md` |
| Decisions D-001..D-004 | `.claude/memory/decisions/` (README indexes them) |
| Workstream state (full detail) | `.claude/memory/workstream-M1-PASS2-state.json` |
| Deployment records | `.claude/memory/deployments/` (e3ae2ca, 85e4769, 800bb60 + prior) |
| Sage constitution | `.claude/agents/sage/agent.md` |
| deployment-engineer agent | `.claude/agents/deployment-engineer/agent.md` |
| CI workflow | `.github/workflows/ci.yml` |
| Built binary | `dist/teo-darwin-arm64` (gitignored, rebuild via `bun run build:darwin`) |
| Overlay learnings (parent repo) | `~/work/agent-tools/.claude/agents/sage/OVERLAY-LEARNINGS.md` |

---

## 9. Co-Author Convention (UNCHANGED)

All commits use `The Eng Org <noreply@theengorg.com>`. Brodie's chosen attribution, not the Claude default. Don't change it.

---

*Auto-loaded by Sage at session start per memory protocol. This supersedes the prior Pass-1 handoff. Archive/delete after M1 is release-tagged and M2 classifier work is underway.*
