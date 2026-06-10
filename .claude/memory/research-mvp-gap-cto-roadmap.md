# CTO Roadmap — WS-MVP-GAP

**Workstream:** WS-MVP-GAP  
**Date:** 2026-06-09  
**Author:** CTO  
**Source inputs:** research-mvp-gap-staff-eng.md, research-mvp-gap-pm.md, ADR-046, ADR-045, ADR-0001, SPIKE-001, M1-acceptance-criteria.md

---

## Decision 1 — ADR-046 Disposition

**Recommendation: (b) Carve out a Phase-1-only MVP path.**

Ratify a scoped subset of ADR-046 that covers Phase 1 only (stateless CLI wrapper). Phases 2 (compaction) and 3 (governor loop) are deferred to post-MVP.

**Rationale:**

ADR-046 as written is architecturally correct and the right long-term direction. The problem is its bundling — ratifying all three phases before any M3 work creates a false dependency. Phase 1 is what MVP actually needs: a stateless subprocess call to `claude --print` that gets a response back. That is the sole inference seam required to close the gap between stub responses and real LLM output.

Phases 2 and 3 are hardening layers. They solve real problems (token hemorrhage, governor loop enforcement) but those problems are not blockers for a single user running `teo` locally. Requiring ADR-047 (Governor Loop) and ADR-048 (Compaction Contract) to be ACCEPTED before M3 ships would add 4–6 weeks of design/review work to an MVP that doesn't need it yet.

Option (a) — ratify all three phases — is the right call for v1 production hardening, not for MVP. Option (c) — skip ADR-046 entirely — throws away the architectural investment and produces a one-off hack that we'll have to migrate later. Option (b) threads the needle: we get the inference seam now, we preserve the architectural shape, and we defer the complexity gates to the right time.

**What must reach the user for ratification:**

The user must ratify the following scoped ADR-046 disposition before M3 implementation is dispatched:

> "I accept ADR-046 Phase 1 (stateless CLI wrapper / `teo_cli_wrapper` bash script) as the v1 LLM inference seam for MVP. I acknowledge that Phases 2 (compaction) and 3 (governor loop) are deferred to post-MVP and will require separate ratification before ship. ADR-046 status advances from PROPOSED to CONDITIONALLY-ACCEPTED (Phase 1 only)."

This is a binary yes/no. No design work is required from the user — just confirmation that the scoped interpretation is acceptable before dev is dispatched to build the wrapper.

**Pre-Phase-1 gate that remains live:**

Staff-engineer must complete live validation of `claude --print` headless flag semantics (SPIKE-001 OI-1 and OI-2) before Phase 1 is dispatched. This is not waived by the scoped ratification — it is the gate that gives us confidence Phase 1 will work. See Decision 2 for the current evidence posture.

---

## Decision 2 — Runtime/Auth Path

**Lock: ClaudeCliRuntime is the v1 runtime. ClaudeSDKAdapter is the documented fallback, not active development.**

**Spike evidence assessment (SPIKE-001):**

SPIKE-001 is COMPLETE with structural confirmation and two live validation gaps:

- `--print`, `--allowed-tools`, `--disallowed-tools` flags: **confirmed present** in the binary (v2.1.146), extracted from the compiled binary directly.
- Headless/no-TTY mode: **confirmed viable** — the existing `daemon/src/llm/claude.ts` already uses `claude --print --output-format text` as a subprocess with no TTY in production.
- Per-turn context injection overhead: **analytically confirmed** at ~5,000–7,000 chars/turn; practical limit ~100+ turns, well beyond TEO's 5–30 turn session range.
- Multi-turn coherence (live 3-turn test): **not confirmed live** due to TEO sandbox allowlist blocking the `claude` binary. Structural approach is sound; live test is a 10-minute task.
- Tool flag enforcement behavior (live test): **not confirmed live**. Flag presence confirmed; hard-block vs. warn-and-continue behavior requires a live run.

These two gaps (SPIKE-001 OI-1 and OI-2) are the remaining pre-Phase-1 gates. They are not blockers for planning — they are blockers for M3 implementation dispatch. Either the CTO or any dev with terminal access can close them in under 30 minutes total.

**The spike evidence is sufficient to plan on ClaudeCliRuntime.** The structural evidence is strong enough that we're not designing speculatively. The live confirmation is a gate before we write code, not before we plan.

**Locked: v1 runtime path is ClaudeCliRuntime** — subprocess call to `claude --print`, per-turn context injection, session state via `session-store.ts`.

**Auth UX (what the user must have configured):**

