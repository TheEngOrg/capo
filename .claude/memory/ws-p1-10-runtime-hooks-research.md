# WS-P1-10: Runtime Hook Research Findings
<!-- date: 2026-06-20, researcher: staff-engineer -->

## Summary

All three primary TEO portability targets — Gemini CLI, Codex CLI, and GitHub Copilot CLI — have a `SessionStart` hook mechanism with `additionalContext` injection, making them viable for WS-P1-11 equivalents. Cursor also has the mechanism on paper but `additionalContext` is broken in production as of April 2026. Continue.dev has no executable hook system at all. No runtime currently supports hard-blocking session startup from a hook — all are fail-open on `SessionStart` — so the integrity check pattern must warn rather than abort on those runtimes.

---

## Claude Code (baseline — already implemented)

**Hook config:** `.claude/settings.json` → `hooks.SessionStart[].hooks[].command`

**Mechanism:** Shell command subprocess. Receives tool input on stdin as JSON. Outputs JSON stdout with `hookSpecificOutput.additionalContext` injected into the model as authoritative context before the first user message. `capo-activation.sh` uses this pattern today.

**Relevant files:**
- `.claude/hooks/session-start.sh` — version banner
- `.claude/hooks/capo-activation.sh` — `additionalContext` injection (the TEO pattern)
- `.claude/hooks/teo-session-start-meta.sh` — meta logging stub

**Hard-block capability:** No — Claude Code's `SessionStart` cannot abort the session. Exit code non-zero logs an error but the session continues.

**Evidence:** https://docs.anthropic.com/en/docs/claude-code/hooks

---

## Gemini CLI

**Official docs:** https://geminicli.com/docs/hooks/ (official site, linked from https://github.com/google-gemini/gemini-cli README)

### Q1 — Session-start hook mechanism

Yes. Gemini CLI has a full hooks system with a dedicated `SessionStart` event. Configured in `settings.json` at three scope levels (system: `/etc/gemini-cli/settings.json`, user: `~/.gemini/settings.json`, project: `.gemini/settings.json`) under the `hooks` key.

`SessionStart` fires on:
- `source: "startup"` — fresh session start
- `source: "resume"` — resuming a saved session
- `source: "clear"` — after `/clear` command

The `matcher` field can filter to specific sources (e.g. `matcher: "startup"` for fresh-start only). The `hooksConfig.enabled` toggle (default: `true`) gates the entire system.

### Q2 — Execution contract

- **Form:** Shell command (`type: "command"` is the only supported type). The `command` field is a shell command string.
- **Sync/async:** Synchronous. The CLI waits for all matching hooks to complete before continuing. (`SessionEnd` and `PreCompress` are the exceptions — fire-and-forget.)
- **Subprocess:** Yes. Communication is via stdin/stdout JSON bidirectionally.
  - **stdin:** JSON payload with `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `timestamp`, `source`
  - **stdout:** JSON response with optional output fields
  - **stderr:** Captured for logging only, never parsed
- **Environment (sanitized):** `GEMINI_PROJECT_DIR`, `GEMINI_PLANS_DIR`, `GEMINI_SESSION_ID`, `GEMINI_CWD`, `CLAUDE_PROJECT_DIR` (alias). Host env vars are NOT passed through unless explicitly declared in extension `settings` arrays.

### Q3 — Authoritative startup context injection

Yes. `hookSpecificOutput.additionalContext` in the JSON output is supported:
- **Interactive mode:** Injected as the first turn in conversation history before any user message.
- **Non-interactive (headless) mode:** Prepended to the user's prompt.

This is a first-class design intent — the writing-hooks guide shows `SessionStart` → init script pattern for "initialize resources, load context."

### Q4 — Hard-block capability

No. `SessionStart` is explicitly advisory-only. From the reference docs: "`continue` and `decision` fields are **ignored**. Startup is never blocked." Exit code 2 (which causes a "System Block" on other events) is treated as a warning on `SessionStart` — the session continues regardless.

Other hooks (`BeforeAgent`, `BeforeTool`, `BeforeModel`) support hard-blocking, but not `SessionStart`.

### Q5 — Latency budget

Default timeout: **60,000 ms (60 seconds)**. Configurable per-hook via `timeout` field in milliseconds:
```json
{ "type": "command", "command": ".gemini/hooks/init.sh", "timeout": 5000 }
```
Hook runs synchronously, so latency directly delays session start. Re-hashing 10 agent `.md` files (~5–20 ms in shell) is well within budget.

### Recommendation for WS-P1-11 equivalent

**Use:** `.gemini/settings.json` → `hooks.SessionStart` with a command that outputs `hookSpecificOutput.additionalContext`. Pattern is nearly identical to Claude Code — same stdin/stdout JSON protocol, same field name. Config lives in `.gemini/settings.json` instead of `.claude/settings.json`.

**Constraint:** Cannot hard-block. Integrity-check failure must use a warning in `additionalContext` rather than aborting the session.

---

## Codex CLI (OpenAI)

**Official docs:** https://developers.openai.com/codex/hooks  
**Source schemas:** https://github.com/openai/codex/tree/main/codex-rs/hooks/schema/generated/

### Q1 — Session-start hook mechanism

Yes. Codex CLI has a full hooks system implemented in Rust (`codex-rs/hooks/`) with `SessionStart` as a first-class event. Introduced experimentally in v0.114.0 (March 2026), stable in v0.124.0 (April 23, 2026).

Config locations (all declarative JSON/TOML — not scripts themselves):
- `~/.codex/hooks.json` (user-global)
- `<repo>/.codex/hooks.json` (project-local)
- `~/.codex/config.toml` inline `[hooks]` table
- `<repo>/.codex/config.toml` inline
- Plugin manifests (`.codex-plugin/plugin.json` → `hooks/hooks.json`)
- `requirements.toml` for enterprise managed hooks

Note: AGENTS.md is a separate file-based context mechanism (static text walked from `~/.codex/AGENTS.md` down through the directory tree). It is NOT an executable hook — just static instructions injected at session start. The hooks system is distinct and executable.

### Q2 — Execution contract

- **Form:** Shell command string declared in config. `type: "command"` is the only supported type (`prompt` and `agent` types are parsed but skipped).
- **Working directory:** Session `cwd`.
- **Stdin:** JSON with `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, and for `SessionStart`: `source` (`startup|resume|clear|compact`)
- **Concurrency:** Multiple matching hooks for the same event fire **concurrently** — "one hook cannot prevent another matching hook from starting."
- **Sync/async:** Synchronous (Codex waits). The `async` field is parsed but explicitly not supported — hooks with `async: true` are skipped.
- **Env vars:** Plugin hooks get `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`. Regular hooks inherit the session environment — no additional env vars documented.
- **Timeout:** Configurable via `timeout` field (in **seconds**). Default: **600 seconds (10 minutes)**.

