# TEO M1 — Test Specifications

**Status:** COMPLETE  
**Date:** 2026-05-28  
**Author:** QA  
**Source of truth:** `docs/specs/M1-acceptance-criteria.md` (LOCKED)  
**Parallel artifact:** `docs/specs/M1-implementation-spec.md` (staff-engineer, in-flight)

---

## Section 1 — Test Strategy

We're taking a misuse-first approach: every test category opens with the things a user could do wrong, a caller could do wrong, or an attacker could exploit — before we get to happy paths. The ordering is misuse → boundary → golden within each category, and that ordering is enforced. Tests that exercise pure logic (classifier function, history serialization, SOC2 hook call counts) use Vitest — it's TypeScript-native and runs cleanly under Bun. Tests that exercise Ink component rendering use `ink-testing-library@4.0.0`, which renders components in a virtual terminal without a real TTY. Tests that require an actual compiled binary (startup time, binary execution, cross-platform behavior) are manual smoke tests modeled on SPIKE-002's evidence format — they can't be automated without a real process context, and pretending otherwise produces false confidence. The ADR-0005 OQ-3 gate (long-PEM `--define`) is its own category (Section 6) because it blocks the M1 release build cut regardless of all other test results.

---

## Section 2 — Test Cases

### Category A — Binary & Distribution

**T-01 — Wrong-arch binary graceful failure**  
Category: misuse  
PM AC reference: Binary section — "launches on macOS arm64 / Linux x64 without additional runtime installs"  
Pre-condition: `teo` arm64 binary placed on a Linux x64 machine (or vice versa)  
Action: Execute the binary  
Expected: Process exits non-zero with a human-readable architecture mismatch message; no segfault, no silent hang  
Notes: Manual — requires both target platforms. Acceptable evidence: `file` output confirming arch mismatch, observed exit code.

**T-02 — Execute bit stripped**  
Category: misuse  
PM AC reference: Binary section  
Pre-condition: `teo` binary with execute bit removed (`chmod -x teo`)  
Action: Run `./teo`  
Expected: Shell returns `Permission denied` before the process starts; exit code non-zero  
Notes: This is OS-level behavior but we document it as a known-bad state for install troubleshooting. Automated.

**T-03 — Binary standalone (no tarball context)**  
Category: misuse  
PM AC reference: Binary section — binary ships in a tarball; user might copy it independently  
Pre-condition: `teo` binary copied to an arbitrary directory with no sibling files  
Action: Execute `./teo --version`  
Expected: Prints version string and exits 0; does not crash looking for adjacent files  
Notes: Manual smoke test. Confirms no relative-path resource loading.

**T-04 — `--version` matches package.json**  
Category: boundary  
PM AC reference: Binary section — "`teo --version` prints the version string from `package.json` to stdout"  
Pre-condition: Compiled `teo` binary from current build  
Action: Run `teo --version`, compare stdout to `version` field in `package.json`  
Expected: Exact string match (e.g., `0.1.0`); exit code 0  
Notes: Automated. Vitest test reads package.json and shells out to binary. String comparison must be exact — no trailing newline confusion.

**T-05 — `--help` exits 0**  
Category: boundary  
PM AC reference: Binary section — "`teo --help` prints usage to stdout; the command must not error"  
Pre-condition: Compiled `teo` binary  
Action: Run `teo --help`  
Expected: Exit code 0; stdout is non-empty; stderr is empty  
Notes: Automated. We don't assert on help text format (staff-eng owns that), only on exit code and non-empty output.

**T-06 — No-args REPL opens within 2000ms**  
Category: golden  
PM AC reference: Binary section — "Cold start to ready prompt < 2000ms"; Section 7 step 2  
Pre-condition: Fresh compiled binary on macOS arm64 and Linux x64 (no warm process cache)  
Action: `time ./teo` — measure time from invocation to `teo> ` prompt appearing  
Expected: Prompt visible within 2000ms on both platforms  
Notes: Manual smoke test (`time` command). Run 3 times per platform; record all three. Per PM AC, measurement is a required deliverable, not optional. ADR-0005 OQ-2 open question — this test closes it.

---

### Category B — REPL Lifecycle

**T-07 — stdin closed before REPL ready**  
Category: misuse  
PM AC reference: REPL section — "Pressing Ctrl+D exits the REPL cleanly"  
Pre-condition: `teo` binary started  
Action: Pipe `/dev/null` to stdin immediately (`teo < /dev/null`)  
Expected: Process exits cleanly with code 0; no hung process, no error output  
Notes: Automated via subprocess with piped stdin. Tests the EOF-before-ready path.

