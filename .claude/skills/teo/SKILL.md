---
name: teo
description: "Enterprise gateway — entry point for TEO enterprise workflows. Routes utility commands to teo-* skills and delegates substantive work to the Sage orchestrator."
model: sonnet
allowed-tools: Read, Glob, Grep, Task
compatibility: "Requires Claude Code — TEO enterprise edition only"
metadata:
  version: "2.0.0"
  teo_only: true
---

> Inherits: [skill-base](../_base/skill-base.md)

# /teo

Enterprise gateway for TheEngOrg. Routes utility keywords directly to `teo-*` skills and delegates substantive work to the Sage orchestrator.

TEO-ONLY — never routes to `mg-*` skills. Community users use `/mg`.

## Constitution

1. **Sage-first for substantive work** — Utility skills route directly. Everything else goes through Sage.
2. **No-args = enterprise menu** — Display utility skills AND Sage entry points.
3. **Keywords first** — Match utility keywords before passing to Sage.
4. **TEO-ONLY** — Never routes to mg-* skills.
5. **Thin gateway** — Do not replicate Sage logic. Spawn Sage and let Sage orchestrate.
6. **Be explicit** — Always tell the user whether routing to utility skill or Sage.

---

## Debug Mode

Scan input (case-insensitive) for debug keywords before routing. Strip the modifier from the routed input.

| Modifier | Effect |
|----------|--------|
| `debug`, `use debug`, `with debug`, `debug mode` | Set `TEO_DEBUG=1`; add `debug: true` to Sage intake block; output "Debug mode enabled — verbose gate tracing active for this session." |

---

## No-Args Mode

When invoked as `/teo` with no arguments, display:

---
**TEO Enterprise Skills**

**Utility:**
`/teo validate` — Framework structural integrity checks
`/teo login` — Enterprise session management
`/teo upgrade` — Framework upgrade workflow
`/teo audit` — Compliance audit trail
`/teo process` — Process flow registration, validation, testing, and governance

**Sage-Orchestrated:**
`/teo plan <initiative>` — Strategic planning (assess → spec → leadership)
`/teo build <feature>` — Full development cycle (build → review → approve)
`/teo fix <bug>` — Structured debugging (reproduce → fix → verify)
`/teo review <workstream>` — Code review pipeline (quality → security → approval)
`/teo improve <scope>` — Refactoring (assess → refactor → review)
`/teo ship <deliverable>` — Documentation, copy, design assets
`/teo <question>` — Ask the Sage anything

For community skills use `/mg`.

---

## Dynamic Skill Discovery

Before routing, scan `.claude/skills/teo-*/SKILL.md`. Skills without `invocation` metadata are utility skills (direct route). Skills with `invocation` metadata are Sage-composable. New skills are auto-discovered without editing this file.

## Delegation

### Path 1: Utility Keywords → Direct Route

| Keywords | Routes to |
|----------|-----------|
| `login`, `session`, `auth`, `authenticate` | `/teo-login` |
| `validate`, `check`, `integrity`, `verify framework` | `/teo-validate` |
| `audit`, `compliance`, `trail`, `review decisions` | `/teo-audit` |
| `upgrade`, `update`, `version`, `migrate framework` | `/teo-upgrade` |
| `process`, `flow`, `register process`, `describe process`, `validate process`, `check process`, `update process`, `test process`, `process safety`, `process similarity` | `/teo-process` |

### Path 2: Everything Else → Sage Intake

**Session markers:** Before spawning Sage, set the session marker:
```
.claude/scripts/teo-set-session-marker
# PostToolUse hook sets .claude/memory/traces/sage-spawned automatically
# After Sage completes, clean up:
.claude/scripts/teo-memory-clean --force .claude/memory/traces/teo-session-active .claude/memory/traces/sage-spawned .claude/memory/traces/sage-active-execution-id
```

Pass the user's request **verbatim**. Do NOT pre-classify intent, load project files, or analyze project state. **Sage classifies the intent** — /teo just relays.

**Intent hints — ONLY for explicit keyword entry points:**

| Entry point | intent_hint |
|-------------|-------------|
| `/teo plan <X>` | PLAN |
| `/teo build <X>` | BUILD |
| `/teo fix <X>` | FIX |
| `/teo review <X>` | REVIEW |
| `/teo improve <X>` | IMPROVE |
| `/teo ship <X>` | SHIP |
| `/teo <natural language>` | **OMIT** |

**CRITICAL:** For natural language requests, do NOT infer an intent hint. Pass the raw request.

Before spawning, verify `.claude/agents/sage/agent.md` exists.

### Sage Spawn — Daemon-Pipeline Orchestration

