# TEO 5 — Architecture

Status: **BUILT** — deterministic core shipped, 100% covered, CLI live.
Supersedes: the M3 LLM-dispatch line (pinned at branch `m3-baseline-pre-v5`, commit `8fd9d3c`).

> **Reading this for the first time?** The one idea: an LLM agent is the most
> expensive, least deterministic, least auditable way to do anything, so it is the
> **tool of last resort** — not the default. TEO plans work, runs the mechanical
> majority as plain scripts (zero tokens), spends an agent only where the work
> genuinely needs generation or judgment, and signs + logs every step into an
> append-only ledger you can audit and bill from. §1 is the shape; §4–5 are why it's
> auditable; the rest is the contract. A 5-minute end-to-end demo lives in
> [`../../demo/DEMO.md`](../../demo/DEMO.md).

---

## 1. The shape

TEO 5 is a **deterministic orchestration engine** that executes a signed execution plan
task-by-task, emitting an append-only telemetry event at every step and handoff. Agents
(LLM-backed) only fill the "do the task" slot inside a step. Sequencing, gates, verification
wiring, and telemetry are **code, never LLM**.

### Core principle: an agent is the tool of last resort

An LLM agent is the most expensive, least deterministic, and least auditable way to do
anything. So it is spent **only where the work genuinely needs generation or judgment** —
writing code, designing, writing prose, making a call a script can't. Everything mechanical
— deploy a site, run a migration, build, lint, provision — is a **script**, run directly by
the orchestrator with **zero LLM tokens**.

Those scripts are first-class and **human-runnable**: the exact `teo deploy-site` the
orchestrator runs is a script a human can run by hand, identically. No agent in the middle of
mechanical work. When a generation task produces a repeatable procedure, the preferred output
is *a script* — promoted into the versioned library — not a one-time action.

```
Is the task generation / judgment?
   ├─ yes → agent task  (task_actor_type: ENGINEER | QA | CREATE | ...)
   └─ no  → SCRIPT task (task_actor_type: SCRIPT) — orchestrator runs it, 0 tokens
```

```
User Input
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ PLAN — Sage (agent)                                           │
│   classify task · create plan w/ steps + agents               │
│   does NOT solve · research belongs to each task's agent      │
│   opens work stream · registers telemetry                     │
│   OUTPUT: TEO-EXECUTION-PLAN (signed)                          │
└──────────────────────────────────────────────────────────────┘
   │  TEO-EXECUTION-PLAN
   ▼
┌──────────────────────────────────────────────────────────────┐
│ RUN — Orchestrator (deterministic code)                       │
│   intake: TEO-EXECUTION-PLAN                                  │
│   for each task in task_order:                                │
│      ├─ spawn task_actor (agent) ── AGENT PROCESS             │
│      ├─ capture output                                         │
│      ├─ MECHANICAL VERIFY: run task.verifications[] (scripts) │
│      └─ at a Gate: gate_owner signs (or blocks)               │
│   emits a telemetry event at every step + handoff             │
│   OUTPUT: OUTCOME                                              │
└──────────────────────────────────────────────────────────────┘
   │  OUTCOME
   ▼
┌──────────────────────────────────────────────────────────────┐
│ DELIVER + PARK — state: pending-human                         │
│   goods delivered · run is COMPLETE here                      │
└──────────────────────────────────────────────────────────────┘
   │
   ▼  (later, separate invocation)
┌──────────────────────────────────────────────────────────────┐
│ HUMAN GATE — async accept / reject  (FINAL GATE)             │
│   accept → CLOSE   ·   reject → REOPEN                        │
└──────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ CLOSE — Sage (agent): log process result · close work stream │
└──────────────────────────────────────────────────────────────┘
```

The orchestrator run **completes at `pending-human`**. Human accept/reject is a *second*
invocation that emits its own event and drives closure or reopen. The human gate is never
a blocking prompt — the goods are delivered, the stream parks, the human signs off whenever.

---

## 2. Storage — `~/.teo/`

TEO owns its own home directory. It does **not** write run-state into `.claude/`. The
`.claude/` tree keeps only what Claude Code must discover (agent role definitions, skills,
dispatcher `CLAUDE.md`) — that is config, not state. This is a deliberate break from v4,
which parasitized `.claude/memory/` and caused the stale-token drift that motivated the rebuild.

