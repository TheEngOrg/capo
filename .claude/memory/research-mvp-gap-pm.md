# PM Acceptance Criteria — MVP Gap Analysis
# Workstream: WS-MVP-GAP

**Status:** DRAFT  
**Date:** 2026-06-09  
**Author:** Product Manager  
**Workstream:** WS-MVP-GAP  
**Execution ID:** c75fe007-04fc-48d0-b21e-82c49e804351

---

## Baseline: What M1 + M2 Delivered

M1 ships a working REPL binary (`teo`) with:
- Interactive prompt loop (`teo>`)
- Heuristic classifier routing inputs to MECHANICAL or ARCHITECTURAL
- Stub pipeline responses (no real LLM calls)
- SOC2 skeleton: identity token issuance, `PolicyEnforcement.preflight()`, local audit log
- Signed tarball distribution on macOS arm64 + Linux x64

M2 delivers classifier refinement: 350 passing tests, principled pattern development (D-005), FU-6/FU-8/C3 all resolved. The classifier is substantially correct but the pipelines are still stubs. FU-9 and FU-10 are tracked open follow-ups at low/medium severity.

**The gap:** The user types a prompt, sees `[→ architectural]`, and then sees `[architectural stub] Received: design a caching layer`. That is not the same as Claude Code. The MVP closes that gap.

---

## MVP Definition (PM)

The MVP is the first release where a user can open `teo`, type a natural-language prompt, and receive a real LLM-generated response in the terminal — with no wrapper, no copy-paste, no switching tools.

**What the user can DO at MVP that they cannot do today:**

1. Type "help me design a rate limiter for our API" and get a substantive, contextual response from Claude — not a stub.
2. Type "what is the status of the CI pipeline" (or a mechanical query) and get an executed result, not a placeholder.
3. Stay in the REPL across multiple exchanges — the next prompt builds on the previous response.
4. Trust that what `teo` does is gated: they can see the route decision, they can interrupt with Ctrl+C, and there is an audit trail.

**The user's stated benchmark:** "I want to use TEO the same way I use Claude Code or Gemini-CLI."

That means, at minimum:
- Open terminal, type `teo`, get a prompt.
- Type natural-language intent, get a real response.
- The conversation persists within the session.
- Ctrl+C returns to prompt without killing the session.
- The tool feels like a peer to `claude` / `gemini`, not a demo toy.

The MVP does NOT need to ship the full SOC2 certification control stack, multi-tenant features, or npm/PyPI distribution. The bar is "works end-to-end as a REPL for one user, locally."

---

## PM Acceptance Criteria by Milestone

**Note:** The staff-engineer defines the milestone scope and sequencing. The following PM criteria are written to cover the logical phases that must exist between current state (classifier + stubs) and MVP. The staff-engineer's roadmap will name and bound each milestone. PM criteria below are organized by _what gets unlocked_ at each phase transition.

---

### Milestone A — Real LLM Response (Architectural Pipeline Live)

**Goal:** The architectural stub is replaced by a real LLM call. The user types an architectural question and gets a real Claude response.

**User Stories**

**US-A1 — Real architectural response**
As a user, when I type "help me design a caching strategy for a high-traffic API," I receive a substantive, contextual response from Claude — not a stub placeholder — so I can actually use TEO to think through design problems.

**US-A2 — Response renders in the REPL**
As a user, the LLM response appears inline in the REPL, beneath the `[→ architectural]` routing indicator, so I don't have to look elsewhere for the answer.

**US-A3 — Ctrl+C during response**
As a user, if I press Ctrl+C while Claude is generating a response, the generation stops and I return to the `teo>` prompt, so I'm not locked out if a response is taking too long or I made an error.

**Acceptance Criteria (Observable Behavior)**

- User types an architectural question; response contains substantive content, not `[architectural stub]`
- Response appears inline beneath the route indicator
- `teo --debug` shows that a real LLM call was made (e.g., a log entry confirming the runtime was invoked, NOT just preflight)
- Ctrl+C during generation: response generation halts; prompt returns to `teo>`; no orphaned process or hanging subprocess
- If the LLM call fails (network error, auth error, rate limit): user sees a human-readable error message, not a stack trace; REPL continues
- Cold start to first real response (including LLM round-trip) is measured and logged — this is a required deliverable, not just a stretch goal

**BDD Scenarios**

Given I have `teo` open at the prompt  
When I type "help me think through a microservices vs monolith decision" and press Enter  
Then I see `[→ architectural]` followed by a response from Claude with substantive content (more than one sentence, addresses the tradeoff)