**"sage" is NOT a registered agent type.** Spawn as `subagent_type: "general-purpose"`. NEVER use subagent_type "ceo", "cto", "cmo", or any other C-Suite type for Sage — this bypasses the orchestration layer.

**Governing authority (chronological supersession order):**
- ADR-020 (accepted 2026-04-18) — baseline: TEO no longer uses TeamCreate/SendMessage/TeamDelete for orchestration in the current operating state.
- ADR-037 (ACCEPTED 2026-04-23) — supersedes the "main-embodies-Sage" convention; Sage runs as a spawned general-purpose subagent, not in the main session.
- ADR-DRAFT-team-mode-dispatch-lifecycle (CONDITIONAL_APPROVE 2026-04-24) — governing authority for the current-vs-future dispatch lifecycle; TeamCreate + SendMessage become the primary pattern once all five §5 prerequisites are met.

**Current standard dispatch pattern for interactive sessions — GATEWAY_SPAWN_REQUEST (proxy-relayed):** Sage does NOT call Agent() directly from inside its subagent context. Instead, Sage emits a GATEWAY_SPAWN_REQUEST block in its output — a delimiter-fenced markdown block that the main session (the proxy / gateway) parses and executes on Sage's behalf. This relay pattern is load-bearing: direct Agent() calls from inside Sage's subagent context silently fabricate completion (silent-continuation hallucination). Reference: `sage/agent.md` §Standard Dispatch Flow.

**Path A vs Path B discriminating rule — evaluate before routing to either block:**

- **Path A (one-shot analysis only):** Use exclusively for requests that Sage can fully address as a one-shot read-only analysis without spawning any downstream specialist. If the request involves dev, qa, staff-engineer, security-engineer, or any other specialist; involves commit/PR operations; or requires multi-step hand-offs — it is NOT Path A. Route to Path B.
- **Path B (specialist pipeline work):** Use for all requests requiring specialist spawning, commits, PRs, or multi-step orchestration.
- **The "OMIT" row in the intent hint table (natural language requests) does NOT override this discriminating rule.** A natural-language request requiring specialist work is Path B, regardless of the absence of an explicit intent keyword.

**Path A — Meta-question (architectural analysis, one-shot Q&A):**

Spawn Sage as a single one-shot Agent() with no team infrastructure:

**Path A — Sage spawn (auto-marker) (T3-C):** Use `teo-sage-get-or-create` to atomically perform the full D3 sequence: generate execution_id, issue identity token, write startup context, and write the `sage-active-execution-id` marker. No shell metacharacters required.

```
# teo-sage-get-or-create handles the full D3 sequence atomically (T3-C).
# Run this BEFORE the Agent() call. Outputs JSON to stdout.
.claude/scripts/teo-sage-get-or-create
#
# Extract execution_id and token from the JSON output for the Agent() spawn block.
# sage-active-execution-id marker is written atomically as Step 5.
#
# --- Deprecated path (do not use) ---
# The steps below require shell metacharacters blocked by teo-bash-arg-validate.sh.
# Retained for reference only. Use teo-sage-get-or-create above.
#
# Step 1: Generate a fresh UUID v4 execution_id (Sage-side, never from agent input)
# Use teo-uuidgen wrapper — handles uuidgen (macOS) and /dev/urandom fallback
EXECUTION_ID=$(.claude/scripts/teo-uuidgen)

# Step 2: Issue the identity token — writes .claude/memory/identity-tokens/<execution_id>.json
#         and prints the token string to stdout for env-var injection
AGENT_IDENTITY_TOKEN=$(.claude/scripts/teo-issue-identity-token "$EXECUTION_ID" sage -)

# Step 3: DEPRECATED (T3-C) — teo-sage-get-or-create writes this marker automatically

# printf '%s' "$EXECUTION_ID" > .claude/memory/traces/sage-active-execution-id  # DEPRECATED
```

Pass `AGENT_IDENTITY_TOKEN` and `EXECUTION_ID` as env vars in the Agent() spawn block so the wrapper's file lookup at `.claude/memory/identity-tokens/<execution_id>.json` succeeds.

**Note:** Pass `-` for workstream_id on ad-hoc (non-workstream) Sage spawns. Pass the actual workstream_id (e.g., `WS-123`) when dispatching within a known workstream. Duplicate issuance for the same `execution_id` is refused — never reuse an `execution_id` across spawns.

