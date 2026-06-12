# TEO 5 — Team Orchestration for Claude Code

A **deterministic orchestration engine**. You describe what you want; Sage plans it; a
deterministic runner executes the plan task-by-task, signing every gate and emitting an
append-only telemetry trail for audit and finance.

Full design: [`docs/architecture/TEO-5.md`](docs/architecture/TEO-5.md).

## The core idea

An LLM agent is the most expensive, least deterministic, least auditable way to do anything —
so it's the **tool of last resort**, not the default.

```
Is the task generation / judgment (write code, design, decide)?
   ├─ yes → agent task   (the one place an LLM runs)
   └─ no  → SCRIPT task   (a script the engine runs — zero LLM tokens)
```

Mechanical work — deploy, build, migrate, provision — is a **script**, run directly by the
orchestrator. Those scripts are first-class and human-runnable: the exact `scripts/deploy.sh`
the engine runs is one you can run by hand, identically. The engine just adds telemetry and a
signed sign-off. Sage applies one litmus test when planning: *"Could a human do this by
running a fixed command?"* If yes, it's a script.

## The flow

```
teo plan "<request>"   Sage classifies + decomposes → a signed TEO-EXECUTION-PLAN
        │
teo run <plan>         deterministic runner walks tasks in order:
        │                SCRIPT → run it (0 tokens)   AGENT → the one LLM call
        │                each task mechanically verified · gates signed by gate_owner
        │                telemetry event at every step
        ▼
   pending-human        goods delivered, run complete, parked
        │
teo gate <plan> accept|reject     async human final gate (separate invocation)
        │                accept → closed     reject → reopened
        ▼
teo audit <plan>        the full ledger + per-actor finance rollup
```

The orchestrator is **deterministic code** — sequencing, gates, verification, and telemetry
never involve an LLM. An LLM appears in exactly two places: Sage planning, and the one
`agent-spawn` call inside an AGENT task.

## CLI

| Command | What it does |
|---------|--------------|
| `teo plan "<request>" [--out plan.json] [--runner claude-cli\|anthropic-api]` | Sage produces a signed plan |
| `teo run <plan>` | Run a signed plan → `pending-human` or `error` |
| `teo status <plan>` | Derived work-stream state (replayed from the ledger) |
| `teo gate <plan> <accept\|reject> [--reason r] [--as handle]` | Async human final gate |
| `teo close <plan> [--as handle]` | Accept shorthand (close the stream) |
| `teo audit <plan>` | Print the telemetry ledger + finance rollup |
| `teo run-script <path> [args...]` | Run a library script through the same runner the engine uses |

## Storage — `~/.teo/`

TEO owns its own home directory. It never writes run-state into `.claude/`.

```
~/.teo/
  keyring/signing.key            HMAC secret (0600) — never in any repo
  registry/agents.jsonl          agent identity registry (append-only)
  memory/<project-id>/
    plans/<plan_id>.json         the signed plan
    events/<plan_id>.jsonl       append-only telemetry — THE AUDIT TRUTH
    signoffs/<plan_id>.jsonl     signed gate verdicts
    streams/<plan_id>.json       derived stream state (rebuildable)
```

`<project-id>` is a stable hash of the project, so finance rolls up per client without leaking
paths. Set `TEO_HOME` to override the location (used in tests).

## Identity + signed sign-offs

Every agent has a stable id (`eng-003`, `qa-001`) recorded in the registry. Every gate and the
human final gate carry an **HMAC-SHA256 signature** over
`plan_id | task_id | actor_id | verdict | ts | seq`. That makes a sign-off:

- **unforgeable** — a verdict not produced by the engine won't verify against the key;
- **non-replayable** — `seq` + `ts` are inside the signed message, so a captured sign-off can't
  be reused on another task or run;
- **attributable** — every verdict names exactly one signer, so a false positive traces to one
  id, not an ambient token.

## LLM backends

The one LLM call site is pluggable:

- **`claude-cli`** (default) — shells out to the `claude` binary, using your existing Claude
  Code auth. No API key to manage.
- **`anthropic-api`** — calls the Anthropic Messages API via `@anthropic-ai/sdk`
  (`claude-opus-4-8`). Needs `ANTHROPIC_API_KEY`.

## Develop

```sh
bun install
npx vitest run            # 173 tests
npx vitest run --coverage # 100% on the deterministic core (src/core/**)
npx tsc --noEmit          # typecheck
npx biome check src/      # lint
npx tsx src/index.ts --help
```

The deterministic core (`src/core/**`) is gated at **100% coverage**. The CLI surface and the
live-I/O LLM runners are exercised by integration tests (`tests/integration/`), which run the
real binary and skip cleanly when `claude` isn't on `PATH`.

## Data isolation

Agents and skills are shared role definitions only. All run-state is project-local under
`~/.teo/memory/<project-id>/`. No code or data crosses between clients or projects.

## License

MIT. See [LICENSE](LICENSE).
