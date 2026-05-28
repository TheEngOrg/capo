# ADR-0003 — Module/Extension Contract Surface

**Status:** PROPOSED — registry implementation must be proven before ACCEPTED  
**Date:** 2026-05-21  
**Author:** CTO  
**Deciders:** CTO, Sage (Step 0 planning), User  
**Related:** ADR-0001 (SOC2 V1 Boundary — Option C manifest bootstrap, no re-compile path), ADR-0002 (Greenfield Interfaces — `agents.json` schema), ADR-0004 (Root-Config Integrity)

---

## Context

TEO v1 adopts Option C manifest bootstrap (ADR-0001): agent manifests are compiled at release time, signed in the tarball, and the binary refuses to load user-modified `agent.md` files. There is no `teo install` re-compile path in v1.

This is the right SOC2 call — the release-signed `agents.json` chain is the cleanest audit boundary. But it immediately creates a usability gap: teams need to customize, override, and extend agent behavior. Without a designed path for this, users hit an opaque wall and the obvious workaround is building from source (which defeats the signed binary chain entirely).

The module/extension system is the designed answer to that gap. It replaces local YAML edits as the customization mechanism. Instead of editing `agent.md` files (which the v1 binary refuses to re-compile), operators ship signed extension manifests with declared relationships to the core agent definitions.

**Scope of this ADR:** This ADR locks the types, trust model, and interfaces that constitute the v1 contract surface. It defines what a module IS and what the runtime MUST honor. It does NOT prescribe how modules are discovered, loaded, or registered at runtime — that is the registry implementation, deferred to v1.x. Building the contract surface first means v1.x discovery/loading work can happen without breaking callers: the types are stable, the trust model is locked, and the `agents.json` `modules: []` field is reserved but empty at v1.

Why lock the contract before the registry? Because the registry implementation's correctness depends on the type system being stable. If we design the registry first and discover the types need to change, we break the registry. The reverse is not true — stable types can absorb a registry implementation without changes.

User directive (2026-05-21): "Module/extension contract: signed extension manifests, declared `extends:`/`overrides:`/`adds:` relationships, separate release lifecycle from core, registered in `agents.json` via a `modules: []` field at compile time."

---

## Decision

### Types

The following types define the v1 module contract surface. They live in `@teo/core` and are exported from the barrel `src/index.ts`. They do NOT appear in the CLI or MCP server packages — modules are a core primitive.

```typescript
/** Globally unique module identifier. Namespaced: "<scope>/<name>@<version>". */
type ModuleId = `${string}/${string}@${string}`;

/** Semantic version string. Validated at load time against the semver spec. */
type ModuleVersion = string; // semver: "1.2.3" | "1.2.3-beta.1"

/** Human-readable module metadata. Embedded in ModuleManifest. */
interface ModuleMetadata {
  id: ModuleId;
  version: ModuleVersion;
  display_name: string;
  description: string;
  author: string;
  /** ISO 8601 timestamp of manifest authoring. */
  authored_at: string;
  /** Optional license identifier (SPDX). */
  license?: string;
}

/** Trust level assigned to a module at load time based on signing chain. */
enum ModuleTrustLevel {
  /** First-party TEO module. Signed by the TEO core key. Full capability access. */
  FIRST_PARTY = 'first_party',
  /** Third-party module, signed by a key on the verified key list. Scoped capability access. */
  THIRD_PARTY_VERIFIED = 'third_party_verified',
  /** Third-party module, unsigned or signed by an unknown key. Sandboxed or blocked. */
  THIRD_PARTY_UNVERIFIED = 'third_party_unverified',
}

/**
 * What a module can declare it does. Each capability is a claim that
 * the runtime evaluates at trust-boundary enforcement time.
 * Capabilities are additive — a module must declare every capability it exercises.
 */
enum ModuleCapability {
  /** Declare additional agents (adds: [] entries in ModuleManifest). */
  ADD_AGENTS = 'add_agents',
  /** Override existing agent tool lists or behavioral constraints. */
  OVERRIDE_AGENTS = 'override_agents',
  /** Extend an existing agent with additional allowed tools or hooks. */
  EXTEND_AGENTS = 'extend_agents',
  /** Register hooks that fire on governance events (observe-only). */
  GOVERNANCE_HOOKS = 'governance_hooks',
  /** Register hooks that can intercept and modify tool_propose events. */
  TOOL_INTERCEPT_HOOKS = 'tool_intercept_hooks',
}
```