**T-08 — Terminal resized mid-input**  
Category: misuse  
PM AC reference: REPL section  
Pre-condition: `teo` running in a real terminal with text partially typed  
Action: Resize the terminal window while input is in progress  
Expected: Input buffer is preserved after resize; prompt re-renders without garbling; next Enter submission works normally  
Notes: Manual — requires a real TTY. Can be validated in SPIKE-002 Test 2 follow-up session.

**T-09 — SIGTERM during REPL operation**  
Category: misuse  
PM AC reference: Error handling section — "binary exits with non-zero exit code on fatal startup errors"; SOC2 section (history must be consistent)  
Pre-condition: `teo` REPL running with at least one history entry written  
Action: `kill -TERM <pid>`  
Expected: Graceful shutdown; history file contains all entries written before SIGTERM; process exits  
Notes: Manual smoke test. History-file consistency is the assertion — not just clean exit.

**T-10 — SIGKILL and history durability**  
Category: misuse  
PM AC reference: History section — each submitted input appended to history file  
Pre-condition: `teo` REPL running with at least one history entry written to disk  
Action: `kill -KILL <pid>`  
Expected: History file contains entries written before the kill; no partial/corrupted entry at end of file  
Notes: Manual. Validates that history writes are atomic per entry (not buffered then flushed on exit). If staff-eng implements buffered writes, this test will catch it. Flag to staff-eng: history writes must be synchronous/atomic per entry.

**T-11 — Blank input is a no-op**  
Category: boundary  
PM AC reference: REPL section — "Blank input (Enter with no text) is a no-op — prompt re-renders, nothing is submitted to the classifier"  
Pre-condition: `teo` REPL running  
Action: Press Enter with empty input buffer  
Expected: Prompt re-renders (`teo> `); classifier is NOT called (verifiable via mock/spy on classifier function); history file receives no new entry  
Notes: Automated with `ink-testing-library`. Assert classifier call count = 0.

**T-12 — Whitespace-only input is a no-op**  
Category: boundary  
PM AC reference: REPL section — implied by blank input rule  
Pre-condition: `teo` REPL running  
Action: Type two spaces, press Enter  
Expected: Same as T-11 — no-op, no classifier call, no history entry  
Notes: Automated with `ink-testing-library`.

**T-13 — Ctrl+C during classifier interrupts, returns to prompt**  
Category: boundary  
PM AC reference: REPL section — "Pressing Ctrl+C while the system is processing interrupts the current operation and returns to the prompt (does not exit the REPL)"  
Pre-condition: `teo` REPL running; classifier artificially delayed (test hook)  
Action: Submit input, then press Ctrl+C before classifier completes  
Expected: Current operation cancelled; `teo> ` prompt re-renders; REPL continues accepting input; process does NOT exit  
Notes: Requires test-instrumented classifier that can be paused. Automated unit test for the cancellation logic; manual TTY confirmation for the key event.

**T-14 — Ctrl+D exits with code 0**  
Category: golden  
PM AC reference: REPL section — "Pressing Ctrl+D exits the REPL cleanly (exit code 0, no stack trace)"; Section 7 step 6  
Pre-condition: `teo` REPL running  
Action: Press Ctrl+D  
Expected: Exit code 0; no stack trace in stderr; process terminates  
Notes: Automated via subprocess — send EOF to stdin, assert exit code.

---

### Category C — Classifier

**T-15 — Empty string input does not crash**  
Category: misuse  
PM AC reference: Classifier section — "Every non-blank input is classified"  
Pre-condition: Classifier function imported directly  
Action: Call `classify("")`  
Expected: Returns `UNKNOWN` (or valid label); does not throw; no crash  
Notes: Automated Vitest unit test. Empty string should logically never reach the classifier (T-11 guards it), but the classifier itself must be defensive.

**T-16 — 10,000-character input does not OOM or hang**  
Category: misuse  
PM AC reference: Classifier section  
Pre-condition: Classifier function  
Action: Call `classify("a".repeat(10000))`  
Expected: Returns a valid label within 100ms; process memory does not spike abnormally; no hang  
Notes: Automated Vitest unit test with timeout assertion. Validates that the heuristic regex engine doesn't catastrophically backtrack on long inputs.

**T-17 — Null bytes in input handled gracefully**  
Category: misuse  
PM AC reference: Classifier section  
Pre-condition: Classifier function  
Action: Call `classify("show me\x00the directory")`  
Expected: Returns valid label without throwing; stdout is not garbled by null byte  
Notes: Automated Vitest unit test.