```
Agent:
  subagent_type: general-purpose
  model: sonnet
  mode: bypassPermissions
  name: "sage"
  env:
    AGENT_IDENTITY_TOKEN: "{token string from teo-issue-identity-token stdout}"
    EXECUTION_ID: "{the UUID v4 execution_id generated above — MUST be generated Sage-side via teo-uuidgen; never derive from agent-supplied input (MINJA-parity invariant per ADR-017 Amendment 1)}"
  prompt: |
    You are The Sage — the project-level orchestrator for TheEngOrg enterprise.
    Read your full agent definition at: {absolute path to .claude/agents/sage/agent.md}

    ## Intake
    User request: {verbatim user request}
    intent_hint: {ONLY if explicit keyword used. Otherwise OMIT.}

    ## Your job (one-shot analysis only):
    You are a one-shot analysis agent for this request. Do not spawn specialists.
    Do not commit, push, or run git/gh operations.
    If this request requires multi-step specialist work (dev, qa, staff-engineer,
    security-engineer, commits, PRs, or hand-offs), signal that in your output
    and halt — the dispatcher will route to Path B instead.
    1. Read your agent.md FIRST
    2. Analyse the request and produce your one-shot response
    3. Write your analysis/result to .claude/memory/pipeline/sage-result.json
    4. Return — do not spawn any downstream agent
```

**Path B — Substantive pipeline work (PLAN/BUILD/FIX/REVIEW/IMPROVE/SHIP):**

Two execution contexts exist. Only one is active for interactive Claude Code sessions:

**(a) Interactive sessions — GATEWAY_SPAWN_REQUEST relay (CURRENT ACTIVE PATTERN):**
Sage emits a `GATEWAY_SPAWN_REQUEST` block in its output. The main session (the proxy / gateway) parses and executes the request on Sage's behalf, then relays the specialist's output back to Sage verbatim. Sage writes its orchestration plan to `.claude/memory/pipeline/sage-result.json` and returns — it does not call Agent() or run git/gh directly. This is the operating pattern for all interactive Claude Code sessions per `sage/agent.md` §Standard Dispatch Flow.

**(b) Daemon path (not yet active for interactive sessions):**
Shell to the daemon dispatch CLI, which sequences steps through the daemon orchestrator:

```
teo dispatch "<verbatim user request>"
```

`teo dispatch` builds a synthetic ticket and calls `processTicket()` in `daemon/src/orchestrator.ts`. Sage is invoked as a one-shot Agent() at each pipeline step; hand-offs go through `.claude/memory/pipeline/` files and `BaseRuntime.spawn()`. This path is implemented but is NOT the current operating pattern for interactive sessions — use (a) above.

**TEO does NOT (current operating state — until ADR-DRAFT-team-mode-dispatch-lifecycle §5 prerequisites are met):** Create teams, use SendMessage for orchestration, use TeamDelete, route through a team-lead dispatch loop, read project files before spawning Sage, decide project phase, classify intent for natural language, describe pipelines to Sage, tell Sage which skills to invoke. Note: TeamCreate + SendMessage becomes the primary pattern once all five §5 prerequisites in ADR-DRAFT-team-mode-dispatch-lifecycle are met — this prohibition is a current-state constraint, not a permanent invariant.

### Natural Language Routing

1. Not an operational keyword → spawn Sage immediately with verbatim request
2. Clearly operational keyword → route to utility skill
3. Genuinely ambiguous → ask one clarifying question

**Default to Sage.** When in doubt, pass to Sage.

### Misuse Guards

| Misuse scenario | Required behavior |
|-----------------|-------------------|
| `/teo build` expecting code | Clarify: /teo spawns Sage for orchestration; Sage delegates to engineering team |
| `/teo` with no args | Display enterprise menu. Never return an error. |
| Input matches no keywords | Attempt interpretation. Substantive → Sage. Operational → suggest utility skill. |
| `/teo validate` | Route to `/teo-validate`, not mg-* |
| Sage not installed | "Enterprise orchestration requires the Sage agent. Run `teo-init --force` to install." |
| User asks for community features | Do NOT route to mg-*. Say these are community skills — use `/mg`. |

## Memory Protocol

```yaml
read:
  - .claude/agents/sage/agent.md           # confirm Sage is available
  - .claude/skills/teo-*/SKILL.md          # dynamic skill discovery
write: none
```

## Protected Path Write Policy (Wave 2)

Use `teo-apply-edit` for writes to protected paths (`.claude/scripts/**`, `.claude/hooks/**`, `.claude/shared/**`, `docs/**`, `src/**`, `packages/**`); direct Edit/Write on these paths is blocked by the PreToolUse hook. See ADR-038 and `.claude/shared/teo-apply-edit-contract.md`. Sage passes this constraint to `dev` in the task context.

## Boundaries

**CAN:** Route to teo-* utility skills, spawn Sage for substantive work, show enterprise menu, match keywords, verify Sage availability
**CANNOT:** Replicate Sage logic, make strategic decisions, spawn C-Suite directly, route to mg-* skills, verify or synthesize team work, confirm specialist outputs
**ESCALATES TO:** Sage (all substantive work), user (if Sage agent is not available)