```
~/.teo/
  keyring/
    signing.key              # HMAC secret, mode 0600, never in any repo
  registry/
    agents.jsonl             # agent identity registry (append-only)
  memory/
    <project-id>/            # per-project namespace (finance attribution)
      plans/
        <plan_id>.json       # the signed TEO-EXECUTION-PLAN
      events/
        <plan_id>.jsonl      # append-only telemetry — THE AUDIT TRUTH
      signoffs/
        <plan_id>.jsonl      # append-only signed gate verdicts
      streams/
        <plan_id>.json       # current work-stream state (derived/rebuildable)
```

- `<project-id>` = stable hash of the project's git-remote-or-abspath. Keeps finance
  rollups attributable to a client without leaking the path. (Hash seed is an open item, §8.)
- `events/*.jsonl` is the source of truth. `streams/*.json` is a derived projection and
  may be rebuilt from events at any time.
- Nothing here is git-tracked. It is machine-local audit state.

**Boundary rule:** if losing it would corrupt an audit or finance trail, it lives in
`~/.teo/`. If Claude Code needs to find it to route, it lives in `.claude/`.

---

## 3. TEO-EXECUTION-PLAN — the data contract

The only artifact that crosses PLAN → RUN. Produced by Sage, consumed by the orchestrator.
Signed at creation; the orchestrator refuses an unsigned or tampered plan.

```jsonc
{
  "plan_id": "uuid",
  "project_id": "sha256-prefix",
  "description": "string_blob — what the work stream is for",
  "created_by": "sage-001",            // agent_id of the planner
  "created_at": "ISO-8601 UTC",
  "schema_version": "5.0",

  "tasks": [
    // ── SCRIPT task — the DEFAULT for any mechanical work. No agent, 0 tokens. ──
    {
      "task_id": "uuid",
      "task_order": 1,
      "task_actor_type": "SCRIPT",     // orchestrator runs the script itself
      "script": {
        "path": "scripts/deploy-site.sh",   // versioned, human-runnable
        "args": ["--env", "prod"],
        "expect_exit": 0
      },
      "description": "deploy the site to prod",
      "expected_output": "string — the verifiable expectation",
      "verifications": [
        { "kind": "script", "cmd": "scripts/smoke-prod.sh", "expect_exit": 0 }
      ]
      // NOTE: a human runs `scripts/deploy-site.sh --env prod` and gets the
      // identical result. The orchestrator adds telemetry + signoff, nothing else.
    },

    // ── AGENT task — only when the work needs generation / judgment ──
    {
      "task_id": "uuid",
      "task_order": 2,                 // integer; orchestrator runs ascending
      "task_actor": "eng-003",         // agent_id that performs the task
      "task_actor_type": "ENGINEER",   // role enum: ENGINEER | QA | CREATE | ...
      "description": "string",
      "expected_output": "string — the verifiable expectation",
      "verifications": [               // MECHANICAL checks — scripts, exit-code 0 = pass
        { "kind": "script", "cmd": "npx tsc --noEmit", "expect_exit": 0 },
        { "kind": "script", "cmd": "npx vitest run x.test.ts", "expect_exit": 0 }
      ]
    },

    // A Gate is a Task with gate fields. It has no task_actor work of its own;
    // it asserts the preceding tasks satisfied constraints, and is SIGNED.
    {
      "task_id": "uuid",
      "task_order": 10,
      "is_gate": true,
      "gate_owner": "qa-002",          // agent_id that signs this gate
      "gate_constraints": [            // what must hold for the gate to pass
        { "kind": "verification-ref", "task_id": "..." },
        { "kind": "document",          "path": "..." }
      ]
    }
  ],

  "plan_signature": "hmac-sha256(...)" // see §5
}
```

Notes:
- `task_actor_type: SCRIPT` is the **default** for mechanical work. It has no `task_actor`
  agent_id — the orchestrator runs `script.path` directly, captures exit/stdout/stderr,
  emits telemetry, and signs off. Zero LLM tokens. The `actor_id` on its events is `system`.
- Agent task types (`ENGINEER`, `QA`, `CREATE`, …) are spent only on generation/judgment.
- `verifications[]` are **mechanical** — a script the orchestrator runs, pass = exit code.
  No LLM judges mechanical verification. (A SCRIPT *task* and a `verifications[]` *check* are
  the same machinery pointed at two jobs: doing the work vs. confirming it.)
- A **Gate** `extends Task` (same id/order machinery) but carries `gate_owner` +
  `gate_constraints` and produces a *signed* verdict, not work output.