Given I have `teo` open and have initiated an architectural query  
When the LLM is generating a response and I press Ctrl+C  
Then the response stops mid-stream and `teo>` reappears without the REPL exiting

Given the Claude CLI is not authenticated or the API is unreachable  
When I type any architectural query  
Then I see a human-readable error ("teo: could not reach the LLM — check your auth / network") and the REPL continues accepting input

**Done Definition**

Milestone A is done when: a fresh user runs `teo`, types a design question, and receives a real Claude response in the terminal. Stub copy (`[architectural stub]`) must not appear in the output for architectural-routed inputs.

---

### Milestone B — Mechanical Pipeline Live + Session Continuity

**Goal:** The mechanical pipeline executes real operations. The session maintains context across multiple turns (prior exchanges influence the current response).

**User Stories**

**US-B1 — Mechanical execution**
As a user, when I type a mechanical request (e.g., "show me the current directory" or "run the test suite"), TEO executes it and returns the result — not a stub.

**US-B2 — Session context carries forward**
As a user, when I ask a follow-up question in the same session, the response reflects what we've already discussed — I don't have to repeat myself, so the REPL feels like a conversation, not isolated prompts.

**US-B3 — Mixed session**
As a user, I can ask a mix of architectural and mechanical questions in the same session, in any order, without the session breaking or losing context.

**Acceptance Criteria (Observable Behavior)**

- Mechanical-routed inputs produce real executed results, not `[mechanical stub]`
- The result is correct: "show me the current directory" returns the actual cwd; "what files are in src/" returns the actual file list
- Session state persists across turns within the session: a follow-up question that references "the approach we just discussed" gets a response that actually reflects the prior context
- Switching between mechanical and architectural queries in the same session works without error
- `teo --debug` shows that each turn's context is being passed to the runtime (not re-initialized from scratch on each turn)
- Session context does NOT persist across process exits (cross-session persistence is not in MVP scope)

**BDD Scenarios**

Given I have `teo` open at the prompt  
When I type "what files are in the src/ directory" and press Enter  
Then I see `[→ mechanical]` followed by an actual listing of the files in src/ — not stub text

Given I have had an exchange about "designing a rate limiter using a token bucket"  
When I type "what are the tradeoffs of that approach" in the same session  
Then the response references the token bucket approach without me restating it

Given I type an architectural question followed by a mechanical request in the same session  
When I review both responses  
Then neither response errors; both produce substantive results; the session has not reset

**Done Definition**

Milestone B is done when: a user can run a full mixed session — architectural questions and mechanical tool executions — with responses that build on each other, and no stub text appears for either pipeline.

---

### Milestone C — Parity Polish: REPL UX, Error Handling, Distribution

**Goal:** TEO feels like a shipping product, not a prototype. UX matches the Claude Code / Gemini CLI reference bar. Distribution covers the common developer install path.

**User Stories**

**US-C1 — Up-arrow history**
As a user, I can press the up-arrow key to navigate to my previous inputs, so I don't have to retype queries I've already made.

**US-C2 — Slash commands**
As a user, I can type `/help` to see what commands are available, and `/clear` to clear the session display, so I can manage my REPL session without reading docs.

**US-C3 — Streaming responses**
As a user, long architectural responses start appearing token-by-token rather than waiting for the complete response — so I know the system is working and can read as content arrives.

**US-C4 — Install is one command**
As a user, I can install `teo` with one command (e.g., `brew install teo` or `npm install -g teo`) without downloading and extracting a tarball manually, so onboarding is frictionless.

**Acceptance Criteria (Observable Behavior)**

- Up-arrow navigates to the previous input; multiple presses continue backward through the session history
- `/help` prints a list of available slash-commands and their descriptions; no error
- `/clear` clears the visible session output and returns to `teo>` (session context is NOT reset by /clear — the LLM conversation persists)
- Long responses stream inline — tokens appear progressively; the prompt is not visible during streaming (consistent with Claude Code active-task pattern per ADR-045 OD-3)
- Ctrl+C during streaming: generation halts; prompt returns
- At least one of: Homebrew formula, npm global package, or GitHub Releases binary download that does not require manual tarball extraction
- On a fresh macOS arm64 machine using the published install path: user can be in a live `teo` conversation within 5 minutes of first running the install command

**BDD Scenarios**

Given I have submitted three inputs in the current session  
When I press the up-arrow key at the empty prompt  
Then I see my most recent input pre-filled; pressing up-arrow again shows the input before that

Given I type `/help` at the prompt  
When I press Enter  
Then I see a list of supported slash-commands without an error

Given I ask an architectural question that generates a long response  
When I watch the REPL output  
Then text begins appearing within 2 seconds of submitting the query (not after the full response is ready)

