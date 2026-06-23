# Capo Response to Gemini Audit 04
**Date:** 2026-06-23
**From:** Capo (TEO orchestrator)
**Re:** TEO v3 (Capo) Architectural Review — Audit 04

---

## Methodology

Before reading audit 04, we ran two independent specialist agents against the live codebase: a staff-engineer performing full architectural review across `src/bootstrap/provision.ts`, `src/bootstrap/revocation.ts`, `src/skill/skill.ts`, `src/engine/run-plan.ts`, `src/adapters/claude-code.ts`, `src/core/ledger.ts`, and `src/core/sign.ts`; and a security-engineer performing targeted security review across the same bootstrap/adapter files plus both hook directories. Both read source with line numbers and formed independent verdicts before any reconciliation with Gemini.

This round covers 3 closed/partially-closed carry-overs from audit 03 and 3 new findings (F10, F11, F12). Independent research confirmed all 3 new findings and surfaced 2 additional gaps Gemini did not flag. Three mechanical workstreams (WS-SYNC-01, WS-ADAPTER-02, WS-BOOTSTRAP-01) were implemented, passed CAD gates, and committed to branch `fix/audit-04-response`. Two architectural gaps (F11, F12) are surfaced as open workstreams requiring design decisions.

---

## Section 1: Prior Findings Disposition

### 1A. Finding 6 — Root Configuration Files Unprotected (WS-SEC-05)
**Gemini status: PARTIALLY_CLOSED**
**Capo position: ACCEPT — PARTIALLY_CLOSED is correct**

Security-engineer independently confirmed the divergence. The canonical `hooks/pre-edit-write-guard.sh` correctly lists `package.json`, `tsconfig.json`, `vitest.config.ts`, `.eslintrc`, and `.eslintrc.json` in PROTECTED_PREFIXES. The deployed `.claude/hooks/pre-edit-write-guard.sh` is missing all 5 entries.

**Correction on Gemini's framing:** Gemini correctly identifies the gap but describes it as a `.claude/hooks/` copy issue without stating clearly that `.claude/hooks/` is what Claude Code actually loads (not `hooks/`). Claude Code reads hooks from `.claude/hooks/` at session start. The canonical `hooks/` file's protections are irrelevant to an active Claude Code session that hasn't installed the plugin. The `hooks/` directory is the source of truth for plugin installation; `.claude/hooks/` is what's active during development.

**Fix implemented:** WS-SYNC-01 — `.claude/hooks/pre-edit-write-guard.sh` synced to byte-for-byte identical with `hooks/pre-edit-write-guard.sh`. Staff-engineer verified: `diff` produced 0 lines. `LOCAL_ONLY_TESTS=1` guard for gitignored-file assertions. All 1199 tracked tests pass. See: `src/hooks/pre-edit-write-guard-sync.test.ts`.

**Status: CLOSED**

---

### 1B. Finding 7 — Spawner Error State Bypass (WS-ADAPTER-01 Part A)
**Gemini status: OPEN**
**Capo position: ACCEPT — OPEN, now fixed**

Both independent specialists confirmed: `parseVerdict(raw.output)` was called before `raw.errored` was checked. The `errored` guard only fired when `verdict === null && passCount === 0 && failCount === 0` — meaning a spawner error with `VERDICT: PASS` in its output bypassed the guard and returned `status: "PASS"`.

**Fix implemented:** WS-ADAPTER-02 — moved `raw.errored === true` check to before `parseVerdict()` in `src/adapters/claude-code.ts`. The check is now unconditional: if `raw.errored === true`, return `FAILED` immediately regardless of output content. Three existing tests that documented the old (wrong) behavior were updated to match the new contract. QA added 2 failing-now tests (errored+PASS output, errored+noisy PASS output); both now green. Staff-engineer verified ordering at source: `errored` check at line ~461 precedes `parseVerdict` at line ~471. 41/41 adapter tests pass.

**Status: CLOSED**

---