### ModuleManifest Schema

`ModuleManifest` is the serialized form of a module — what ships in the extension tarball and what the runtime reads at registration time.

```typescript
interface ModuleManifest {
  schema_version: '1';
  metadata: ModuleMetadata;
  trust_level: ModuleTrustLevel; // Set by the runtime at load time — NOT trusted from the manifest file itself
  /** Declared capabilities. Runtime validates trust_level permits each declared capability. */
  capabilities: ModuleCapability[];

  /** Agents this module declares in addition to the core agent set. */
  adds?: AgentDefinition[];
  /** Agent overrides. Replaces the named core agent's definition wholesale. */
  overrides?: AgentOverride[];
  /** Agent extensions. Merges with the named core agent's definition (additive). */
  extends?: AgentExtension[];

  /** Optional module-level hooks. */
  hooks?: ModuleHook[];

  /**
   * Cryptographic signature of the manifest content (excluding this field).
   * Algorithm: Ed25519. Encoding: base64url.
   * Absent = unsigned (THIRD_PARTY_UNVERIFIED treatment).
   */
  signature?: string;
  /** Key fingerprint identifying which signing key was used. */
  signing_key_id?: string;
}
```

### Trust Model

The trust model has three tiers. The runtime assigns `trust_level` at load time — it is NOT read from the manifest file (a compromised manifest could claim `FIRST_PARTY` trust; the runtime must verify independently).

**Tier 1 — FIRST_PARTY**

- Signed by the TEO core key (same key that signs `agents.json` in the release tarball).
- Permitted capabilities: all `ModuleCapability` values.
- Verification: signature checked against the compiled-in public key at runtime.
- Distribution: bundled in TEO release tarballs only. Cannot be installed from external sources without a TEO team signature.

**Tier 2 — THIRD_PARTY_VERIFIED**

- Signed by a key on the verified key list. The verified key list is compiled into the binary at release time alongside the core public key — same mechanism, same attack surface posture (no file-based key list).
- Permitted capabilities: `ADD_AGENTS`, `EXTEND_AGENTS`, `GOVERNANCE_HOOKS`. NOT permitted: `OVERRIDE_AGENTS`, `TOOL_INTERCEPT_HOOKS` (these are too high-privilege for unvalidated third parties at v1.x).
- Verification: signature checked against the verified key list at runtime.
- Process for verified key addition: PR to TEO core repo, CTO approval, merged to verified-keys list, shipped in next binary release.

**Tier 3 — THIRD_PARTY_UNVERIFIED**

- Unsigned manifest, or signed by a key not on the verified key list.
- Default posture: **blocked**. The runtime refuses to load the module and emits a `module_load_blocked` governance event with reason `unverified_signature`.
- Override mechanism: `TEO_ALLOW_UNVERIFIED_MODULES=1` env var — same semantics as `TEO_DEV_MODE=1`. Emits `module_unverified_bypass_active` governance event before loading. NOT silent. NOT available in CI (same CI policy as tamper enforcement in ADR-0001).
- Rationale: Unverified modules can ADD_AGENTS, but those agents still run through PolicyEnforcement at spawn time — the tool grant cap from `agents.json` is the final enforcement layer regardless of what the module claims. THIRD_PARTY_UNVERIFIED modules cannot escalate beyond what PolicyEnforcement allows. The block posture is about auditability, not just capability containment.

**Trust-level enforcement at capability boundary:**

```
trust_level: FIRST_PARTY        → all ModuleCapability values permitted
trust_level: THIRD_PARTY_VERIFIED → ADD_AGENTS, EXTEND_AGENTS, GOVERNANCE_HOOKS
trust_level: THIRD_PARTY_UNVERIFIED → blocked (or bypass with governance event)
```

Any module that declares a capability its trust level doesn't permit: `module_load_blocked` governance event, load aborted. This is checked before any module code executes.

### ModuleRuntime Interface

`ModuleRuntime` is what the host runtime MUST provide to a module. It is the module's view of the host — modules program against this interface, not against `@teo/core` internals.