Example config:
```json
{
  "SessionStart": [
    {
      "command": "python3 ~/.codex/hooks/session_start.py",
      "statusMessage": "Loading session notes"
    }
  ]
}
```

### Q3 — Authoritative startup context injection

Yes. `hookSpecificOutput.additionalContext` in stdout JSON "is added as extra developer context before the first turn." Plain text on stdout also works (treated as extra developer context). Dynamic output (git branch, date, env state) is supported since this is an executable hook.

### Q4 — Hard-block capability

Ambiguous. `continue: false` in hook output "marks that hook run as stopped" and records `stopReason`. However, the docs do not explicitly state this aborts the full session — phrasing is vague compared to `UserPromptSubmit` (which explicitly documents `decision: "block"`). Exit code 2 as a hard-abort is only documented for `PreToolUse`, `UserPromptSubmit`, `SubagentStop`, and `Stop` — not `SessionStart`.

**Confidence: low on hard-abort capability.** To resolve: test locally with `continue: false` from a `SessionStart` hook, or check `codex-rs/hooks/schema/generated/` schemas for `SessionStart` output fields. Treat as fail-open for WS-P1-11 design purposes.

### Q5 — Latency budget

Default: **600 seconds (10 minutes)** — intentionally generous. Configurable per-hook via `timeout` (seconds). No minimum documented. Re-hashing agent `.md` files (~5–20 ms) is negligible.

### Recommendation for WS-P1-11 equivalent

**Use:** `<repo>/.codex/hooks.json` → `SessionStart` array with a command that outputs `additionalContext`. Protocol is nearly identical to Claude Code. One difference: multiple hooks fire concurrently (vs. Claude Code's sequential execution), so the integrity-check hook must be self-contained.

**Constraint:** Cannot reliably hard-block (treat as fail-open). **Open question:** verify Q4 behavior locally before finalizing WS-P1-11 for Codex.

---

## Cursor

**Official docs:** https://cursor.com/docs/hooks, https://cursor.com/docs/rules

### Q1 — Session-start hook mechanism

Yes, two mechanisms:

**a) `sessionStart` hook** — full lifecycle hook. Fires when a new composer conversation is created. Configured in `.cursor/hooks.json` (project) or `~/.cursor/hooks.json` (user).

**b) Rules** — file-based static context injection. `.cursor/rules/*.mdc` files with YAML frontmatter. Rules with `alwaysApply: true` are injected into every model context before the first user message. `.cursorrules` (project root) is deprecated since 0.43+ but still recognized.

