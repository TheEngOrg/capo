# TEO M1 — Acceptance Criteria

**Status:** LOCKED  
**Date:** 2026-05-28  
**Author:** Product Manager  
**OQ Closures:** ADR-0006 OQ-2, ADR-0006 OQ-3

---

## Section 1 — M1 Goal Statement

M1 delivers a working REPL binary named `teo`. A user runs it, types any freeform input, sees the system classify and route that input to either `MECHANICAL` or `ARCHITECTURAL`, and gets a stub response that proves the dispatch path is alive. Identity token issuance and `PolicyEnforcement.preflight()` are wired in from day one — not mocked, not skipped. M1 is done when the dispatch pipeline is observable, the SOC2 baseline hooks are verifiable, and the binary ships as a signed single-binary tarball on both macOS arm64 and Linux x64.

---

## Section 2 — User Stories

**US-01 — First launch**
As a new user, when I run `teo` with no arguments, I see a `teo> ` prompt and can start typing immediately, so I know the REPL is ready.

**US-02 — Mechanical request**
As a user, when I type a clearly operational request (e.g., "show me the current directory"), I see `[→ mechanical]` inline and a stub response confirming the mechanical pipeline received my input, so I can see the classifier is working.

**US-03 — Architectural request**
As a user, when I type a design or reasoning request (e.g., "help me design an auth system"), I see `[→ architectural]` inline and a stub response confirming the architectural pipeline received my input.

**US-04 — Ambiguous input**
As a user, when I type something the classifier can't confidently categorize, I see `[→ architectural]` inline (not an error, not a "please rephrase" prompt), and get a stub response — so I'm never blocked waiting to re-type.

**US-05 — Clean exit**
As a user, when I press Ctrl+D (or type a quit command if one exists), the REPL exits cleanly with no stack trace, so I can trust the binary behaves like a normal CLI tool.

---

## Section 3 — Acceptance Criteria (Observable Behavior)

**Binary**
- `teo` binary launches on macOS arm64 without additional runtime installs
- `teo` binary launches on Linux x64 without additional runtime installs
- Cold start to ready prompt is measured on day one of M1 ship; the M1 target is < 2000ms (measurement is a required deliverable, not just a stretch)
- `teo --version` prints the version string from `package.json` to stdout
- `teo --help` prints usage to stdout; format is TBD by staff-eng (Ink-style or Click-style both acceptable) but the command must not error

**REPL interaction**
- `teo` with no arguments opens an interactive REPL with prompt `teo> `
- User input is captured via Ink's `TextInput` component
- Pressing Enter submits the current line for processing
- Pressing Ctrl+C while the system is processing interrupts the current operation and returns to the prompt (does not exit the REPL)
- Pressing Ctrl+D exits the REPL cleanly (exit code 0, no stack trace)
- Blank input (Enter with no text) is a no-op — prompt re-renders, nothing is submitted to the classifier

**Classifier**
- Every non-blank input is classified to exactly one of: `MECHANICAL`, `ARCHITECTURAL`, `UNKNOWN`
- The routing decision is displayed inline in the REPL output as a dim prefix: `[→ mechanical]`, `[→ architectural]`, or (for UNKNOWN, which routes to ARCHITECTURAL) `[→ architectural]`
- UNKNOWN inputs produce `[→ architectural]` — they do not surface the UNKNOWN label to the user

**Pipeline stubs**
- MECHANICAL pipeline stub renders a one-line placeholder that includes the routed input text (exact wording TBD by staff-eng)
- ARCHITECTURAL pipeline stub renders a one-line placeholder that includes the routed input text (exact wording TBD by staff-eng)
- Both stubs render atomically — no streaming, no partial output

**SOC2 baseline**
- An identity token is issued once per session on REPL startup; its issuance is verifiable via `--debug` flag output or a local audit log file
- `PolicyEnforcement.preflight()` is called before each pipeline execution; calls are verifiable via `--debug` flag output or a local audit log file
- Neither hook silently no-ops — if either fails, the error surfaces to the user as a human-readable message

**History**
- Each submitted input is appended to a local history file in `<route>: <text>` format (e.g., `mechanical: show me the current directory`)
- UNKNOWN-classified inputs are written as `architectural: <text>` (the user-visible route, not the internal classifier label)
- The history file is written during the session; reads from prior session history are not in M1