Given I have never installed `teo` before  
When I follow the published install instructions  
Then within 5 minutes I have a working `teo` binary and have received my first real LLM response

**Done Definition**

Milestone C is done when: a developer who has never used `teo` can install it in one step, open the REPL, have a multi-turn conversation, see responses stream in, and use up-arrow to recall their previous queries. The tool is indistinguishable in daily use from `claude` or `gemini` in a terminal.

---

## Gate Thresholds (PM Perspective)

The staff-engineer will define three gates: test, code quality, and active testing. From a product lens:

### Test Gate

The minimum bar is: every user-visible behavior in the acceptance criteria above has at least one passing test that exercises that behavior in a way that would catch a regression. 

A test gate is a formality if it only covers happy-path unit tests while leaving observable UX behaviors untested. Specifically:

- Ctrl+C interrupt during LLM generation must have a test (or verified manual gate entry documenting what was checked)
- Human-readable error messages (auth fail, network fail) must have tests — not just `expect(error).toBeDefined()` but `expect(output).toContain('check your auth')` or equivalent
- Stub text must be explicitly asserted ABSENT in integration tests for Milestones A and B (regression guard)
- Session context continuity (Milestone B) must have a test that sends a follow-up referencing prior context and validates the runtime receives the full history

### Code Quality Gate

Standard: TypeScript clean, no `coverage-ignore` in `src/`, 100% coverage on pure-logic modules (classifier, history, policy — per D-003). 

From a PM lens, one additional constraint: any path that renders output to the user must be covered. Untested render paths are where stub text leaks into production.

### Active Testing Gate

This is the gate that matters most from a product perspective. "It started" is not the bar. The active-testing gate must demonstrate end-to-end behavior from a fresh install.

**Scenarios that must pass for each milestone to be considered done from a PM perspective:**

**Milestone A active-testing scenario:**
1. Fresh macOS arm64 machine, no prior `teo` state
2. Install from tarball (or new install method if Milestone C ships first)
3. Run `teo`, see `teo>` within 2 seconds
4. Type "help me design a caching layer for a high-traffic API", press Enter
5. See `[→ architectural]` and then a real response from Claude with substantive content (not stub, not an error)
6. See the response complete fully
7. Press Ctrl+D — exit cleanly
8. `teo --debug` on a second run shows LLM invocation event in the debug stream

All 8 steps pass = Milestone A ships.

**Milestone B active-testing scenario:**
Builds on Milestone A steps. Additionally:
1. Type "what files are in the src/ directory" — see mechanical execution result
2. In the same session, type an architectural question, then a mechanical one, then reference something from earlier — all work without error
3. Exit and restart — confirm session context did NOT persist (expected: fresh session)

**Milestone C active-testing scenario:**
Builds on Milestone B. Additionally:
1. Install using the one-step published method (not tarball)
2. Verify up-arrow history navigation works
3. Verify `/help` and `/clear` work
4. Verify streaming: watch a long response begin rendering within 2 seconds
5. Time total install-to-first-response: target < 5 minutes

---

## Scope Risks

### Over-build risks

**Streaming before parity.** There's a temptation to ship streaming (Milestone C) before the mechanical pipeline is live (Milestone B). Streaming is visible and impressive. But a streaming stub response is still a stub response. Sequence matters: real responses first, polish second.

**SOC2 full stack blocking MVP.** ADR-0001 has a rich SOC2 control set (manifest hash chain, license validation, remote log shipping). None of these are required to demonstrate that `teo` works as a REPL with a real LLM. If the team treats all SOC2 controls as MVP gates, the MVP slips significantly. The MVP bar is: preflight hook is called, identity token is issued, local audit log is written. Full SOC2 certification is post-MVP.

**Verb-prefix override (M2 Hybrid C).** ADR-0006 explicitly defers verb-prefix override to M2. If the team pre-builds the verb-prefix surface as part of MVP work, that's scope that wasn't asked for. The classifier is working — the user doesn't need to type `architectural: design a caching layer`.

**History cross-session persistence.** M1 AC Section 4 explicitly deferred cross-session history reads. That deferral should hold through MVP unless the user explicitly re-opens it. Within-session up-arrow navigation (Milestone C) is in scope; reading prior-session history into the REPL on startup is not.

### Under-build risks

**Mechanical pipeline scope ambiguity.** "Mechanical execution" is ambiguous without a concrete list of what `teo` can actually do mechanically in v1. Does it run shell commands? Does it read files? Does it query git? Without a clear list, the mechanical pipeline is either too broad (dangerous) or so narrow it's not useful. Staff-engineer or Sage needs to define the v1 mechanical execution surface before Milestone B specs are locked.