The user must have the `claude` CLI authenticated on their machine. ClaudeCliRuntime inherits the user's existing `claude` auth — no separate `ANTHROPIC_API_KEY` is required. This is the primary auth UX advantage of the CLI path over the SDK path.

**"Not authenticated" error path (required in M3, resolves staff-eng OQ-4 and PM OQ-PM-2):**

At REPL startup (before entering the interactive loop), TEO must probe auth state. The current `useSubmit.ts` carries a dummy `IdentityToken` (TODO comment at lines 39–45). M3 must replace this with a real startup check. The check is: attempt a dry-run or `claude --version` call to confirm the binary is reachable and authenticated. If it fails, surface this error before the REPL loop begins:

```
teo: could not reach the Claude CLI — run `claude auth` to authenticate, then try again
```

The REPL must not start in a degraded state and silently fail on the first query. The user must know before typing anything that their auth is broken.

**ClaudeSDKAdapter fallback trigger:**

If either SPIKE-001 OI-1 (live multi-turn coherence) or OI-2 (live tool flag enforcement) comes back with a hard failure, ClaudeSDKAdapter activates. In that path: auth requirement changes to `ANTHROPIC_API_KEY` env var. The `BaseRuntime` interface is adapter-agnostic, so the swap is a one-file change with no external API surface impact per ADR-0001. The error message changes to:

```
teo: ANTHROPIC_API_KEY is not set — export ANTHROPIC_API_KEY=<your-key> and try again
```

---

## Decision 3 — v1 Mechanical Execution Surface

**This resolves OQ-PM-1 — PM's most urgent blocker for Milestone B criteria.**

**v1 mechanical execution is a named allowlist, not shell passthrough.**

Shell passthrough (unrestricted `bash` execution) is not acceptable for a v1 product with SOC2 controls in scope. The SOC2 boundary in ADR-0001 requires `PolicyEnforcement.preflight()` + `--disallowed-tools` enforcement. Open shell passthrough bypasses both.

**Canonical v1 mechanical operation allowlist:**

| Operation | Mechanism | Allowed in v1 |
|-----------|-----------|----------------|
| Current working directory | `process.cwd()` — in-process, no subprocess | Yes |
| File read (within project root) | `Read` tool, path-scoped to cwd | Yes |
| Directory listing (within project root) | `Read` on directory, or equivalent glob | Yes |
| Git status / log / diff | `Bash(git status)`, `Bash(git log)`, `Bash(git diff)` — git read-only subcommands | Yes |
| Run test suite | `Bash(npx vitest)` / `Bash(bun test)` — no arbitrary args passthrough | Yes |
| TypeScript typecheck | `Bash(bun run typecheck)` — mapped to defined package.json script | Yes |
| Build binary | `Bash(bun run build)` — mapped to defined package.json script | Yes |

**Explicitly NOT in v1 mechanical allowlist:**

- Arbitrary shell command execution (no `Bash(*)` wildcard)
- File write or delete operations via mechanical pipeline
- Network calls (no `curl`, `wget`, or equivalent)
- Process management (`kill`, `pkill`, etc.)
- `sudo` or privilege escalation of any kind
- git write operations (`git commit`, `git push`, `git reset`, etc.) — these are architectural-pipeline decisions, not mechanical operations

**How this ties to SOC2 enforcement (ADR-0001):**

`PolicyEnforcement.preflight()` checks the requested tool against the compiled manifest's grant list before any `runtime.execute()` call. For the mechanical pipeline, the compiled manifest grants exactly the tools in the allowlist above. A mechanical request for an operation not in this list throws `ToolGrantViolation` and surfaces to the user as:

```
teo: [→ mechanical] that operation is not in the v1 allowlist — type /help to see supported operations
```

The `--disallowed-tools` flag is appended to the subprocess invocation as defense-in-depth.

**Implementation note for PM Milestone B criteria:**

PM can now write precise Milestone B mechanical execution criteria against this allowlist. The "show me the current directory" and "what files are in src/" examples from the PM spec are both in scope. "Run the test suite" is in scope. "Delete the build artifacts" is not. "Push to main" is not.

---

## Decision 4 — Canonical Milestone Roadmap

### Mapping: Staff-eng numbering vs. PM milestone naming

