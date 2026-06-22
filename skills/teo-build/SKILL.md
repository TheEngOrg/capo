---
name: teo-build
description: "Build it. Classify at intake, then execute the appropriate track: MECHANICAL (1 spawn) or ARCHITECTURAL (5-6 spawns). Invoke with workstream ID."
model: sonnet
allowed-tools: Read, Glob, Grep, Edit, Write, Task, Bash
compatibility: "Requires Claude Code with Task tool (agent spawning)"
metadata:
  version: "2.0"
  spawn_cap: "6"
---

# teo-build

Classifies workstreams at intake, then coordinates the appropriate track: MECHANICAL (single Dev spawn + bash gate) or ARCHITECTURAL (QA, Dev, Staff Engineer review).

## Constitution

1. **Classify first** - Determine track at intake before any spawns
2. **Tests before code** - MECHANICAL: Dev writes tests then implements. ARCHITECTURAL: QA writes tests first.
3. **99% coverage** - Unit + integration combined, no exceptions
4. **Escalate blockers** - Surface issues early to engineering-manager
5. **Follow output format** — See `.claude/shared/visual-formatting.md` for standard visual patterns

## Flags

- `--force-mechanical` — Override classification, use MECHANICAL track regardless of rules
- `--force-architectural` — Override classification, use ARCHITECTURAL track regardless of rules

## Engine Binary Guard

**This check runs BEFORE Step 0 and BEFORE any classification, spawn, or memory write.**

Verify that the engine binary is reachable on PATH and functional:

```bash
command -v teo-run.js && teo-run.js validate-plan '{}'
```

This exercises the binary with zero disk writes (`validate-plan` runs a Zod parse and returns `{"valid":...}`). `command -v` confirms the binary is on PATH before executing it.

A `valid:false` result here is EXPECTED for the empty-object probe and does NOT indicate failure — the guard passes if the command's EXIT CODE is 0 (binary reachable and ran). Do not halt on the `valid:false` payload; only halt if `command -v teo-run.js` finds nothing or the binary cannot execute.

If `teo-run.js` is not found on PATH — surface this error and stop immediately, do not proceed to classification, spawning, or writing memory:

```
ERROR: teo-run.js not found on PATH.
The teo-build skill requires the TEO engine binary to be reachable.
Install TEO as a Claude Code plugin so that bin/ is added to PATH,
then retry this workstream.
```

Do not classify, spawn agents, or write to memory if this guard fails.

## Step 0: Classify at Intake

Before spawning any agent, classify the workstream by applying R1-R8 and M1-M5 rules to the ticket or request description. Run `teo-classify-workstream <workstream-id>` before spawning any agent; if the script is not found, fall back to manual classification (fail-open).

```
Any R-rule matches    → ARCHITECTURAL
All M-rules match     → MECHANICAL
Uncertain             → ARCHITECTURAL (conservative bias)
--force-mechanical    → MECHANICAL (override)
--force-architectural → ARCHITECTURAL (override)
```

See `development-workflow.md` for classification rules (R1-R8, M1-M5).

Record classification in memory before proceeding.

## MECHANICAL Track (1 spawn)

**When:** Classified MECHANICAL at Step 0.

```
Step 1: Dev — writes tests + implements (full TDD cycle)  → tests_pass + coverage >= 99%
Step 2: Bash Gate — automated verification                → mechanical_gate_passed
Done — no leadership review
```

### Progressive Escalation Cascade

MECHANICAL workstreams use a two-attempt Haiku cascade before the Bash Gate. The engine runs `dev-haiku` up to `max_attempts` times; on exhaustion it escalates to `dev` (Sonnet) with the full `AttemptLog` injected as `{attempt_log}`. Failure Resume formatting is engine-managed (ADR-029 §4) — no manual `=== HAIKU FAILURE RESUME ===` blocks needed.

**Logging:** After every cascade run (pass or escalation), the engine emits a `retry_complete` telemetry event. Additionally, append an entry to `.claude/memory/escalation-metrics.json`:

```json
{
  "workstream_id": "{id}",
  "timestamp": "{iso8601}",
  "attempts": 1 | 2 | 3,
  "final_tier": "haiku" | "sonnet",
  "outcome": "pass" | "escalated",
  "rejection_reasons": ["..."]
}
```

