// WS-STARTUP-CLEANUP — passing (post-impl, CAD gate 1 spec)

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// hooks-json.test.ts — QA spec for hooks/hooks.json (WS-STARTUP-CLEANUP)
//
// Change under test: remove 5 stub/stale hooks from hooks.json:
//   - SessionStart: remove session-start.sh and teo-session-start-meta.sh
//     (only capo-activation.sh remains under SessionStart)
//   - Remove entire PostToolUse, TaskCompleted, TeammateIdle event type keys
//     (their only scripts were no-op stubs)
//
// POST-IMPL EVENT TYPE COUNT: 3
//   SessionStart    [1 hook]:  capo-activation.sh
//   PreToolUse      [3 hooks]: block-no-verify.sh (Bash), pre-edit-write-guard.sh (Edit + Write)
//   UserPromptSubmit[1 hook]:  teo-prompt-router.sh
//
// PRE-IMPL STATE (what hooks.json looks like before dev acts):
//   SessionStart    [3 hooks]: session-start.sh, capo-activation.sh, teo-session-start-meta.sh
//   PreToolUse      [3 hooks]: block-no-verify.sh, pre-edit-write-guard.sh (Edit), pre-edit-write-guard.sh (Write)
//   PostToolUse     [1 hook]:  post-tool-use.sh
//   TaskCompleted   [1 hook]:  task-completed.sh
//   TeammateIdle    [1 hook]:  teammate-idle.sh
//   UserPromptSubmit[1 hook]:  teo-prompt-router.sh
//   6 top-level event type keys total
//
// verify-plugin-install.sh currently asserts HOOKS_COUNT = "6". After cleanup
// it must assert "3". Tests below cover that shell script gate as well.
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
// =============================================================================

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOKS_JSON = path.join(REPO_ROOT, "src", "plugin", "hooks", "hooks.json");
const VERIFY_SCRIPT = path.join(REPO_ROOT, "scripts", "verify-plugin-install.sh");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HookEntry {
  type: string;
  command: string;
}

interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

interface HooksJson {
  hooks: Record<string, HookGroup[]>;
}

function loadHooksJson(): HooksJson {
  const raw = fs.readFileSync(HOOKS_JSON, "utf8");
  return JSON.parse(raw) as HooksJson;
}

function getEventTypeKeys(): string[] {
  return Object.keys(loadHooksJson().hooks);
}