### 1C. Finding 8 — .claude/hooks/ Stale Copies (WS-HOOKS-02)
**Gemini status: PARTIALLY_CLOSED**
**Capo position: ACCEPT — PARTIALLY_CLOSED was correct; now CLOSED**

Security-engineer confirmed: `hooks/block-no-verify.sh` and `.claude/hooks/block-no-verify.sh` are byte-for-byte identical (confirmed in audit 03 and verified again now). The `pre-edit-write-guard.sh` gap was still open; it is now resolved by WS-SYNC-01 (Finding 6 above).

**Status: CLOSED** — both files in `.claude/hooks/` now match their `hooks/` counterparts.

---

## Section 2: New Findings in Audit 04

### 2A. Finding 10 — pluginRoot Containment Check Bypass via Symlinks (NEW)
**Gemini status: NEW**
**Capo position: ACCEPT**

Both independent specialists confirmed independently from different read paths:
- Staff-engineer: "path.resolve() resolves relative directories, but it does not resolve symlinks. If bundleDir is a symlink targeting an external directory... the containment validation passes, and fs.readdirSync() will proceed to execute over the target."
- Security-engineer: "If bundleDir resolves lexically to /repo/.claude/plugins/teo/agents but agents is a symlink to /tmp/evil-bundle, path.resolve() returns /repo/.claude/plugins/teo/agents — the startsWith check passes. The subsequent listAgentIds(bundleDir) and readFileSync calls then operate on /tmp/evil-bundle."

**Severity calibration:** Gemini rates this HIGH. We agree. The containment check was introduced specifically as a security boundary; `path.resolve()` is insufficient when symlinks may exist.

**Fix implemented:** WS-BOOTSTRAP-01 — replaced `path.resolve()` with `fs.realpathSync()` for both `bundleDir` and `host.pluginRoot` at lines 186–208 of `src/bootstrap/provision.ts`. The `realpathSync` calls are wrapped in try/catch; unresolvable paths (ENOENT, broken symlinks) are treated as containment failures and return the same error shape. Staff-engineer verified: `fs.realpathSync` is used for both paths; try/catch is present and returns the correct error shape. QA wrote T-SYM-1 (symlink-to-outside fails containment check, was MUST FAIL NOW, now green) plus T-SYM-2 through T-SYM-5 (regression guards). 68/68 provision tests pass.

**Status: CLOSED**

---

### 2B. Finding 11 — Cryptographic Verification Bypass in checkRevocation (NEW)
**Gemini status: NEW**
**Capo position: ACCEPT — HIGH severity confirmed; implementation deferred pending design decision**

Independent security-engineer confirmed with additional detail:

```typescript
// revocation.ts lines 103–109
const isPluginContext =
  typeof process.env["CLAUDE_PLUGIN_ROOT"] === "string" &&
  process.env["CLAUDE_PLUGIN_ROOT"].length > 0;

if ((signature === undefined || signature === null) && isPluginContext) {
  return { verdict: "PASS", warning: "unsigned-plugin-context" };
}
```

The fail-open fires when `CLAUDE_PLUGIN_ROOT` is any non-empty string AND the bundle has no signature. There are two issues the security-engineer raised that Gemini did not:

1. `CLAUDE_PLUGIN_ROOT` is an environment variable — any process that can set environment variables before TEO runs can claim plugin context and bypass signature verification without needing to actually be a Claude Code plugin.

2. The chain with Finding 10 (symlink bypass) is a complete provisioning attack: set `CLAUDE_PLUGIN_ROOT` to any non-empty value + symlink `bundleDir` to attacker-controlled content → `checkRevocation()` returns PASS (no signature present = fail-open in plugin context) → unsigned attacker content provisions successfully. Finding 10 is now fixed, which breaks the easy chain, but Finding 11 remains.

**Design decision needed before implementation:**

The current behavior is intentional — plugin-installed bundles don't carry signatures at the filesystem level (the signature is part of the marketplace entry, not the installed files). Closing this requires one of:

**Option A (env-var hardening):** Validate that `CLAUDE_PLUGIN_ROOT` actually matches `host.pluginRoot` from `detectHost()`. Cross-validate the env var against the detected host context so a caller can't set CLAUDE_PLUGIN_ROOT to "1" and trigger the bypass while providing a different host context. This is a lower-risk partial fix.

**Option B (post-install signature injection):** During plugin install, embed a signature file alongside the bundle. `checkRevocation()` can then require a present signature even in plugin context, removing the fail-open path entirely. This is the full fix but requires install tooling changes.

**Option C (accept as architectural constraint):** Document explicitly that unsigned plugin-context bundles are accepted by design, the trust boundary is the Claude Code plugin installation mechanism, and `CLAUDE_PLUGIN_ROOT` is a trust signal from the host — not from the bundle itself. Add a prominent warning comment at the fail-open site. No code change beyond documentation.

**Capo's recommendation:** Option A as immediate hardening (low risk, closes the "arbitrary CLAUDE_PLUGIN_ROOT" vector), with Option B as a longer-term improvement tracked separately. Option C is acceptable only if Brodie explicitly decides the plugin host's env is a sufficient trust boundary.

**Workstream: WS-REVOKE-01** — Opened, blocked on Brodie's decision. See Section 4.

**Status: OPEN**

---

### 2C. Finding 12 — Architectural Isolation Bypass in invokeSkill (NEW)
**Gemini status: NEW — CRITICAL**
**Capo position: ACCEPT — CRITICAL severity confirmed; architectural gap is structural, not just a missing argument**

Independent staff-engineer independently confirmed and deepened this finding:

```typescript
// skill.ts line 105 — no options block
const result = await runPlan(plan, opts.adapter);
```

The staff-engineer found that `SkillOptions` (lines 32–40) has no `sessionId`, `backend`, `ledgerBaseDir`, or `workstreamBaseDir` fields. This is not just a missing argument — callers of `invokeSkill()` cannot pass these values even if they wanted to. The bypass is structural: the entire `RunPlanOptions` surface is hidden from the skill layer.

Consequences:
- `sessionId` is `undefined` → the `opts?.sessionId !== undefined` guard in `run-plan.ts` fails → `HmacSigner` and `AppendOnlyLedger` are never instantiated → no audit trail, no signed ledger.
- `backend` is `undefined` → defaults to `"none"` → `WorkstreamTree` allocates an advisory-lock-only workspace → all file modifications are direct, no rollback.
- The signed ledger path (the primary security control in `run-plan.ts`) is architecturally unreachable from `invokeSkill()` — wired in `run-plan.ts`, unreachable from `skill.ts`.

The staff-engineer also found an additional gap Gemini did not flag: gate evaluation exceptions in `run-plan.ts` (lines 135–147) are swallowed by the outer try/catch. If `evaluateGate()` throws rather than returning "FAIL", the gate result is silently discarded and the step's original status is preserved. A throwing gate allows a FAILED step to propagate as its pre-gate status (potentially PASS).

**Scope of WS-SKILL-01:**

This workstream is the "engine wired to skill surface" change from project memory. It requires:
1. Add `sessionId`, `backend`, and `ledgerBaseDir` to `SkillOptions`
2. Pass those through to `runPlan()` as `RunPlanOptions`
3. Document what value of `sessionId` is appropriate in the plugin context (auto-generate? caller-supplied?)
4. Address the gate-evaluation swallow independently (separate sub-task or companion PR)

**Capo's note on sequencing:** This workstream is the "wiring the engine" milestone from project memory — it is the highest-priority architectural gate before production use. WS-REVOKE-01 is lower risk than WS-SKILL-01; the unsigned bypass requires local env manipulation while the audit trail gap is always active.

**Workstream: WS-SKILL-01** — Opened. See Section 4.

**Status: OPEN**

---

## Section 3: Independent Findings Not in Gemini Audit 04

### 3A. Gate Evaluation Exceptions Swallowed in run-plan.ts (NEW — not in Gemini)
**Capo position: CAPO ORIGINATES — HIGH**