- `task_actor` / `gate_owner` reference IDs in `~/.teo/registry/agents.jsonl`. The
  orchestrator rejects a plan referencing an unregistered agent.

### Script library

Scripts are versioned in the repo at `scripts/` (source of truth) and are standalone
human-runnable executables. The plan references them by path. The orchestrator and a human
invoke them identically — the only thing the orchestrator adds is telemetry + signoff.

When an agent (generation task) produces a repeatable procedure, its preferred output is a
**new script committed to `scripts/`**, not a one-time action. Good procedures get promoted
into the library so the next plan calls a script instead of spending an agent.

---

## 4. Telemetry — the event contract

Every step and handoff appends one immutable line to `events/<plan_id>.jsonl`. This is what
audit and finance read. No event is ever mutated or deleted.

```jsonc
{
  "event_id": "uuid",
  "plan_id": "uuid",
  "task_id": "uuid | null",          // null for stream-level events
  "seq": 42,                          // monotonic per plan; gaps = tamper signal
  "ts": "ISO-8601 UTC",
  "phase": "PLAN | RUN | TASK_START | TASK_OUTPUT | MECH_VERIFY | RETRY |
            GATE | DELIVER | HUMAN_GATE | CLOSE | ERROR",
  "actor_id": "sage-001 | eng-003 | human:byazaki | system",
  "actor_type": "SAGE | ENGINEER | QA | CREATE | HUMAN | SYSTEM",

  "verdict": "pass | fail | block | accept | reject | n/a",

  // finance — populated on any LLM-backed step
  "tokens_in":  1234,
  "tokens_out": 567,
  "model": "claude-...",
  "cost_usd": 0.0231,
  "duration_ms": 8123,

  "detail": { /* phase-specific, free-form */ },

  "signature": "hmac-sha256(...) | null"  // present on signoff-bearing events
}
```

- `seq` is monotonic per plan. The auditor reads the file; a gap or out-of-order seq is a
  tamper signal.
- Finance rollup = sum `cost_usd` / `tokens_*` grouped by `project_id` (the dir) and
  `actor_id`. Per-client cost falls straight out of the namespace.
- Drift / false-positive tracing = filter events by `actor_id` + `verdict`, find the
  signoff, verify its signature. This is the direct answer to today's stale-token problem.

---

## 5. Agent identity + signed signoff

### Identity
Every agent gets a stable logical ID issued once and recorded append-only in
`~/.teo/registry/agents.jsonl`:

```jsonc
{ "agent_id": "eng-003", "agent_type": "ENGINEER", "issued_at": "ISO-8601", "active": true }
```

IDs are referenced by `task_actor`, `gate_owner`, and every event's `actor_id`. Humans get
`human:<handle>` IDs.

### Signed signoff (the token)
A gate approval or verification verdict is only trusted if it carries a verifiable token.
The orchestrator computes:

```
signature = HMAC-SHA256(
  key = ~/.teo/keyring/signing.key,
  msg = plan_id | task_id | actor_id | verdict | ts | seq
)
```

written to `signoffs/<plan_id>.jsonl`:

```jsonc
{
  "plan_id": "uuid", "task_id": "uuid", "seq": 42,
  "actor_id": "qa-002", "verdict": "pass",
  "ts": "ISO-8601 UTC",
  "signature": "hmac-sha256-hex"
}
```

Why this kills the current drift class:
- **No forgery** — a signoff for `qa-002` that wasn't produced by the engine won't verify
  against the key.
- **No replay** — `seq` + `ts` are inside the signed message, so a captured signoff can't
  be re-used on a different task or run. (This is exactly the failure today: a stale token
  sitting in a memory dir got replayed against a new session and falsely asserted role=sage.)
- **Attribution** — every verdict names exactly one `actor_id`. A false positive traces to
  a single signer, not an ambient token sitting in a memory dir.

The HMAC key lives only in `~/.teo/keyring/` (mode 0600), never in any repo or `.claude/`.
Logical-ID issuance and the signing layer ship together; the event schema already carries
`signature`, so nothing reworks later if we move to asymmetric keys.

---

## 5a. Sage planning contract

Sage's job at PLAN is to classify and decompose — never to solve. Its planning prompt
carries one hard bias: **prefer a SCRIPT task over an agent task.**

For each unit of work, Sage classifies:

- **Mechanical** (deterministic command sequence — deploy, build, migrate, test, provision,
  move files) → emit a `SCRIPT` task referencing a `scripts/` executable. If the script
  doesn't exist yet, Sage emits a generation task whose *output is the script*, followed by a
  SCRIPT task that runs it.