**T-18 — Unicode input does not crash classifier**  
Category: misuse  
PM AC reference: Classifier section  
Pre-condition: Classifier function  
Action: Call `classify("🎉👋")`, `classify("مرحبا")`, `classify("​​​")` (zero-width chars)  
Expected: All three return valid labels; no crash; no garbled stdout output; process stdout encoding remains UTF-8  
Notes: Three sub-cases in one Vitest test. Zero-width characters are the sneaky one — they can produce empty-looking inputs that bypass the blank-input guard if the guard is byte-length not character-aware.

**T-19 — MECHANICAL seed pattern boundary**  
Category: boundary  
PM AC reference: Classifier section — "MECHANICAL" classification; Section 7 step 3  
Pre-condition: Heuristic seed patterns defined by staff-eng (BLOCKED — see Section 4, Flag F-01)  
Action: Call `classify(<exact mechanical seed keyword>)`  
Expected: Returns `MECHANICAL`  
Notes: Pseudo-code until staff-eng defines the seed list. One test per seed pattern. Exact keyword match at boundary (no surrounding context) must still classify correctly.

**T-20 — ARCHITECTURAL seed pattern boundary**  
Category: boundary  
PM AC reference: Classifier section — "ARCHITECTURAL" classification; Section 7 step 4  
Pre-condition: Heuristic seed patterns defined by staff-eng (BLOCKED — see Section 4, Flag F-01)  
Action: Call `classify(<exact architectural seed keyword>)`  
Expected: Returns `ARCHITECTURAL`  
Notes: Same as T-19, for architectural seeds.

**T-21 — No seed pattern match returns UNKNOWN**  
Category: boundary  
PM AC reference: Classifier section — "MECHANICAL, ARCHITECTURAL, UNKNOWN"; ADR-0006 OQ-2 closure  
Pre-condition: Input that matches no seed pattern  
Action: Call `classify("blorp the fleeb")` (Section 7 step 5 input — intentionally chosen to match nothing)  
Expected: Returns `UNKNOWN`  
Notes: Automated Vitest unit test. "blorp the fleeb" is the PM's own smoke test input — it must return UNKNOWN.

**T-22 — Mechanical input routes to mechanical stub**  
Category: golden  
PM AC reference: Section 7 step 3  
Pre-condition: Full REPL with stubs wired  
Action: Type `show me the current directory`, press Enter  
Expected: `[→ mechanical]` label visible; mechanical stub response rendered; no error  
Notes: Integration test with `ink-testing-library`. Input taken directly from Section 7.

**T-23 — Architectural input routes to architectural stub**  
Category: golden  
PM AC reference: Section 7 step 4  
Pre-condition: Full REPL with stubs wired  
Action: Type `design a caching layer for a high-traffic API`, press Enter  
Expected: `[→ architectural]` label visible; architectural stub response rendered  
Notes: Integration test with `ink-testing-library`.

**T-24 — UNKNOWN routes to architectural, shows `[→ architectural]` not `[→ unknown]`**  
Category: golden  
PM AC reference: Classifier section — "UNKNOWN inputs produce `[→ architectural]`"; Section 7 step 5; PM US-04  
Pre-condition: Full REPL with stubs wired  
Action: Type `blorp the fleeb`, press Enter  
Expected: Display shows `[→ architectural]` (not `[→ unknown]`, not an error, not "please rephrase"); architectural stub renders  
Notes: Integration test with `ink-testing-library`. This is a PM-locked behavior (OQ-2 closure) — the label `[→ unknown]` must never appear in the UI.

---

### Category D — Routing Display

**T-25 — Corrupted classifier return value produces safe fallback**  
Category: misuse  
PM AC reference: Error handling section — "any unhandled error path renders a human-readable message; no raw stack traces"  
Pre-condition: Classifier mock that returns an unexpected value (e.g., `null`, `"BANANA"`, `undefined`)  
Action: Submit any input  
Expected: UI shows human-readable error or falls back to architectural routing; no crash; no raw stack trace visible  
Notes: Automated with `ink-testing-library` using a mock classifier.

**T-26 — Delayed classifier shows pending state**  
Category: boundary  
PM AC reference: REPL section — implied by the interaction model  
Pre-condition: Classifier mock with artificial 500ms delay  
Action: Submit input; observe UI during delay  
Expected: UI shows some indication of pending state (spinner or similar) rather than blank screen; does not hang  
Notes: `ink-testing-library` with fake timers. Exact pending UI is staff-eng's call — we assert non-blank.