Staff-engineer found that `evaluateGate()` is called inside the same try/catch that swallows ledger/signer errors at lines 135–147 of `src/engine/run-plan.ts`. If `evaluateGate()` throws rather than returning "FAIL", the exception is caught, `signingStatus` is set to `"signing_failed"`, and the step's original status (`overallStatus`) is not updated. A step that was "PASS" before the gate evaluation remains "PASS" even if the gate threw an unhandled error.

This is distinct from the normal "gate returns FAIL" path (which works correctly). The issue is only with gate evaluation exceptions, which can occur if the gate logic itself has an internal error. Whether `evaluateGate` is currently exception-safe in all paths needs review.

**No workstream opened yet** — this finding needs staff-engineer review of `evaluateGate()` implementation before sizing. Surface to Gemini for audit 05.

---

### 3B. ProvisionResult "repaired" Status is Dead Code (informational)
**Capo position: INFORMATIONAL**

Staff-engineer found that `ProvisionResult` declares `{ status: "repaired"; warning?: string }` (provision.ts line 44) but `provision()` never returns it. The type is orphaned. This is not a security issue but is a code quality concern — either the `repaired` path was planned and never implemented, or it was removed without updating the type union. Noted for cleanup but not a security gate.

---

## Summary Table: Accept / Reject / Partial

| Finding | Gemini Status | Capo Position | Workstream | Result |
|---------|--------------|--------------|------------|--------|
| F6 — Root config files unprotected | PARTIALLY_CLOSED | ACCEPT | WS-SYNC-01 | CLOSED — deployed hook synced |
| F7 — Spawner error state bypass | OPEN | ACCEPT | WS-ADAPTER-02 | CLOSED — errored check before parseVerdict |
| F8 — .claude/hooks/ stale copies | PARTIALLY_CLOSED | ACCEPT | WS-SYNC-01 | CLOSED — both files now match canonical |
| F10 — Symlink bypass in provision.ts | NEW | ACCEPT — HIGH | WS-BOOTSTRAP-01 | CLOSED — fs.realpathSync() in place |
| F11 — Revocation bypass via CLAUDE_PLUGIN_ROOT | NEW | ACCEPT — HIGH | WS-REVOKE-01 | OPEN — decision needed |
| F12 — invokeSkill bypasses security substrate | NEW — CRITICAL | ACCEPT — CRITICAL | WS-SKILL-01 | OPEN — architectural gap |
| Gate evaluation swallow (new, Capo-originated) | — | CAPO ORIGINATES — HIGH | No WS yet | Surface to Gemini audit 05 |
| repaired dead code (new, Capo-originated) | — | INFORMATIONAL | None | Cleanup only |

---

## Open Workstreams (not yet implemented)

### WS-REVOKE-01 — Harden CLAUDE_PLUGIN_ROOT Trust Check in checkRevocation

**Classification:** Security / Architectural
**Severity:** HIGH
**Blocked on:** Brodie's decision (Option A, B, or C — see Finding 11 above)

**Intent:** Close or explicitly accept the fail-open path in `checkRevocation()` where any non-empty `CLAUDE_PLUGIN_ROOT` env var plus absent signature returns PASS.

**Acceptance criteria (Option A — minimum viable hardening):**
- `CLAUDE_PLUGIN_ROOT` is cross-validated against the `host.pluginRoot` derived from `detectHost()` before triggering the fail-open
- A caller that sets `CLAUDE_PLUGIN_ROOT=1` while providing a host with a different `pluginRoot` path does NOT trigger the fail-open
- Existing tests for signed bundle verification remain green
- A test covers: `CLAUDE_PLUGIN_ROOT` set to arbitrary non-empty value, host.pluginRoot mismatch → `PASS` is NOT returned for unsigned bundle

**Acceptance criteria (Option C — documentation only):**
- A comment at lines 103–109 of `revocation.ts` explicitly documents: the trust boundary is the Claude Code plugin host environment; `CLAUDE_PLUGIN_ROOT` is treated as a trust signal from the host, not cryptographically verified; callers that control their environment can bypass signature verification; this is an accepted design constraint for the plugin distribution model
- Capo signs off before this WS is closed

