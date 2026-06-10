# WS-MVP-GAP: Staff Engineer Assessment

**Workstream:** WS-MVP-GAP  
**Date:** 2026-06-09  
**Author:** staff-engineer  
**Source HEAD:** 800bb60 (main, in sync with origin)

---

## Current State Assessment (Part 1)

### What M1 Delivered vs. Claude Code Peer Comparison

| Capability | Claude Code Has | TEO Status | Technical Note |
|------------|----------------|------------|----------------|
| REPL loop | Yes — `claude` no-args opens interactive session | DONE | Ink + TextInput loop works. Prompt renders, submits are captured, history appended. Verified in real interactive terminal sessions by user. |
| Command history | Yes — up-arrow, Ctrl+R within session | PARTIAL | History is written to a file (`<route>: <text>` format, XDG_STATE_HOME path). In-session up-arrow / history replay is NOT implemented — `TextInput` has no history navigation wired. Reading prior session history on startup is explicitly M2+ per AC Section 4. |
| LLM routing | Yes — routes to Claude, dispatches real inference | MISSING | TEO classifies (`MECHANICAL` / `ARCHITECTURAL` / `UNKNOWN`) via regex patterns. Neither pipeline calls an LLM. `MechanicalStub` renders `[mechanical stub] Received: <input>`. `ArchitecturalStub` renders `[architectural stub] Received: <input>`. No inference call of any kind exists anywhere in the source tree. |
| Slash commands | Yes — `/help`, `/clear`, `/exit`, etc. | MISSING | No slash-command handling exists. The TextInput captures all input identically. ADR-045 specifies `/help`, `/exit`, `/memory`, `/status`, `/model`, `/clear` for v1, but none are implemented. |
| Tab completion | Yes — `/` triggers slash-command completion | MISSING | No completion handler. ADR-045 scopes v1 to slash-command completion only; free-form NL is not completed. Nothing is wired. |
| Async interrupt | Yes — Ctrl+C cancels active operation, returns to prompt | PARTIAL | Ctrl+C while idle is a no-op (spec-correct for M1 — AC only requires interrupt "while processing"). No async operation exists to cancel. The spec notes this needs revisiting when real async work is added in M2. |
| Streaming | Yes — responses stream token-by-token | MISSING | Responses are atomic stubs. No streaming infrastructure exists. Explicitly M3 per AC Section 4. |

### Does TEO Actually Call an LLM?

**No.** There is no LLM call anywhere in the current codebase.

The dispatch pipeline is: classify input → `PolicyEnforcement.preflight()` → append to history state → `appendHistory()` to file → render stub. The stub components (`MechanicalStub`, `ArchitecturalStub`) are static Ink `<Text>` renders. There is no HTTP client, no Anthropic SDK, no `claude --print` subprocess, no fetch to any model endpoint.

The gap: to become a REPL product in the ADR-045 sense, TEO needs an inference seam. ADR-046 (PROPOSED, not yet ratified or implemented) names this the `teo_cli_wrapper` — a stateless CLI call to `claude --print` or equivalent. That wrapper does not exist in source.

### Is the ADR-046 Stateless Runner Built?

**No.** ADR-046 is PROPOSED, not ACCEPTED, and none of its implementation phases have been dispatched.

What exists that is relevant:
- `daemon/src/llm/claude.ts` and `daemon/src/llm/gemini.ts` — noted in ADR-046 as prior art. These are in the `daemon/` package, not in the REPL source tree. Their relationship to the current `src/` is that they demonstrate the pattern; they are not wired to the REPL.
- `packages/runtime/adapters/` — mentioned in ADR-046 as existing `LLMRuntimeAdapter` infrastructure.

What is needed before Phase 1 ships:
- Staff-engineer verification of `claude --print` headless flag semantics (an open gate in ADR-046 §Open Decisions).
- The `teo-cli-wrapper` bash script itself.
- Wiring from `useSubmit.ts` to call the wrapper rather than return a static stub.

### What Does "Active Testing" Currently Look Like?

The CI smoke job runs `teo --version` and `teo --help` on the compiled binary. That is the extent of binary-level exercise in CI.