**T-27 — `[→ mechanical]` renders inline before stub response**  
Category: golden  
PM AC reference: Classifier section — "routing decision is displayed inline in the REPL output as a dim prefix"  
Pre-condition: Full REPL, classifier returns MECHANICAL  
Action: Submit mechanical input  
Expected: Route label `[→ mechanical]` appears in output before the stub response text; they're on the same or adjacent lines (not separated by blank lines)  
Notes: `ink-testing-library` render snapshot assertion.

**T-28 — Route label uses dim styling**  
Category: golden  
PM AC reference: Classifier section — "dim prefix"  
Pre-condition: Full REPL  
Action: Submit any non-blank input  
Expected: Route label text has dim/muted color applied (Ink `dimColor` prop or equivalent); main stub text is not dim  
Notes: `ink-testing-library` component tree assertion on color props.

---

### Category E — Pipeline Stubs

**T-29 — Stub failure surfaces to user**  
Category: misuse  
PM AC reference: Error handling section — "any unhandled error path renders a human-readable message"  
Pre-condition: Stub mock that throws on render  
Action: Submit any input that routes to the throwing stub  
Expected: User sees human-readable error message; REPL does not crash; returns to prompt  
Notes: Automated with `ink-testing-library` and mock stub.

**T-30 — Stub receives empty payload**  
Category: boundary  
PM AC reference: Pipeline stubs section  
Pre-condition: Stubs receiving an artificially empty input string (defensive — blank-input guard should prevent this but we test the stub itself)  
Action: Call stub function directly with empty string  
Expected: Renders without throwing; one-line output (may say "received empty input" or equivalent — wording is staff-eng's call)  
Notes: Vitest unit test on stub module directly.

**T-31 — MECHANICAL stub includes routed input text**  
Category: golden  
PM AC reference: Pipeline stubs section — "renders a one-line placeholder that includes the routed input text"  
Pre-condition: Full REPL  
Action: Submit `show me the current directory`  
Expected: Stub output text contains the substring `show me the current directory`  
Notes: `ink-testing-library`. Exact wording TBD by staff-eng (Flag F-02), but the input echo is PM-floor.

**T-32 — ARCHITECTURAL stub includes routed input text**  
Category: golden  
PM AC reference: Pipeline stubs section  
Pre-condition: Full REPL  
Action: Submit `help me design an auth system`  
Expected: Stub output text contains the substring `help me design an auth system`  
Notes: Same as T-31 for architectural path.

**T-33 — Stubs render atomically (no streaming)**  
Category: golden  
PM AC reference: Pipeline stubs section — "Both stubs render atomically — no streaming, no partial output"  
Pre-condition: Full REPL  
Action: Submit any input; observe render sequence  
Expected: Stub output appears in a single render cycle — no character-by-character or chunk-by-chunk reveal  
Notes: `ink-testing-library` with render-cycle counting. Exactly one new render containing the full stub text.

---

### Category F — SOC2 Baseline

**T-34 — Identity token issuance failure surfaces to user**  
Category: misuse  
PM AC reference: SOC2 section — "Neither hook silently no-ops — if either fails, the error surfaces to the user as a human-readable message"  
Pre-condition: Identity token issuer mock that throws on call  
Action: Start `teo` REPL  
Expected: User sees a human-readable error message; REPL does not open silently; process exits with non-zero code  
Notes: Automated Vitest integration test. This is a PM explicit floor — silent no-op on token issuance failure is a BLOCK.

**T-35 — `PolicyEnforcement.preflight()` failure surfaces to user**  
Category: misuse  
PM AC reference: SOC2 section — "Neither hook silently no-ops"  
Pre-condition: `preflight()` mock that throws  
Action: Submit any input  
Expected: User sees human-readable error; REPL exits with non-zero code; no silent continuation  
Notes: Automated. PM floor — silent no-op on preflight failure is a BLOCK.

**T-36 — Malformed identity token rejected at preflight**  
Category: misuse  
PM AC reference: SOC2 section  
Pre-condition: Identity token issuer returns a structurally invalid token (empty string, truncated, wrong format)  
Action: Start `teo` REPL  
Expected: `preflight()` rejects the token; REPL exits with clear error message; non-zero exit code  
Notes: Automated. Tests the handshake between token issuance and preflight validation.

**T-37 — `--debug` shows token issuance at startup**  
Category: boundary  
PM AC reference: SOC2 section — "verifiable via `--debug` flag output or a local audit log file"; Section 7 step 8  
Pre-condition: `teo` started with `--debug` flag  
Action: Start REPL and observe stderr/stdout debug output  
Expected: Debug output includes a line confirming identity token was issued (exact format TBD by staff-eng — Flag F-04)  
Notes: Integration test. `--debug` output goes to stderr or a debug channel — staff-eng to specify.

**T-38 — `--debug` shows preflight call before each pipeline execution**  
Category: boundary  
PM AC reference: SOC2 section; Section 7 step 8  
Pre-condition: `teo` started with `--debug` flag  
Action: Submit three inputs  
Expected: Debug output contains exactly three preflight call log entries (one per input); token issuance appears exactly once  
Notes: Integration test. The 1:1 preflight-to-execution ratio is observable here.

**T-39 — Exactly one preflight call per pipeline execution**  
Category: golden  
PM AC reference: SOC2 section — "`PolicyEnforcement.preflight()` is called before each pipeline execution"  
Pre-condition: `preflight` spy/mock that counts calls  
Action: Submit three inputs  
Expected: `preflight` call count === 3; no double-calls, no skipped calls  
Notes: Automated Vitest test with spy. This is the core SOC2 correctness assertion — the 1:1 ratio must be mechanically verified, not just observed in debug output.

---

### Category G — History File

**T-40 — Non-writable history file path shows error, REPL continues**  
Category: misuse  
PM AC reference: History section (implied); Error handling section  
Pre-condition: History file path set to a non-writable location (e.g., `/root/history` or a path where the parent dir doesn't exist)  
Action: Start `teo` REPL, submit an input  
Expected: User sees clear error message about history write failure; REPL continues accepting input; history is auxiliary, not blocking  
Notes: Automated test with mocked filesystem. History failure must not prevent the classifier and stub pipeline from running.

**T-41 — Input containing a colon parses correctly when re-read**  
Category: misuse  
PM AC reference: History section; PM OQ-3 closure — "The only mild concern is readability when the text itself contains a colon (e.g., `mechanical: list files in src: `) — but that's a parsing edge case for staff-eng to handle"  
Pre-condition: History file write path  
Action: Write entry where input text contains a colon: `classify("list files in src: and also test:")` routes to MECHANICAL; write to history  
Expected: History file line is `mechanical: list files in src: and also test:`; when parsed by splitting on first colon only, `route = "mechanical"` and `text = " list files in src: and also test:"` are recovered correctly  
Notes: Automated Vitest unit test on the history serializer. Parser must split on the FIRST colon only. Staff-eng to define the parse strategy — this test defines what "handles correctly" means at the PM floor.

**T-42 — Input containing newlines is handled before write**  
Category: misuse  
PM AC reference: History section — `<route>: <text>` format is one line per entry  
Pre-condition: Input that contains a literal newline character (e.g., pasted text)  
Action: Classify and write `"first line\nsecond line"` to history  
Expected: History file receives exactly one new line per submission; newlines in input are either escaped (e.g., `\n`) or the input is truncated at first newline — staff-eng to decide which, but the file must not gain a spurious extra line  
Notes: Automated. Flag to staff-eng: define the newline-in-input policy (Flag F-05). Our test asserts "exactly one new history line per submission" regardless of which policy is chosen.

**T-43 — Unicode written with correct UTF-8 encoding**  
Category: misuse  
PM AC reference: History section  
Pre-condition: History file write path  
Action: Submit input `"help me build 日本語 support"`, write to history  
Expected: History file line is `architectural: help me build 日本語 support` encoded as valid UTF-8; reading it back produces the original string without corruption  
Notes: Automated Vitest test. History file must be opened with `utf8` encoding, not `ascii` or `latin1`.

**T-44 — History file is appended to, not overwritten**  
Category: boundary  
PM AC reference: History section — "each submitted input is appended to a local history file"  
Pre-condition: History file with two existing entries  
Action: Submit one more input  
Expected: History file now has three entries; original two entries are intact  
Notes: Automated. Tests that the write mode is append, not write.

**T-45 — History file format is `<route>: <text>`**  
Category: boundary  
PM AC reference: History section — "appended to a local history file in `<route>: <text>` format"  
Pre-condition: History file write path  
Action: Submit `show me the current directory` (routes MECHANICAL)  
Expected: History file line is exactly `mechanical: show me the current directory` (lowercase route, colon-space, then input text verbatim)  
Notes: Automated assertion on file contents. Route label is lowercase, not the internal enum value.

**T-46 — UNKNOWN classified input written as `architectural:` in history**  
Category: golden  
PM AC reference: History section — "UNKNOWN-classified inputs are written as `architectural: <text>`"; Section 7 step 7  
Pre-condition: Input that classifies as UNKNOWN  
Action: Submit `blorp the fleeb` (UNKNOWN per T-21)  
Expected: History file entry is `architectural: blorp the fleeb` — NOT `unknown: blorp the fleeb`  
Notes: Automated Vitest test. This is an explicit PM lock from OQ-3 closure.

---

### Category H — Error Handling

**T-47 — Classifier throws, REPL recovers**  
Category: misuse  
PM AC reference: Error handling section — "any unhandled error path renders a human-readable message; no raw stack traces"  
Pre-condition: Classifier mock that throws `new Error("internal classifier failure")`  
Action: Submit any input  
Expected: User sees human-readable message (no raw stack trace text); REPL returns to prompt and continues accepting input  
Notes: Automated with `ink-testing-library`. Stack trace text (containing file paths or line numbers) must not appear in rendered output.

**T-48 — Stub throws, REPL recovers**  
Category: misuse  
PM AC reference: Error handling section  
Pre-condition: Stub mock that throws  
Action: Submit input that routes to the throwing stub  
Expected: Same as T-47 — human-readable message, return to prompt  
Notes: Automated with `ink-testing-library`.

**T-49 — SOC2 hook throws, REPL exits non-zero**  
Category: misuse  
PM AC reference: Error handling section — "binary exits with a non-zero exit code on fatal startup errors"; SOC2 section  
Pre-condition: `preflight()` mock that throws  
Action: Submit input  
Expected: REPL exits with non-zero exit code; clear error message shown to user; no continuation  
Notes: Automated. SOC2 hook failure is treated as fatal — unlike classifier or stub failures which are recoverable.

**T-50 — No stack trace shown on any error path**  
Category: boundary  
PM AC reference: Error handling section — "no raw stack traces are shown to the user"  
Pre-condition: Each of T-47, T-48, T-49 error scenarios  
Action: Observe rendered output for each  
Expected: No text matching patterns like `at Object.<anonymous>`, `Error:`, file paths ending in `.ts`, or line number references (`:<N>:<N>`) appears in the rendered REPL output  
Notes: Automated assertion applied to all error-path tests. Stack trace detection is a regex check on output text.

**T-51 — Fatal startup error exits non-zero**  
Category: golden  
PM AC reference: Error handling section — "binary exits with a non-zero exit code on fatal startup errors"  
Pre-condition: Binary started with a mocked fatal initialization failure  
Action: Start `teo`  
Expected: Exit code != 0; human-readable error in stderr or stdout  
Notes: Automated integration test with mocked startup dependencies.

---

### Category I — Performance

**T-52 — Cold start < 2000ms, macOS arm64**  
Category: boundary  
PM AC reference: Binary section — "Cold start to ready prompt < 2000ms"; Section 7 step 2  
Pre-condition: Compiled `teo` binary on macOS arm64; no warm process  
Action: `time ./teo` — measure to `teo> ` prompt  
Expected: Elapsed time < 2000ms; measure 3 runs, record all three  
Notes: Manual smoke test. Required deliverable on M1 ship day. Closes ADR-0005 OQ-2.

**T-53 — Cold start < 2000ms, Linux x64**  
Category: boundary  
PM AC reference: Binary section  
Pre-condition: Compiled `teo` binary on Linux x64  
Action: Same as T-52  
Expected: Same as T-52  
Notes: Manual smoke test. Can run in Docker with `docker run -it` to get a real PTY.

**T-54 — Classifier latency < 100ms for inputs ≤ 1000 chars**  
Category: boundary  
PM AC reference: Classifier section (implied by sub-2s overall target)  
Pre-condition: Classifier function  
Action: Call `classify()` with 10 different inputs of 1000 characters each; measure call duration  
Expected: All 10 calls complete in < 100ms; no single call exceeds 100ms  
Notes: Automated Vitest test with `performance.now()` timing. The classifier must not be the bottleneck in the startup + response pipeline.

**T-55 — No perceptible delay between Enter and route label**  
Category: golden  
PM AC reference: Classifier section — route label is "inline"  
Pre-condition: Full REPL in real terminal  
Action: Submit input; observe UI timing  
Expected: `[→ mechanical]` or `[→ architectural]` label appears in same render cycle as or immediately after input submission — not after a delay  
Notes: Manual observation in real TTY. This is a UX assertion, not a timer-based one.

---

## Section 3 — Test Infrastructure

**Test runner:** Vitest (Bun-compatible, TypeScript-native). All unit and integration tests run via `bun run vitest` or `npx vitest`. Test files live in `packages/teo/src/__tests__/` and `packages/teo/src/**/*.test.ts`.

**Component rendering:** `ink-testing-library@4.0.0` (confirmed compatible in SPIKE-002). Used for all tests that need to assert on rendered Ink component output without a real TTY.

**Coverage target:** 99% statement + branch coverage on classifier module, pipeline routing logic, SOC2 hook call sites, and history serializer. Coverage measured with Vitest's built-in V8 coverage provider (`vitest --coverage`). The 99% gate is hard — a lower number is a FAIL.

**Manual TTY verification list** — these tests cannot be automated and require human execution in a real terminal session:
- T-06 — cold start timing (both platforms)
- T-08 — terminal resize
- T-09 — SIGTERM + history durability
- T-10 — SIGKILL + history durability
- T-13 — Ctrl+C during classifier (partial — key event requires real TTY)
- T-52, T-53 — cold start measurement (both platforms)
- T-55 — Enter-to-route-label latency perception

The SPIKE-002 Test 2 manual TTY session (raw mode verification) should be run and documented before M1 sprint completion — it's already called out in SPIKE-002's rationale section as an outstanding closure.

**Compiled-binary smoke tests** — T-01 through T-06, T-52, T-53 must run against the actual `bun build --compile` output, not `bun run`. Testing `bun run` without the compiled binary does not validate the SOC2 distribution story. These tests are sequenced after the build step in the M1 CI pipeline.

---

## Section 4 — Open Questions / Flags for Staff-Eng

**F-01 — Heuristic seed patterns (BLOCKS T-19, T-20)**  
The specific regex or keyword list for MECHANICAL vs. ARCHITECTURAL vs. UNKNOWN is not defined in PM's spec (intentionally — it's staff-eng's territory per PM Section 5). T-19 and T-20 are written in pseudo-code until staff-eng defines the seed list. Once defined, we'll expand these into one test case per pattern. Before the seed list ships, T-19 and T-20 are PENDING.

**F-02 — Stub response wording (BLOCKS T-31, T-32)**  
PM specifies stubs must include the routed input text (PM floor). The surrounding wording is staff-eng's call. Until the wording is defined, T-31 and T-32 assert only on the presence of the input text substring, not the full stub string. Once wording is locked, we'll add an exact-string assertion.

**F-03 — Slash commands**  
PM Section 5 leaves this to staff-eng. If `/help` or `/quit` are added, we need additional test cases: T-NEW-A (slash command routes correctly, not to classifier), T-NEW-B (`/quit` exits with code 0), T-NEW-C (unknown slash command shows usage error, not crash). If slash commands ship in M1 they must appear in `--help` output (PM AC). Flag: staff-eng to confirm Y/N before implementation start so we can write or skip these.

**F-04 — History file path (BLOCKS T-40, T-44, T-45, T-46)**  
Tests T-40 through T-46 need a known file path to read and assert on. Likely `~/.teo/history` or `$XDG_DATA_HOME/teo/history`. Staff-eng to specify. Until defined, these tests use a configurable `TEST_HISTORY_PATH` env variable.

**F-05 — Audit log file path + format (BLOCKS T-37, T-38)**  
SOC2 tests T-37 and T-38 can assert on `--debug` output format but the audit log file path and line format need to be defined for the file-based assertions. Staff-eng to specify.

**F-06 — Newline-in-input policy (BLOCKS T-42)**  
T-42 defines the test contract ("exactly one history line per submission") but needs staff-eng to specify whether newlines are escaped or truncated at first occurrence. Test passes either way as long as the one-line invariant holds — but we need to know which to write the "reading it back" assertion correctly.

---

## Section 5 — Test Coverage Map

Every PM AC bullet and every Section 7 smoke-test step is covered.

| PM Acceptance Criterion | Test ID(s) |
|------------------------|------------|
| Binary launches on macOS arm64 without runtime | T-04, T-06, T-52 |
| Binary launches on Linux x64 without runtime | T-04, T-06, T-53 |
| Cold start < 2000ms | T-06, T-52, T-53 |
| `teo --version` prints package.json version | T-04 |
| `teo --help` exits 0 | T-05 |
| Opens REPL with `teo> ` prompt | T-06, T-14 |
| Input via Ink `TextInput` component | T-11, T-22 (integration) |
| Enter submits line for processing | T-22, T-23, T-24 |
| Ctrl+C during processing — interrupts, returns to prompt | T-13 |
| Ctrl+D — clean exit, code 0 | T-14 |
| Blank input is no-op | T-11, T-12 |
| Every non-blank input classified to one of three labels | T-15, T-16, T-17, T-18, T-19, T-20, T-21 |
| Route displayed inline as dim prefix | T-27, T-28 |
| UNKNOWN → `[→ architectural]` (not `[→ unknown]`) | T-24, T-46 |
| MECHANICAL stub includes routed input text | T-31 |
| ARCHITECTURAL stub includes routed input text | T-32 |
| Both stubs render atomically | T-33 |
| Identity token issued once per session — verifiable via `--debug` | T-37, T-39 |
| `preflight()` called before each pipeline execution — verifiable | T-38, T-39 |
| Neither SOC2 hook silently no-ops | T-34, T-35, T-36 |
| History appended in `<route>: <text>` format | T-44, T-45 |
| UNKNOWN written as `architectural:` in history | T-46 |
| History file written during session | T-44 |
| Unhandled errors → human-readable message, no stack trace | T-47, T-48, T-50 |
| Fatal startup errors → non-zero exit code | T-49, T-51 |

| Section 7 Smoke Test Step | Test ID(s) |
|--------------------------|------------|
| Step 1: `teo --version` shows version string | T-04 |
| Step 2: `teo` shows `teo> ` within 2 seconds | T-06, T-52, T-53 |
| Step 3: `show me the current directory` → `[→ mechanical]` + stub with input text | T-22, T-31, T-45 |
| Step 4: `design a caching layer...` → `[→ architectural]` + stub | T-23, T-32 |
| Step 5: `blorp the fleeb` → `[→ architectural]`, no error | T-21, T-24 |
| Step 6: Ctrl+D → exit code 0 | T-14 |
| Step 7: History file has 3 entries in `<route>: <text>` format | T-44, T-45, T-46 |
| Step 8: `--debug` shows token issuance + preflight calls | T-37, T-38 |

All 8 Section 7 steps are covered. All PM AC bullets are covered.

---

## Section 6 — ADR-0005 OQ-3 Gate Test

This test is a **required gate before the M1 release build is cut**. It does not block implementation start, but no release binary ships until this passes. Staff-engineer runs it; this section defines what passing means.

**T-56 — Long-PEM `--define` gate (ADR-0005 OQ-3)**  
Category: boundary  
Owner: Staff-Engineer (per ADR-0005 OQ-3)  
PM AC reference: Binary section (signed single-binary tarball); ADR-0001 D2 (compiled-in key)

**Inputs — three test cases:**

| Case | Input value | Expected |
|------|-------------|----------|
| Case 1: PKCS8 PEM, 120+ chars | Full PKCS8 Ed25519 public key in PEM format (headers + base64 body + footer + escaped newlines): `-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA<68-char-base64-body>=\n-----END PUBLIC KEY-----` — approximately 120 characters | `RELEASE_PUBLIC_KEY.length` at runtime === character count of the defined string. No truncation. `includes('\n') === true`. |
| Case 2: OpenSSH format, 200+ chars | Full OpenSSH Ed25519 public key: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5<remainder of base64 body, ~64 chars> user@host` — approximately 80 chars but include a longer realistic variant by using a key with comment field to push past 200 chars | `RELEASE_PUBLIC_KEY.length` at runtime === character count of the defined string. No truncation. |
| Case 3: Full cert chain | A realistic certificate chain string pushing past 500 characters (headers + multiple base64 blocks + footers, all on one line with escaped newlines) | `RELEASE_PUBLIC_KEY.length` at runtime matches defined string. No truncation at any intermediate byte boundary (test at 256, 512 chars). |

**Build command pattern** (same as SPIKE-002 Test 6, extended with longer values):
```sh
bun build packages/teo/src/index.tsx \
  --compile \
  --define "RELEASE_PUBLIC_KEY=\"<escaped-pem-string>\"" \
  --target=bun-darwin-arm64 \
  --outfile dist/teo-darwin-arm64
```

**PASS definition:** All three cases compile without error AND runtime `RELEASE_PUBLIC_KEY.length` matches the character count of the string passed to `--define` exactly. No case shows silent truncation at any length. Newline escape sequences (`\n`) in the defined value survive as actual newline characters at runtime (`includes('\n') === true`).

**FAIL definition:** Any case where:
- `bun build` exits non-zero
- Runtime `RELEASE_PUBLIC_KEY.length` does not match the defined string's character count
- `RELEASE_PUBLIC_KEY` is `undefined` at runtime
- Newline sequences are silently dropped in cases where they were defined

**Evidence required:** Same format as SPIKE-002 Test 6 — full build command per case, runtime output showing length, `starts-with`, `contains-newline`, and explicit character-count match confirmation. This evidence is part of the M1 release checklist.

**Why SPIKE-002 didn't close this:** SPIKE-002 Case B tested a 97-character PEM string. Real Ed25519 PKCS8 PEM keys are ~120 characters; OpenSSH format is ~80 chars; a full cert chain with comment fields exceeds 200. The gap between 97 chars tested and real-world key lengths is non-trivial. ADR-0005 OQ-3 is explicitly open pending this test.
