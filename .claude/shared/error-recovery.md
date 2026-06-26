<!--
  Copyright (c) 2026 Wonton Web Works LLC. All rights reserved.
  Licensed under the TheEngOrg Enterprise License Agreement.
  See LICENSE.enterprise for terms.
-->
# Error Recovery Protocol

**Owner:** TheEngOrg Enterprise (TEO)
**Version:** 1.0.0
**Tier:** 3 — On-demand (loaded on error conditions, NOT at session start)
**Trigger:** Any agent encountering an error, gate failure, or unexpected blocking condition
**Purpose:** Standardize error classification and recovery actions across all 25 TEO agents.

---

## Loading Note

This is a **Tier 3** protocol. Do NOT load at session start. Load when:
- An agent encounters an unhandled exception, unexpected exit code, or tool failure
- A gate evaluation returns FAIL or BLOCK
- An agent detects output that violates a schema or acceptance criterion
- Any agent is unsure how to proceed after a failure

---

## Error Taxonomy

Classify every error into exactly one of these five types before taking recovery action.

### TRANSIENT

**Definition:** Failure caused by external conditions that are likely to resolve without code change.

**Examples:**
- Network timeout or connection reset
- API rate limit (HTTP 429)
- Service unavailability (HTTP 503, 502, 504)
- Temporary file system lock
- Flaky test due to timing or external dependency

**Recovery action:** Retry with exponential backoff (see Heal section). Max 3 retries. If all retries fail, reclassify as RESOURCE or FATAL.

---

### RESOURCE

**Definition:** Failure caused by exhausted or insufficient resources — the agent cannot proceed without more capacity.

**Examples:**
- Context window approaching or at limit (>90% tokens used)
- Output truncated due to max_tokens limit
- Disk full
- Memory exhausted
- Token budget exceeded

**Recovery action:** Escalate to orchestrator (Capo) with a resource request. Include: current state, what was completed, what remains, and the resource needed. Do NOT silently truncate or proceed with partial output.

---

### LOGIC

**Definition:** Failure caused by incorrect behavior in the code, prompt, or agent output — the task ran but produced wrong results.