function getAllReferencedScripts(): string[] {
  const data = loadHooksJson();
  const scripts: string[] = [];
  for (const groups of Object.values(data.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        const match = hook.command.match(/\/hooks\/([^"'\s]+\.sh)/);
        if (match) scripts.push(match[1]);
      }
    }
  }
  return scripts;
}

function getSessionStartCommands(): string[] {
  const data = loadHooksJson();
  const ssGroups = data.hooks["SessionStart"] ?? [];
  return ssGroups.flatMap((g) => g.hooks.map((h) => h.command));
}

function getPreToolUseEntries(): HookGroup[] {
  return loadHooksJson().hooks["PreToolUse"] ?? [];
}

function findPreToolUseEntry(matcher: string): HookGroup | undefined {
  return getPreToolUseEntries().find((e) => e.matcher === matcher);
}

function entryReferencesScript(entry: HookGroup, scriptName: string): boolean {
  return entry.hooks.some((h) => h.command.includes(scriptName));
}

// =============================================================================
// MISUSE — patterns that must NOT appear in hooks.json after cleanup
// =============================================================================

describe("hooks.json — misuse: stub hooks must not remain registered (WS-STARTUP-CLEANUP)", () => {
  it("must NOT reference post-tool-use.sh in any event type", () => {
    // post-impl: PostToolUse event type removed; post-tool-use.sh no longer referenced. Confirmed absent.
    // The stub was a no-op exit 0 and has been removed entirely.
    const scripts = getAllReferencedScripts();
    expect(scripts).not.toContain("post-tool-use.sh");
  });

  it("must NOT reference task-completed.sh in any event type", () => {
    // post-impl: TaskCompleted event type removed; task-completed.sh no longer referenced. Confirmed absent.
    const scripts = getAllReferencedScripts();
    expect(scripts).not.toContain("task-completed.sh");
  });

  it("must NOT reference teammate-idle.sh in any event type", () => {
    // post-impl: TeammateIdle event type removed; teammate-idle.sh no longer referenced. Confirmed absent.
    const scripts = getAllReferencedScripts();
    expect(scripts).not.toContain("teammate-idle.sh");
  });

  it("must NOT reference teo-session-start-meta.sh in any event type", () => {
    // post-impl: teo-session-start-meta.sh removed from SessionStart in hooks.json. Confirmed absent.
    const scripts = getAllReferencedScripts();
    expect(scripts).not.toContain("teo-session-start-meta.sh");
  });

  it("must NOT reference session-start.sh in any event type", () => {
    // post-impl: session-start.sh removed from SessionStart in hooks.json. Confirmed absent.
    // session-start.sh was stale (emitted TEO branding, checked agents/capo.md
    // which never existed in dev repo). teo-statusline.sh handles status output.
    const scripts = getAllReferencedScripts();
    expect(scripts).not.toContain("session-start.sh");
  });

  it("must NOT have a PostToolUse key in hooks", () => {
    // post-impl: PostToolUse key removed from hooks.json. Confirmed absent.
    // Removing its stub script meant this entire event type had no entries — key removed.
    const keys = getEventTypeKeys();
    expect(keys).not.toContain("PostToolUse");
  });

  it("must NOT have a TaskCompleted key in hooks", () => {
    // post-impl: TaskCompleted key removed from hooks.json. Confirmed absent.
    const keys = getEventTypeKeys();
    expect(keys).not.toContain("TaskCompleted");
  });

  it("must NOT have a TeammateIdle key in hooks", () => {
    // post-impl: TeammateIdle key removed from hooks.json. Confirmed absent.
    const keys = getEventTypeKeys();
    expect(keys).not.toContain("TeammateIdle");
  });
});

// =============================================================================
// BOUNDARY — structural validity invariants (must hold before AND after cleanup)
// =============================================================================

describe("hooks.json — boundary: file is structurally valid (WS-STARTUP-CLEANUP)", () => {
  it("file exists at hooks/hooks.json", () => {
    expect(fs.existsSync(HOOKS_JSON)).toBe(true);
  });

  it("file is valid JSON (does not throw on parse)", () => {
    expect(() => loadHooksJson()).not.toThrow();
  });

  it('top-level object has a "hooks" key whose value is an object', () => {
    const parsed = loadHooksJson();
    expect(parsed).toHaveProperty("hooks");
    expect(typeof parsed.hooks).toBe("object");
    expect(parsed.hooks).not.toBeNull();
  });

  it("each event type value is a non-empty array", () => {
    // Every key in hooks must have at least one group entry — empty arrays are dead weight.
    const data = loadHooksJson();
    for (const [eventType, groups] of Object.entries(data.hooks)) {
      expect(Array.isArray(groups), `${eventType} value must be an array`).toBe(true);
      expect(groups.length, `${eventType} must have at least one group`).toBeGreaterThan(0);
    }
  });

  it("each hook entry has type 'command' and a non-empty command string", () => {
    const data = loadHooksJson();
    for (const groups of Object.values(data.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          expect(hook.type).toBe("command");
          expect(typeof hook.command).toBe("string");
          expect(hook.command.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("every command referencing a hook script uses CLAUDE_PLUGIN_ROOT (no hardcoded paths)", () => {
    const data = loadHooksJson();
    for (const groups of Object.values(data.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          if (hook.command.includes(".sh")) {
            expect(hook.command, `command must use CLAUDE_PLUGIN_ROOT: ${hook.command}`).toContain(
              "CLAUDE_PLUGIN_ROOT"
            );
          }
        }
      }
    }
  });

  it("hooks.json round-trips through JSON.parse → JSON.stringify cleanly", () => {
    // Catches BOM, trailing commas, or encoding issues from dev edits.
    const raw = fs.readFileSync(HOOKS_JSON, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const reparsed: unknown = JSON.parse(JSON.stringify(parsed));
    expect(reparsed).toEqual(parsed);
  });

  it("PreToolUse key exists and is an array with at least 3 entries (Bash + Edit + Write)", () => {
    // Regression guard: WS-STARTUP-CLEANUP must not disturb PreToolUse entries.
    const data = loadHooksJson();
    expect(Array.isArray(data.hooks["PreToolUse"])).toBe(true);
    expect((data.hooks["PreToolUse"] ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

// =============================================================================
// GOLDEN PATH — post-impl assertions
// =============================================================================

describe("hooks.json — golden: exactly 3 event types after stub removal (WS-STARTUP-CLEANUP)", () => {
  it("hooks has exactly 3 top-level event type keys", () => {
    // post-impl: 3 event types remain (SessionStart, PreToolUse, UserPromptSubmit). Confirmed.
    const keys = getEventTypeKeys();
    expect(keys).toHaveLength(3);
  });

  it("the 3 event type keys are SessionStart, PreToolUse, UserPromptSubmit", () => {
    // post-impl: PostToolUse, TaskCompleted, TeammateIdle all removed. Exactly these 3 remain.
    const keys = getEventTypeKeys().sort();
    expect(keys).toEqual(["PreToolUse", "SessionStart", "UserPromptSubmit"].sort());
  });
});

describe("hooks.json — golden: SessionStart has exactly capo-activation.sh (WS-STARTUP-CLEANUP)", () => {
  it("SessionStart group has exactly one hook command", () => {
    // post-impl: SessionStart has exactly 1 command. Previously 3 (session-start.sh,
    // capo-activation.sh, teo-session-start-meta.sh). The other 2 have been removed.
    // Only capo-activation.sh remains. Confirmed.
    const commands = getSessionStartCommands();
    expect(commands).toHaveLength(1);
  });

  it("the single SessionStart command references capo-activation.sh", () => {
    // post-impl: capo-activation.sh is the sole SessionStart command. Confirmed.
    const commands = getSessionStartCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("capo-activation.sh");
  });

  it("the SessionStart capo-activation.sh command uses CLAUDE_PLUGIN_ROOT", () => {
    // Ensures the solo remaining SessionStart hook uses the portable path pattern.
    const commands = getSessionStartCommands();
    expect(commands[0]).toContain("CLAUDE_PLUGIN_ROOT");
  });
});

describe("hooks.json — golden: PreToolUse registry intact after cleanup (WS-STARTUP-CLEANUP)", () => {
  it("Bash matcher entry for block-no-verify.sh is still present (regression guard)", () => {
    // WS-STARTUP-CLEANUP removes stubs; it must not disturb PreToolUse.
    const bashEntry = findPreToolUseEntry("Bash");
    expect(bashEntry).toBeDefined();
    expect(entryReferencesScript(bashEntry!, "block-no-verify.sh")).toBe(true);
  });

  it("Edit matcher entry for pre-edit-write-guard.sh is still present (regression guard)", () => {
    const editEntry = findPreToolUseEntry("Edit");
    expect(editEntry).toBeDefined();
    expect(entryReferencesScript(editEntry!, "pre-edit-write-guard.sh")).toBe(true);
  });

  it("Write matcher entry for pre-edit-write-guard.sh is still present (regression guard)", () => {
    const writeEntry = findPreToolUseEntry("Write");
    expect(writeEntry).toBeDefined();
    expect(entryReferencesScript(writeEntry!, "pre-edit-write-guard.sh")).toBe(true);
  });

  it("UserPromptSubmit still references teo-prompt-router.sh", () => {
    const data = loadHooksJson();
    const groups = data.hooks["UserPromptSubmit"] ?? [];
    const refs = groups.flatMap((g) => g.hooks.map((h) => h.command));
    expect(refs.some((cmd) => cmd.includes("teo-prompt-router.sh"))).toBe(true);
  });
});

// =============================================================================
// verify-plugin-install.sh — hook count gate must be updated to "3"
//
// WS-STARTUP-CLEANUP drops 3 event types (PostToolUse, TaskCompleted, TeammateIdle).
// `claude plugin details teo` reports hooks by distinct event type count.
//
// hooks/hooks.json post-impl has 3 top-level event type keys:
//   SessionStart, PreToolUse, UserPromptSubmit
// Dev must update verify-plugin-install.sh to assert HOOKS_COUNT = "3".
// =============================================================================

describe("verify-plugin-install.sh — hook count gate must assert 3 (WS-STARTUP-CLEANUP)", () => {
  it("verify-plugin-install.sh exists at scripts/verify-plugin-install.sh", () => {
    expect(fs.existsSync(VERIFY_SCRIPT)).toBe(true);
  });

  it('verify-plugin-install.sh does NOT assert HOOKS_COUNT = "6"', () => {
    // post-impl: script no longer asserts HOOKS_COUNT = "6".
    // Event type count dropped to 3 and the assertion was updated accordingly. Confirmed.
    const content = fs.readFileSync(VERIFY_SCRIPT, "utf8");
    expect(content).not.toMatch(/HOOKS_COUNT.*"6"/);
  });

  it('verify-plugin-install.sh asserts HOOKS_COUNT = "3"', () => {
    // post-impl: script now asserts HOOKS_COUNT = "3". Confirmed.
    const content = fs.readFileSync(VERIFY_SCRIPT, "utf8");
    expect(content).toMatch(/HOOKS_COUNT.*"3"/);
  });

  it("verify-plugin-install.sh OK message references Hooks (3)", () => {
    // post-impl: OK message now references Hooks (3 event types). Confirmed.
    // The message was updated to reference 3 event types.
    const content = fs.readFileSync(VERIFY_SCRIPT, "utf8");
    expect(content).toMatch(/Hooks \(3/);
  });
});