### Q2 — Execution contract

**Hooks:** Shell command subprocess, stdio JSON bidirectionally. Config:
```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": "./hooks/session-init.sh", "timeout": 30 }]
  }
}
```
The `sessionStart` hook runs as **fire-and-forget** — "the agent loop does not wait for or enforce a blocking response."

**Rules:** Purely declarative static text (`.mdc` markdown). Not executable. No subprocess.

### Q3 — Authoritative startup context injection

**Documented: Yes. Actual production status: BROKEN.**

Hook output schema includes `additional_context` for `sessionStart`. However, as of April 2026 (Cursor v3.1.15), the Cursor team confirmed: `"additional_context from sessionStart gets dropped due to a timing issue between when the hook runs and when the composer handle is created."` Bug acknowledged, no ETA for fix.

**Reliable alternative:** `.cursor/rules/*.mdc` with `alwaysApply: true`. Rule contents are included at the start of the model context before any user input. Static text only — not dynamic executable output.

Source: https://forum.cursor.com/t/sessionstart-hook-additional-context-is-never-injected-into-agents-initial-system-context/158452

### Q4 — Hard-block capability

No. `sessionStart` is explicitly fire-and-forget with fail-open semantics. Non-zero exit is logged and skipped. `failClosed: true` is a config option but is documented as not applying to `sessionStart`. Other hooks (`beforeShellExecution`, `preToolUse`) support exit code 2 = deny and `failClosed`, but those are mid-session.

### Q5 — Latency budget

Configurable per hook via `timeout` field (seconds). `sessionStart` is fire-and-forget — latency doesn't delay session start regardless.

### Recommendation for WS-P1-11 equivalent

**Do NOT use `sessionStart` hook** — `additionalContext` injection is broken in production (as of April 2026). Track the Cursor bug for fix.

**Use instead:** `.cursor/rules/*.mdc` with `alwaysApply: true` for static TEO directives. This is file-based, not executable, so it cannot run an integrity check at session time. It can inject a standing instruction (e.g., "read `.claude/agents/capo/agent.md` on first message") but cannot dynamically verify integrity at startup.

**WS-P1-11 for Cursor is a PARTIAL solution at best until the hook bug is fixed.**

---

## Continue.dev

**Official docs:** https://docs.continue.dev

### Q1 — Session-start hook mechanism

**No executable session-start hook exists.** Continue.dev has no lifecycle hook system.

Closest mechanisms:
- **`config.yaml`/`config.json`:** Declarative config, loaded at extension startup — not per-session. Configures models, context providers, rules.
- **`config.ts` with `modifyConfig`:** TypeScript file at `~/.continue/config.ts`. Programmatically mutates the config object. Runs at **config load time** (extension startup or config reload), not at individual session start. Only executable customization point.
- **Rules:** Static text rules injected per conversation (timing relative to first user message is unspecified in docs).

### Q2 — Execution contract

`config.ts` / `modifyConfig` only: TypeScript file executed by the extension's Node.js runtime at config load time. Not a subprocess. No stdin/stdout protocol.

### Q3 — Authoritative startup context injection

Not via an executable hook. `modifyConfig` can modify what system prompt text is included in model config, but this is static config-time modification, not dynamic per-session injection. No documented mechanism for auto-injecting dynamic content before the first user message.

### Q4 — Hard-block capability

No hook mechanism exists. Not applicable.

### Q5 — Latency budget

Not applicable — no session-start hook exists.

### Recommendation for WS-P1-11 equivalent

**Not possible via hooks.** No executable session-start mechanism exists.

**Alternative:** `modifyConfig` in `config.ts` to inject static TEO system prompt text at config load time. This is not per-session and cannot run a dynamic integrity check. Continue.dev would need a file-based static-instruction approach (similar to CLAUDE.md) rather than a hook.

**WS-P1-11 for Continue.dev: NO-GO for dynamic integrity check. Consider static instruction injection only.**

---

## GitHub Copilot CLI

**Official docs:** https://docs.github.com/en/copilot/reference/hooks-configuration  
**Tutorial:** https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks

### Q1 — Session-start hook mechanism

Yes. Full hook system including `sessionStart`. Introduced with the new GitHub Copilot CLI (distinct from the deprecated "GitHub Copilot in the CLI" which was retired October 25, 2025).

Config locations (loaded in priority order):
1. Policy-level: `/etc/github-copilot/policy.d/*.json`
2. Repository-level: `.github/hooks/*.json`
3. User-level: `~/.copilot/hooks/*.json`
4. Repository settings: `.github/copilot/settings.json` (hooks field)
5. User settings: `~/.copilot/settings.json` (hooks field)