**LLM auth UX.** ADR-0001 notes that `ClaudeCliRuntime` relies on the user's existing `claude` CLI auth. If the user hasn't authenticated `claude`, `teo` fails silently or with a confusing error. The MVP must have a clear, human-readable auth failure message that tells the user exactly what to do (e.g., "run `claude auth` to authenticate, then try again"). This is a first-run experience requirement, not a nice-to-have.

**Ctrl+C during LLM generation.** ADR-045 Section UX Consequences says Ctrl+C must cancel an active operation and return to prompt. This is a product requirement, not an implementation detail. If it's not wired correctly, users who Ctrl+C expecting to get back to the prompt will instead kill their session. This must be in the Milestone A active-testing gate, not deferred.

**Streaming vs. atomic response decision.** M1 AC Section 4 explicitly deferred streaming to M3 ("No streaming — responses appear atomically"). If streaming moves earlier (Milestone C above), that's a scope change from the M1 spec. The team needs to consciously re-open that deferral. I've included streaming in Milestone C as an optional polish milestone — but if the staff-engineer's roadmap keeps it deferred, the Milestone C criteria above should be updated to remove it.

---

## Open Questions (for staff-engineer or Sage)

**OQ-PM-1 — Mechanical pipeline v1 execution surface**
What can `teo` actually do mechanically in v1? The acceptance criteria above say "run the current directory listing" and "run the test suite" as examples. But the real question is: what is the bounded list of mechanical operations `teo` supports at MVP? Without this, I can't write precise acceptance criteria for Milestone B mechanical execution. Is it: shell passthrough? Named tool grants? A specific list of operations? This is a staff-engineer / Sage decision, not a PM decision.

**OQ-PM-2 — ClaudeCliRuntime vs ClaudeSDKAdapter resolution**
ADR-0001 has open questions (OQ-1 through OQ-4) about whether `ClaudeCliRuntime` (subprocess) or `ClaudeSDKAdapter` (API key) is the v1 path. The Week 1 spike was listed as a gate for this. Has the spike happened? The answer changes the auth UX story meaningfully: subprocess = user needs `claude` CLI auth; SDK = user needs `ANTHROPIC_API_KEY`. PM needs this resolved to write the auth failure acceptance criteria correctly.

**OQ-PM-3 — Streaming milestone placement**
The M1 AC explicitly deferred streaming to M3. Is streaming still deferred, or does the staff-engineer's MVP roadmap pull it into the MVP window? If streaming is in scope, it belongs in one of the milestones above. If it's still deferred, Milestone C criteria need to be rewritten to remove it and focus purely on UX polish (history, slash-commands, distribution).

**OQ-PM-4 — FU-9 and FU-10 classifier follow-up disposition**
FU-9 ("why + verb" architectural shadowing) and FU-10 (polite/prefixed imperative blind spots) are open after M2. These affect the routing quality that users experience at MVP. Are these follow-ups scheduled for a milestone before MVP ships, or are they accepted as known gaps? If they're accepted gaps, that's fine — I just need them documented in the PM scope guardrails so they don't resurface as blocking MVP issues at the end.

**OQ-PM-5 — Session continuity implementation path**
Milestone B requires multi-turn session context. ADR-0001 describes two paths: per-turn context injection via `claude --print` (serializes full history as prompt prefix) or SDK `messages.create()` with a conversation array. Either can work from a PM perspective, but the implementation choice affects what "context continuity" looks like to the user — specifically, whether there is a practical turn limit before the context window is exhausted. PM needs to know if there is a user-visible turn limit or degradation behavior to write acceptance criteria correctly.

---

## Out of Scope for MVP (PM Guardrails)

The following are NOT in the PM MVP definition and should be deferred:

- Cross-session history persistence (reading prior sessions into the REPL on startup)
- `teo-compliance-report` automated auditor report
- Remote immutable log shipping (CloudWatch, Splunk, S3)
- Multi-tenant control plane
- Live manifest reload without binary restart
- Verb-prefix override (`mechanical: do the thing` syntax) — this is M2 Hybrid C, post-MVP
- Agent conversation loop beyond the single-model LLM integration
- npm / PyPI distribution (tarball + one Homebrew formula is sufficient for MVP)
- SOC2 Type II certification (Type I evidence is acceptable at MVP)

---

*Written for workstream WS-MVP-GAP. Sage reads this document via Agent() return value. Staff-engineer should review OQ-PM-1 through OQ-PM-5 before milestone specs are locked.*