- **Generation / judgment** (write code, design, prose, evaluate, decide) → emit an agent
  task with the appropriate `task_actor_type`.

The litmus test Sage applies: *"Could a human do this by running a fixed command?"* If yes,
it's a script. An agent is only justified when the answer is no. This is planning guidance,
not a hard validation gate in v5.0 — see §8 for the deferred enforcement heuristic.

## 6. Component map (deterministic core)

Build order, each module tests-first:

| # | Module                | Responsibility                                                        |
|---|-----------------------|-----------------------------------------------------------------------|
| 1 | `home`                | resolve/create `~/.teo/`, keyring, project-id hashing                  |
| 2 | `identity`            | agent registry read/write; ID issuance                                |
| 3 | `signing`             | HMAC sign + verify over the canonical message                         |
| 4 | `telemetry`           | append-only event writer; seq allocator; finance rollup reader        |
| 5 | `plan` (schema)       | TEO-EXECUTION-PLAN type, validate, sign, verify, load                  |
| 6 | `orchestrator`        | plan-loader → step-runner → (SCRIPT: run · AGENT: spawn) → capture → mech-verify → gate |
| 7 | `mechanical-verify`   | run `verifications[]` scripts, map exit code → verdict                 |
| 8 | `script-runner`       | run a SCRIPT task's `script.path` directly; capture exit/stdout/stderr; 0 tokens |
| 9 | `agent-spawn`         | the one place an LLM is invoked, fenced by code — AGENT tasks only     |
| 10| `human-gate`          | park `pending-human`; accept/reject second-invocation handler         |
| 11| `stream`              | open/close work stream; derive stream state from events               |
| 12| `cli`                 | `teo plan` · `teo run` · `teo gate` · `teo audit` · `teo close` · `teo run-script` |

The step-runner branches on `task_actor_type`: **SCRIPT → `script-runner` (no LLM)**,
agent type → `agent-spawn`. LLM appears in exactly **two** places — Sage planning (module 6
input) and `agent-spawn` (module 9). Everything else, including all mechanical task
execution, is deterministic and unit-testable without a model. A well-planned run spends
agents on a minority of its tasks.

`teo run-script <path> [args]` lets a human run any library script directly through the same
runner the orchestrator uses (telemetry optional) — so the human and the engine never drift
on how a script is invoked.

---

## 7. The v4 break (what the rebuild removed)

TEO 5 was a clean rebuild off the M3 baseline (recoverable at `m3-baseline-pre-v5`):
- `src/` was rebuilt against §6, deterministic-core-first.
- The `.claude/memory/` scratch that v4 parasitized (`tmp-*`, stale `identity-tokens/`,
  `go-signals/`, `_v4-disabled-traces/`) is gone — and the stale-token enforcement drift
  it caused went with it.
- `.claude/` now keeps only config Claude Code must discover: `agents/`, `skills/`,
  dispatcher `CLAUDE.md`, `settings.json`. Signing lives in `~/.teo/keyring/`, never in a
  repo or a stray file — which is precisely why a captured token can no longer be replayed.

## 8. Open items / deliberate non-goals for v5.0

- Per-project namespace hash: git-remote vs abspath as the seed.
- Whether `teo audit` renders finance rollups itself or emits CSV/JSON for a sheet.
- ~~Retry policy when a task's mechanical verification fails (auto-retry N? straight to ERROR?).~~
  **RESOLVED:** `max_retries` on a task (default 0 = first failure is terminal). The
  orchestrator re-runs a failed task up to N times, emitting a `RETRY` telemetry event per
  re-attempt, before going to `error`. Sage may set it on flaky tasks.
- **Script-over-agent enforcement heuristic** (deferred from §5a): once we have real plans,
  add plan-validation that flags an agent task whose only output is a deterministic command —
  "this should have been a SCRIPT task." Guidance ships in v5.0; the mechanical gate comes after.
- Human-gate notification channel (out of scope for core; the event is enough to drive any notifier).
- Concurrency: tasks run strictly sequentially by `task_order` in v5.0. Parallel/DAG
  *task* execution remains a deliberate non-goal. Parallel *workstreams* (whole plans
  running at once, each in an isolated working tree) are implemented — see
  [`TEO-5-workstream-isolation.md`](./TEO-5-workstream-isolation.md) and the
  `workstream-tree` core module.
