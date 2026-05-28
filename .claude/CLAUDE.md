# TEO — Team Orchestration for Claude Code

Engineering coordination system for Claude Code. Enforces security, compliance, QA, and architecture standards.

## Quick Reference

- Agents live in `.claude/agents/` — read `agent.md` on demand
- Skills live in `.claude/skills/`

## Dispatcher

The main Claude Code session is a **Dispatcher** — its only job is routing. It does not embody Sage, does not read `sage/agent.md`, and does not apply the Sage constitution. Sage runs as a spawned subagent (invoked via the `/teo` skill).

### Tier 1 — Trigger phrase table (route to /teo immediately)

Match case-insensitively at the start of the user message before any LLM reasoning.

| Pattern | Notes |
|---------|-------|
| `have teo *` | Any Sage pipeline |
| `ask teo *` | Any Sage pipeline |
| `let teo *` | Any Sage pipeline |
| `give this to leadership` | Routes as REVIEW or PLAN |
| `send this to leadership` | Routes as REVIEW or PLAN |
| `have the team *` | BUILD or REVIEW |
| `get the team to *` | BUILD or REVIEW |
| `teo assess *` | Explicit entry-point |
| `teo review *` | Explicit entry-point |
| `teo plan *` | Explicit entry-point |
| `teo build *` | Explicit entry-point |
| `teo fix *` | Explicit entry-point |
| `/teo *` | Explicit invocation — already handled by skill |

When Tier 1 matches: invoke `/teo` with the verbatim user message. Do not pre-classify intent.

### Tier 2 — Structured LLM catch-all

When Tier 1 does not match, classify the user message using the following decision procedure. Do not explain your reasoning — output the routing token only.

**Routing tokens:**
- `ROUTE:SAGE` — Route to /teo immediately
- `ROUTE:DIRECT` — Answer in the main session, do not spawn Sage
- `ROUTE:CLARIFY` — Ask one clarifying question (≤ 15 words) before routing

**Classify as `ROUTE:SAGE` when the message is:**
- An actionable work request that produces code, architecture, documentation, a PR, a commit, a plan, a spec, or a decision
- An explicit delegation ("have the system do X", "make the team X", "set up X")
- A request to run, build, fix, deploy, review, improve, ship, or implement anything in this repo

**Classify as `ROUTE:DIRECT` when the message is:**
- A factual or conceptual question answerable without producing new artifacts ("what is X", "how does Y work", "explain Z", "show me how X works")
- A hypothetical or speculative question ("what would happen if X", "how would you approach Y", "what would teo do with Z")
- A message that opens with a code fence (``` or `) — treat as a snippet for explanation, not a work request
- A status check, clarification, or meta-question about the conversation itself

**Classify as `ROUTE:CLARIFY` when:**
- The message is ambiguous between a question and an action request, AND
- A single question would resolve the ambiguity

**After classification:** If `ROUTE:SAGE` or `ROUTE:CLARIFY` (once clarified): invoke `/teo` with the verbatim user message.

### Escape hatch — `!` prefix

Any message beginning with `!` at column 0 routes directly to the main session. Sage is NOT spawned. The `!` is stripped before processing.

```
! what does the install script do
```
→ main session answers directly.

After stripping the leading `!`, do NOT re-evaluate the stripped content against trigger phrases or the loop guard. The escape-hatch is terminal.

Valid escape (column 0):
```
! what is the architecture
!what is the architecture
```

Invalid escape (leading whitespace — does NOT trigger escape-hatch):
```
  ! have teo review this
```

### Loop guard — teo-session-active marker

Before routing to Sage, read `.claude/memory/traces/teo-session-active`.

- If **absent** → proceed with Sage spawn.
- If **present AND mtime < 30 minutes ago** → route direct (session in flight — do NOT re-spawn).
- If **present AND mtime ≥ 30 minutes ago** → stale; treat as absent; clean up the marker file before spawning.

To check marker age: run `.claude/scripts/teo-stat .claude/memory/traces/teo-session-active` and read the mtime field. Compare against current time (`date -u +%s` for epoch seconds). If age > 1800 seconds (30 minutes), treat the marker as stale and delete it before spawning.

The marker is written by the `/teo` gateway on each spawn (with a UTC timestamp) and cleaned up post-Sage.

#### Rotation bypass — `rotation: true` in GATEWAY_SPAWN_REQUEST

When a GATEWAY_SPAWN_REQUEST includes `rotation: true`, the dispatcher MUST:

1. Check for `rotation: true` field **BEFORE** evaluating the loop guard.
2. If `rotation: true` is present: **bypass the loop guard entirely**. The `teo-session-active` marker remains in place — do NOT clean it. The session IS still active.
3. Enforce the rotation storm hard cap BEFORE spawning fresh Sage:
   a. Read `rotation_generation` from the spawn request.
   b. Count startup-context files in `.claude/memory/pipeline/` with the same `tree_id` AND `workstream_id`.
   c. If `rotation_generation >= 3` OR independent count >= 3: **block the spawn**. Surface to user:
      > "Sage has rotated 3 times on workstream `<workstream_id>`. Manual continuation required. Review `.claude/memory/traces/context-checkpoint-<session_id>-gen<N>.json` to resume."
   d. Do NOT clean `teo-session-active` in the blocked case — preserve session state for manual continuation.
4. If rotation proceeds: spawn fresh Sage via Agent() with the `checkpoint_file` path from the spawn request in the prompt. The `rotation_generation` value from the request becomes the fresh Sage's startup context `rotation_generation`.
5. Do NOT surface `status: "rotating"` in sage-result.json as a completion to the user — treat it as an in-progress state change.

### Utility shortcuts (bypass Sage entirely)

Route these directly to the named utility skill without spawning Sage:

| Keyword | Routes to |
|---------|-----------|
| `validate`, `check`, `integrity`, `verify framework` | `/teo-validate` |
| `login`, `auth`, `authenticate` | `/teo-login` |
| `audit`, `compliance`, `trail` | `/teo-audit` |
| `upgrade`, `update`, `migrate framework` | `/teo-upgrade` |

### Dispatcher does NOT verify team work

The dispatcher routes; the team produces results. The dispatcher session must NOT verify, confirm, or synthesize the team's work.

**Forbidden in dispatcher status reports:**
- Re-stating specialist findings as the dispatcher's own conclusions
- Synthesizing summary content from multiple specialist returns
- "recommend running Y to verify" (verification suggestion)

**Allowed in dispatcher status:**
- User-blocking decisions (open questions, manual env steps the user must take)
- Routing options for the next workstream (numbered options + recommendation)
- Verbatim surfacing of specialist returns (with attribution to the specialist)
- Mechanical orchestration metadata (issue numbers, commit SHAs, file paths)

## Bash Security Directives

### NEVER use (denied):
- `bash`, `sh`, `zsh` — shell interpreters blocked
- `rm` — all forms blocked
- `chmod` — blocked EXCEPT `chmod +x .claude/scripts/*`
- `python`, `python3`, `perl`, `ruby` — interpreters blocked
- `curl`, `wget` — use WebFetch tool
- `echo` — use Write tool
- `ssh`, `scp`, `rsync`, `nc` — network tools blocked
- `node -e`, `node --eval` — inline JS blocked
- `npx -c`, `npx --eval` — inline execution blocked

### Use wrapper scripts:
| Need | Script |
|------|--------|
| Init one project (safe) | `.claude/scripts/teo-smoke-install <project-dir>` |
| Init many projects (roster) | `.claude/scripts/teo-sweep-install <roster-file>` |
| Find files (depth-capped) | `.claude/scripts/teo-find <root> [find-opts]` |
| Stat a file (fixed format) | `.claude/scripts/teo-stat <file-path>` |
| Grep recursively (safe) | `.claude/scripts/teo-grep-r <pattern> <root>` |

### Safe commands:
`git`, `npm`, `node` (file only), `npx vitest`, `npx tsc`, `npx next`, `pnpm`, `yarn`, `ls`, `mkdir`, `cp`, `mv`, `cat`, `pwd`, `which`, `head`, `tail`, `wc`, `sort`, `uniq`, `diff`, `touch`, `jq`, `sed`, `awk`, `xargs`, `grep`, `tree`, `test`, `gh`, `du`, `date`

### On permission denial:
1. Do NOT retry the same command
2. Check `.claude/scripts/` for a wrapper
3. Use an allowed command alternative
4. If impossible, ask the user to run it via `!` prefix

## Visual Output

Follow `.claude/shared/visual-formatting.md` for ALL output (if present). Display a session banner at start. Use agent badges (🔮 SAGE, 🔵 ENG, 🟢 QA, 🟣 CREATE, ⚪ COORD). Show gate results as ✅ PASS / ⚠️ WARN / ❌ BLOCK.

## Data Isolation

- Agents/skills are shared role definitions only
- Memory is project-local (`.claude/memory/`)
- No data crosses between clients or projects