```yaml
Retry:
  max_attempts: 2
  escalate_on: [failure, escalate]
  attempt:
    Task:
      subagent_type: dev-haiku
      model: haiku
      prompt: |
        MECHANICAL workstream {id}.
        You are responsible for the full TDD cycle:
        1. Write failing tests (misuse → boundary → golden path)
        2. Implement minimum code to pass
        3. Refactor while green
        4. Verify coverage >= 99%

        {attempt_log}
        Acceptance criteria: {criteria}
        Constraints: {standards}
        Gate: all tests pass, coverage >= 99%, <200 lines total (<500 single-module),
              modifications only (no new files except tests), single src/ dir + tests/.
  escalation:
    Task:
      subagent_type: dev
      model: sonnet
      prompt: |
        MECHANICAL workstream {id}.
        You are responsible for the full TDD cycle:
        1. Write failing tests (misuse → boundary → golden path)
        2. Implement minimum code to pass
        3. Refactor while green
        4. Verify coverage >= 99%

        {attempt_log}
        Acceptance criteria: {criteria}
        Constraints: {standards}
        Gate: all tests pass, coverage >= 99%, <200 lines total (<500 single-module),
              modifications only (no new files except tests), single src/ dir + tests/.
```

When the successful cascade spawn completes, it writes a `handoff` message to `messages-dev-gate.json` before the bash gate runs.

### Bash Gate (no spawn)

Run automated verification. If any check fails, route back to Dev with failure details.

- [ ] All tests pass
- [ ] Coverage >= 99%
- [ ] Total changes < 200 lines (< 500 if single-module)
- [ ] Modifications only (no new files except tests)
- [ ] Single src/ directory + tests/
- [ ] No package.json, framework, or CI/CD changes

Pass → report complete. No leadership review required.

## ARCHITECTURAL Track (5-6 spawns)

**When:** Classified ARCHITECTURAL at Step 0.

```
Step 1: QA writes tests (can overlap with Dev start)
Step 2: Dev implements against QA tests
Step 2.5: Dual-specialist review (if code blocks in deliverable)
Step 3: Staff Engineer internal review
Step 4: /deployment-engineer merge
```

### Step 1: QA Test Specification

```yaml
Task:
  subagent_type: qa
  model: sonnet
  prompt: |
    Write misuse-first test specs for workstream {id}.
    Acceptance criteria: {criteria}
    Target: 99% coverage paths identified, failing tests.
    Order: misuse cases → boundary cases → golden path.
```

QA and Dev can run in parallel once QA has committed initial test stubs.

### Step 2: Dev Implementation

QA writes a `handoff` message to `messages-qa-dev.json` when test specs are committed. Dev reads this message before starting implementation — this enables QA and Dev to run in parallel, with Dev starting as soon as QA's handoff message appears.

```yaml
Task:
  subagent_type: dev
  model: sonnet
  prompt: |
    Implement workstream {id} to pass tests.
    Test files: {test_files}
    Principles: Test-first, DRY, config-over-composition.
    Run Red → Green → Refactor cycle.
```

When Dev completes, it writes a `handoff` message to `messages-dev-staff-engineer.json`.

### Step 2.5: Dual-Specialist Review (conditional)

After Dev completes, inspect each deliverable file. If it contains fenced code blocks (``` or ~~~), run dual-specialist review. Skip if no code blocks.

Spawn two specialists in parallel (at most one additional spawn beyond normal budget):

1. **Domain specialist** — platform correctness (determined at runtime by workstream context)
2. **Language specialist** — code quality and idiomatic style

**Gate:** Both must pass. Partial approval does not proceed.

**Review output format:** Each specialist returns findings severity-ranked as:
- `blocking` — must be fixed before the deliverable is accepted (correctness errors, security issues, broken logic)
- `warning` — advisory; should be addressed but does not block acceptance

### Step 3: Staff Engineer Review

```yaml
Task:
  subagent_type: staff-engineer
  model: sonnet
  prompt: |
    Review workstream {id} code.
    Check: standards compliance, architecture, security, performance.
```

### Step 4: Merge

After Staff Engineer approval, invoke `/deployment-engineer merge feature/ws-{id}-{name}`.

## Memory Protocol

```yaml
read:
  - .claude/memory/workstream-{id}-state.json

write: .claude/memory/workstream-{id}-state.json
  agent_id: teo-build
  track: mechanical | architectural
  phase: step_0_classify | step_1 | step_2 | step_3 | step_4
  delegated_to: dev | qa | staff-engineer
  gate_status: pending | passed | failed
  blocker: {description if failed}
```

## Output Format

- **Compact** (default): <=10 lines per build cycle — classification, progress lines, gate status only
- **Full** (pass "verbose"): CAD pipeline diagram CLASSIFY → TEST → IMPL → VERIFY → REVIEW, status box, detailed progress

See `references/output-examples.md` for full template examples.

## Boundaries

**CAN:** Classify workstreams, execute full CAD cycle, spawn qa/dev/staff-engineer, track gates, coordinate handoffs, report progress
**CANNOT:** Write code without tests, skip tests, merge to main, skip classification
**ESCALATES TO:** engineering-manager (blockers), staff-engineer (final approval)