The test suite (195 tests, 7 todo) covers:
- Unit tests for `classifier`, `patterns`, `identity`, `policy`, `audit/log`, `history`, `useSubmit` — all via Vitest + ink-testing-library (no real TTY, no binary execution).
- Integration tests that spawn `bun src/index.tsx` via `spawnSync` for: `--version`, `--help`, non-TTY guard (piped stdin reject), and piped EOF exit behavior.
- The "golden path" integration test (PM Section 7 smoke) uses a hybrid strategy: subprocess for steps 1/2/6 (binary exits), ink-testing-library component rendering for steps 3/4/5/8. It does NOT exercise the full REPL loop end-to-end via subprocess.

The critical gap the handoff document names explicitly: "ink-testing-library simulates input via its own harness and never exercises real raw-mode key handling or piped binary stdin." Steps 3-5 of the golden path test the classifier and stub components in isolation — they do NOT verify that a user typing into the real interactive REPL sees the classified output. That was verified by Brodie doing a real terminal session, not by an automated test.

---

## Gap Analysis and Milestone Roadmap (Part 2)

### MVP Definition

"The user types a natural-language command into the TEO REPL, TEO routes it, calls a real LLM (Claude or equivalent), and the response streams back to the prompt."

### Current State vs. MVP

The current binary is a classifier + stub renderer. It is M1-complete by spec, but M1 was deliberately scoped to NOT include LLM calls or streaming (AC Section 4: "No LLM-backed classifier", "No actual MECHANICAL or ARCHITECTURAL execution — stubs only", "No streaming"). The gap from current state to MVP is substantial: two full capabilities missing (real LLM dispatch, streaming) plus the ADR-046 runner architecture which is unbuilt.

### Milestone Roadmap

---

**M2 — Classifier Hardening (already partially underway)**

Capability added: The heuristic classifier correctly routes common compute/arithmetic inputs to MECHANICAL. Reduce the "looks broken" demo problem (`2+2` routing to `[→ architectural]`).

Technical work:
- QA writes ground-truth-derived test cases first (the pattern is in the handoff doc under M2 queue).
- Dev expands `MECHANICAL_PATTERNS` for numeric/compute inputs (already done per patterns.ts comments — M2 appears largely complete).
- SE reviews.

User can do after M2: Type `2+2` and see `[→ mechanical]` instead of `[→ architectural]`. The demo no longer looks broken on basic arithmetic inputs.

Status note: The patterns.ts file already includes M2 compute expansion (the file header says "M2 compute/arithmetic expansion"). This milestone may be complete pending SE sign-off and release tag (OQ-3 gate still blocks v0.1.0).

---

**M3 — Real LLM Dispatch (the MVP-critical milestone)**

Capability added: The ARCHITECTURAL and/or MECHANICAL pipeline calls a real LLM. Response appears in the REPL.

Technical work:
1. ADR-046 Phase 1: Build `teo_cli_wrapper` (bash script, wraps `claude --print --output-format stream-json`). Staff-engineer must verify headless flag semantics before dev dispatches (this is a gate in ADR-046 §Open Decisions — not yet done).
2. Wire `useSubmit.ts` to invoke the wrapper instead of rendering a static stub. The stub components become the fallback path if the wrapper is unavailable.
3. Handle wrapper output in the REPL: parse the response, append to history state, render via a new `Output` item type that holds the LLM response text.
4. Auth: the wrapper needs a valid `ANTHROPIC_API_KEY` (or equivalent) available at runtime. Session auth state in `useSubmit` currently carries only a `token_id` (SOC2 identity). The API key is a separate credential — needs a session-start check and a clear "not authenticated" error path.

Note: ADR-046's Governor Loop (Phase 3) and Context Compaction (Phase 2) are NOT required for MVP. MVP needs only Phase 1 — a stateless subprocess call that gets a response back. Phases 2 and 3 are hardening layers.

User can do after M3: Type "explain what a REPL is" → TEO classifies it ARCHITECTURAL → calls Claude → response appears in the REPL. This is the MVP moment.

---

**M4 — Response Streaming**

Capability added: LLM response streams token-by-token into the REPL session rather than appearing atomically after the full response is buffered.

