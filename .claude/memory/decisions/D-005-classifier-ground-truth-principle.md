# D-005 — Classifier Ground-Truth Principle

**Date:** 2026-05-29
**Author:** staff-engineer
**Status:** Active
**Applies to:** All classifier pattern additions — now and future

---

## The Problem

The M1 classifier had an operational gap: compute and arithmetic inputs (`2+2`, `calculate the total`, `what is 100 divided by 4`) were falling through to UNKNOWN→architectural. That looked wrong to users and was wrong — arithmetic has exactly one correct answer. The gap wasn't just a missing pattern; it exposed the absence of a stated principle for what MECHANICAL means. Without a principle, pattern authors fill the gap with example-fitting: they look at failing tests and write the narrowest regex that makes them pass. That produces a suite that passes today and breaks in two months when a user asks "compute the tradeoffs between our two approaches."

---

## The Decision

The classifier routes on three categories with these precise definitions:

**MECHANICAL** = a single deterministic operation with exactly one correct result. No judgment required. The result doesn't depend on context, preference, or tradeoffs. If the only valid answer to "is there a correct result here?" is "yes, and there's only one," it's MECHANICAL. Examples: arithmetic, unit conversion, deterministic lookups.

**ARCHITECTURAL** = requires judgment. "It depends" is a legitimate answer. Tradeoffs exist and reasonable engineers could pick differently. Examples: design decisions, strategy questions, approach selection.

