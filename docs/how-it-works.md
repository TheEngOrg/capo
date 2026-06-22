# How It Works

TEO is a team of agents coordinated by one orchestrator, running inside your Claude Code session. This page explains the moving parts.

## The dispatcher and Sage

The main Claude Code session acts as a **dispatcher**. Its only job is routing: it matches your `/teo` request and either handles a utility command directly or hands the work to Sage.

**Sage** is the orchestrator. Sage does not write code. Sage classifies the request, scopes and sequences the work, and dispatches each piece to the right specialist. Every artifact — tests, code, specs, reviews, commits — is produced by a named specialist, never by Sage directly. Sage runs as a spawned subagent, not as the main session.

```
You → /teo → Dispatcher → Sage → specialists (qa, dev, staff-engineer, …)
```

## The CAD pipeline

Substantive code changes follow a gated cycle. Sage will not skip these gates.

```
qa-spec → dev → qa-validate → staff-engineer review → commit
```

1. **qa-spec** — QA writes failing tests first, covering misuse and boundary cases before the golden path.
2. **dev** — Implements to green against those tests.
3. **qa-validate** — Verifies the implementation and coverage.
4. **staff-engineer** — Reviews architecture and quality.
5. **commit** — Sage commits only after every gate passes.

Larger or ambiguous work expands the front of the pipeline (product-manager for scope, cto for architecture decisions) but the gate order holds.

## The agents

TEO bundles a full roster. You don't invoke these directly — Sage dispatches them. The core engineering set:

| Agent | Role |
|-------|------|
| `sage` | Orchestrator — plans and delegates |
| `qa` | Test specs and validation |
| `dev` | Implementation (after tests exist) |
| `staff-engineer` | Architecture review, post-build gate |
| `security-engineer` | Security audit, threat modeling |
| `product-manager` | Scope and BDD scenarios |
| `technical-writer` | Docs |

Plus design, data, devops, API, and coordination roles for non-engineering work.

Because the agents ship with the plugin, they are namespaced (e.g. `teo:sage`, `teo:qa`). They never collide with agents you've defined in your own project.

## The signed ledger

Each run writes an append-only JSONL ledger, and every step result is signed with HMAC. This gives you a verifiable record of what the team did — which gates ran, in what order, and with what outcome. The acceptance harness checks that the ledger was written and that the signatures verify.

## What runs where

Everything runs in your session. There is no daemon, no server, no separate process, and no API key. Sage's planning and the specialist spawns use Claude Code's own subagent mechanism. The plugin loads its agents, skills, and hooks from the plugin cache — your project directory is never touched.
