# ADR-0004 — Root-Config Integrity

**Status:** PROPOSED  
**Date:** 2026-05-21  
**Author:** Security Engineer  
**Deciders:** CTO, Security Engineer  
**Related:** ADR-0001 (SOC2 V1 Boundary — tamper enforcement policy this ADR implements), ADR-0003 (Module/Extension Contract Surface — `TEO_ALLOW_UNVERIFIED_MODULES=1` bypass and `module_load_blocked` event schema)

---

## Context

ADR-0001 commits TEO v1 to three-layer tamper enforcement: hard block in production, dev-mode escape via `TEO_DEV_MODE=1`, and CI policy constraint. It also establishes the manifest hash chain (`agents.json` + `agents.lock`, signed at release time, verified by a compiled-in public key) as a SOC2 V1 control.

ADR-0001 owns the policy. This ADR owns the implementation contract: which files are protected, how integrity checks run, the full governance event schemas (including events referenced in ADR-0003 but not yet specified), and the normative env var precedence rules.

The security-engineer SOC2 assessment (q2-soc2-verification.md, Option C verdict) identified two closing controls required for CC6.6 and CC7.2:
- Launch-time signature verification failures must be logged as `manifest_integrity_violation` events.
- The verification public key must be compiled into the binary, not shipped as a file.

Both are specified here as normative requirements.

ADR-0003 introduces `TEO_ALLOW_UNVERIFIED_MODULES=1` as a granular bypass for unverified module loading. OQ-4 from ADR-0003 asked how this var interacts with `TEO_DEV_MODE=1`. That question is resolved: the two vars are not symmetric, and their precedence relationship is normatively specified in this ADR.

---

## Decision

### Part 1 — Protected Files and Integrity Check Mechanism

**Which files are protected:**

The following files constitute the protected root config set. Any modification to these files after release must be detected and blocked before any agent spawn occurs:

| File | Protection mechanism |
|------|---------------------|
| `agents.json` | Ed25519 signature verified against compiled-in public key |
| `agents.lock` | Ed25519 signature verified against compiled-in public key; hash of `agents.json` must match `agents.json` SHA-256 |
| Agent manifests in the release tarball | Covered by `agents.json.source_hash` field; individual files not re-verified at runtime in Option C (no re-compile path means these are not loaded at runtime) |

The public key is compiled into the binary at build time (same mechanism as ADR-0001 D2). No file-based key path exists. A file-based public key can be replaced by an attacker with local filesystem access, defeating the entire signing chain. The compiled-in key is the only trust anchor.

**What is NOT in the protected file set at v1:**

- Individual `agent.md` source files — in Option C (no re-compile path), these are not loaded at runtime. The binary reads `agents.json` only. Editing `agent.md` files on disk has no runtime effect, which is why this control is cleaner than Options A or B.
- Module manifests registered via the v1.x module system — those are covered by per-module signature verification (ADR-0003 trust model), not by this root-config chain.

**When integrity checks run:**

1. **At startup** — before any agent is spawned, before any command executes. The binary verifies `agents.json` signature and cross-checks `agents.lock`. If verification fails, the process halts. In production: exits non-zero, emits `manifest_integrity_violation` governance event to the append-only log before exit. In dev mode: emits `manifest_integrity_violation` governance event, emits `dev_mode_active` governance event, then proceeds with a stderr warning.

2. **On demand via `teo verify`** — explicit integrity verification command. Runs the same checks as startup. Exits non-zero and reports findings. Does NOT require or honor `TEO_DEV_MODE=1` — `teo verify` always runs in strict mode so it can be used as a diagnostic even in dev environments.

3. **On every agent spawn** — `PolicyEnforcement.preflight()` in `spawn()` performs a lightweight hash check (not signature re-verification) confirming `agents.json` has not changed since startup. This catches in-process file replacement between startup and spawn time. If the hash doesn't match, the spawn throws `ManifestTamperDetected`, a `manifest_integrity_violation` event is emitted, and the spawn is rejected. This check is a hash comparison only (fast path); the full signature re-verification only happens at startup and `teo verify`.

**Governance event write ordering at startup:**

The `manifest_integrity_violation` event is written BEFORE `process.exit()`. The write is synchronous — it completes before the process terminates. This ensures the audit record exists even when the binary exits non-zero. (See OQ-2 for the question of whether this event is written before or after the `dev_mode_active` event when both apply.)

---

### Part 2 — Governance Event Schemas