| Canonical ID | Staff-eng | PM Milestone | Name | Capability Added | MVP Line |
|-------------|-----------|-------------|------|-----------------|----------|
| M1 | M1 | Baseline | REPL Baseline | Working REPL, classifier, stub pipeline, SOC2 skeleton, signed binary | — SHIPPED — |
| M2 | M2 | Baseline+ | Classifier Hardening | Compute/arithmetic patterns correct; `2+2` routes to `[→ mechanical]` | — SHIPPED (pending SE sign-off) — |
| M3 | M3 | Milestone A | Real LLM Dispatch | ARCHITECTURAL pipeline calls real Claude; response appears in REPL; Ctrl+C cancels in-flight generation; auth error path live | **MVP LINE** |
| M4 | M4 | Milestone B | Mechanical Pipeline + Session Continuity | MECHANICAL pipeline executes from allowlist; multi-turn session context carries forward; stub text fully absent | Post-MVP (near-term) |
| M5 | M5 | Milestone C (partial) | REPL Polish + Slash Commands | Up-arrow history, `/help`, `/exit`, `/status`, `/model`; cross-turn context window management | Post-MVP |
| M6 | M6 | Milestone C (full) + Post-MVP | Production Hardening | Streaming (token-by-token), Governor Loop (ADR-047), Compaction (ADR-048), multi-LLM provider, distribution | Post-MVP |

**Why M3 is the MVP line, not M4:**

The user's benchmark is "I want to use TEO the same way I use Claude Code or Gemini-CLI." The minimum bar for that is: type a natural-language prompt, get a real LLM response. That is M3. M4 (mechanical pipeline + session continuity) makes the product significantly better but is not required to cross the "not a demo toy" threshold. A user can have a real architectural conversation in M3. That is the MVP moment.

The PM's concern about "mechanical execution" being useful at MVP is noted — but the PM's own scoping says "MVP does NOT need to ship the full SOC2 certification control stack, multi-tenant features, or npm/PyPI distribution. The bar is 'works end-to-end as a REPL for one user, locally.'" A single-pipeline MVP (ARCHITECTURAL live, MECHANICAL still stubbed) meets that bar. We ship M3 as MVP, then immediately target M4.

**Streaming (PM OQ-PM-3) — settled here:**

Streaming is NOT in the MVP window (M3). It moves to M6 alongside production hardening.

Rationale: Staff-eng correctly notes that M1 AC Section 4 explicitly deferred streaming to M3 of the original plan. The original M3 is now this plan's M4/M5/M6 territory. Streaming belongs with the production-polish milestone, not the MVP milestone. An atomic response that appears after a 1–3 second LLM call is acceptable UX for MVP. The PM's Milestone C streaming criteria (tokens begin appearing within 2 seconds) stay in the roadmap but at M6, not M3.

The PM's scope risk is correct: "streaming before parity" is the over-build risk. Real responses first (M3), mechanical parity (M4), then streaming (M6).

### Gate bindings per milestone

| Milestone | Gate 1: Test | Gate 2: Code Quality | Gate 3: Active Testing |
|-----------|-------------|--------------------|-----------------------|
| M3 | All 195+ tests pass; LLM wrapper module at Tier 1 coverage (pure logic) from day one; auth error path has an explicit test (`expect(output).toContain('run \`claude auth\`')`); stub text asserted ABSENT in integration tests | `tsc --noEmit` clean; Biome added at M3 boundary per staff-eng OQ-5; no `v8-ignore` in src/ | `expect` harness: binary launches, prompt appears, architectural query returns substantive content (not stub), Ctrl+C during generation returns to prompt, Ctrl+D exits clean |
| M4 | Session context continuity has a test that passes full history to runtime and asserts history is received; mechanical allowlist operations each have an integration test; stub text asserted ABSENT for both pipelines | Same as M3 | Extends M3 e2e: mechanical query returns real result, mixed-pipeline session works, exit + restart confirms no cross-session context |
| M5 | Up-arrow history wired to TextInput state; slash-command router has unit tests for each command; coverage include list updated for new modules | Same | Extends M4 e2e: up-arrow recalls prior input, `/help` returns list, `/clear` works without session reset |
| M6 | Streaming Ink component covered; `--autocompact` or compaction logic unit tested; governor loop gate tests (Gate 1/2/3 failure cases) | Same | Extends M5 e2e: streaming visible within 2 seconds; CI secret `ANTHROPIC_API_KEY` live for e2e job |

**Note on Gate 3 CI cost (staff-eng OQ-3):** For M3 and M4, the `expect` e2e test uses a minimal prompt ("say hello in exactly one word") to keep per-run cost predictable and response time deterministic. Live LLM calls in CI are acceptable at this scale. A recorded-fixture fallback is not needed at MVP — that complexity is premature. Revisit at M6 if CI latency or rate limits become a real problem.