Technical work:
1. `claude --print --output-format stream-json` emits newline-delimited JSON events. Parse the stream incrementally.
2. Add a streaming Ink component (replace the static `Output` text with an accumulating `StreamingOutput` component that re-renders as tokens arrive).
3. Ctrl+C during streaming must cancel the subprocess and return to prompt. This requires the wrapper process PID to be tracked in REPL state and killed on interrupt.

User can do after M4: See the response appear word-by-word, same feel as Claude Code. Ctrl+C during a long response cancels it immediately.

---

**M5 — Session Continuity and Slash Commands**

Capability added: The REPL maintains conversation context within a session (prior exchanges influence the next LLM call). Slash commands (`/help`, `/exit`, `/status`, `/model`) are operational.

Technical work:
1. Context accumulation: maintain a conversation transcript in session state. Pass the transcript as context to each `teo_cli_wrapper` call. This is a simplified version of ADR-048's compaction — just a growing list, no compaction yet.
2. Slash-command router: detect `/` prefix before classifying. Dispatch to a handler map rather than the classifier. `/help` prints help text; `/exit` triggers clean exit; `/status` shows session state; `/model` shows the active model.
3. Up-arrow history navigation in TextInput — requires either a custom Ink input component or wrapping ink-text-input with history state management.

User can do after M5: Follow-up questions ("make it shorter", "give me an example") work because the prior exchange is in context. `/help` shows available commands. Up-arrow recalls prior inputs.

---

**M6 — Production Hardening (pre-1.0)**

Capability added: Governor Loop (ADR-047), Context Compaction (ADR-048), multi-LLM provider support.

Technical work:
1. ADR-046 Phase 3: Governor Loop wraps every `teo_cli_wrapper` call with JSON schema validation, security constraint check, and execution gate. Per-gate retry cap (3 retries, circuit breaker).
2. ADR-046 Phase 2: Chunked context compaction before each call. Oldest-N turns compressed, newest-M verbatim.
3. Gemini provider: `teo_cli_wrapper` already sketches this — wire the Gemini adapter. `/model` slash command selects provider.

User can do after M6: The REPL is hardened against runaway LLM outputs. Long sessions don't degrade. Can switch between Claude and Gemini.

---

## Milestone Gate Architecture (Part 3)

These gates apply to every milestone. They replace the current implicit "dev says it's done" model with mechanical checkpoints.

---

### Gate 1: Test Gate

**What must pass:**

Unit tests (Vitest, `tests/` directory): All tests pass. Zero failures, zero errors.

Coverage gate (enforced by `vitest.config.ts` thresholds via `--coverage` flag):
- The D-003 tiered system is the right model and should be carried forward as-is. No changes needed to the tier structure.
- As new modules are added (LLM wrapper, streaming component, slash-command router, context manager), each new module gets a tier assignment at the time it is written — not after. The rule: pure-logic modules (no React, no I/O, no TTY) are Tier 1 (100% all metrics). React/Ink components with render branches that cannot be exercised headlessly get Tier 2 thresholds (per-file, ≥90% branch, 100% function). The `**/keys.ts` exclusion pattern stays.
- The coverage include list in `vitest.config.ts` must be updated as new source directories are added. Omitting new directories from `include` is a coverage evasion and will be treated as a violation. The LLM wrapper module, streaming logic, and slash-command router must all be under coverage from day one.

Integration tests: both CI matrix platforms must pass (`ubuntu-latest`, `macos-14`).

No new `v8-ignore` or `c8-ignore` directives in `src/`. This is a hard rule from the M1 session — any appearance of coverage suppression in source is a flag.

**Whether new test tooling is needed:** No new tooling for Gate 1. The existing Vitest + ink-testing-library stack is sufficient for unit and component tests. The active testing gap is addressed in Gate 3.

---

### Gate 2: Code Quality Gate

**What must pass:**

TypeScript typecheck: `tsc --noEmit` with zero errors. This is already in CI (`bun run typecheck`). No change needed.

**Linter recommendation: add Biome.**

Rationale: The current "lint" script is just `tsc --noEmit` — which is typecheck, not lint. TypeScript catches type errors but does not catch: unused imports, `no-explicit-any`, consistent code style, prefer-const, no-fallthrough, and dozens of other correctness signals. The handoff doc's CI spec already has a comment noting "If a dedicated linter (eslint, biome, oxlint) is added in M2+, add the invocation here."