```typescript
/**
 * What the host runtime provides to a loaded module.
 * Modules receive this interface at registration time.
 * Modules MUST NOT retain a reference to any @teo/core internal beyond this interface.
 */
interface ModuleRuntime {
  /**
   * Register a new agent definition. Only callable if module declares ADD_AGENTS.
   * Throws ModuleCapabilityViolation if capability not declared or trust level insufficient.
   */
  registerAgent(definition: AgentDefinition): void;

  /**
   * Override an existing agent. Only callable if module declares OVERRIDE_AGENTS.
   * Core agents (trust_level FIRST_PARTY in agents.json) cannot be overridden by
   * THIRD_PARTY_VERIFIED modules — throws ModuleCapabilityViolation.
   */
  overrideAgent(agentId: string, definition: AgentDefinition): void;

  /**
   * Extend an existing agent (object merge). Only callable if module declares EXTEND_AGENTS.
   * Merge rule: per-field merge with extension (user/module) override as primary.
   * Fields present in the extension override the corresponding core agent fields.
   * Fields present only in the core agent are preserved unchanged.
   * Tool grants: extension can ADD tools to an existing agent's cap, but CANNOT remove tools.
   * Tool removal attempts via extend: throw ModuleCapabilityViolation.
   */
  extendAgent(agentId: string, extension: AgentExtension): void;

  /**
   * Register a hook. Capability required depends on hook type:
   * - GovernanceHook: requires GOVERNANCE_HOOKS
   * - ToolInterceptHook: requires TOOL_INTERCEPT_HOOKS
   */
  registerHook(hook: ModuleHook): void;

  /** Emit a governance event from within the module. Routes through GovernanceBackend. */
  emitGovernanceEvent(event: ModuleGovernanceEvent): void;

  /** Read-only view of the module's own manifest. */
  readonly manifest: Readonly<ModuleManifest>;

  /** Trust level assigned to this module by the runtime. */
  readonly trustLevel: ModuleTrustLevel;
}
```

### ModuleHook Interface

```typescript
type HookPhase = 'pre_spawn' | 'post_spawn' | 'on_tool_propose' | 'on_governance_event';

interface ModuleHook {
  phase: HookPhase;
  /** Unique hook identifier within this module. */
  id: string;
  /**
   * Handler function.
   * GovernanceHook: receives GovernanceEvent, returns void (observe-only).
   * ToolInterceptHook: receives ToolProposePayload, returns 'allow' | 'block' | 'modify'.
   * Returning 'modify' requires providing the modified payload.
   * Hooks MUST complete within 500ms. Timeout = hook disabled, governance event emitted.
   */
  handler: ModuleHookHandler;
}

type ModuleHookHandler =
  | { phase: 'on_governance_event'; fn: (event: GovernanceEvent) => void }
  | { phase: 'on_tool_propose'; fn: (payload: ToolProposePayload) => ToolInterceptResult }
  | { phase: 'pre_spawn' | 'post_spawn'; fn: (context: SpawnContext) => void };

type ToolInterceptResult =
  | { decision: 'allow' }
  | { decision: 'block'; reason: string }
  | { decision: 'modify'; payload: ToolProposePayload };
```

### agents.json Module Field

The `agents.json` compiled manifest (v1 release artifact) includes a `modules` field that is an empty array at v1. The field is reserved and the schema is versioned so that v1.x registry implementation can populate it without a breaking schema change.

```json
{
  "schema_version": "2",
  "source_hash": "<sha256>",
  "compiled_at": "<iso8601>",
  "agents": [...],
  "modules": []
}
```

The `modules: []` field signals to future runtime versions that module loading is supported. A runtime that reads a `modules: []` entry proceeds normally. A runtime that reads a populated `modules: [...]` entry and does not know how to load modules MUST emit a `module_schema_unsupported` governance event and fail startup — it cannot silently ignore modules it doesn't understand (silent ignore = running with a partial policy).

---

## Consequences

### Positive