---

## Decision 5 — Open Question Disposition

### RESOLVED-BY-YOU

**Staff-eng OQ-1 — ADR-046 ratification blocking M3.**  
Answer: Phase 1 ratification is the path (Decision 1). User ratification of the scoped Phase-1-only ADR-046 is required before M3 implementation dispatch — see USER-RATIFICATION below. This unblocks M3 once ratified.

**Staff-eng OQ-4 — Auth credential flow.**  
Answer: Startup probe before REPL loop; explicit human-readable error if auth fails (Decision 2). UX copy defined: `teo: could not reach the Claude CLI — run \`claude auth\` to authenticate, then try again`. This is a required M3 deliverable, not post-MVP.

**Staff-eng OQ-5 — Biome adoption timing.**  
Answer: Add Biome at the M3 milestone boundary, before the LLM wrapper module is written. Gate 2 for M3 requires Biome to be in place. This is the right moment — the codebase is still small, the new LLM-related modules haven't been written yet, and avoiding a noisy "fix existing lint violations" commit later.

**PM OQ-PM-1 — Mechanical pipeline v1 execution surface.**  
Answer: Named allowlist defined in Decision 3. PM can now write precise Milestone B acceptance criteria.

**PM OQ-PM-2 — ClaudeCliRuntime vs ClaudeSDKAdapter resolution.**  
Answer: ClaudeCliRuntime is locked as v1 (Decision 2). Auth UX is: user needs `claude` CLI authenticated. No `ANTHROPIC_API_KEY` required on the primary path. SDK fallback triggers only if SPIKE-001 live validation items fail.

**PM OQ-PM-3 — Streaming milestone placement.**  
Answer: Streaming is deferred to M6 (post-MVP). It is not in the MVP window (M3). Milestone C criteria should be updated by PM to remove streaming from the MVP deliverable scope. Streaming moves to the M6 production-hardening milestone.

**PM OQ-PM-4 — FU-9 and FU-10 classifier follow-up disposition.**  
Answer: FU-9 ("why + verb" architectural shadowing) and FU-10 (polite/prefixed imperative blind spots) are accepted as known gaps and are NOT blockers for MVP. They are tracked follow-ups at low/medium severity per the M2 PM report. They do not affect the v1 mechanical allowlist (Decision 3) and do not affect the real LLM response quality at M3 (the LLM handles nuance the classifier misses). Document them as known M2 follow-ups deferred to M4 polish at the latest.

**PM OQ-PM-5 — Session continuity implementation path.**  
Answer: Per-turn context injection via `claude --print` with full history serialized as prompt prefix (the ClaudeCliRuntime model). Practical turn limit is ~100+ turns before context window becomes a factor. No user-visible degradation within normal session lengths (5–30 turns). For M4, the user-visible contract is: within-session context persists; there is no stated turn limit in v1. If a session approaches the practical limit, the `--autocompact` flag is the escape valve (confirmed present in binary per SPIKE-001). Document the "context persists within session, no cross-session persistence" behavior as the M4 done definition.

**ADR-0001 OQ-4 — Compiled-in public key via Bun build flag.**  
Answer: TEAM-RESOLVABLE (see below). This is a staff-engineer investigation, not a CTO decision.

**ADR-0001 OQ-5 — TEO_OPERATOR env var convention.**  
Answer: Fall back to OS user (`os.userInfo().username`) is sufficient for v1. No default value needed. CI does not need to set `TEO_OPERATOR` — the OS user in the CI runner is informative metadata, not a security control. This is the minimal viable answer; revisit if SOC2 Type I audit requires operator identity to be deterministic.

---

### USER-RATIFICATION

**UR-1 — ADR-046 Phase-1-only acceptance (HIGHEST PRIORITY — blocks M3 implementation dispatch).**

What Brodie must decide:
> "Do you accept ADR-046 Phase 1 (the `teo_cli_wrapper` stateless bash script) as the v1 LLM inference seam, with Phases 2 and 3 deferred to post-MVP?"

Options:
- **YES** → ADR-046 advances to CONDITIONALLY-ACCEPTED (Phase 1 only). M3 implementation can be dispatched after SPIKE-001 live validation is complete.
- **NO** → Specify which alternative you want: ratify all three phases now (delays MVP significantly), or skip ADR-046 and wire a direct path (creates migration debt).

**UR-2 — MVP line at M3 vs. M4.**

What Brodie must decide:
> "Is the MVP the moment you get a real LLM response to an architectural question (M3), or does the mechanical pipeline also need to be live at MVP (M4)?"