All events are written as JSONL entries to the `GovernanceBackend` (ADR-0001). Field order within each event object is not normative — implementations may order fields as convenient for serialization. Field names are normative and case-sensitive.

#### `manifest_integrity_violation`

Emitted when the binary detects that `agents.json` or `agents.lock` does not match the expected signed state. Also emitted by the per-spawn hash check in `PolicyEnforcement.preflight()`.

```json
{
  "event_type": "manifest_integrity_violation",
  "timestamp": "<ISO 8601 UTC>",
  "binary_hash": "<SHA-256 of the running binary, hex-encoded>",
  "violation_description": "<which file, what was expected vs. found — e.g., 'agents.json signature verification failed: signature invalid for key teo-release-v1'>",
  "operator_identity": "<TEO_OPERATOR env var value, or os.userInfo().username if TEO_OPERATOR is absent>",
  "severity": "fatal | warn",
  "dev_mode_active": "<boolean — true if any TEO_DEV_MODE-family env var is set>"
}
```

**`severity` assignment rule:**
- `"fatal"` — production binary, no dev-mode env vars present. Process exits non-zero after writing this event.
- `"warn"` — `TEO_DEV_MODE=1` or `TEO_ALLOW_UNVERIFIED_MODULES=1` is set (or both). Process proceeds after writing this event and the `dev_mode_active` event.

**`binary_hash` computation:** SHA-256 of the binary file at `process.execPath`, computed once at startup and cached. Recomputed on `teo verify`. Not recomputed per-spawn (too slow; the startup value is used for all spawn-time events in the same process lifetime).

**`violation_description` format:** Human-readable. Must identify: (a) the file whose check failed, (b) the nature of the failure (`signature_invalid`, `hash_mismatch`, `file_missing`), (c) for hash mismatches: the expected hash and the computed hash (truncated to first 16 hex chars for readability, with full values in a `violation_detail` subfield if the implementation chooses to include it).

---

#### `dev_mode_active`

Emitted whenever the binary proceeds past an integrity violation due to a dev-mode env var being set. Also emitted at startup when any `TEO_DEV_MODE`-family env var is detected, even if no violation is present — the operator's choice to run in dev mode is itself a governance event that must be on the audit record.

```json
{
  "event_type": "dev_mode_active",
  "timestamp": "<ISO 8601 UTC>",
  "binary_hash": "<SHA-256 of the running binary, hex-encoded>",
  "detected_violation_description": "<same text as manifest_integrity_violation.violation_description, or null if dev_mode_active is emitted at startup with no active violation>",
  "operator_identity": "<TEO_OPERATOR env var value, or os.userInfo().username if TEO_OPERATOR is absent>",
  "env_vars_active": ["<list of TEO_* dev-mode env vars that are currently set — e.g., ['TEO_DEV_MODE', 'TEO_ALLOW_UNVERIFIED_MODULES']>"],
  "granular_gates_implied": ["<list of granular gate names that TEO_DEV_MODE implies, if TEO_DEV_MODE is in env_vars_active>"]
}
```

**`granular_gates_implied` — exhaustive list for v1:**

When `TEO_DEV_MODE=1` is in `env_vars_active`, `granular_gates_implied` MUST contain every gate that `TEO_DEV_MODE` activates. At v1, the exhaustive list is:

```
"TEO_ALLOW_UNVERIFIED_MODULES"
```

As additional granular gates are added in v1.x, this list expands. The binary MUST populate this field dynamically from the same source-of-truth that governs the implication logic — it cannot be a hardcoded string list that falls out of sync with the actual implication logic.

If `TEO_DEV_MODE` is NOT in `env_vars_active`, `granular_gates_implied` is an empty array `[]`.

**`detected_violation_description` — null vs non-null:**

This field is `null` when `dev_mode_active` is emitted proactively at startup (dev env vars present, no violation detected). It carries the violation description text when emitted as part of a warn-and-proceed flow (violation detected, dev mode active, process continuing).

---

#### `module_load_blocked`

Emitted by the module loader when a module cannot be loaded due to trust level, signature, or capability failure. Specified here because ADR-0003 references this event but defers the full field spec to this ADR.

```json
{
  "event_type": "module_load_blocked",
  "timestamp": "<ISO 8601 UTC>",
  "module_id": "<ModuleId — namespaced: '<scope>/<name>@<version>'>",
  "reason": "unverified_signature | capability_violation | trust_level_insufficient",
  "declared_trust_level": "<ModuleTrustLevel from the manifest file — what the manifest claimed>",
  "assigned_trust_level": "<ModuleTrustLevel assigned by the runtime based on signature verification>",
  "operator_identity": "<TEO_OPERATOR env var value, or os.userInfo().username>"
}
```

