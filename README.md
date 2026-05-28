# TEO — TheEngOrg

Agentic engineering framework + CLI. The free layer of TEO.

> **Status:** v1.0.0-pre — greenfield rewrite in progress. Step 0 (interface sprint) is the current phase. See [`docs/adr/0001-soc2-v1-boundary.md`](docs/adr/0001-soc2-v1-boundary.md) and [`docs/adr/0002-greenfield-interfaces.md`](docs/adr/0002-greenfield-interfaces.md).

## What TEO is

TEO is a CLI tool that replaces `claude code` / `gemini-cli` with an orchestration runtime. It drives `claude` and `gemini` as subprocesses, enforces mechanical tool grant policies at spawn time, signs identity tokens with HMAC, and ships a unified governance audit log for SOC2-ready posture.

The free layer (this repo) gives you everything needed to run TEO locally. The enterprise layer ([`the-eng-org-enterprise`](https://github.com/TheEngOrg/the-eng-org-enterprise)) adds hosted storage, shared memory, and multi-tenant control plane.

## Architecture

Three workspace packages:

| Package | Purpose |
|---------|---------|
| [`@teo/core`](packages/core) | Runtime primitives — ControlPlane, spawn, PolicyEnforcement, GovernanceLogger, ProcessEngine, AgentRegistry, identity tokens |
| [`@teo/cli`](packages/cli) | CLI binary — `teo` (REPL) and `teo serve` (daemon) entry points |
| [`@teo/mcp-server`](packages/mcp-server) | MCP server exposing TEO tooling to MCP-compatible clients |

Cross-package boundaries enforced by TypeScript project references (`composite: true`). Internal `@teo/core` module boundaries enforced by ESLint `no-restricted-imports` in CI — direct imports from `@teo/core/internal/*` are CI failures.

## Build

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

## License

MIT. See [LICENSE](LICENSE).

The enterprise layer is proprietary. See [the-eng-org-enterprise](https://github.com/TheEngOrg/the-eng-org-enterprise) for details.