**UNKNOWN** = genuinely ambiguous. Can't be resolved without more context — and it's not worth asking. Routes to `display_route: 'architectural'` per PM spec Section 3 (don't surface "unknown" to end users).

### Why this principle supersedes example-fitting

Example-fitting produces patterns that are simultaneously too narrow (miss variants the dev didn't think of) and too broad (pass for the wrong reason — the tested phrase happens to match, but the pattern also matches non-deterministic inputs containing the same word). Derivation from the principle forces you to ask "what property of the input makes it deterministic?" before writing the regex. That question changes the pattern.

The principle is the gate. A pattern that can't be derived from it doesn't ship.

---

## M2 Compute Expansion — First Application

M2 closes the compute/arithmetic gap by deriving 8 MECHANICAL patterns from the principle. Compute is MECHANICAL because arithmetic operations have exactly one correct result. The patterns generalize from this property:

- Bare arithmetic expressions (`[\d.]+\s*[+\-*/]\s*[\d.]`) — anchored to sentence start to prevent matching numbers embedded in judgment-frame sentences
- Sentence-initial `calculate|compute|convert` — safe because architectural judgment frames ("how should we compute", "help me decide how to calculate") bury these verbs mid-sentence, not at sentence start
- Verb + digit combos (`add \d`, `multiply|divide|subtract \d`) — digit-gated to distinguish "add 5 and 3" from "add caching"
- `sum (these|the|all|those)` — sum as verb in deterministic quantity context
- `what('?s|\s+is)\s+\d` — "what is 2+2" where no "the" is present (existing pattern required "the")
- `how (much|many) (is|are)` — deterministic quantity questions
- `solve \d` — digit-gated to exclude "solve this design problem"

### Known false positives introduced by M2 (documented, not blocked)

The architecture review identified inputs that mis-route under the M2 patterns. These are real defects, tracked as follow-ups, not reasons to block M2 shipping:

| Input | Routes | Expected | Pattern responsible |
|-------|--------|----------|---------------------|
| `add 10 engineers to the team` | MECHANICAL | ARCHITECTURAL | `/\badd\s+\d/i` — digit gate is insufficient; "add N engineers" is a capacity/org decision |
| `sum the quarterly results` | MECHANICAL | ARCHITECTURAL | `/\bsum\s+(these\|the\|all\|those)\b/i` — "sum the results" is a reporting/judgment question, not a compute request |
| `convert the database schema` | MECHANICAL | ARCHITECTURAL | `/^\s*(calculate\|compute\|convert)\b/i` — schema conversion is an architectural activity |
| `compute the optimal strategy` | MECHANICAL | ARCHITECTURAL | same — "optimal strategy" requires judgment |
| `how much is the project worth` | MECHANICAL | UNKNOWN | `/\bhow\s+(much\|many)\s+(is\|are)\b/i` — "how much is X worth" is valuation, not arithmetic |
| `how many is too many microservices` | MECHANICAL | ARCHITECTURAL | same pattern — opinion question, not count |

All six route wrong. They're post-M2 follow-ups for the dev team. The principle for fixing them: tighten each over-broad pattern using negative lookaheads or require additional structural signals (like a numeric operand) — the same technique digit-gating already uses. Do not revert M2 patterns wholesale; the correct-case coverage outweighs the false positive rate at current volume.

---

## The `solve for x` Ambiguity Call

QA left bare `solve for x` as UNKNOWN and `solve 2x=4` as MECHANICAL. This is correct.

"Solve for x" is genuinely ambiguous. "x" could be a variable in an equation you haven't shown, or a placeholder for "this problem" in a design sense. No additional signal is present to resolve the ambiguity. UNKNOWN is right.

"Solve 2x=4" is deterministic: single linear equation, exactly one solution. The digit immediately following `solve` is the structural signal that distinguishes "a specific equation" from "a vague request." The `/\bsolve\s+\d/i` pattern encodes this correctly.

This asymmetry is the principle in action. Don't flatten it. Future patterns for "solve" variants must require a concrete numeric or algebraic signal before routing MECHANICAL.

---

## Constraint: Principle-First Pattern Development

Future pattern additions to `MECHANICAL_PATTERNS` or `ARCHITECTURAL_PATTERNS` must follow this process:

1. State the principle-based property that makes the target input mechanical or architectural (not "it fails this test")
2. Derive the regex from that property
3. Test adversarial near-misses: inputs that share surface vocabulary but belong to the other category
4. If the pattern catches near-misses: tighten it (digit-gate, sentence-anchor, negative lookahead) before shipping
5. If it can't be tightened without becoming too narrow to be useful: ship the follow-up, document the false positive surface, don't silently swallow it

A pattern written to make a specific failing test pass — without step 1 — is example-fitting. Example-fitting is a BLOCK at staff-review gate.

---

## What We Tried First

The compute gap was initially approached with unanchored compute-verb patterns. An early draft of `compute` without sentence-anchoring would have caught `how should we compute the hash function` as MECHANICAL. The architecture review pressure-tested this and found the anchor is load-bearing: without `^\s*`, judgment-frame sentences with buried compute verbs would mis-route. The anchor is not cosmetic.

The `how much|how many` pattern was an obvious inclusion for "how much is 8 times 9" but turned out to also catch "how much is the project worth." The fix (require a following digit or arithmetic operator) would tighten it correctly but was not implemented in M2. That's a known follow-up — documented above, not a reason to hold M2.

---

## Why This Matters Before the Next Phase

Without this record, the next dev adding patterns for M3 will look at failing tests and write example-fitted regexes. The principle is what separates a maintainable classifier from one that accumulates exceptions until someone rewrites it. This decision locks in the classification contract before the pattern set grows further.

---

## When to Apply

- Every PR that adds or modifies patterns in `MECHANICAL_PATTERNS` or `ARCHITECTURAL_PATTERNS`
- Any dispute about whether an input "should" route mechanical or architectural — resolve against the principle, not against test pass/fail
- Coverage reviews: a 100% passing suite means nothing if the patterns are example-fitted; the principle is the real gate

## When NOT to Apply

- `ARCHITECTURAL_PATTERNS` additions don't need digit-gating in the same way — architectural misfires (routing MECHANICAL as ARCHITECTURAL) degrade UX but don't create "wrong answers"; mechanical misfires do
- Latency-sensitive path changes — the principle governs correctness, not performance

---

## Files Changed

- `src/classifier/patterns.ts` — 8 M2 compute/arithmetic patterns added
- `tests/classifier/classifier.test.ts` — 42 M2 test cases added (MISUSE, BOUNDARY, GOLDEN blocks)
- `tests/classifier/patterns.test.ts` — count assertion updated 18→26

---

## Related

- D-003-coverage-gate-tiered-thresholds.md — coverage policy this work must satisfy (100% on pure-logic modules)
- M1-pass-1-architecture-review.md — architectural constraints the classifier operates within
- M2 qa-spec (go-signal: `.claude/memory/go-signals/M1-pass-2b-qa-validate.json`)

---

## FU-2..FU-5 Resolution — M2 Tightening Pass (D-005 TIGHTENING, 2026-05-30)

**Status:** FU-2, FU-3, FU-5 RESOLVED. FU-4 RESOLVED WITH DOCUMENTED RESIDUALS. FU-6 FORMALIZED (new).

**Staff-engineer gate:** CAD Gate 3, reviewed against this document as the primary bar.

### Resolution Technique

All four patterns were tightened in-place by requiring an additional structural signal derived from the D-005 determinism principle. Pattern count held at 26.

| FU | Pattern tightened | Signal added | Resolution |
|----|------------------|--------------|------------|
| FU-2 | `/\badd\s+\d/i` | Second numeric operand (`and <N>`, `to <N>`, `<op><N>`) | RESOLVED |
| FU-3 | `/\bsum\s+(these\|the\|all\|those)\b/i` | Explicit numeric noun (`numbers`, `values`, `figures`, `totals`) after determiner | RESOLVED |
| FU-4 | `/^\s*(calculate\|compute\|convert)\b/i` | Lookahead: digit OR noun-list match required | RESOLVED (with residuals — see below) |
| FU-5 | `/\bhow\s+(much\|many)\s+(is\|are)\b/i` | Digit immediately following `is/are` | RESOLVED |

Four ARCHITECTURAL_PATTERNS were also extended via `|` alternation to catch false-positive inputs as ARCHITECTURAL rather than relying on UNKNOWN→architectural display collapse.

### Concern A Adjudication — ARCHITECTURAL extensions are LOAD-BEARING

The QA spec asserts `route==='ARCHITECTURAL'` (not UNKNOWN) for FU-2 (add N engineers), FU-3 (sum the quarterly results), FU-4 (convert the database schema, compute the optimal strategy, etc.), and FU-5 (how many is too many). The UNKNOWN→architectural display collapse would satisfy the UX spec but would NOT satisfy the test assertions. The extensions are therefore required by the spec — dev was correct to add them.

Pressure-testing the extensions found no disqualifying new false positives, but two classes of debatable behavior are documented below:

- `add 5 items to the cart` and `add 7 rows to the database` match the FU-2 arch extension and route ARCHITECTURAL. These are operational/programmatic commands that could reasonably be MECHANICAL. They lack a second numeric operand, so the tightened MECHANICAL pattern correctly rejects them. Routing them ARCHITECTURAL (rather than UNKNOWN) is slightly aggressive but not wrong — neither has a single deterministic result given the context-free input. Accepted.
- `add 1 to the counter` — the arch extension does NOT fire (no word between the digit and "to") and the MECHANICAL pattern does not fire (no digit after "to"). Routes UNKNOWN. This is correct: the input is genuinely ambiguous without knowing whether "counter" is a variable or a person count.

### Concern B Adjudication — FU-4 noun allowlist ACCEPTED WITH DOCUMENTED LIMITATION

The allowlist (`total|sum|average|mean|median|percent|difference|product|quotient|remainder|area|volume|distance|speed|rate|cost|tip|tax|discount|interest|balance`) is a principled enumeration of numeric-aggregate nouns in common consumer/developer arithmetic contexts. It is NOT example-fitting in the blocklisting sense — the principle behind each noun is "this word names a numeric aggregate that has exactly one correct result." Each entry is individually defensible.

However, the list is incomplete. Pressure-testing confirmed these routes ARCHITECTURAL when they should be MECHANICAL (or at minimum UNKNOWN):

| Input | Actual route | Expected | Gap |
|-------|-------------|----------|-----|
| `calculate the variance` | ARCHITECTURAL | MECHANICAL | `variance` not in list |
| `calculate the throughput` | ARCHITECTURAL | MECHANICAL | `throughput` not in list |
| `compute the hash` | ARCHITECTURAL | MECHANICAL | `hash` not in list |
| `compute the checksum` | ARCHITECTURAL | MECHANICAL | `checksum` not in list |
| `convert the temperature` | ARCHITECTURAL | UNKNOWN/MECHANICAL | `temperature` not in list (without a unit) |

This is a known limitation of any closed noun enumeration, and D-005 Section 5 (step 5) explicitly permits shipping a follow-up when tightening cannot be done without excessive narrowing. The noun-list approach is accepted at this coverage level. New residuals documented as FU-7 (see below).

The alternative — relying only on the digit-presence branch and letting all noun-only compute requests fall to UNKNOWN — was considered and rejected. It would revert coverage of `calculate the total`, `compute the sum`, `calculate the average`, etc., all of which are in the QA GREEN guards and were explicitly committed to in M2.

### M1 Seed Pattern Confirmation

`/\b(run|exec|execute)\b/i` was NOT modified. Confirmed in git diff. FU-6 (below) formalizes the known false positive.

### No coverage-ignore in src/. Confirmed via grep.

### FU-6 — `run` pattern over-broad (formalized)

`how many services should we run` routes MECHANICAL via `/\b(run|exec|execute)\b/i`. QA spec asserts MECHANICAL (current behavior) and flags it as debatable. Staff position: this is a design philosophy question — "how many should we run" has architectural answers (it depends on SLA, cost, redundancy). The `run` word in the M1 seed is too greedy. This is a false positive from the M1 seed pattern that survived into M2 and the tightening pass.

**Tracking:** FU-6 is scoped OUT of the tightening pass (Sage-confirmed). It is a follow-up for the next classifier pass.

**Resolution approach:** Tighten `/\b(run|exec|execute)\b/i` to require an explicit execution target (a file path, script name, or bare command) — e.g., digit-gate, sentence-anchor to exclude "how many ... should we run" frames.

### FU-7 — FU-4 noun allowlist gaps (new follow-up)

The FU-4 noun allowlist misses numeric-aggregate nouns used in technical/performance contexts: `variance`, `throughput`, `latency`, `count`, `entropy`, `p99`, `percentile`, `checksum`, `hash`, `bandwidth`. Inputs like `calculate the variance` incorrectly route ARCHITECTURAL.

**Resolution approach (next pass):** Either extend the noun list with a principled second tier of technical-numeric nouns, OR refactor the lookahead to a combined strategy: digit OR (noun-list OR unit-of-measure suffix). Do not enumerate indefinitely — find a generalization or accept UNKNOWN as the correct fallback for unlisted numeric nouns.

**Severity:** Low. ARCHITECTURAL display route is the same as UNKNOWN display route (per PM AC Section 3). User sees the same UI treatment. The cost is mild over-conservatism on technical compute requests, not an outright wrong answer.

---

## FU-7 Resolution — CAD Gate 3 (Staff Engineer, 2026-05-30)

**Status: RESOLVED.** FU-7 closed. D-005 closed.

### What dev shipped

The FU-4 noun allowlist was widened from ~21 consumer-math nouns to ~70 nouns organized into four documented sub-categories (statistical aggregates / performance-systems / crypto-data-integrity / physical-unit-measures / financial). A `p\d+` token was added for latency percentiles. A CATEGORY RULE comment was added to patterns.ts explaining the qualifying criterion and the sub-category structure for future additions.

### Principled vs. example-fitting adjudication

**Finding: PRINCIPLED generalization.** The category rule — "a noun qualifies iff it names a numeric quantity with exactly one correct computed result" — does let a future dev decide membership without guessing. I applied it to seven unlisted nouns and the rule gave clean yes/no answers in every case:

| Noun | Rule result | Actual route | Verdict |
|------|-------------|--------------|---------|
| `wavelength` | YES — dimensioned physical scalar | ARCHITECTURAL (not in list) | Correct behavior: not yet listed. Route is acceptable (ARCHITECTURAL display = UNKNOWN display). |
| `voltage` | YES — electrical measure | ARCHITECTURAL (not in list) | Same — acceptable gap, not a regression. |
| `cardinality` | YES — count of elements, single result | ARCHITECTURAL (not in list) | Same — acceptable gap. |
| `headcount` | NO — "headcount" is a compound; "count" does NOT substring-match inside it (word boundary confirmed). "Calculate the headcount" is arguably org-planning. | ARCHITECTURAL | Correct. |
| `morale` | NO — judgment/org value, not a computed scalar | ARCHITECTURAL | Correct. |
| `readability` | NO — subjective quality, no single correct value | ARCHITECTURAL | Correct. |
| `payload size` | NO (as compound) — "payload size" is not a unit-measure noun; "size" alone is context-dependent | ARCHITECTURAL | Correct. |

The rule is consistent and clean. "Wavelength", "voltage", and "cardinality" are honest gaps — they qualify under the rule but aren't in the list. They're not regressions; they're the same class of acceptable miss that `variance` and `throughput` were before FU-7. If volume warrants it, they belong in the physical-measures or statistical sub-categories. The rule makes this decision unambiguous.

### Word-boundary / substring-matching confirmation

All `\b` boundaries in the FU-4 lookahead alternation work correctly. Verified by running the compiled pattern against adversarial inputs:

- `count` does NOT fire inside `account` — `"calculate the account balance"` routes MECHANICAL correctly via `balance` (which IS in the list and is correct: account balance has one correct numeric answer). No substring bug.
- `area` does NOT fire inside `nuclear` — confirmed.
- `mean` does NOT fire inside `meaning` — confirmed.
- `rate` does NOT fire inside `accurate` — confirmed.
- `mass` does NOT fire inside `massive` — confirmed.
- `headcount` — `count` does NOT substring-match inside it — confirmed.

No substring false positives introduced by FU-7.

### New false positives from the widened list

None that are caused by FU-7 work. The one suspicious finding — `"what is the exchange rate strategy"` routes MECHANICAL — is caused by the pre-existing M1 seed pattern `/\bwhat\s+is\s+the\s+(?!best\b)/i`, not by the FU-7 noun list. `"what is the deployment strategy"` has the same behavior and was already wrong before FU-7. This is a pre-existing FU-6-class issue, not a FU-7 regression.

The `"calculate the account balance"` routing MECHANICAL is correct behavior, not a false positive. Account balance has exactly one correct numeric answer.

### Regex catastrophic-backtracking assessment

The FU-4 pattern uses `(?=.*(?:\d|\b(?:noun1|noun2|...)\b))`. The `.*` in a lookahead on a bounded input (REPL lines, typically < 200 characters) is safe. The alternation is an ordered list of short literals — no nested quantifiers, no overlapping ambiguous branches. The engine will not exhibit catastrophic backtracking on inputs of this length. The pattern is linear for practical REPL inputs.

### `convert the temperature` adjudication

**Endorsed as MECHANICAL.** The noun-only form is sufficient signal. The FU-4 noun-list design was specifically decided in the tightening pass (D-005 FU-2..FU-5 section): when a compute verb leads a sentence and the direct object is a recognized numeric-aggregate noun, that combination is sufficient to route MECHANICAL even without an inline digit. `temperature` is a unit-of-measure noun — it names a dimensioned scalar quantity. A unit-conversion of a temperature has exactly one correct result. The claim that `"convert the temperature"` is genuinely ambiguous (vs. `"convert 100F to C"`) does not survive scrutiny: both express the same intent, and "the" determiner doesn't change the deterministic nature of unit conversion. QA's reservation is noted but overruled.

### FU-2..FU-5 confirmation

All four are RESOLVED. Confirmed from the prior tightening pass review section in this document.

### FU-6 status

Still OPEN. Pre-existing M1 seed `/\b(run|exec|execute)\b/i` over-broad issue tracked as the next classifier pass. The `"what is the X"` over-broad M1 pattern is in the same class — both are FU-6-tier, not caused by FU-7 work.

---

## FU-6 Resolution — CAD Gate 3 (Staff Engineer, 2026-05-30)

**Status: CONDITIONAL PASS — BLOCK on C3 only. FU-6 RESOLVED WITH DOCUMENTED RESIDUALS after C3 fix lands.**

**Suite at review:** 339 passed | 7 todo | 0 failed. Typecheck clean. No coverage-ignore in src/.

### What dev shipped

Two M1 seed patterns tightened in-place:

1. `/\b(run|exec|execute)\b/i` → variable-length lookbehind + direct-object requirement.
   Lookbehind excludes judgment lead-ins (should/why/how/whether/when) with `{0,3}` word gap.
2. `/\bwhat\s+is\s+the\s+(?!best\b)/i` → extended negative lookaheads for full judgment-qualifier
   family (right|ideal|recommended|correct|optimal|preferred) and judgment-noun tail (strategy|approach).

Two ARCHITECTURAL_PATTERNS extended via `|` alternation so QA spec `route==='ARCHITECTURAL'` assertions hold (not UNKNOWN→display collapse).

FU-BOUNDARY-11 flipped from MECHANICAL to ARCHITECTURAL — correct.

---

### Concern A — Variable-length lookbehind robustness

**Finding: Real misroutes on high-frequency inputs. Severity: PASS-WITH-FOLLOWUP (FU-8, non-blocking).**

Pressure-tested with bun/vitest. Results:

| Input | Actual | Expected | Finding |
|-------|--------|----------|---------|
| `how should we even consider letting the team run the migration` | MECHANICAL | ARCHITECTURAL | MISROUTE — judgment lead-in 7 words before `run`; {0,3} window too short |
| `why would we possibly want to even run kubernetes here` | MECHANICAL | ARCHITECTURAL | MISROUTE — `why` is 6 words before `run` |
| `when should we consider whether to run containers` | ARCHITECTURAL | ARCHITECTURAL | PASS — caught by `should we` in ARCHITECTURAL_PATTERNS |
| `show me how to run the tests` | MECHANICAL | MECHANICAL | PASS — `show` pattern fires first |
| `tell me why the build failed then run it again` | MECHANICAL | MECHANICAL | PASS — correct: imperative clause follows explanation clause |
| `how to run the tests` | UNKNOWN | MECHANICAL | **MISROUTE** — `how` triggers lookbehind suppression |
| `how do I run the tests` | UNKNOWN | MECHANICAL | **MISROUTE** — `how` + 2-word gap within {0,3} window |
| `how exactly do I run the tests` | UNKNOWN | MECHANICAL | **MISROUTE** — 3-word gap, at boundary; lookbehind still fires |
| `how exactly do I really run the tests` | MECHANICAL | MECHANICAL | PASS — 4-word gap, over window; lookbehind misses correctly |
| `regardless of why this happened run the rollback` | UNKNOWN | MECHANICAL | **MISROUTE** — `why` earlier in sentence suppresses run-match |
| `explain why then run npm test` | UNKNOWN | MECHANICAL | **MISROUTE** — `why` is 2 words before `run` |

**"how to run the tests" and "how do I run the tests" are canonical REPL inputs. They route UNKNOWN silently.** This is a real defect introduced by the lookbehind technique.

**ReDoS assessment:** No risk. `(?:\w+\s+){0,3}` is a bounded repetition (max 3 iterations), no nested alternation within the quantified group. Linear on practical REPL inputs (< 200 chars).

**Staff position:** Not a block for this commit — the FU-6 mandate (eliminate architectural false positives from M1 seed) is met. The window limitation is a follow-up defect. Tracked as FU-8.

**FU-8 (new):** The {0,3} lookbehind silences "how to run X" and "how do I run X" as UNKNOWN. Resolution options: (a) restrict lookbehind to sentence-start judgment frames only (not mid-sentence occurrence), (b) use a different structural signal (require sentence-initial judgment word rather than lookbehind), or (c) adjudicate "how to run X" as UNKNOWN-intended (procedural question, not imperative). Option (a) or (b) preferred — "how to run the tests" is unambiguously mechanical.

---

### Concern B — ARCHITECTURAL extension scope

**Finding: Extensions are load-bearing. Two under-coverage gaps documented. Severity: PASS-WITH-FOLLOWUP (FU-9, non-blocking).**

QA spec asserts `route==='ARCHITECTURAL'` (not UNKNOWN) for flipped inputs. Extensions required by spec.

Pressure-test results for extension false positives:

| Input | Actual | Assessment |
|-------|--------|-----------|
| `why run the linter before commit` | ARCHITECTURAL | Correct — rationale/justification question |
| `why build this feature` | MECHANICAL (build pattern fires first) | Under-coverage — "why build" is in arch extension but MECHANICAL wins |
| `why start the server` | MECHANICAL (start pattern fires first) | Same cause |
| `what is the caching approach` | ARCHITECTURAL (tail-noun extension) | Correct |
| `what is the right database` | ARCHITECTURAL (qualifier extension) | Correct |

"why build X" and "why start X" route MECHANICAL because MECHANICAL_PATTERNS evaluate first. This is not a new false positive (same behavior as before FU-6) — it's an under-coverage gap in the new arch extension for verbs that appear in both lists.

**Staff position:** Not a block. "Why build X" as MECHANICAL is aggressive but display_route collapse reduces user impact. Tracked as FU-9.

**FU-9 (new):** "why + verb" ARCHITECTURAL extension is partially shadowed by MECHANICAL_PATTERNS when the verb is also in MECHANICAL (build, start, stop, deploy). Resolution: (a) sentence-anchor check — if "why" is the sentence-opening word + operational verb, route ARCHITECTURAL before MECHANICAL evaluation, or (b) document "why build X" as a known MECHANICAL misroute.

---

### Concern C — Debatable Cases Adjudicated

**C1: `run kubernetes` → MECHANICAL**

**ACCEPTABLE AS-IS.** Imperative form, named execution target. No judgment qualifier, no "should", no "why". D-005 principle satisfied: specific command with a concrete execution target. "Should we run kubernetes" is architectural; bare "run kubernetes" is mechanical. Framing is determinative. Document as intended behavior.

**C2: `what is the approach` → MECHANICAL**

**ACCEPTABLE, DOCUMENTED AS AMBIGUOUS RESIDUAL.** Bare "approach" without a subject modifier is genuinely ambiguous. The tail-noun exclusion only fires when a modifier precedes "approach" (`\w+(?:\s+\w+)*\s+approach`). Bare "approach" has no modifier — lookbehind doesn't fire. UNKNOWN would be more defensible, but display_route collapse means the user sees the same UI. No new follow-up required unless a downstream consumer is found that branches on `route==='MECHANICAL'` for this case.

**C3: `what is the architecture` → MECHANICAL**

**THIS IS WRONG. BLOCK — require dev to add "architecture" to the tail-noun exclusion.**

"Architecture" is the canonical architectural judgment noun. It already appears in ARCHITECTURAL_PATTERNS (`/\b(design|architect|architect(ure)?)\b/i`) but is preempted by the MECHANICAL "what is the" match. Unlike "version", "status", or "file size", "architecture" does NOT name a single deterministic property — it names the structural design choices of a system, which require judgment. Letting MECHANICAL preempt it violates the D-005 principle.

**Required fix (minimal — unblocks immediately):**

In BOTH tightened "what is the" MECHANICAL patterns, add `architecture` to the tail-noun exclusion:

Pattern 1 — change:
```
(?!\w+(?:\s+\w+)*\s+(?:strategy|approach)\b)
```
to:
```
(?!\w+(?:\s+\w+)*\s+(?:strategy|approach|architecture)\b)(?!architecture\b)
```

Pattern 2 — same change.

Also add `architecture` to the ARCHITECTURAL tail-noun alternation:
```
\bwhat\s+is\s+the\s+(?:\w+\s+)*(?:strategy|approach)\b
```
→
```
\bwhat\s+is\s+the\s+(?:\w+\s+)*(?:strategy|approach|architecture)\b
```

Test assertions required: `what is the architecture` → ARCHITECTURAL. `what is the current architecture` → ARCHITECTURAL. `what is the architecture of this system` → ARCHITECTURAL.

---

### FU-BOUNDARY-11 Flip

Confirmed correct. "how many services should we run" routes ARCHITECTURAL via `/\bshould\s+we\b/`. Test comment is accurate and consistent with the principle. No issue.

---

### M1 Golden-Path Regression

No regression. 339/339 green. All QA-guarded inputs (current directory, version, status, npm install, git status, run the tests, run the build, run npm install) confirmed MECHANICAL.

---

### New Follow-Ups

| ID | Issue | Severity | Resolution path |
|----|-------|----------|----------------|
| FU-8 | {0,3} lookbehind silences "how to run X", "how do I run X" as UNKNOWN | Medium — high-frequency REPL inputs affected | Restrict lookbehind to sentence-start judgment frames, not mid-sentence occurrence |
| FU-9 | "why + verb" ARCHITECTURAL extension shadowed by MECHANICAL for verbs in both lists (build, start, stop, deploy) | Low — display_route collapse reduces impact | Sentence-anchor on "why" prefix or document as known gap |

---

### Gate 3 Verdict

**⚠️ PASS-WITH-FOLLOWUP — BLOCK on C3 only.**

C3 fix is a one-line edit per pattern (two patterns total). After that lands, FU-6 is RESOLVED. FU-8 and FU-9 are real but non-blocking.

### Permanent decision: noun-list-with-rule approach

The bounded category list with a stated CATEGORY RULE is the accepted permanent approach for compute-noun membership. It is NOT example-fitting in the disqualifying sense — the rule is independently applicable, as verified above. Future additions: pick the correct sub-category, verify the noun names a numeric quantity with exactly one correct computed result, test one adversarial near-miss per D-005 Step 3 before shipping. Do not add judgment terms (optimal, best, ideal, strategy, approach, schema) under any sub-category.

### Files reviewed

- `src/classifier/patterns.ts` — FU-7 widening, CATEGORY RULE comment, sub-category breakdown
- `tests/classifier/classifier.test.ts` — `Classifier M2 refinement — FU-7 noun gaps + greedy edges` block (MISUSE/BOUNDARY/GOLDEN structure)
- `tests/classifier/patterns.test.ts` — count assertion update (if any)

---

## FU-6 / FU-8 / C3 Final Resolution — CAD Gate 3 Re-Review (Staff Engineer, 2026-05-30)

**Status: ✅ PASS-WITH-FOLLOWUPS. FU-6 RESOLVED. FU-8 RESOLVED. C3 RESOLVED. FU-9 and FU-10 tracked.**

**Suite:** 350 passed | 7 todo | 0 failed. Typecheck clean. 100% coverage on patterns.ts + classifier.ts. No coverage-ignore in src/.

### C3 Fix — CONFIRMED RESOLVED

`architecture` added to bare-noun exclusion AND tail-noun exclusion in both MECHANICAL `what is the` patterns. Also added to ARCHITECTURAL tail-noun alternation for affirmative coverage.

Confirmed via live vitest execution:

- `what is the architecture` → ARCHITECTURAL (via `\b(design|architect|architect(ure)?)\b`)
- `what is the current architecture` → ARCHITECTURAL
- `what is the architecture of this system` → ARCHITECTURAL
- `what is the architecture decision` → ARCHITECTURAL
- `what is the version/status/file size/error message/output` → all MECHANICAL (guards intact)

The MECHANICAL negative lookahead excludes `architecture` and the ARCHITECTURAL pattern catches it affirmatively. Both layers working.

---

### FU-8 Anchor — CONFIRMED RESOLVED

The variable-length lookbehind replaced with positive instruction-form anchor:
`/(?:(?:^|\.\s*)\s*|\bto\s+|\bthen\s+|\bhow\s+(?:\w+\s+){0,2}(?:do|does|can)\s+(?:\w+\s+){0,2})(run|exec|execute)\s+\S/i`

**FU-8 mandate inputs confirmed fixed:**

- `how to run the tests` → MECHANICAL (was UNKNOWN)
- `how do I run the tests` → MECHANICAL (was UNKNOWN)
- `how exactly do I run the tests` → MECHANICAL (was UNKNOWN)
- `explain why then run npm test` → MECHANICAL (was UNKNOWN — `then` anchor fires)

**Judgment frames confirmed ARCHITECTURAL:** should we run, how should we run, why run, how many should we run, long chains — all pass. The do-vs-should distinction is clean and exact.

**Instruction-form coverage confirmed working:** how-can/do/does forms; adverb slots 0 and 1; to-chain; then-chain; sentence-boundary form.

**ReDoS:** `(?:\w+\s+){0,2}` appears twice; both are bounded (max 2 iterations), no nested alternation within the quantified group. Safe on REPL-length inputs. Adversarial long inputs confirmed to terminate promptly.

---

### FU-8 Anchor — New Blind Spots (FU-10)

The positive anchor introduced a new failure surface: polite/prefixed imperatives that don't match sentence-start, to-chain, then-chain, or how-do/can form.

| Input | Actual | Severity |
|-------|--------|----------|
| `please run the tests` | UNKNOWN | Medium |
| `just run npm install` | UNKNOWN | Medium |
| `now run the linter` | UNKNOWN | Medium |
| `let's run the tests` | UNKNOWN | Medium |
| `can I run the tests` | UNKNOWN | Medium |
| `you should run the tests` | UNKNOWN | Low-medium |
| `always run the linter before committing` | UNKNOWN | Low |
| `quickly run the tests` | UNKNOWN | Low |
| `go run the migration` | UNKNOWN | Low |
| `also run the tests` | UNKNOWN | Low |
| `regardless of why this happened run the rollback` | UNKNOWN | Low — embedded clause, uncommon in REPL |

Note: `to-chain` correctly handles `I need to run X`, `want to run X`, `going to run X` — these route MECHANICAL. The remaining UNKNOWN cases are for pure polite-prefix forms.

**One judgment-frame misroute introduced by the `to` anchor (FU-10 scope):**

`why would we want to run kubernetes` → MECHANICAL (via `\bto\s+run\s+\S`).

This is a strategic question ("it depends on team, cost, platform maturity") that should be ARCHITECTURAL. The `to run` sub-clause fires even inside a `why would we want` framing. Severity: low for typical REPL use ("why run kubernetes" and "why should we run kubernetes" both correctly route ARCHITECTURAL; the `why would we want to run` phrasing is synthetic). Resolution path: add `\bwhy\s+would\b` as a standalone ARCHITECTURAL pattern, or accept the edge case.

**Staff position on FU-10:** Not a block. The positive-anchor approach is architecturally sounder than the lookbehind — it can be extended without re-introducing window-blindness. Polite prefixes (`please`, `just`, `now`, `let's`) are a well-defined class; a future pass can either (a) add them as allowed sentence-start prefixes in the anchor, or (b) add a separate `\b(?:please|just|now)\s+(run|exec|execute)\s+\S` pattern. The display_route degradation (UNKNOWN→architectural) is the same UI treatment as ARCHITECTURAL.

Tracked as **FU-10**. Next classifier pass.

---

### FU-BOUNDARY-11

`how many services should we run` → ARCHITECTURAL via `\bshould\s+we\b`. Confirmed, no regression.

---

### Follow-Up Tracking (final state after this pass)

| ID | Issue | Status |
|----|-------|--------|
| FU-2 | add N engineers | RESOLVED |
| FU-3 | sum the quarterly results | RESOLVED |
| FU-4 | convert/calculate/compute noun allowlist | RESOLVED |
| FU-5 | how much/many is opinion | RESOLVED |
| FU-6 | run/exec/execute + what-is-the over-breadth | **RESOLVED** |
| FU-7 | FU-4 noun allowlist gaps | RESOLVED |
| FU-8 | Lookbehind window silencing how-to/how-do | **RESOLVED** |
| FU-9 | why+verb ARCHITECTURAL extension shadowed by MECHANICAL (build, start, stop, deploy) | OPEN — low severity |
| FU-10 | Positive anchor blind spots: polite/prefixed imperatives; `why would we want to run X` misroute | OPEN — medium severity on prefix forms |

### Gate 3 Re-Review Verdict

✅ PASS-WITH-FOLLOWUPS. FU-6, FU-8, and C3 all confirmed resolved. Suite 350/350 green. No coverage-ignore. No M1 golden-path regression. FU-9 and FU-10 documented as next-pass work — neither blocks at this level given display_route collapse semantics. Commit approved.