**Examples:**
- Test assertion failure
- Schema validation error (output doesn't match expected structure)
- Gate evaluation FAIL (acceptance criteria not met)
- Wrong output content (factually incorrect, hallucinated, off-topic)
- Infinite loop or recursion detected

**Recovery action:** Diagnose root cause. Revert to last known-good state. Do NOT retry without understanding why it failed — retrying a LOGIC error produces the same wrong result.

---

### PERMISSION

**Definition:** Failure caused by denied access — the agent attempted an action it is not authorized to perform.

**Examples:**
- Tool call denied by user permission settings
- Blocked bash command (per CLAUDE.md security directives)
- Auth failure (401, 403)
- File write blocked by OS permissions
- GitHub API access denied

**Recovery action:** Stop immediately. Escalate to user. Include: what was attempted, why it was needed, and what the user must do to unblock. Do NOT retry a denied tool call — if the user denied it once, respect that decision.

---

### FATAL

**Definition:** Unrecoverable failure — continuing would cause data loss, corruption, or a worse outcome than stopping.

**Examples:**
- Data corruption detected in memory files
- Pipeline state is inconsistent (cannot determine what completed)
- Partial write that left a file in a broken state
- Agent reached max delegation depth (3) with task incomplete
- Circular delegation detected

**Recovery action:** HALT immediately. Preserve all state. Write a FATAL error entry to `.claude/memory/capo-pipeline-log.json`. Escalate to engineering-manager with full context: what state was preserved, what was lost, and what caused the failure.

---

## Detect-Diagnose-Heal-Verify Cycle

Every error recovery follows this four-phase cycle. Never skip a phase.

### DETECT

Recognize that an error has occurred. Do not proceed silently.

| Signal | How to detect |
|--------|---------------|
| Script/tool exit code ≠ 0 | Check exit code after every `.claude/scripts/teo-*` call |
| Gate verdict = FAIL or BLOCK | Gate evaluator returns structured verdict — read it |
| Schema violation | Compare output against expected schema before passing to next step |
| Assertion failure | Test runner output contains FAIL/ERROR lines |
| Unexpected empty output | Treat empty where content expected as a LOGIC or RESOURCE error |
| Context usage >90% | Monitor token usage; treat as RESOURCE before hitting the wall |

**Rule:** If something feels wrong, it is wrong. Surface it. Never proceed on ambiguous state.

---

### DIAGNOSE

Classify the error using the taxonomy above. Ask:

1. **Is this external or internal?** External (network, API, rate limit) → TRANSIENT or PERMISSION. Internal (wrong output, test failure) → LOGIC.
2. **Is this a capacity problem?** Resource exhaustion → RESOURCE.
3. **Did I try something I'm not allowed to do?** Tool denied, auth failure → PERMISSION.
4. **Is the pipeline state trustworthy?** Corrupted, inconsistent, or partial state → FATAL.

Write the classification explicitly before acting. Example:
```
Error type: LOGIC
Cause: teo-validate exited 1 — schema validation failed on workstream state file
Missing field: parallelizability_classification
```

---

### HEAL

Take the recovery action for the classified error type.

| Error Type | Heal Action |
|------------|-------------|
| TRANSIENT | Retry with exponential backoff: wait 1s, 2s, 4s (max 3 retries, then escalate) |
| RESOURCE | Checkpoint current state → escalate to Capo with resource request |
| LOGIC | Identify root cause → revert to last green state → fix → re-run |
| PERMISSION | Stop → escalate to user with clear description of what is needed |
| FATAL | Halt → preserve state → escalate to engineering-manager |

**Backoff formula for TRANSIENT retries:**
```
wait_seconds = 2^attempt  (attempt 1 → 2s, attempt 2 → 4s, attempt 3 → 8s)
Add jitter: wait_seconds += random(0, 1)
```

**Revert to last green state (LOGIC):**
- For Dev/QA: revert the file(s) changed since the last passing test run
- For Capo: restore the workstream state from the last successful gate checkpoint
- For all: do NOT accumulate partial changes across multiple failed attempts

---

### VERIFY

Confirm that recovery succeeded before resuming the pipeline.

| Heal action taken | Verification step |
|-------------------|-------------------|
| Retried after TRANSIENT | Check that the retried step returned exit 0 or expected output |
| Escalated RESOURCE | Capo confirms resource is available before resuming |
| Reverted + fixed LOGIC | Re-run the full failing test suite or gate — confirm all pass |
| PERMISSION escalated | User confirms the action is now authorized |
| FATAL halted | Engineering-manager reviews state and explicitly authorizes resume |

**Rule:** Do NOT mark a step complete until VERIFY passes. An unverified recovery is an unresolved error.

---

## Agent-Specific Guidance

### Capo

- **RESOURCE errors:** Before hitting the context wall, checkpoint at 60% token usage. Write current pipeline state to `.claude/memory/workstream-{id}-state.json`, summarize progress, and spawn a fresh agent to continue. Do NOT wait until 90%+ — checkpoint early.
- **LOGIC errors in gates:** A FAIL gate result is a LOGIC error on the work product, not a LOGIC error in Capo. Diagnose which agent produced the failing output and re-delegate the fix.
- **FATAL:** Write a detailed halt entry to `capo-pipeline-log.json` before escalating. Include: workstream ID, last successful gate, and what triggered the FATAL classification.

### Dev and QA

- **LOGIC errors:** Revert to the last green test state immediately. Do not attempt to "patch around" a failing test — fix the root cause. Re-run the full suite, not just the failing test.
- **TRANSIENT errors in test infrastructure:** If a test fails due to a flaky external dependency (network, database timeout), retry the test run once. If it fails again, reclassify as LOGIC and investigate.
- **Coverage drops:** A coverage drop below 99% after a change is a LOGIC error — treat it as such, not a cosmetic issue.

### Researcher

- **TRANSIENT errors:** If a search or web fetch fails, retry with a different query strategy or alternative source. Do not retry the identical query — if it failed once, a different approach is needed.
- **LOGIC errors in output:** If research output fails schema validation or acceptance criteria, diagnose whether the source data was insufficient or the synthesis was wrong. Do not pad output to pass validation.

### All Agents

- **NEVER silently swallow errors.** Every error must be classified, logged, and acted on. Silent failure is the worst outcome — it produces invisible corruption of downstream state.
- **NEVER retry a PERMISSION error.** If a tool call was denied, the denial stands until the user explicitly authorizes the action.
- **NEVER proceed past a FATAL.** There is no recovery from a FATAL without human review.
- **Log every error event.** See Integration: Observability below.

---

## Integration Points

### gate-evaluator-protocol.md

Gate failures are LOGIC errors on the work product being evaluated. When a gate returns FAIL or BLOCK:

1. **DETECT:** Gate verdict is FAIL/BLOCK (structured verdict from gate evaluator)
2. **DIAGNOSE:** LOGIC — the work product did not meet acceptance criteria
3. **HEAL:** Identify which agent produced the failing artifact. Re-delegate the fix with the gate failure evidence attached (schema diff, assertion message, test output).
4. **VERIFY:** Re-run the gate after the fix. Gate must return PASS before the pipeline continues.

The gate evaluator does NOT automatically retry on FAIL. That is this protocol's responsibility.

### observability-protocol.md

Every error event MUST be logged before recovery action is taken.

**Log target:** `.claude/memory/capo-pipeline-log.json` (append-only)

**Minimum fields for an error log entry:**

```json
{
  "event_type": "error",
  "timestamp": "<ISO-8601>",
  "agent": "<agent-name>",
  "workstream_id": "<id>",
  "error_type": "TRANSIENT | RESOURCE | LOGIC | PERMISSION | FATAL",
  "error_message": "<human-readable description>",
  "recovery_action": "<what was done>",
  "recovery_status": "pending | success | escalated | halted"
}
```

Log a second entry when VERIFY completes, updating `recovery_status` to `success`, `escalated`, or `halted`.

### protocol-tiers.md

This protocol is **Tier 3**. It must be registered in the Tier 3 table of `protocol-tiers.md` with trigger: "Error condition detected by any agent."

---

## Quick Reference

```
Error encountered
      |
      v
DETECT: Is this actually an error? (exit code, gate verdict, schema, assertion)
      |
      v
DIAGNOSE: Classify → TRANSIENT / RESOURCE / LOGIC / PERMISSION / FATAL
      |
      v
LOG: Write error event to capo-pipeline-log.json
      |
      +-- TRANSIENT  → Retry (max 3, exponential backoff)
      |
      +-- RESOURCE   → Checkpoint state → escalate to Capo
      |
      +-- LOGIC      → Root cause → revert to last green → fix → re-run
      |
      +-- PERMISSION → Stop → escalate to user
      |
      +-- FATAL      → Halt → preserve state → escalate to eng-manager
      |
      v
VERIFY: Confirm recovery succeeded before resuming
```
