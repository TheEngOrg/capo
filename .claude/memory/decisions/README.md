# Decision Log

Non-obvious implementation calls that future agents need to stay consistent with.

If you made a call that isn't obvious from the code or specs — document it here. Future dev (you, next session) will re-litigate it otherwise.

---

## Naming

`D-NNN-{slug}.md` — sequential, no gaps, kebab-case slug. Next file: `D-003-...`

---

## When to Write One

Any time you make a technical call where a reasonable engineer might pick differently:

- You chose approach A over B after trying B
- You picked a path that looks wrong at first glance but is correct in context
- You defined behavior that isn't pinned by the PM spec or staff-eng spec
- You made a portability or compatibility call that isn't obvious from the code

If the call is obvious from reading the spec, don't write a D-file — you'd just be paraphrasing the spec.

---

## Required Structure

Follow D-001 as the canonical example. Every file needs:

1. **The Problem** — what was ambiguous or broken
2. **The Decision** — what we decided, with code snippet if relevant
3. **What We Tried First** — MANDATORY. This is the highest-value section. It prevents future agents from re-discovering rejected alternatives. If you skipped straight to the right answer, write "didn't try alternatives — reasoning was..." here anyway. "What We Tried First" can be a top-level section or nested under the rationale — pick whichever makes the alternatives readable.
4. **Why This Matters Now** — why the decision needs to be written down before the next phase starts
5. **When to Apply** — concrete guidance: when does this rule kick in, when doesn't it
6. **Files Changed** — which files this decision is tied to (or "none" for preemptive records)
7. **Related** — links to other D-files, specs, or ADRs

---

## Who Writes Them

The agent making the call writes the D-file as part of the work — not as an afterthought, not in a separate cleanup pass. If you're closing a workstream and realize you made a non-obvious call, write the D-file before the go-signal.

---

## Voice

Brodie's voice: conversational, senior engineer, contractions, short paragraphs. No filler ("Furthermore", "Leveraging", "Utilize"). No emoji. Get to the point.

---

## Index

| File | What it covers |
|------|---------------|
| D-001-test-binary-spawn-pattern.md | How to resolve and spawn the Bun binary from Vitest tests — `resolveBun()` pattern |
| D-002-vitest-runs-under-node.md | Vitest workers run under Node, not Bun — `Bun.*` globals are unavailable inside tests |
| D-003-coverage-gate-tiered-thresholds.md | Flat 99% global replaced with per-file tiers — pure-logic at 100%, Session.tsx branch-exempted (TTY paths), global floor as safety net |
| D-004-synchronous-token-issuance-useref.md | useEffect throws escape ErrorBoundary — identity token issuance moved to synchronous render phase with useRef guard to satisfy T-34 |
