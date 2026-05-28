# ADR-0001 — SOC2 V1 Boundary and Runtime Adapter Strategy

**Status:** PROPOSED — pending Week 1 subprocess spike  
**Date:** 2026-05-21  
**Author:** CTO  
**Deciders:** CTO, Sage (Step 0 planning), User  
**Related:** ADR-0002 (Greenfield Interfaces — human-authored spec), ADR-0003 (Module/Extension Contract Surface), ADR-0004 (Root-Config Integrity — dev-mode escape mechanism and governance event schema)

---

## Context

TEO v1 is a greenfield rewrite of the binary monorepo (`packages/`, `daemon/`, `storage/`). The `.claude/` framework tree — 28 agents, 26 skills, 17 protocols — is preserved unchanged and becomes the configuration source for the new binary.

The rewrite is motivated by two structural problems in the current codebase:

1. **Enforcement architecture**: The current system relies on behavioral discipline (the Sage constitution) and optional identity tokens to enforce tool grant policy. Both have documented production failures (INCIDENT-3, INCIDENT-10, issues #692 and #525). SOC2 controls cannot be certified on behavioral constraints — they require mechanical enforcement.

2. **Adapter model**: `ClaudeCliRuntime` and `GeminiRuntime` are working partial implementations of Model B (TEO IS the runtime, drives `claude`/`gemini` as subprocesses). The existing daemon's `selectRuntime()` already does this. The greenfield completes and unifies what's partially built.

Two specific decisions must be locked before any BUILD session begins:

**Runtime adapter strategy (D1):** Whether to ship CLI subprocess (`ClaudeCliRuntime`) or SDK client (`ClaudeSDKAdapter`) as the v1 runtime, and how to design the `BaseRuntime` interface for clean adapter swapping.

**SOC2 V1 boundary (D2, D3):** What controls are certified at v1 (and what is explicitly deferred), including public key pinning strategy and tamper enforcement posture.

The manifest bootstrap approach (user directive 2026-05-21) adopts Option C from the security-engineer SOC2 assessment: agent manifests are compiled at release time, signed in the tarball, and the binary refuses to load user-modified `agent.md` files. There is no `teo install` re-compile path in v1. This is the cleanest SOC2 audit chain and forces a first-class module/extension system for customization (see ADR-0003).

---

## Decision

### Part 1 — Runtime Adapter Strategy

**v1 ships `ClaudeCliRuntime` as the primary runtime. The `BaseRuntime` interface is designed adapter-agnostic from day one.**

`ClaudeCliRuntime` drives the `claude` CLI subprocess directly, using per-turn context injection (`claude --print` with full history serialized as prompt prefix) and `session-store.ts` for state persistence. This is the current implementation's model, extended with multi-turn support.

The `BaseRuntime` interface is defined as follows (greenfield version — this is the Step 0 human-authored interface, not the current legacy definition):

```typescript
interface BaseRuntime {
  execute(
    context: SpawnContext,
    identity: AgentIdentity,
    extraArgs?: string[],
    signal?: AbortSignal,
    onOutput?: (chunk: string) => void
  ): Promise<SpawnResult>;

  supportsToolInterception(): boolean;   // false for CLI black-box adapters
  supportsDisallowedToolsFlag(): boolean; // true for Claude CLI only
}
```

`AgentIdentity.identity_token` is a required `string` in the greenfield — the legacy `identity_token?: string` optional escape hatch is removed. Any spawn() call site that does not supply a token fails TypeScript compilation. This is enforced by the Step 0 CI gate on `greenfield/spec` branch.

**`ClaudeSDKAdapter` is the contingency path.** It is activated if and only if the Week 1 spike proves CLI subprocess multi-turn is not feasible. The spike must answer:

1. Can `claude` in interactive stdin-driven mode work as a scriptable subprocess without a TTY?
2. Does per-turn context injection via `claude --print` (re-serializing full history as prompt prefix) stay coherent across 3+ turns at realistic session lengths?
3. Does `claude --help` confirm `--allowed-tools` / `--disallowed-tools` flag availability and syntax?
4. What is the per-turn overhead of context injection across 5 turns (token growth rate)?

If CLI subprocess is not feasible: `ClaudeCliRuntime` becomes `ClaudeSDKAdapter` using `@anthropic-ai/sdk` `messages.create()`. The `BaseRuntime` interface is unchanged — the swap is purely internal. PolicyEnforcement's `tool_propose` interception point changes from ControlPlane bus (subprocess stdout parse) to SDK response `tool_use` content block inspection. Same bus subscriber, different event source. Auth requirement changes: `ANTHROPIC_API_KEY` env var instead of relying on the user's existing `claude` CLI auth.

**This is not "plan for both adapters at day one."** The design has one primary path. The interface is adapter-agnostic so the fallback can slot in without API surface changes if needed.

**Week 1 spike gate:** The spike is a required gate before this ADR advances from PROPOSED to ACCEPTED. A human-executed Day 1 spike documents findings in a one-page capability assessment. If CLI subprocess works, this ADR is accepted with `ClaudeCliRuntime` as the v1 runtime. If the spike fails, this ADR is amended to record `ClaudeSDKAdapter` as the v1 runtime before ACCEPTED status is granted.

**Two-layer tool grant enforcement (Claude CLI path):**

- Universal floor: in-process `PolicyEnforcement.preflight()` called from `spawn()` before any `runtime.execute()`. Checks requested tool list against compiled manifest. Throws `ToolGrantViolation`, emits `tool_grant_denied` governance event.
- Defense-in-depth (Claude CLI only): `--disallowed-tools` flag appended to subprocess invocation args after the in-process check passes. The subprocess enforces the grant internally. If in-process check somehow passes a disallowed tool, the subprocess still blocks it.

This resolves issue #692 (Sage Edit/Write drift) by construction.

---

### Part 2 — SOC2 V1 Boundary

**The following controls are committed to SOC2 certification at v1:**

| Control | Implementation | Week |
|---------|---------------|------|
| Identity tokens — HMAC-SHA256 signed, required at spawn | `TokenIssuer` + `TokenVerifier`, session-local secret at `chmod 0600` | Week 2A |
| Tool grant enforcement — in-process PolicyEnforcement + subprocess flag | `spawn()` → `PolicyEnforcement.preflight()` → `--disallowed-tools` arg | Week 3A |
| Unified governance audit log | `GovernanceBackend` interface, separate REPL + daemon log paths, `teo audit merge` | Week 2C |
| Manifest hash chain — release-signed `agents.json` | Option C bootstrap: `agents.json` + `agents.lock` signed at release; binary verifies at startup | Week 2B |
| License validation — `teo.lic` HMAC verified at startup | Hard block on tamper, blocks before any agent spawn | Week 4B |

**The following are explicitly v1.x (out of scope for v1 certification):**

- Live manifest reload without binary restart
- Remote immutable log shipping (CloudWatch, Splunk, write-once S3)
- Multi-tenant control plane and shared memory
- `teo-compliance-report` automated auditor report (v1 ships the evidence; the report command is v1.x)

These v1.x items are tracked as: STORY-REMOTE-LOG, STORY-LIVE-MANIFEST, STORY-COMPLIANCE-REPORT.

**Public key pinning (D2):**

The verification public key for `agents.lock` and `teo.lic` signature validation is compiled into the binary at build time. There is no file-based key path. There is no documented caveat or deferral — this is the SOC2 V1 closing control required by the security-engineer assessment (q2-soc2-verification.md, "Closing control required: The verification public key must be compiled into the binary, not shipped as a file").

A file-based public key can be replaced by an attacker with local filesystem access, defeating the entire signing chain. Compiling the key into the binary closes this attack surface.

Key rotation mechanism is out of scope for v1. Key rotation requires a coordinated binary release — see Future Work: STORY-KEY-ROTATION.

**Tamper enforcement posture (D3):**

Three enforcement layers:

1. **Production binary:** Hard block on integrity violation. Process exits non-zero. Error written to stderr. No execution continues. A `manifest_integrity_violation` governance event is written to the append-only log before exit (not after — the write happens as part of the detected-violation handling path, before the process calls `process.exit()`).

2. **Dev mode escape:** `TEO_DEV_MODE=1` environment variable enables warn-and-proceed locally. The escape is NOT silent. It MUST emit a permanent `dev_mode_active` governance event burned into the audit log. The `dev_mode_active` event includes: timestamp, binary hash, detected violation description, operator identity (from `TEO_OPERATOR` env var, falling back to OS user via `os.userInfo().username`). The event schema is specified in ADR-0004.

3. **CI policy constraint:** The CI environment MUST fail on integrity violation regardless of `TEO_DEV_MODE`. This is a CI pipeline policy, not a binary feature. The binary honors `TEO_DEV_MODE=1` in dev. The CI pipeline explicitly does NOT set `TEO_DEV_MODE=1` and fails hard on the binary's non-zero exit code. This is documented here as a CI integration requirement — it is NOT a binary configuration option, and it does NOT require a binary code change to enforce.

ADR-0004 (Root-Config Integrity, authored by security-engineer) elaborates the dev-mode escape mechanism and governance event schema in detail. ADR-0001 owns the policy. ADR-0004 owns the implementation contract.

**Governance audit chain:**

Every subprocess invocation produces, in order, governance log entries: `spawn_requested → token_verification_failed | spawn_started → tool_grant_denied (if applicable) → spawn_completed | spawn_rejected`. This chain is the G4 gate artifact.

The six current parallel audit paths (`GovernanceLogger` JSONL, `bypass-audit-YYYY-MM-DD.json`, `sage-session-log.json`, `agent-trace-{workstream-id}.json`, `gates-{workstream-id}.json`, `token-usage.json`) are replaced by a single `GovernanceBackend` interface. v1 ships JSONL. v1.x adds pluggable remote write.

---

## Consequences

### Positive

- Tool grant enforcement is mechanical — behavioral compliance (Sage constitution) is belt-and-suspenders, not primary enforcement. Issues #692 and #525 are resolved by construction.
- `BaseRuntime` adapter-agnostic design means the CLI-to-SDK swap, if needed, is a one-file change with zero external API surface impact.
- Option C manifest bootstrap (release-signed `agents.json`, no re-compile path) produces the cleanest possible SOC2 audit chain — the auditor's verification path is: release artifact signature → `agents.json` → grants enforced. No intermediate local events to reconcile.
- Public key compiled into binary closes the key-replacement attack surface at v1 with no ongoing maintenance cost.
- Three-layer tamper enforcement (hard block / dev-mode escape / CI policy) is practical for the real development workflow without sacrificing the audit story.

### Negative / Trade-offs

- **Week 1 spike blocks everything.** If the spike takes more than 2-3 days to execute and document, it delays every subsequent workstream. This is a human-executed spike, not a Sage BUILD session — architect availability is the constraint.
- **SDK fallback changes auth.** If `ClaudeSDKAdapter` is needed, users who rely on `claude` CLI auth (no API key required) face a UX change. `ANTHROPIC_API_KEY` becomes a hard requirement.
- **No re-compile path means agent manifest changes require a binary release.** This is the trade-off of Option C. The module/extension system (ADR-0003) is the designed answer for user customization, but it is a v1.x deliverable. Between v1 ship and v1.x module system, users cannot customize agent definitions without building from source.
- **Public key compiled into binary means key rotation requires a binary release.** Acceptable for v1 given the controlled distribution model; must be addressed before v1.x or any broad community distribution.

### Future Work

- STORY-KEY-ROTATION: Key rotation mechanism — out of scope for v1. When the binary is broadly distributed, key rotation without a full binary release is required. Design options include: JWKS endpoint with pinned CA, or dual-key signed tarballs with a key transition window.
- STORY-REMOTE-LOG: Remote immutable log shipping — CloudWatch Logs, Splunk, or write-once S3. Required before SOC2 Type II certification for enterprise accounts (local JSONL is insufficient for Type II).
- STORY-SDK-ADAPTER: `ClaudeSDKAdapter` full implementation — if the Week 1 spike finds CLI subprocess not feasible, this story becomes Week 1's output rather than a future item.
- STORY-COMPLIANCE-REPORT: `teo-compliance-report` automated auditor report — v1 ships the governance event chain; the readable control evidence report is v1.x.

---

## Open Questions

| ID | Question | Owner | Status |
|----|----------|-------|--------|
| OQ-1 | Does `claude --print` support multi-turn via context injection at realistic session lengths (3+ turns, coherent tool results)? | Week 1 spike (human-executed) | OPEN — blocks ADR ACCEPTED status |
| OQ-2 | Does `claude --help` confirm `--allowed-tools` / `--disallowed-tools` flag availability? If absent, what is the subprocess tool enforcement mechanism? | Week 1 spike | OPEN |
| OQ-3 | What is the signing key generation and storage process for the v1 release? Who holds the private key? What is the CI secret name? | CTO + DevOps | OPEN |
| OQ-4 | Does the compiled-in public key approach require a separate build step or can it be embedded via a Bun build flag at release time? | Staff-engineer (Week 4B) | OPEN |
| OQ-5 | What is the `TEO_OPERATOR` env var convention for CI vs developer workstations — does it need a default value or is falling back to OS user sufficient? | CTO + Security-engineer | OPEN |
