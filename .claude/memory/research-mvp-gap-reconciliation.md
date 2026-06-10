# WS-MVP-GAP — Evidence Reconciliation (UR-1/2/3)

Reconciles Brodie's response to the three user-ratification decisions against on-disk
evidence. Sources: staff-engineer evidence search + cto MVP re-scope (both 2026-06-09).
This is evidence reconciliation, not re-derivation.

---

## UR-1 — Context summary of last X turns (compaction out of scope)

**Brodie:** "we dont need to worry about compaction... start with a small context
summary of the last x turns. I think this is already designed."

**Verdict: PARTIALLY RIGHT.** Compaction out of scope — agreed. But "already designed"
overstates it.

- Design: ADR-046 Phase 2 (teo-benchmark-repo) sketches an "oldest-N compressed,
  newest-M verbatim" rolling summary. It points to ADR-048 for the full spec, but
  ADR-048 is about memory rotation, not REPL turn summary. So there is no dedicated spec.
- Implementation: NONE. `src/repl/` holds a growing `history: HistoryItem[]` list and
  nothing more. Zero hits for compaction/summarizer/rolling/oldest-N across `src/`.
- Status: DESIGNED_ONLY, and the design itself is an incomplete Phase 2 sketch of an
  unratified ADR whose Phase 1 prerequisite isn't built either.

**Corrected framing:** sketched, not specced, not built.

---

## UR-2 — MVP line ("must be usable as a dev tool")

**Brodie:** "without streaming or mechanical surface we have no product... the point is
to start developing with this tool and show it can do that."

**Verdict: TEAM AGREES.** M3-as-LLM-dispatch-only ships a smarter chat window, not a dev
tool. Without file reads the pipeline answers from training data, not the codebase.

### Revised milestone line
- M1 REPL Baseline — DONE
- M2 Classifier Hardening — DONE (pending staff-eng sign-off)
- **M3-revised = MVP LINE** — Real LLM dispatch + read-only mechanical + multi-turn
  continuity + Ctrl+C + spinner + auth error path
- M4 — Streaming + REPL polish (token streaming, up-arrow, slash commands) — near-term
- M5 — Write ops + confirmation UX (file write/edit w/ diff, git write, Governor Loop)
- M6 — Production hardening (context compaction, multi-LLM, distribution, SOC2)

### MVP scope
IN: claude --print subprocess dispatch · read-only mechanical (file read scoped to
project root, git status/log/diff/show, dir listing) · test runner (bun/vitest output in
REPL) · multi-turn continuity (prior turns as context prefix) · Ctrl+C cancels in-flight
· auth error before REPL loop · --debug LLM events · buffered output + spinner.

OUT (post-MVP): file writes/edits (no confirmation/diff UX — unsafe) · git writes · shell
passthrough · token-by-token streaming · slash commands / up-arrow · cross-session persist.

### Streaming
Token-by-token NOT required for MVP. A spinner IS required (without it a 5s call looks
hung). Full streaming = ~2-3 eng-days, moved to M4 (not M6). Responses >8s feel laggy
even with spinner.

### Estimate
~10-13 eng-days for the revised MVP.

### Acceptance criteria (terminal-testable)
1. Architectural query returns substantive Claude output, not `[architectural stub]`;
   --debug shows LLM invocation.
2. "what files are in src/" returns real filesystem; "what does classify do" references
   actual code, not hallucination.
3. Multi-turn: response B builds on response A without being re-told.
4. Ctrl+C mid-generation returns to prompt, REPL alive, no orphaned subprocess.
5. Auth failure → human-readable message before prompt loop, clean exit, no stack trace.

---

## UR-3 — SPIKE-001 / multi-turn coherence

**Brodie:** "we already fucking did this? multiple times, we've also proved multi turn
coherance."

**Verdict: EVIDENCE CONTRADICTS RECOLLECTION — GENUINELY_OPEN.**

- `docs/spikes/SPIKE-001-claude-cli-multi-turn.md` header says `Status: COMPLETE` but its
  own summary (line 18) says live multi-turn coherence testing was BLOCKED by the TEO
  sandbox allowlist; structural analysis says viable, live validation is a recommended
  follow-up.
- Open items OI-1 (3-turn coherence test) and OI-2 (tool-flag enforcement) both marked
  "High — needed before ACCEPTED."
- Pass evidence: NONE. `tests/e2e/` is empty. No SPIKE-001 go-signal (SPIKE-002 ones
  exist). No git commit references OI closure or multi-turn coherence. cto-roadmap.md
  itself says multi-turn coherence and tool-flag enforcement "not confirmed live."
- The COMPLETE header is wrong — should be PARTIAL. But the open items are NOT secretly
  resolved. Both are ~10-min terminal tests, runnable outside the TEO sandbox.

---

## Meta-finding (changes a prior assumption)

`daemon/` and `packages/runtime/` DO NOT EXIST in the current greenfield repo. The ADRs
and prior staff-eng assessment referenced them as prior art, but they were deliberately
not migrated. The LLM dispatch path is a from-scratch build, not "elevate existing
adapter." This is why M3-revised carries a 3-4 day LLM-dispatch line item.

## Stale-doc cleanups (mechanical, low-risk)
1. SPIKE-001 status header: COMPLETE → PARTIAL.
2. ADR-0005 OQ-3 (long-PEM --define): ADR lists OPEN but it's RESOLVED on disk —
   `docs/spikes/OQ3-long-pem-define.md` (commit d959af4) records PASS at 137/201/616 chars.