Biome is the right choice for this stack:
- Single binary, no plugin ecosystem to manage (unlike ESLint).
- Bun-native: `bun add --dev @biomejs/biome`, invoked as `bunx biome check src/`. No Node compatibility shims needed.
- Faster than ESLint on the same rule set — sub-second on this codebase size.
- Ships a formatter and linter together, replacing the need for Prettier separately.
- oxlint is an alternative but its rule coverage is still maturing relative to Biome's. ESLint is correct but slower and the plugin management overhead is unnecessary for a codebase this size.

Implementation: add `biome.json` with a `recommended` base + project-specific overrides. Add `"lint": "bunx biome check src/"` to `package.json` scripts (replacing the current `tsc --noEmit` alias). Keep `typecheck` as the separate `tsc --noEmit` step. CI runs both.

**Static analysis additions for M3+:**

No dead-code analysis tool needed yet — the codebase is small enough that TypeScript's `noUnusedLocals: true` and `noUnusedParameters: true` (if not already set) cover this. Check `tsconfig.json` and enable those flags if absent. Cyclomatic complexity analysis is not needed at this codebase size.

---

### Gate 3: Active Testing Gate

**This is the gate that doesn't exist yet.**

**Problem statement:** ink-testing-library never exercises real raw-mode key handling, real binary stdin, or real TTY behavior. The current CI smoke job only runs `--version` and `--help`. The interactive REPL — the core product — is exercised zero times in CI. Every milestone ships interactive behavior that is untested mechanically.

**Definition of "active testing":**

The compiled binary (`dist/teo-darwin-arm64`, `dist/teo-linux-x64`) is launched in a real PTY, receives real keystroke sequences, and its stdout/stderr are asserted. Not a subprocess with piped stdin — a pseudoterminal allocation that lets the binary think it has a real terminal.

**Tooling recommendation: a bash harness using `script` or `expect`, run as a separate CI job.**

The options evaluated:

1. **`expect` (TCL-based)** — the classic approach. Allocates a real PTY, sends keystrokes, asserts on output patterns. Works on Linux and macOS. Requires `expect` to be installed (available as an OS package on both CI runners — `sudo apt-get install expect` on ubuntu-latest, `brew install expect` on macos-14). This is the most mature option with the largest community of CLI test examples.

2. **bash + `script` + `timeout`** — simpler than expect but less precise for timing and pattern matching. Allocates a PTY via `script -q -c "<command>" /dev/null` (Linux) or `script -q /dev/null <command>` (macOS). Reasonable for simple "does the prompt appear" checks but fragile for keystroke sequences.

3. **`playwright-terminal`** — not a real package. Playwright supports browser automation; it does not natively support terminal PTY allocation. Skip.

4. **`pexpect` (Python)** — Python port of expect. Available via pip, works well, but introduces a Python dependency to a Bun/Node codebase. Avoidable.

**Recommendation: `expect` for Linux (ubuntu-latest), `script`+`timeout` for macOS (macos-14) with `expect` as the preferred path on both.**

Actually: `expect` is available on macOS via homebrew and is pre-installed on ubuntu-latest GitHub runners. Use `expect` on both platforms. The test scripts live in `tests/e2e/` as `.exp` files.

**What a passing scenario looks like (M3 milestone):**

```
# tests/e2e/repl-basic.exp
set timeout 15
spawn ./dist/teo-darwin-arm64
expect "teo> "
send "what is 2 plus 2\r"
expect -re "\\\[→ mechanical\\\]"
expect -re "(mechanical|stub|2|4|result)"
send "\x04"
expect eof
```

Translated to assertions:
1. Binary starts and shows `teo> ` prompt within 15 seconds.
2. User types a query and presses Enter.
3. Output contains `[→ mechanical]` (classifier ran).
4. Output contains some response content (LLM call returned something).
5. Ctrl+D exits cleanly.

For M1 (current state), the equivalent scenario would only assert steps 1, 2, 3, and 5 (no LLM response yet). A valid M1 e2e scenario:

```
# tests/e2e/repl-m1.exp
set timeout 10
spawn ./dist/teo-darwin-arm64
expect "teo> "
send "show me the current directory\r"
expect -re "\\\[→ mechanical\\\]"
expect -re "mechanical stub"
send "\x04"
expect eof
```

**CI vs. pre-release:**

Run as a CI gate on every PR. The scenario is fast (<15 seconds), deterministic (stubs are static), and catches the class of defect that the M1 session found via manual testing (Ctrl+C, Ctrl+D, raw-mode input). It should not be deferred to pre-release — that's where it was in M1, and it meant two manual test cycles caught defects that should have been caught mechanically.

Starting from M3 (real LLM calls), the e2e job needs a CI secret for `ANTHROPIC_API_KEY`. This is available as a GitHub Actions secret the same way `RELEASE_PUBLIC_KEY` is already configured. The scenario should use a minimal-cost prompt ("say hello in exactly one word") to keep CI costs predictable.

**New tooling installation:**

CI change needed: add `sudo apt-get install -y expect` to the ubuntu-latest e2e job. On macos-14, `expect` is available via `brew install expect` (or may already be present — check `which expect` in a macos-14 workflow step before adding the install).

The e2e job structure:

```yaml
e2e:
  name: E2E (${{ matrix.os }})
  needs: build
  runs-on: ${{ matrix.runner }}
  strategy:
    matrix:
      include:
        - os: darwin-arm64
          runner: macos-14
          binary-name: teo-darwin-arm64
        - os: linux-x64
          runner: ubuntu-latest
          binary-name: teo-linux-x64
  steps:
    - uses: actions/checkout@...
    - name: Install expect (Linux)
      if: matrix.os == 'linux-x64'
      run: sudo apt-get install -y expect
    - name: Install expect (macOS)
      if: matrix.os == 'darwin-arm64'
      run: brew install expect
    - name: Download binary
      uses: actions/download-artifact@...
      with:
        name: binary-${{ matrix.os }}
        path: dist/
    - run: chmod +x dist/${{ matrix.binary-name }}
    - name: E2E — REPL basic scenario
      run: expect tests/e2e/repl-basic.exp
      timeout-minutes: 2
```

The `gate` job must add `e2e` to its `needs` list once this job exists.

---

## Open Questions

**OQ-1 — ADR-046 ratification blocking M3.**  
ADR-046 is PROPOSED, not ACCEPTED. The staff-engineer headless flag verification gate (does `claude --print --output-format stream-json` behave as assumed?) is listed as a pre-Phase-1 open decision and has not been done. Until that verification runs and ADR-046 is ratified, M3 dispatch is formally blocked. This is the first thing to resolve before M3 is scheduled.

**OQ-2 — Streaming format for M4.**  
The `claude --print --output-format stream-json` flag produces newline-delimited JSON events. The exact event schema (which fields carry the token text, which carry metadata) needs to be verified against the current `claude` CLI version before the streaming Ink component is designed. A spike on this is cheaper than designing against an assumed schema.

**OQ-3 — E2E test strategy for M3+ (LLM calls in CI).**  
Running `expect` tests that call a real LLM in CI has cost and reliability implications (LLM response time variance, API rate limits, network failures in CI). Consider whether M3 e2e tests should mock the `teo_cli_wrapper` output for CI (a recorded response fixture) and reserve live LLM calls for a nightly/pre-release job. This is a pragmatic tradeoff, not a standards violation.

**OQ-4 — Auth credential flow.**  
`useSubmit` currently constructs a dummy `IdentityToken` inline (the TODO comment in `useSubmit.ts` line 39-45 notes this). When M3 wires a real LLM call, the API key is a separate credential from the SOC2 identity token. The session startup flow needs to check for `ANTHROPIC_API_KEY` (or equivalent) and surface a clear error before entering the REPL if it's absent. This is a UX correctness issue — the user should know immediately if they're missing credentials, not after typing their first command.

**OQ-5 — Biome adoption timing.**  
Biome can be added at any milestone boundary. Recommend adding it at M2 or M3 — before the codebase grows significantly. Adding it to a large existing codebase tends to produce a noisy initial fix commit that obscures other changes.
