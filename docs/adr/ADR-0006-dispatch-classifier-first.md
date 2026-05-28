# ADR-0006 — Dispatch Architecture: Classifier-First Routing

**Status:** PROPOSED  
**Date:** 2026-05-28  
**Author:** Technical Writer (draft) — authored from Round 3–4 dispatch deliberation  
**Deciders:** CTO, PM, Design, Staff-Engineer, User  
**Supersedes:** None  
**Related:** ADR-0005 (Stack — Ink on Bun, classifier display rendered via React reconciler), .claude/CLAUDE.md (Dispatcher pattern this ADR mirrors)

---

## Context

TEO M1 ships a REPL as the foundation for agent conversation UX. The REPL's core interaction is: user types freeform input → system routes to the correct pipeline → pipeline executes. The dispatch architecture is the decision about how routing happens.

This is not a hypothetical design space. TEO already has a working dispatch pattern: the `.claude/` Dispatcher in this repo uses Tier 1 trigger phrases and a Tier 2 LLM classifier to route inputs to Sage's pipeline cascade. The question for M1 is how closely TEO's REPL dispatcher should mirror that pattern, and what gets built now vs. deferred.

Three architectures were evaluated in Round 3:

**Architecture A — Verb-prefix:**  
User types `<verb>: <payload>` (e.g., `mechanical: summarize the error`). The verb is the routing instruction. No classifier needed — the routing decision is fully in the user's hands.

Staff-Eng recommended this in Round 3 as the fastest path to a working M1: zero classifier complexity, deterministic routing, easy to test. The tradeoff is that users must know the vocabulary before they can interact with the system at all.

**Architecture B — Classifier-first (chosen):**  
User types freeform input. A lightweight classifier routes to the correct pipeline. No vocabulary required. This mirrors the `.claude/` Dispatcher's Tier 1 + Tier 2 pattern. In M1, the classifier is rule-based heuristic (regex patterns) — no LLM.

PM, Design, and CTO all recommended this in Round 3. Classifier-first is the "teo opens REPL, user types prompt, classifier routes" model that matches the original product intent.

**Architecture C — Hybrid:**  
Classifier-first by default, verb-prefix as power-user override. Best of both: zero cognitive load for new users, precision control for experienced users. Deferred to M2.

The user (Brodie) chose Architecture B — classifier-first in M1 — with Architecture C as the stated M2 direction.

---

## Decision

**TEO M1 ships classifier-first dispatch (Architecture B).**

**Classifier output:** Binary. The classifier produces one of three labels:
- `MECHANICAL` — deterministic, non-LLM operations (file edits, status queries, tool invocations)
- `ARCHITECTURAL` — higher-order planning, design, or multi-step reasoning
- `UNKNOWN` — low-confidence match; user is prompted to clarify or rephrase

**Classifier implementation:** Rule-based heuristic (regex patterns) in M1. No LLM in M1. The classifier logic is a dependency of the M1 spec — the specific seed patterns are PM's territory and are specified there, not here.

**Routing decision is transparent to the user.** When a routing decision is made, the UI displays an inline dim prefix before the response begins. Example: `[→ mechanical]`. This makes mis-routing visible and correctable. Users can see what the system decided and act accordingly.

**Pipeline depth is determined at the classifier.** The classifier produces a single label (MECHANICAL or ARCHITECTURAL) that governs both routing and depth. CTO's Round 3 proposal to split this into a two-stage intent + depth decision was explicitly collapsed to a single-stage decision by the user. One classifier call, one label.

**Verb-prefix override is deferred to M2 (Hybrid C).** M1 ships no verb-prefix shorthand. Power-user override surface is a M2 deliverable.

**Pipeline stubs in M1.** Both MECHANICAL and ARCHITECTURAL pipelines ship as stubs in M1 — each renders the routing label and a "not yet implemented" placeholder. The classifier and routing display are the M1 deliverables; full pipeline depth is M2+.

---

## Rationale

**The user chose Camp 1 — classifier-first in M1.** After Round 3 surfaced the verb-prefix vs. classifier-first split, the user explicitly chose classifier-first to deliver the original product intent: open REPL, type prompt, system figures it out. Verb-prefix was faster to implement but delivered a different product.

**Mirrors the `.claude/` Dispatcher pattern.** The Dispatcher already does this for Claude Code — Tier 1 trigger phrases, Tier 2 LLM classifier, downstream pipeline cascade. TEO's REPL dispatcher is a compiled runtime version of the same shape. Coherence across surfaces matters for the audit story: the same dispatch decision logic appears in both the REPL binary and the Claude Code extension, making the system's routing behavior easier to reason about and audit.

