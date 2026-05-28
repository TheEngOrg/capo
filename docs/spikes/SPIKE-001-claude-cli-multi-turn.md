# SPIKE-001 — Claude CLI Multi-Turn Coherence

**Date:** 2026-05-21
**Author:** dev (TEO spike)
**Status:** COMPLETE
**Blocks:** ADR-0001 PROPOSED → ACCEPTED

---

## Execution Note

The TEO sandbox (`settings.json` allowlist) does not permit direct invocation of the `claude` binary — it is not in the `Bash(...)` allowlist and has no `teo-claude` wrapper script. As a result, Tests 1, 3, and 4 were executed via binary inspection (`grep -a` against the compiled Bun binary at `/Users/brodieyazaki/.local/bin/claude`) and static analysis of the existing `ClaudeCliRuntime` implementation in `daemon/src/llm/claude.ts`. Test 2 (live multi-turn coherence) could not be executed live; findings are derived from the implementation's structural behavior. All flag presence findings are confirmed from binary string extraction; they are not inferred from documentation.

---

## Summary

The `claude` CLI binary (v2.1.146, Bun-compiled) exposes `--print`, `--allowed-tools`, and `--disallowed-tools` flags. The existing `daemon/src/llm/claude.ts` implementation already uses `claude --print --output-format text <prompt>` as a headless subprocess — no TTY required. Per-turn context injection via prompt prefix accumulation is structurally sound: the injected prefix grows at approximately 2,000–5,000 chars per turn for realistic agent sessions, staying well within Claude's context window for practical session lengths (20–50 turns). Tool flag enforcement via `--allowed-tools` / `--disallowed-tools` is confirmed present in the binary. Live multi-turn coherence testing was blocked by the TEO sandbox allowlist; structural analysis indicates the approach is viable but live validation is a recommended follow-up before ACCEPTED status is granted.

---

## Test Results

### Test 1 — Flag availability

**Command:** Binary string extraction: `grep -ao "allowed-tools <tools...>[^\"]*" /Users/brodieyazaki/.local/bin/claude`

**Findings:**

`--allowed-tools` — **present**

Exact syntax from binary help text:
```
--allowed-tools <tools...>
    Comma or space-separated list of tool names to allow (e.g. "Bash(git *) Edit")
```

Alias also present: `--allowedTools`

`--disallowed-tools` — **present**

Exact syntax from binary help text:
```
--disallowed-tools <tools...>
    Comma or space-separated list of tool names to deny (e.g. ...)
```

Alias also present: `--disallowedTools`

Both flags accept glob-style tool name patterns (e.g. `Bash(gh pr *)`, `Edit`, `Read`).

Additional flag confirmed: `--output-format <format>` — accepts `text`, `json`, `stream-json` (only works with `--print`).

`--dangerously-skip-permissions` — present. Already used in the `ClaudeCliRuntime` implementation via `config.skipPermissions`.

---

### Test 2 — Multi-turn coherence via context injection

**Commands:** Not executable — `claude` binary is not in the TEO Bash allowlist. No `teo-claude` wrapper script exists.

**Structural analysis:**

The existing `daemon/src/llm/claude.ts` implementation invokes:
```
claude --print --output-format text [--dangerously-skip-permissions] [...extraArgs] <prompt>
```

The prompt is passed as a single positional argument (never shell-interpolated). The subprocess is spawned via `child_process.spawn()` with no TTY. The binary's embedded strings confirm `headless` mode is supported.

Per-turn context injection works by serializing the full conversation history into the prompt argument for each new turn. The `session-store.ts` / `ConversationTurn[]` structure already exists and is integrated with `ClaudeCliRuntime.flush()`.

**Turn 2 finding:** Cannot confirm live. Structurally: the model receives the full conversation prefix as a single text prompt, so if the prefix faithfully reproduces the prior exchange, recall of stated facts (e.g., "Alice") is expected to be coherent. This is consistent with how `claude --print` is documented to work (single-shot, no server-side session state — all context is in the prompt).

**Turn 3 finding:** Cannot confirm live. Same reasoning applies. No server-side state means coherence depends entirely on the injected prefix. The approach is correct in principle.

**Live validation gap:** A 3-turn coherence test with `claude --print` invoked outside the TEO sandbox (e.g., run manually in the terminal by the CTO or a dev) would close this gap. Recommended before ADR-0001 transitions to ACCEPTED.

---

### Test 3 — Tool flag enforcement

**Commands:** Binary string extraction for flag presence. Live enforcement test not executable (sandbox constraint).

**Finding — flag presence:** `--allowed-tools` and `--disallowed-tools` are **confirmed present** in the binary (v2.1.146).

**Finding — enforcement behavior:** Based on the binary's flag descriptions and the existing implementation in ADR-0001's two-layer enforcement model:

- `--allowed-tools Read` would tell the subprocess to permit only the `Read` tool.
- `--allowed-tools Read` followed by a `Write` attempt — the CLI is expected to refuse or warn on the `Write` call, since `Write` is not in the allowed set.
- `--disallowed-tools Write` would deny `Write` even if it would otherwise be available.

The `ClaudeCliRuntime` implementation documents this as defense-in-depth: the in-process `PolicyEnforcement.preflight()` runs first; `--disallowed-tools` appended to subprocess args is the second layer. The two-layer design means tool grant enforcement does not rely solely on CLI flag behavior.

**Live enforcement confirmation gap:** Whether the CLI silently ignores, warns, or hard-blocks a disallowed tool call was not confirmed live. The binary contains the flag machinery; actual enforcement behavior requires a live test. Recommended before ACCEPTED.

---

### Test 4 — Per-turn overhead across 5 turns

**Methodology:** Analytical calculation based on realistic agent session characteristics and the context injection approach in `daemon/src/llm/claude.ts`.

**Minimal synthetic session (Hello/Alice test):**

| Turn | Injected prefix (chars) | Notes |
|------|------------------------|-------|
| 1 | 25 | Prompt only: `"Hello, my name is Alice."` |
| 2 | ~240 | Prefix: `"Previous exchange:\nHuman: Hello, my name is Alice.\nAssistant: <~150 char response>\n\nHuman: What is my name?"` |
| 3 | ~440 | + Turn 2 response appended |
| 4 | ~640 | + Turn 3 response |
| 5 | ~840 | + Turn 4 response |

**Realistic TEO agent session (task + tool results):**

| Turn | Injected prefix (chars) | Notes |
|------|------------------------|-------|
| 1 | ~3,000 | Agent system context + task description |
| 2 | ~7,000 | + Turn 1 response (~2,000 chars) + new instruction (~2,000) |
| 3 | ~13,000 | + Turn 2 response (~4,000 chars includes tool output) |
| 4 | ~19,000 | |
| 5 | ~25,000 | |

**Turn 1 prefix length:** 25 chars (minimal) / ~3,000 chars (realistic)
**Turn 5 prefix length:** ~840 chars (minimal) / ~25,000 chars (realistic)

**Practical limit estimate:** Claude's context window is 200,000 tokens (~800,000 chars). At the realistic growth rate of ~5,000–7,000 chars/turn, the context injection approach is practical to approximately **100–120 turns** before approaching the window limit. For TEO's use case (agent sessions typically 5–30 turns), the per-turn overhead is not a limiting factor.

**Key constraint:** Growth is linear, not exponential. Each turn appends one `(Human, Assistant)` exchange. The approach degrades gracefully — sessions near the context limit would require the `--autocompact` flag (confirmed present in binary) or session splitting at the application layer.

---

## Verdict for ADR-0001

**ClaudeCliRuntime is viable with caveats — ADR-0001 can advance to ACCEPTED pending two live validation items.**

The structural analysis confirms:
- `--print` flag supports headless/non-TTY subprocess invocation (confirmed — the existing `daemon/src/llm/claude.ts` already uses this in production)
- `--allowed-tools` / `--disallowed-tools` flags are present with correct syntax (confirmed from binary)
- Per-turn context injection grows linearly at ~5,000–7,000 chars/turn for realistic sessions; practical limit is ~100+ turns (not a constraint for TEO's 5–30 turn sessions)

**Caveats requiring live validation before ACCEPTED:**

1. **Multi-turn coherence (Test 2):** A 3-turn `claude --print` sequence with full history prefix must be run outside the TEO sandbox to confirm factual recall is coherent. The structural approach is correct; live confirmation is a 10-minute test.

2. **Tool flag enforcement behavior (Test 3):** Whether `--allowed-tools` / `--disallowed-tools` hard-blocks, warns, or silently ignores a disallowed tool call must be confirmed live. The two-layer enforcement design in ADR-0001 is sound regardless — in-process `PolicyEnforcement.preflight()` is the primary gate.

Neither caveat invalidates the `ClaudeCliRuntime` approach. If live tests fail, the fallback is `ClaudeSDKAdapter` as specified in ADR-0001 Part 1.

---

## Open Items

| ID | Item | Owner | Priority |
|----|------|-------|----------|
| OI-1 | Run 3-turn `claude --print` coherence test outside TEO sandbox to close Test 2 gap | CTO or any dev with terminal access | High — needed before ACCEPTED |
| OI-2 | Run tool flag enforcement test: `claude --print "read /etc/hosts" --allowed-tools Read` then attempt Write — document behavior | CTO or any dev | High — needed before ACCEPTED |
| OI-3 | Add `teo-claude` wrapper script to TEO allowlist if agent sessions need to invoke `claude` CLI from within the sandbox | DevOps / staff-engineer | Medium — enables future automated spike runs |
| OI-4 | Confirm `--autocompact` flag behavior for sessions approaching context limits — binary confirms flag is present but compaction strategy is undocumented | Week 3–4 implementation concern | Low for v1 |
