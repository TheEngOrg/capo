# Agent Handoff Protocol (WS-0)

> **Version:** 1.2.0
> **Status:** Active
> **Last Updated:** 2026-02-04
> **Owner:** Staff Engineer

This document defines the protocol for passing context between agents during delegation. All agents participating in the delegation system MUST adhere to this specification.

---

## Table of Contents

1. [Core Principles](#core-principles)
2. [Handoff Format](#handoff-format)
3. [Context Rules](#context-rules)
4. [Delegation Depth Tracking](#delegation-depth-tracking)
5. [Loop Prevention](#loop-prevention)
6. [Escalation vs Consultation](#escalation-vs-consultation)
7. [Error Handling](#error-handling)

---

## Core Principles

1. **Minimal Context Transfer** - Pass only what the delegate needs; no more, no less
2. **Structured Communication** - All handoffs use the defined format; no free-form delegation
3. **Bounded Depth** - Maximum 3 levels of delegation; enforced at protocol level
4. **No Circular Delegation** - Agents cannot delegate back up the chain
5. **Fire-and-Forget Consultations** - Peer queries return results; no re-delegation allowed

---

## Handoff Format

### Delegation Request Envelope

Every delegation MUST use this structured envelope:

```yaml
handoff:
  # === ROUTING ===
  id: "<uuid>"                          # Unique identifier for this handoff
  type: "delegation" | "consultation"   # See Section 6 for distinction
  timestamp: "<ISO-8601>"               # When handoff was initiated

  # === CHAIN TRACKING ===
  chain:
    depth: <number>                     # Current depth (1-3)
    max_depth: 3                        # Immutable ceiling
    path:                               # Ordered list of agents in chain
      - agent: "<agent-id>"
        handoff_id: "<uuid>"
    origin: "<original-requesting-agent>"

  # === TASK SPECIFICATION ===
  task:
    objective: "<clear-single-sentence-goal>"
    success_criteria:                   # How delegate knows task is complete
      - "<criterion-1>"
      - "<criterion-2>"
    constraints:                        # Boundaries and limitations
      - "<constraint-1>"
    deliverable: "<expected-output-format>"

  # === CONTEXT PAYLOAD ===
  context:
    essential:                          # REQUIRED: Minimum needed to execute
      - "<key-fact-1>"
      - "<key-fact-2>"
    references:                         # OPTIONAL: Pointers to additional info
      - type: "file"
        path: "<absolute-path>"
        relevance: "<why-this-matters>"
      - type: "decision"
        summary: "<what-was-decided>"
        rationale: "<brief-why>"
    excluded:                           # Explicitly noting what was NOT passed
      - "<category-of-omitted-info>"

  # === RETURN CONTRACT ===
  return:
    format: "structured" | "freeform"
    schema: "<if-structured-define-shape>"
    timeout_minutes: <number>           # Optional deadline
```

### Delegation Response Envelope

Every delegation response MUST use this format:

```yaml
handoff_response:
  # === ROUTING ===
  request_id: "<original-handoff-uuid>"
  responder: "<agent-id>"
  timestamp: "<ISO-8601>"

  # === OUTCOME ===
  status: "completed" | "partial" | "failed" | "escalated"

  # === DELIVERABLE ===
  result:
    summary: "<one-paragraph-executive-summary>"
    deliverable: <actual-output-per-contract>
    confidence: "high" | "medium" | "low"
    caveats:                            # Important limitations or assumptions
      - "<caveat-1>"

  # === METADATA ===
  execution:
    duration_minutes: <number>
    subtasks_delegated: <count>         # 0 if leaf node
    tools_used:
      - "<tool-name>"
```

---

## Context Rules

### What to INCLUDE (Essential Context)

| Category | Include | Example |
|----------|---------|---------|
| **Direct Requirements** | Always | "Must use TypeScript strict mode" |
| **Blocking Constraints** | Always | "Cannot modify legacy-api.ts" |
| **Prior Decisions** | If directly relevant | "Team decided on REST over GraphQL" |
| **File References** | Path + relevance only | "See /src/types.ts for domain models" |
| **Error Context** | If debugging task | "Error occurs on line 45 of parser.ts" |

### What to SUMMARIZE (Reduced Context)

| Category | Summarization Rule | Example |
|----------|-------------------|---------|
| **Discussion History** | Key decisions only | "After review: chose Option B for perf reasons" |
| **Alternative Approaches** | Mention rejected options briefly | "Considered caching; rejected due to staleness" |
| **Technical Background** | One-sentence if delegate may need | "System uses event sourcing pattern" |

### What to OMIT (Excluded Context)

| Category | Rationale |
|----------|-----------|
| **Deliberation Details** | Delegate needs decisions, not debates |
| **Unrelated Codebase Info** | Reduces noise; delegate can discover if needed |
| **Personal Preferences** | Focus on requirements, not opinions |
| **Speculative Futures** | Only current scope matters |
| **Other Agent Conversations** | Privacy and focus boundaries |

### Context Size Guidelines

```
Essential Context:   Max 500 tokens (hard limit)
References:          Max 5 items (prefer fewer)
Total Envelope:      Max 1000 tokens (soft limit, warn if exceeded)
```

---

## Delegation Depth Tracking

### Depth Semantics

```
Depth 0: Human request to primary agent (not counted in agent depth)
Depth 1: Primary agent delegates to first delegate
Depth 2: First delegate re-delegates to second delegate
Depth 3: Second delegate re-delegates to third delegate (TERMINAL)
```

### Enforcement Rules

1. **On Receive**: Agent MUST check `chain.depth` before accepting
2. **On Delegate**: Agent MUST increment `chain.depth` by 1
3. **At Depth 3**: Agent MUST NOT delegate; must complete or escalate
4. **Immutable Max**: `chain.max_depth` is always 3; agents cannot modify

### Depth Check Algorithm

```python
def can_delegate(handoff):
    current_depth = handoff.chain.depth
    max_depth = handoff.chain.max_depth  # Always 3

    if current_depth >= max_depth:
        return False, "DEPTH_LIMIT_REACHED"

    return True, None

def prepare_delegation(handoff, delegate_id):
    can, error = can_delegate(handoff)
    if not can:
        raise DelegationError(error)

    new_handoff = copy(handoff)
    new_handoff.chain.depth += 1
    new_handoff.chain.path.append({
        "agent": self.agent_id,
        "handoff_id": handoff.id
    })
    return new_handoff
```

### Depth Limit Reached Behavior

When an agent at depth 3 cannot complete the task:

1. **Attempt Completion**: Make best effort with available capabilities
2. **Partial Result**: Return what was accomplished with `status: "partial"`
3. **Escalation**: If critical blocker, use escalation path (see Section 7)

---

## Loop Prevention

### Chain Path Validation

Every agent MUST validate the delegation chain before accepting or delegating.

```python
def validate_no_loop(handoff, target_agent):
    # Extract all agents in the current chain
    agents_in_chain = [entry["agent"] for entry in handoff.chain.path]
    agents_in_chain.append(handoff.chain.origin)

    # Check if target would create a loop
    if target_agent in agents_in_chain:
        return False, f"LOOP_DETECTED: {target_agent} already in chain"

    return True, None
```

### Loop Prevention Rules

1. **No Backtracking**: Cannot delegate to any agent already in `chain.path`
2. **No Origin Return**: Cannot delegate back to `chain.origin`
3. **Self-Delegation Forbidden**: Agent cannot delegate to itself
4. **Consultation Exception**: Consultations bypass loop check (see Section 6)

### Violation Handling

If loop detected:
1. Reject the delegation attempt
2. Log the violation with full chain path
3. Return error to delegating agent
4. Delegating agent must find alternative or complete task itself

---

## Escalation vs Consultation

### Definitions

| Aspect | Escalation (Delegation) | Consultation (Query) |
|--------|------------------------|---------------------|
| **Purpose** | Transfer ownership of task | Request information/opinion |
| **Ownership** | Transfers to delegate | Remains with requester |
| **Depth Impact** | Increments depth counter | Does NOT increment depth |
| **Re-delegation** | Delegate may re-delegate (if depth allows) | Consultant CANNOT re-delegate |
| **Response** | Full deliverable | Information/recommendation only |
| **Chain Tracking** | Added to chain.path | NOT added to chain.path |
| **Loop Rules** | Full loop prevention applies | Bypasses loop check |

### Escalation (type: "delegation")

Use when:
- Task requires capabilities you don't have
- Task is better suited to another agent's specialty
- Workload balancing is needed
- Task is a discrete, delegatable unit

Rules:
- MUST include full handoff envelope
- MUST increment depth
- MUST update chain.path
- Delegate owns the outcome

### Consultation (type: "consultation")

Use when:
- Need expert opinion on approach
- Need factual information from specialist
- Want validation of a decision
- Quick question that doesn't warrant full delegation

Rules:
- Uses simplified envelope (task + context only)
- Does NOT increment depth
- Does NOT modify chain.path
- Consultant returns info; requester retains ownership
- Consultant CANNOT delegate or consult further (fire-and-forget)

### Consultation Request Format (Simplified)

```yaml
consultation:
  id: "<uuid>"
  type: "consultation"
  from: "<requesting-agent>"
  timestamp: "<ISO-8601>"

  query:
    question: "<specific-question>"
    context:
      - "<relevant-fact>"
    response_format: "brief" | "detailed"
```

### Consultation Response Format

```yaml
consultation_response:
  request_id: "<uuid>"
  responder: "<agent-id>"

  answer:
    summary: "<direct-answer>"
    details: "<optional-elaboration>"
    confidence: "high" | "medium" | "low"
    sources:
      - "<reference>"
```

---

## Error Handling

### Error Categories

| Error Code | Meaning | Handler Action |
|------------|---------|----------------|
| `DEPTH_LIMIT_REACHED` | At max depth, cannot delegate | Complete locally or return partial |
| `LOOP_DETECTED` | Target agent in chain | Select different delegate |
| `INVALID_ENVELOPE` | Malformed handoff structure | Reject with validation errors |
| `DELEGATE_UNAVAILABLE` | Target agent not responding | Retry, then escalate or complete locally |
| `CONTEXT_OVERFLOW` | Payload exceeds limits | Reduce context, retry |
| `CONSULTATION_VIOLATION` | Consultant attempted delegation | Reject; log violation |

### Error Response Format

```yaml
handoff_error:
  request_id: "<original-uuid>"
  error:
    code: "<ERROR_CODE>"
    message: "<human-readable-description>"
    recoverable: true | false
    suggested_action: "<what-to-do-next>"
```

---

## Quick Reference Card

```
DELEGATION CHECKLIST
--------------------
[ ] Check current depth < 3
[ ] Verify target not in chain.path
[ ] Prepare minimal essential context
[ ] Define clear success criteria
[ ] Specify return format
[ ] Increment depth in new envelope
[ ] Add self to chain.path

CONSULTATION CHECKLIST
----------------------
[ ] Formulate specific question
[ ] Provide minimal context
[ ] Expect info-only response
[ ] Remember: no re-delegation allowed
[ ] Retain task ownership

DEPTH QUICK CHECK
-----------------
Depth 1: Can delegate (2 levels remain)
Depth 2: Can delegate (1 level remains)
Depth 3: CANNOT delegate (terminal)
```

---

## Protected Path Write Handoff (Wave 2)

When a handoff context references deliverables that target protected paths (`.claude/scripts/**`, `.claude/hooks/**`, `.claude/shared/**`, `docs/**`, `src/**`, `packages/**`), the receiving agent MUST use `teo-apply-edit` for any writes — not direct `Edit` or `Write` tool calls. Include the following in the handoff `context.essential` for such deliverables:

```yaml
context:
  essential:
    - "Writes to <protected path> require teo-apply-edit (patch spec JSON, schema_version 1.0.0)"
    - "Direct Edit/Write on protected paths is blocked by pre-edit-write-guard.sh"
  references:
    - type: "file"
      path: ".claude/shared/posix-write-contract.md"
      relevance: "Patch spec schema and bypass contract"
```

Use `teo-apply-edit` for writes to protected paths (`.claude/scripts/**`, `.claude/hooks/**`, `.claude/shared/**`, `docs/**`, `src/**`, `packages/**`); direct Edit/Write on these paths is blocked by the PreToolUse hook. See ADR-038 and `.claude/shared/teo-apply-edit-contract.md`.

---

## Dev Spawn Commit Discipline (Path B — #377)

For any multi-phase CAD workstream where a dev agent will stage and commit files,
include the following block verbatim in the dev spawn prompt:

```
COMMIT DISCIPLINE (mandatory):
1. Finish ALL file edits before touching git.
2. Before git add, run:
     .claude/scripts/teo-commit-lock acquire <AGENT_ID> <WORKSTREAM_ID>
   Wait for LOCK_ACQUIRED before proceeding.
   If you receive LOCK_HELD:<holder>:<expires_at>, wait 5 seconds and retry
   (max 3 retries), then escalate to Sage as GATE_BLOCKED if still held.
3. git add <list each file explicitly — never git add -A or git add .>
4. git commit -m "<message>"
5. Run: .claude/scripts/teo-commit-lock release <AGENT_ID>
6. Return diff + recommended commit message to Sage. Do NOT proceed past step 5
   unless this spawn prompt explicitly grants direct-commit authority.
```

The lock covers the atomic window between `git add` and the final `git commit`.
Any crash or early exit must still be followed by `teo-commit-lock release` on
best-effort; the 90-second TTL auto-evicts stale locks if release is missed.

Sage direct commits (staff-review merges, changelog updates) must either acquire
the lock with `TEO_AGENT_ID=sage` or set `TEO_COMMIT_GATE=light` on the invocation.
At `standard` level Sage commits without a lock emit WARN only. At `strict` level
they will be blocked.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-02-04 | Initial protocol specification |
| 1.1.0 | 2026-04-23 | Added Wave 2 protected path write handoff guidance (ADR-038) |
| 1.2.0 | 2026-04-23 | Added Section 8 — Async GO-Signal Protocol (#379 Wave A) |

---

## Async GO-Signal Protocol (v1.2.0 Addition)

When Sage spawns an agent asynchronously and a subsequent pipeline phase must wait for that agent to complete, coordination MUST use the GO-signal protocol. Verbal return values, task-queue state, and informal "I'm done" messages in agent output are NOT sufficient to unblock a waiting phase.

**Signal file location:** `.claude/memory/go-signals/<workstream_id>-<phase>.json`

**Minimum schema** (schema_version 1.0.0): `workstream_id`, `phase`, `from_agent`, `to_phase`, `artifact_paths` (all paths verified on disk), `timestamp`.

**Producer rule:** The contracted agent writes the signal atomically (temp file + rename) only when all acceptance criteria are met and all artifact paths exist. Agents MUST NOT write signals for phases they did not execute.

**Consumer rule:** Sage reads and verifies the signal before dispatching the next phase. Artifact paths are re-verified by Sage independently of the producer's claim. After verification, Sage writes an `ack` block into the signal file and updates the workstream state.

**Every async wait MUST specify:** (a) the GO-signal path, (b) a timeout duration, (c) the escalation path on timeout. These three elements are required in the delegating handoff envelope's `context.essential`.

**Ack semantics:** At-least-once. Signals are retained after ack as audit trail. Downstream dispatch is idempotent via workstream state.

**Failure handling:** Corrupt or missing signals after timeout escalate to Sage → user. Agent mismatch in `from_agent` is a protocol violation and blocks dispatch.

**Worked example:**

```
Sage dispatches qa agent for workstream "ws-379", phase "qa-spec".
Handoff context.essential includes:
  - "GO-signal path: .claude/memory/go-signals/ws-379-qa-spec.json"
  - "Timeout: 30 minutes from dispatch"
  - "Escalation on timeout: Sage logs GO_SIGNAL_TIMEOUT, surfaces to user"

qa agent completes spec, writes to .claude/memory/pipeline/qa-spec-ws-379-output.json,
then atomically writes .claude/memory/go-signals/ws-379-qa-spec.json with:
  artifact_paths: [".claude/memory/pipeline/qa-spec-ws-379-output.json"]
  to_phase: "dev"

Sage reads signal, verifies artifact exists, writes ack, dispatches dev agent.
```

**Relationship to ADR-020 (Sage-owns-spawning):** The GO-signal protocol is a coordination primitive within Sage's dispatch authority. It does not change who spawns agents — Sage still owns all spawning. It formalizes how Sage knows a spawned agent is done.

**Relationship to ADR-037 (Dispatcher + Wave 1/2):** No conflict. Wave 1/2 mechanical tools remain the write mechanism for agents producing artifacts. The GO-signal is a separate coordination token they write in addition to their primary artifact.

**Validator:** `.claude/scripts/teo-go-signal-validate <path-to-signal.json>` — exit 0 = valid, exit 1 = schema error, exit 2 = missing artifact path.