Options:
- **M3 is MVP** → Ship M3, immediately start M4. Users get real LLM responses for design/reasoning queries at MVP.
- **M4 is MVP** → MVP includes mechanical execution and session continuity. Adds ~2–4 weeks to the MVP timeline.

CTO recommendation: M3 is MVP. The user's benchmark is "works like Claude Code" — that bar is cleared when you type a question and get a real response. Mechanical pipeline parity is near-term post-MVP, not a gating requirement.

**UR-3 — SPIKE-001 live validation items (OI-1 and OI-2).**

What Brodie must do (not decide — must execute):
> "Run a 3-turn `claude --print` coherence test and a `--allowed-tools` enforcement test outside the TEO sandbox. Takes <30 minutes. Results close the last pre-Phase-1 gate."

This is not a yes/no — it is a manual step only Brodie (or a dev with terminal access outside the TEO sandbox) can take. Until it runs, M3 implementation dispatch is formally blocked. The structural evidence is strong enough that we expect PASS; this is confirmation, not exploration.

---

### TEAM-RESOLVABLE

**Staff-eng OQ-2 — Streaming format for M4/M6.**  
Owner: staff-engineer.  
Action: Verify `claude --print --output-format stream-json` event schema against current CLI version (v2.1.146). Confirm which fields carry token text, which carry metadata. This is a 30-minute spike — run before M6 streaming component design begins. Not a blocker for MVP.

**Staff-eng OQ-3 — E2E test strategy for M3+ LLM calls in CI.**  
Owner: staff-engineer.  
Action: Use minimal prompt ("say hello in exactly one word") in the `expect` e2e harness starting at M3. No recorded-fixture strategy needed at MVP. Revisit at M6 if CI cost or rate limits become a real problem. Decision is: live LLM in CI is fine at MVP scale.

**ADR-0001 OQ-1 — `claude --print` multi-turn coherence (live test).**  
Owner: CTO or any dev with terminal access (SPIKE-001 OI-1).  
Action: Run 3-turn `claude --print` sequence outside TEO sandbox. Close within 1 week. Blocks M3 implementation dispatch.

**ADR-0001 OQ-2 — `--allowed-tools` / `--disallowed-tools` enforcement behavior (live test).**  
Owner: CTO or any dev with terminal access (SPIKE-001 OI-2).  
Action: Run `claude --print "read /etc/hosts" --allowed-tools Read` then attempt Write. Document whether CLI hard-blocks, warns, or silently ignores. Blocks M3 implementation dispatch.

**ADR-0001 OQ-3 — Signing key generation and storage for v1 release.**  
Owner: CTO + DevOps.  
Action: Define: who holds the private key, what is the CI secret name, what is the key generation process. This is a pre-release gate for v1 but not a pre-MVP gate (M3 MVP is local binary, not a signed release tarball change). Target: resolve before M5/M6 production-hardening milestone.

**ADR-0001 OQ-4 — Compiled-in public key via Bun build flag.**  
Owner: staff-engineer (Week 4B in the original ADR-0001 timeline, now aligns with M5/M6).  
Action: Confirm whether `bun build --define` is sufficient for the public key embedding or whether a separate build step is needed. SPIKE-002 already confirmed `bun build --define` works for env injection — this is an extension of that confirmation. Low risk; resolve during M5 hardening.

---

## What Must Reach the User

Three decisions require Brodie's explicit sign-off before M3 can be dispatched. These are stated as crisp choices:

**1. ADR-046 Phase-1-only ratification (UR-1)**

> Accept the stateless CLI wrapper (Phase 1) as the v1 LLM inference seam, with Phases 2 and 3 deferred to post-MVP?

**YES / NO / ALTERNATIVE**

*If YES: ADR-046 moves to CONDITIONALLY-ACCEPTED. M3 implementation dispatch is unblocked pending SPIKE-001 live validation.*

---

**2. MVP milestone line (UR-2)**

> Is M3 (real LLM response, architectural pipeline only) sufficient for MVP, or does M4 (mechanical pipeline + session continuity) also need to ship before you'd call it MVP?

**M3 IS MVP / M4 IS MVP**

*CTO recommendation: M3 is MVP. Real responses, not stubs — that's the threshold.*

---

**3. SPIKE-001 live validation (UR-3)**

> Run the two 10-minute terminal tests (3-turn `claude --print` coherence + `--allowed-tools` enforcement) outside the TEO sandbox to formally close SPIKE-001.

*This is an action, not a decision. No implementation can begin until these run.*