**Error handling**
- Any unhandled error path renders a human-readable message to the REPL; no raw stack traces are shown to the user
- The binary exits with a non-zero exit code on fatal startup errors

---

## Section 4 — Scope Guardrails (What's NOT in M1)

- No LLM-backed classifier — heuristic only
- No actual MECHANICAL or ARCHITECTURAL execution — stubs only, no tool calls, no Claude calls
- No verb-prefix override syntax (e.g., `mechanical: do the thing`) — that's M2 Hybrid C
- No reading prior session history into the REPL on startup — file write is in scope, file read on launch is M2+
- No multi-line input — single line per prompt submission
- No slash commands beyond any REPL-builtins staff-eng chooses to add (if any — see Section 5)
- No streaming — responses appear atomically; streaming is M3
- No agent conversation loop — M3
- No tool grant policy enforcement beyond the preflight skeleton — M4 is full enforcement
- No audit log shipping — local file write only; log shipping is M5
- No PyPI or npm distribution — tarball for dev install is the M1 distribution target

---

## Section 5 — Open Questions for Implementation Specs

The following are deliberately left open for qa and staff-eng to resolve in their specs:

- **Heuristic seed patterns:** What specific keywords or patterns trigger MECHANICAL vs ARCHITECTURAL? Staff-eng should propose the starter list; qa should write misuse cases against it. We don't need to settle this in the PM spec.
- **Slash commands:** Does the REPL support `/help` or `/quit` as built-ins, or do we handle quit exclusively via Ctrl+D and omit slash commands entirely in M1? Staff-eng to decide; if slash commands are added they must appear in the `--help` output.
- **Stub response content:** What does the placeholder text look like? Does it echo the input? Does it include the classifier label? One line or multi-line? Staff-eng proposes; qa writes the assertion. The AC above says "includes the routed input text" — that's the PM floor.

---

## Section 6 — OQ Closures

**ADR-0006 OQ-2 — UNKNOWN routing in M1**

Closed. UNKNOWN inputs route to ARCHITECTURAL.

I'm signing off on the CTO default. The rationale holds from a product lens: in M1, both pipelines are stubs. There's no cost difference between a wrong-but-labeled-architectural stub and a wrong-but-labeled-mechanical stub. What there *is* a cost to is blocking the user with "please rephrase" before they've seen anything — that's friction with no upside when the result is a stub either way. The inline `[→ architectural]` label keeps the routing decision visible and correctable via user feedback. We can tune the heuristic in M1 based on what we observe routing to UNKNOWN. This is locked.

**ADR-0006 OQ-3 — History format `<route>: <text>`**

Closed. Format is `<route>: <text>` (colon-space separated).

From a product/UX lens this works. A user reading their history sees `architectural: help me design an auth system` — the route label is right there, parseable by eye and by tool. The forward-compatibility argument is strong: when M2 ships verb-prefix override syntax, the history format already mirrors that surface, so power users will recognize it immediately. The only mild concern is readability when the text itself contains a colon (e.g., `mechanical: list files in src: `) — but that's a parsing edge case for staff-eng to handle, not a reason to change the format. This is locked.

---

## Section 7 — Done Definition

M1 is done when the following scenario runs end-to-end on a fresh macOS arm64 machine from a tarball install, with no prior `teo` state:

1. User installs the tarball, runs `teo --version` — sees the version string.
2. User runs `teo` — sees `teo> ` within 2 seconds.
3. User types `show me the current directory`, presses Enter — sees `[→ mechanical]` and a stub response that includes their input text.
4. User types `design a caching layer for a high-traffic API`, presses Enter — sees `[→ architectural]` and a stub response.
5. User types `blorp the fleeb` (ambiguous), presses Enter — sees `[→ architectural]` and a stub response (no error, no "please rephrase").
6. User presses Ctrl+D — REPL exits cleanly with exit code 0.
7. History file on disk contains three entries in `<route>: <text>` format.
8. Running with `--debug` shows identity token issuance at startup and `preflight()` called before each pipeline execution.

If all eight steps pass, M1 ships. If any step fails, it doesn't.