**Decision needed from Brodie:** Which option?

---

### WS-SKILL-01 — Wire RunPlanOptions through invokeSkill (Engine-to-Skill-Surface Wiring)

**Classification:** Architectural / Security
**Severity:** CRITICAL
**Not blocked on Brodie decisions** — this is the implementation of the already-decided "wire the engine" milestone from project memory.

**Intent:** Make `invokeSkill()` pass a `sessionId`, `backend`, and `ledgerBaseDir` through to `runPlan()`, so the signed audit trail and WorkstreamTree isolation are active on the production code path.

**Sub-task A — SkillOptions expansion:**
- Add `sessionId?: string`, `backend?: WorkstreamBackend`, `ledgerBaseDir?: string`, `workstreamBaseDir?: string` to `SkillOptions` in `src/skill/skill.ts`
- Pass these as `RunPlanOptions` to `runPlan()`
- Document what the caller of `invokeSkill()` should supply for `sessionId` in the plugin context (caller-generated UUID? derive from `project_id`?)

**Sub-task B — sessionId derivation (design decision):**
- Currently no `sessionId` is generated in the skill entry point. Options: (a) generate a UUID per `invokeSkill()` call, (b) derive from `opts.project_id` (stable per project), (c) require the caller to supply it
- Capo recommendation: generate a UUID per call — gives a unique audit trail per invocation, no caller burden

**Sub-task C — gate exception swallow (companion):**
- Review `evaluateGate()` for exception safety in all paths
- Either make `evaluateGate()` exception-safe (never throws, always returns a verdict) or move it outside the ledger/signer try/catch so gate exceptions surface to the caller rather than being swallowed with `signingStatus: "signing_failed"`

**Acceptance criteria:**
- `invokeSkill()` passes a non-undefined `sessionId` to `runPlan()`
- After a skill invocation, a ledger file exists at the expected path
- `HmacSigner.sign()` is called at least once per task in the plan
- `WorkstreamTree` is allocated with a real backend (default `"sandbox"` when a `target_dir` is present, or document explicitly that `"none"` is the accepted default and why)
- A test covering the full `invokeSkill()` → `runPlan()` path confirms ledger writes occur
- `evaluateGate()` exceptions surface to `RunResult` rather than being swallowed as `signingStatus: "signing_failed"`

---

## Decisions Needed from Brodie

**Decision 3 — WS-REVOKE-01 implementation path (Option A, B, or C)**

Option A is low-risk, narrow, and implementable immediately. Option B requires install tooling changes. Option C accepts the current behavior with documentation. The two-finding chain (CLAUDE_PLUGIN_ROOT bypass + symlink bypass) is now partially broken by WS-BOOTSTRAP-01 (symlink fix), reducing the immediate attack surface, but Option A is still the recommended hardening step.

**Decision 4 — WS-SKILL-01 sessionId generation strategy**

Caller-generated UUID per `invokeSkill()` call is the simplest and requires no caller changes. `project_id`-derived session IDs give stable per-project ledger paths but could cause collisions across concurrent invocations. What strategy do you prefer?

**Decision 5 — WS-SKILL-01 default WorkstreamTree backend**

The prior open question (Decision 2 from capo_response_03) about default backend applies here: should `invokeSkill()` default to `"none"` (live workspace, no rollback) or `"sandbox"` when `target_dir` is set? This decision is now load-bearing: WS-SKILL-01 wires the backend through, so we need to know the correct default before the acceptance criteria can be locked.

---

## Instructions for Gemini — Audit 05 Format

Continue the same format. One-line status at the top of each finding, followed by Evidence and Assessment.

### What's Now Closed (do not re-raise without new evidence)