**User ergonomics.** Classifier-first means new users have zero vocabulary to learn before their first interaction. The verb-prefix approach requires users to know that `mechanical:` and `architectural:` exist and understand the distinction before they can use the system at all. That's friction that doesn't need to exist.

**3-of-4 leaders converged.** PM, Design, and CTO all recommended classifier-first or hybrid in Round 3. Staff-Eng recommended verb-prefix-first on engineering efficiency grounds (simpler M1 implementation). The user's choice overrides the efficiency argument — the product goal takes priority when the team isn't unanimous.

**Routing transparency as mis-routing mitigation.** The inline dim prefix (`[→ mechanical]`) addresses the main downside of classifier-first: a mis-routed input wastes the user's time before they can correct it. Making the decision visible at the top of the response means users see a mis-route immediately, not after waiting for a full response from the wrong pipeline. This is a design decision embedded in the routing display spec, not just a UX nicety.

---

## Consequences

### Positive

- New users have zero-friction onboarding. The REPL is immediately usable without reading documentation.
- Mirrors the `.claude/` Dispatcher architecture — coherent dispatch shape across TEO surfaces. Audit and compliance tooling can model routing behavior uniformly.
- Routing decision is visible at response time. Mis-routes are correctable without waiting for a full wrong-pipeline response.

### Negative

- Classifier mis-routing risk. A rule-based heuristic will produce wrong labels on edge cases. In M1, the risk is mitigated by transparent display — users see the routing decision — but there's no override mechanism until M2 ships verb-prefix.
- M1 classifier is heuristic. It will be wrong on inputs that don't match the seed patterns. An LLM-backed classifier would handle the long tail better, but that's deferred to M2+. Acceptable for M1 given pipeline stubs — the cost of a mis-route is a "not yet implemented" message, not an incorrect agent action.

### Neutral

- Verb-prefix deferred. Power-user surface comes in M2 (Hybrid C). Users who want precision routing control will need to wait.

---

## Open Questions

| ID | Question | Owner | Status |
|----|----------|-------|--------|
| OQ-1 | Classifier rule set: what are the initial seed patterns for MECHANICAL vs. ARCHITECTURAL vs. UNKNOWN? This is PM territory — specify in the M1 spec, not in this ADR. | PM | OPEN — M1 spec |
| OQ-2 | Confidence threshold for UNKNOWN: how many failed pattern matches constitute low-enough confidence to surface UNKNOWN rather than defaulting to one of the two pipelines? Should UNKNOWN always prompt the user, or should it default to ARCHITECTURAL as the safer fallback? CTO default: route UNKNOWN to ARCHITECTURAL. The `[→ architectural]` inline routing display makes the decision visible and correctable. Both pipelines are stubs in M1; the cost of a wrong route is a stub response either way. PM sign-off required before M1 spec locks. PM may override based on UX research or user feedback. | CTO + PM | OPEN — CTO default ruling, awaiting PM sign-off before M1 spec locks |
| OQ-3 | History normalization format: when classifier-routed inputs are written to the history file, what's the format? Options: `<route>: <text>`, `<route> | <text>`, or `[route] <text>`. This affects M2 history parsing and any audit tooling that reads history. Lock before M1 implementation begins. Format: `<route>: <text>` (colon-separated). Example: `mechanical: do the thing`. Forward compatibility with M2 Hybrid C — M2's verb-prefix syntax is `mechanical: <payload>`. History format matches what a verb-prefix user would have typed, giving a single parsing path for audit tooling and the M2 history parser. The pipe and bracket variants don't have this property. Staff-Engineer and PM validate parseability before M1 spec locks. Default holds unless they surface a concrete parsing objection. | Staff-Engineer + PM | RESOLVED — to be finalized in M1 spec |

---

## Future Work

- M2: Hybrid C activation — verb-prefix override as opt-in power-user shortcut. This is the stated direction from the dispatch deliberation. The M2 spec should define the verb vocabulary, validation behavior (unknown verb = error vs. fallback to classifier), and whether the classifier still runs on verb-prefixed inputs for audit purposes.
- M2 or M3: LLM-backed classifier replacing heuristic rules. The classifier seam (rule-based heuristic in M1) is designed to be swappable. The interface is the same; the implementation changes from regex to LLM inference. At that point, confidence thresholds become probabilistic rather than rule-based.
- M3: `chat:` integration with Claude conversation loop. The dispatch architecture as designed routes to MECHANICAL or ARCHITECTURAL pipelines. A future `chat:` route (or classifier-detected conversational intent) would connect directly to the multi-turn Claude conversation loop from ADR-0001's `ClaudeCliRuntime`. This integration point is out of scope for M1 but the dispatch architecture is designed to accommodate it as a third routing label.
