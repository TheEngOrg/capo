# CAPO by The Eng Org

Multi-agent engineering orchestration for Claude Code, packaged as a plugin.

TEO brings a structured engineering team into your Claude Code session. A single orchestrator (**Capo**) takes a request, breaks it into work, and dispatches it to specialist agents — QA, dev, staff-engineer, security, design, and more — through a gated development cycle. Every substantive code change runs QA-first: tests are written before implementation, reviewed by a staff engineer, and recorded in an HMAC-signed audit ledger.

It installs as a Claude Code plugin. No daemon, no server, no API key — everything runs in your own session.

> Alpha: the in-session command is `/teo`. It becomes `/capo` post-alpha.

## Install

```
/plugin marketplace add TheEngOrg/capo
/plugin install teo@teo-marketplace
```

Then start any workflow with `/teo`.

## Use

```
/teo                     # show the menu
/teo build <feature>     # full QA -> dev -> review cycle
/teo fix <bug>           # reproduce -> fix -> verify
/teo review <scope>      # quality + security review
/teo plan <initiative>   # scope and sequence new work
/teo <anything>          # ask Capo to orchestrate it
```

`/teo` is the gateway. It routes your request to Capo, who plans the work and delegates to the right specialists. You stay in the loop for decisions; the team produces the artifacts.

## What it does

- **QA-first development** — tests are authored before code, covering misuse and boundary cases first.
- **Gated pipeline** — every change passes through spec -> build -> validate -> staff review before commit.
- **Deterministic guardrails** — the gate logic and plan validation are deterministic code, not LLM judgment. The agent work they wrap is not — CAPO's job is to put hard, verifiable guardrails around it.
- **Signed audit trail** — gate verdicts are recorded in an HMAC-signed, append-only ledger. Independent verification tooling is coming post-alpha.

## What it does NOT do

- It does not run a daemon, a server, or a separate CLI. Everything runs inside your Claude Code session.
- It does not copy agents, skills, or hooks into your project's `.claude/`. The plugin loads from its own cache; your repo stays clean.
- It does not require an API key, a license, or a login.
- It does not commit or push without passing its gates first.

## Documentation

- [Getting Started](docs/getting-started.md) — install, first run, and the `/teo` menu.
- [How It Works](docs/how-it-works.md) — Capo, the dispatcher, the CAD pipeline, and the ledger.
- [Configuration](docs/configuration.md) — adding agents, overriding agents, custom skills, and hooks.
- [Agents](docs/agents.md) — full roster with one-line descriptions.
- [Contributing](docs/contributing.md) — how to build and test CAPO locally.

## Sponsor

If CAPO saves you time, consider supporting development: [github.com/sponsors/bywonton](https://github.com/sponsors/bywonton)

## License

MIT — see [LICENSE](LICENSE).