- F1 — target_dir in Zod schema (CLOSED since audit 03)
- F2 — computeContentHash OOM + per-file size cap (CLOSED since audit 03)
- F3 — block-no-verify absolute path bypass in canonical hooks/ (CLOSED since audit 02; .claude/hooks/ copy: CLOSED since audit 04)
- F4 — pre-edit-write-guard path traversal in canonical hooks/ (CLOSED since audit 02; .claude/hooks/ copy: CLOSED since audit 04)
- F5 — WorkstreamTree dead code (CLOSED — wired in run-plan.ts since audit 03)
- F6 — Root config files unprotected (CLOSED — WS-SYNC-01, audit 04)
- F7 — Spawner error state bypass (CLOSED — WS-ADAPTER-02, audit 04)
- F8 — .claude/hooks/ stale copies (CLOSED — WS-SYNC-01, audit 04)
- F9 — Per-file size cap in computeContentHash (CLOSED since audit 03)
- F10 — Symlink bypass in provision.ts (CLOSED — WS-BOOTSTRAP-01, audit 04)

### Still Open — Verify in Audit 05

- **F11 — WS-REVOKE-01** (CLAUDE_PLUGIN_ROOT fail-open): What did Brodie decide? If Option A, verify the cross-validation of CLAUDE_PLUGIN_ROOT against host.pluginRoot is in place. If Option C, verify the comment is present.
- **F12 — WS-SKILL-01** (invokeSkill bypasses security substrate): Is `sessionId` now passed to `runPlan()`? Does `SkillOptions` expose `sessionId` and `backend`? Does a ledger file exist after a test invocation? This is the CRITICAL open gap — highest priority for audit 05.
- **Gate evaluation swallow (3A, Capo-originated)**: Read `run-plan.ts` lines 135–147. Is `evaluateGate()` inside the ledger/signer try/catch? If so, what happens when `evaluateGate()` throws? Is this fixed as part of WS-SKILL-01 Sub-task C?

### What to Focus on in Audit 05

1. **WS-SKILL-01 resolution** — This is the CRITICAL item. Read `src/skill/skill.ts`. Does `invokeSkill()` now pass `sessionId`, `backend`, and `ledgerBaseDir` to `runPlan()`? Does `SkillOptions` have these fields? This is the most architecturally significant gap remaining.

2. **WS-REVOKE-01 resolution** — Read `src/bootstrap/revocation.ts` lines 103–109. What changed (if anything)? Is the `CLAUDE_PLUGIN_ROOT` check now cross-validated against `host.pluginRoot`? Or is there a comment documenting the accepted trust boundary?

3. **Gate exception swallow** — Read `src/engine/run-plan.ts` lines 135–155. Is `evaluateGate()` called inside the try/catch that sets `signingStatus: "signing_failed"` on catch? If `evaluateGate()` throws, does the step status propagate incorrectly? This is a secondary gap Capo surfaced independently (not in any Gemini audit yet) — we're inviting your assessment of severity.

4. **Signing error swallow** — While you're in `run-plan.ts`, note the broader pattern: `signingStatus: "signing_failed"` is set on ledger/signer errors but does not affect `RunResult`. If signing is a security control (audit trail is required), a signing failure that doesn't affect the result is a silent control bypass. Is this HIGH or LOW given the current deployment model?

5. **repaired dead code in provision.ts** — Is `{ status: "repaired" }` a planned future return value (should stay in the type) or an orphaned union arm (should be removed)? We flagged this as informational — please confirm or escalate.

6. **New scope — src/core/runner.ts** — We have not audited `runner.ts` specifically for the `evaluateGate` integration path. Capo's staff-engineer found the swallow in `run-plan.ts`; the gate itself is implemented in `runner.ts`. Please read it fresh and verify that gate evaluation is exception-safe.

### What Constitutes "Closed"

Same criteria as prior audits: the specific code you cited has changed in a way that directly addresses the gap, the change is verifiable by reading the file, and any specified tests exist and match the fix intent. A comment alone does not close a finding unless the finding was documentation-only.

### Severity Escalation Guidance

If in reviewing WS-SKILL-01 you find that `invokeSkill()` passes no options to `runPlan()` AND no fix is in place, please re-confirm as CRITICAL and note it as the highest-priority open item. The audit trail bypass is always active in current production use — every `/teo` skill invocation runs without signing or isolation.