**`reason` values:**

- `"unverified_signature"` — the module's signature is absent or signed by a key not on the verified key list. Runtime-assigned trust: `THIRD_PARTY_UNVERIFIED`. Default posture is block.
- `"capability_violation"` — the module declared a capability its assigned trust level does not permit (e.g., `OVERRIDE_AGENTS` on a `THIRD_PARTY_VERIFIED` module).
- `"trust_level_insufficient"` — the module declared a trust level higher than what the runtime assigns (e.g., manifest claims `FIRST_PARTY`, runtime assigns `THIRD_PARTY_VERIFIED` because the signature doesn't match the core key). This is distinct from `capability_violation` — the block is on trust level assignment, not on a specific declared capability.

**`declared_trust_level` vs `assigned_trust_level`:** The manifest's `trust_level` field is NOT trusted from the file. The runtime assigns trust level independently based on signature verification. Both values are recorded so the audit log can surface attempts by compromised manifests to claim higher trust than they can prove.

---

#### `module_unverified_bypass_active`

Emitted when a `THIRD_PARTY_UNVERIFIED` module is loaded due to `TEO_ALLOW_UNVERIFIED_MODULES=1` (directly set or implied by `TEO_DEV_MODE=1`). Emitted once per module load, before the module code executes. NOT silent.

```json
{
  "event_type": "module_unverified_bypass_active",
  "timestamp": "<ISO 8601 UTC>",
  "module_id": "<ModuleId>",
  "operator_identity": "<TEO_OPERATOR env var value, or os.userInfo().username>",
  "bypass_source": "TEO_ALLOW_UNVERIFIED_MODULES | TEO_DEV_MODE"
}
```

**`bypass_source` assignment rule:**

- `"TEO_DEV_MODE"` — `TEO_DEV_MODE=1` is set. `TEO_ALLOW_UNVERIFIED_MODULES` may or may not also be explicitly set; when `TEO_DEV_MODE` is present it is the authoritative source because it implies all granular gates.
- `"TEO_ALLOW_UNVERIFIED_MODULES"` — `TEO_ALLOW_UNVERIFIED_MODULES=1` is set AND `TEO_DEV_MODE=1` is NOT set.

The distinction matters for audit: an operator who sets only `TEO_ALLOW_UNVERIFIED_MODULES` is making a targeted bypass decision; an operator who sets `TEO_DEV_MODE` is making a catch-all dev environment decision. The audit record must distinguish these intents.

---

### Part 3 — Env Var Precedence (Normative)

This section is normative. Implementations MUST honor these rules. Any deviation is a security defect.

**Rule 1 — `TEO_DEV_MODE=1` is a catch-all.**

Setting `TEO_DEV_MODE=1` activates every granular dev-mode gate simultaneously. The v1 exhaustive list of gates implied:

| Granular gate | Effect when implied by `TEO_DEV_MODE` |
|---------------|--------------------------------------|
| `TEO_ALLOW_UNVERIFIED_MODULES` | Unverified-signature modules load with `module_unverified_bypass_active` event instead of hard block |

When `TEO_DEV_MODE=1` is present:
- All integrity violations are demoted from `fatal` to `warn` (emit event, proceed with warning).
- `TEO_ALLOW_UNVERIFIED_MODULES` behavior is active even if `TEO_ALLOW_UNVERIFIED_MODULES` is not explicitly set in the environment.
- The `dev_mode_active` governance event is emitted at startup and lists all implied gates in `granular_gates_implied`.

**Rule 2 — `TEO_ALLOW_UNVERIFIED_MODULES=1` without `TEO_DEV_MODE=1` is a targeted bypass.**

When only `TEO_ALLOW_UNVERIFIED_MODULES=1` is set:
- Unverified modules load with `module_unverified_bypass_active` event instead of hard block.
- All other integrity checks (`agents.json` signature, `agents.lock` hash) remain in hard-block mode. `manifest_integrity_violation` with `severity: "fatal"` still exits non-zero.
- The `dev_mode_active` governance event is emitted with `env_vars_active: ["TEO_ALLOW_UNVERIFIED_MODULES"]` and `granular_gates_implied: []`.

**Rule 3 — Granular vars cannot suppress `TEO_DEV_MODE`; `TEO_DEV_MODE` cannot be overridden by the absence of granular vars.**

Setting `TEO_DEV_MODE=1` while leaving `TEO_ALLOW_UNVERIFIED_MODULES` unset does NOT disable the unverified-module gate. The implication is unconditional. Conversely, setting `TEO_ALLOW_UNVERIFIED_MODULES=0` explicitly when `TEO_DEV_MODE=1` is set has NO effect — `TEO_DEV_MODE` wins.

**Precedence summary table:**

| `TEO_DEV_MODE` | `TEO_ALLOW_UNVERIFIED_MODULES` | Manifest integrity posture | Unverified modules |
|----------------|-------------------------------|----------------------------|--------------------|
| unset | unset | hard block (`fatal`) | blocked |
| unset | `=1` | hard block (`fatal`) | bypass + event |
| `=1` | unset | warn-and-proceed (`warn`) | bypass + event (implied) |
| `=1` | `=1` | warn-and-proceed (`warn`) | bypass + event (both sources; `bypass_source: "TEO_DEV_MODE"`) |

**Rule 4 — Neither env var is silent.**

Every activation of a dev-mode bypass path produces a governance event on the audit log. There is no combination of env vars that produces a silent bypass.

---

### Part 4 — CI Policy Contract

**CI environment detection:**

The binary detects CI by checking for the `CI` environment variable set to `true` (case-insensitive). This is the standard convention for GitHub Actions, CircleCI, GitLab CI, and most major CI platforms.

Detection logic (pseudo-code):
```
is_ci = (process.env.CI?.toLowerCase() === 'true')
```

`CI=1` (numeric) is NOT treated as CI. Only `CI=true` (string, case-insensitive) is the canonical signal. This is intentional — it avoids false positives from scripts that export `CI` with other values.

**CI + `TEO_DEV_MODE=1` posture:**

When `CI=true` is detected AND `TEO_DEV_MODE=1` (or any granular dev-mode var) is set, the binary:

1. Emits a `ci_dev_mode_conflict` governance event (schema below) to the audit log.
2. Writes a warning to stderr identifying which dev-mode var is set and that CI has been detected.
3. Does NOT hard-block on this condition alone — the hard block comes from the binary's non-zero exit on integrity violation (which CI honors by design because CI pipelines fail on non-zero exit codes).

This posture is: **WARN in the binary, BLOCK from the integrity check itself**. The CI pipeline's failure mode is the binary exiting non-zero when it detects an integrity violation — that exit is unaffected by dev-mode vars when `CI=true` is present.

Wait — this is the point where OQ-1 applies (see Open Questions). The above describes the WARN posture. If CTO decides BLOCK posture, the behavior changes: when `CI=true` AND any dev-mode var is set, the binary exits non-zero immediately (before running any checks), emitting `ci_dev_mode_conflict` as the exit reason. ADR-0004 leaves the decision to OQ-1 and documents WARN as the default recommendation.

**`ci_dev_mode_conflict` governance event:**

```json
{
  "event_type": "ci_dev_mode_conflict",
  "timestamp": "<ISO 8601 UTC>",
  "binary_hash": "<SHA-256 of the running binary, hex-encoded>",
  "operator_identity": "<TEO_OPERATOR env var value, or os.userInfo().username>",
  "env_vars_active": ["<list of TEO_* dev-mode env vars currently set>"],
  "ci_detected": true,
  "recommended_action": "Remove TEO_DEV_MODE and granular dev-mode vars from CI environment. CI pipelines must not set dev-mode bypass vars. Integrity violations in CI must fail the build."
}
```

**CI pipeline operator documentation:**

CI pipelines consuming the TEO binary MUST:
- NOT set `TEO_DEV_MODE=1` in any CI job.
- NOT set `TEO_ALLOW_UNVERIFIED_MODULES=1` in any CI job.
- Treat any non-zero exit from `teo` or `teo verify` as a build failure.
- Include `teo verify` as an explicit step in any pipeline that handles the release artifact.

This is documented here as an integration requirement for operators. It does NOT require a binary code change — the CI pipeline controls are a pipeline configuration responsibility, not a binary enforcement feature.

---

## Consequences

### Positive

- The full governance event schema is normative and complete. Audit log consumers (compliance tools, `teo audit`) have a single ADR to reference for all integrity-related event shapes. No underdefined field names, no "TBD" schemas in production code.
- The `bypass_source` field in `module_unverified_bypass_active` distinguishes targeted dev decisions (`TEO_ALLOW_UNVERIFIED_MODULES` only) from catch-all dev environments (`TEO_DEV_MODE`). This granularity matters for SOC2 audit: an auditor can tell whether a dev bypass was narrow or broad.
- Granular gate design (`TEO_ALLOW_UNVERIFIED_MODULES` without `TEO_DEV_MODE`) gives dev teams the minimum necessary bypass for local module development without disabling all integrity checks. This reduces the blast radius of a "I need to test a local module" workflow.
- Per-spawn hash check in `PolicyEnforcement.preflight()` catches in-process file replacement without the cost of full signature re-verification on every spawn. Startup does the expensive work; spawns do the cheap check.
- CI detection via `CI=true` is a widely adopted standard that doesn't require TEO-specific configuration on the CI platform side.

### Negative / Trade-offs

- **`granular_gates_implied` must stay in sync with the actual implication logic.** If a new granular gate is added without updating the list, the `dev_mode_active` event will be incomplete and the audit record will misrepresent the active bypass surface. This is a maintenance coupling — the source of truth for the list must be co-located with the implication logic, not a separate string array.
- **`CI=1` is not detected.** A CI environment that sets `CI=1` instead of `CI=true` will not be detected. This is intentional (avoids false positives) but could cause a CI job with `TEO_DEV_MODE=1` to proceed silently past the `ci_dev_mode_conflict` check. Operators must ensure their CI environment exports `CI=true`.
- **`teo verify` always runs in strict mode.** This means a dev workflow that includes `teo verify` as a local pre-commit check will fail if any dev-mode bypass is active and produces a violation. This is by design — `teo verify` is a diagnostic tool, not a gated run command. Operators should not use `teo verify` in the same invocation path as normal `teo` commands if they expect dev-mode warn-and-proceed behavior.
- **Binary hash computed at startup from `process.execPath`.** If the binary is run via a symlink or wrapper script, `process.execPath` may not resolve to the actual binary. Implementations must resolve symlinks before computing the hash. This is a platform portability concern, not a security gap, but it must be documented for implementers.

### Future Work

- STORY-BINARY-INTEGRITY: Binary self-verification against a release-signed binary hash. The current ADR covers `agents.json` and `agents.lock` integrity; it does NOT cover the binary itself. A compromised binary can lie about all other checks. This is the remaining attack surface identified in q2-soc2-verification.md under "Required Controls Regardless of Option Chosen." Code-signed install packages (macOS Gatekeeper, Windows Authenticode) close this for distribution; a binary hash check on first launch closes it for runtime.
- STORY-KEY-ROTATION: Key rotation without a full binary release. Currently, rotating the compiled-in public key requires a new binary release. For broad distribution, a JWKS-style key rotation mechanism with a pinned CA is needed. Tied to ADR-0001 Future Work.
- STORY-CI-BLOCK-POSTURE: Resolution of OQ-1. If CTO decides BLOCK posture for `CI=true` + `TEO_DEV_MODE`, the `ci_dev_mode_conflict` event triggers a hard exit instead of a warning. Implement after OQ-1 is resolved.
- STORY-REMOTE-LOG: Remote immutable log shipping for governance events. Local JSONL satisfies SOC2 Type I. Type II requires write-once remote storage. The `manifest_integrity_violation` and `dev_mode_active` events are the highest-priority events to ship remotely. Tracked from ADR-0001.

---

## Open Questions

| ID | Question | Owner | Status |
|----|----------|-------|--------|
| OQ-1 | Should `CI=true` detection result in a WARN (`ci_dev_mode_conflict` event + stderr warning) or a hard BLOCK (non-zero exit) when `TEO_DEV_MODE=1` or any granular dev-mode var is present? ADR-0004 defaults to WARN; BLOCK is the stricter posture. Policy decision — defer to CTO. | CTO | OPEN |
| OQ-2 | Should the `dev_mode_active` event be written BEFORE or AFTER the `manifest_integrity_violation` event when both apply? Writing `dev_mode_active` first signals intent before recording the violation; writing it after ensures the violation is on the log even if the process is interrupted mid-pair. The ordering affects whether a partially-written audit log (e.g., process killed between writes) can suppress one of the two events. | CTO + Security Engineer | OPEN |
| OQ-3 | What is the fallback value for `operator_identity` when `os.userInfo()` throws? This occurs in containerized environments with no `/etc/passwd` or when running as a UID with no registered user entry. Recommendation: fall back to `"unknown"` and emit a `operator_identity_unresolvable` warning event with the thrown error message. Needs CTO confirmation before implementation. | CTO | OPEN |