- Locking types and interfaces before the registry means the v1.x registry implementation has a stable contract to build against. No breaking API surface changes when discovery/loading ships.
- The trust model tier design gives verified third-party module authors a clear path (PR to core repo, approval, binary release) without requiring the core team to audit every module.
- `ModuleRuntime` as an explicit interface boundary means modules cannot escape into `@teo/core` internals — the host controls exactly what the module can see and do.
- The `agents.json` `modules: []` field reservation means v1 binaries are forward-compatible with v1.x manifests that include module entries, as long as the schema version check is honored.
- Tool grant enforcement (ADR-0001, PolicyEnforcement) is the final cap on all module-registered agents — a compromised module cannot escalate tool grants beyond what the compiled manifest allows.

### Negative / Trade-offs

- **No user customization at v1.** Between v1 ship and v1.x module system, users who need custom agents must build from source. This is a real gap for power users and enterprise customers with custom workflows.
- **Verified key list compiled into binary.** Adding a third-party verified publisher requires a TEO binary release. This is the right security posture but creates friction for community publishers. v1.x should evaluate a JWKS-style revocable key list with a pinned CA (same discussion as STORY-KEY-ROTATION).
- **`OVERRIDE_AGENTS` not available to THIRD_PARTY_VERIFIED at v1.x.** `overrideAgent` replaces an agent definition wholesale and requires FIRST_PARTY trust for core agents. `extendAgent` (EXTEND_AGENTS capability) supports per-field object merge with user/module override as primary — this is the designed path for THIRD_PARTY_VERIFIED customization. Full override requires FIRST_PARTY trust. This may frustrate enterprise customers who need to replace core agent behavior wholesale. The right answer at v1.x is to design a delegation model where the TEO team co-signs a customer override manifest — this is not designed yet.
- **500ms hook timeout.** Governance hooks that do synchronous I/O (e.g., calling a remote policy service) will hit this limit. Async hook design is the right long-term answer but requires a more complex hook executor. Deferred to v1.x; the timeout is explicitly documented so hook authors know the constraint.

### Future Work

- STORY-MODULE-REGISTRY: Module discovery and loading implementation (local path resolution, or named npm-style registry). This is the registry implementation deferred from this ADR. Design questions: local path resolution vs. named registry, lock file semantics, install-time signature verification.
- STORY-MODULE-VERIFIED-PUBLISHERS: Process and tooling for the verified publisher key list. Evaluate JWKS-style revocable keys vs. binary-compiled list. Tied to STORY-KEY-ROTATION.
- STORY-MODULE-OVERRIDE-DELEGATION: Delegation model for enterprise customers who need OVERRIDE_AGENTS without FIRST_PARTY trust. Co-signed manifests or a customer-scoped trust tier.
- STORY-MODULE-ASYNC-HOOKS: Async hook executor with configurable timeout and backpressure. Required before TOOL_INTERCEPT_HOOKS are practical for remote policy services.
- STORY-MODULE-COMMUNITY-REGISTRY: Public module registry (npm-style, scoped `@teo/` namespace). Long-term community distribution path.

---

## Open Questions

| ID | Question | Owner | Status |
|----|----------|-------|--------|
| OQ-1 | Module registry: local path resolution (`~/.teo/modules/`) or named npm-style registry? Or both, with different trust tiers for each? | CTO | OPEN — deferred to STORY-MODULE-REGISTRY |
| OQ-2 | Override semantics for `extendAgent`: per-field merge with explicit conflict resolution, or additive-only with conflict = error? The current spec says additive-only. Is that sufficient for real enterprise customization needs? | CTO + User | RESOLVED — Per-field object merge — extension (user/module) override is primary. Conflict resolution: extension wins. Core fields not present in extension are preserved. Resolved 2026-05-21 by user directive. |
| OQ-3 | Should `ModuleGovernanceEvent` be a subtype of the core `AuditEntry.event` union, or a separate event namespace? Affects how `teo audit` merges module events with core events. | Staff-engineer (Week 2C) | OPEN |
| OQ-4 | How does the `TEO_ALLOW_UNVERIFIED_MODULES=1` bypass interact with `TEO_DEV_MODE=1`? Are they independent or does dev mode imply unverified module allowance? Recommend: independent — dev mode is about integrity enforcement, unverified modules is a separate trust boundary. | CTO + Security-engineer | OPEN |
| OQ-5 | The 500ms hook timeout: should it be configurable per hook registration, or is a single global timeout right? Configurable gives hook authors flexibility; global is simpler to audit. | CTO | OPEN |