### Q2 — Execution contract

Shell command (bash or PowerShell), specified in JSON config. Runs **synchronously** in developer's local shell (for CLI) or Linux sandbox (for cloud agent). Config:
```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "./scripts/session-init.sh",
        "powershell": "./scripts/session-init.ps1",
        "cwd": ".github/hooks",
        "env": { "VAR": "VALUE" },
        "timeoutSec": 30
      }
    ]
  }
}
```
Also supports HTTP hooks (POST JSON to a URL) and prompt hooks (auto-submits text as user input — interactive only). `bash` and `powershell` keys both recommended for cross-platform support.

### Q3 — Authoritative startup context injection

Yes. `additionalContext` in stdout JSON is "injected into the session as a prepended user message." Cap: 10 KB combined across all hooks.

**Prompt hook variant:** Auto-submits text "as if the user typed it" — only for new interactive sessions, not on resume, not in non-interactive (`-p`) mode.

**Cloud agent note:** `sessionStart` prompt hooks do not fire on cloud agent jobs (non-interactive). Command-based `sessionStart` hooks with `additionalContext` should still work on cloud agents, per docs.

### Q4 — Hard-block capability

No. "For `sessionStart`, hook failures are logged and skipped." Fail-open by design. Only `preToolUse` has fail-closed semantics (crash, non-zero exit, or timeout = deny). Cannot abort session creation via a hook.

### Q5 — Latency budget

Default: **30 seconds** (`timeoutSec: 30`). Configurable per hook. On timeout, hook is killed and session continues. Tutorial example uses `"timeoutSec": 10`, suggesting fast-work expectation. Re-hashing agent `.md` files (~5–20 ms) is well within budget.

### Recommendation for WS-P1-11 equivalent

**Use:** `.github/copilot/settings.json` → `hooks.sessionStart` with a command that outputs `additionalContext`. Protocol is analogous to Claude Code. Notable differences: supports HTTP hooks as an alternative to subprocess, and both bash/powershell for cross-platform support.

**Constraint:** Cannot hard-block. `additionalContext` cap is 10 KB (generous for TEO directives). Set `timeoutSec` to a small value (e.g. 5) for the integrity check since it's shell-only.

---

## Risk Summary

| Runtime | Hook path viable? | Context injection | Hard-block | Status |
|---|---|---|---|---|
| **Claude Code** | Yes (baseline) | Yes (`additionalContext`) | No | Implemented |
| **Gemini CLI** | Yes | Yes (`additionalContext`) | No | GO |
| **Codex CLI** | Yes | Yes (`additionalContext`) | Ambiguous (likely no) | GO — verify Q4 |
| **GitHub Copilot CLI** | Yes | Yes (`additionalContext`, 10 KB cap) | No | GO |
| **Cursor** | Partial | Hook broken in prod (use rules fallback) | No | PARTIAL — blocked on bug fix |
| **Continue.dev** | No | No executable hook | No | NO-GO |

**Universal constraint across all runtimes:** `SessionStart` is advisory-only everywhere. WS-P1-11 integrity check must warn (via `additionalContext`) rather than abort. Hard-blocking on integrity failure is not achievable at the session-start hook layer in any of these runtimes.

---

## Open Questions

1. **Codex CLI Q4 (hard-block):** What does `continue: false` from `SessionStart` actually do — is it logged-and-ignored or does it halt the session? Resolve by testing locally or reading `codex-rs/hooks/` Rust source. Does not block WS-P1-11 design (treat as fail-open).

2. **Cursor `additional_context` bug fix ETA:** The timing-issue bug on `sessionStart` context injection was open as of April 2026 (v3.1.15). Check Cursor changelog / forum for fix status before finalizing WS-P1-11 for Cursor.

3. **Cursor `workspaceOpen` hook:** Fires once on workspace open (not per-conversation). Whether its output schema can inject model context is undocumented — only `pluginPaths` is documented as output. Not a viable alternative until verified.

4. **Continue.dev rules injection timing:** Docs don't specify whether static rules (config.yaml) are injected strictly before the first user message vs. on the first turn. For a TEO warning directive this is probably fine either way, but needs verification.

5. **Copilot CLI `additionalContext` on cloud agent:** Docs state command-hook `additionalContext` works on cloud agents but this was not validated with an example. Verify with a test deployment before relying on it for the cloud agent path.

6. **TEO portability scope for WS-P1-11:** The task spec asks about "Phase 2/3 targets." Cursor and Continue.dev are not primary targets per the TEO portable scope (which lists Gemini CLI as Phase 2 primary and Codex CLI as Phase 3). Recommend confirming whether Cursor/Continue.dev/Copilot CLI are in scope for WS-P1-11 or deferred.
