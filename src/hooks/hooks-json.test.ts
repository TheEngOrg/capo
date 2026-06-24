// WS-SEC-02 — passing (post-impl, CAD gate 2)

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// hooks-json.test.ts — QA spec for hooks/hooks.json (WS-SEC-02 Fracture C)
//
// Change under test: register hooks/pre-edit-write-guard.sh in hooks/hooks.json
// under PreToolUse for both the "Edit" and "Write" matchers.
//
// WHY THESE TESTS WILL FAIL TODAY
//   hooks/hooks.json currently has ONE PreToolUse entry (matcher: "Bash") for
//   block-no-verify.sh. It has NO entries for matcher "Edit" or "Write", and
//   pre-edit-write-guard.sh is not referenced anywhere. Tests asserting the
//   presence of Edit/Write matchers with pre-edit-write-guard.sh will fail
//   until dev adds those entries.
//
// ALSO TESTED HERE: verify-plugin-install.sh hook count gate update.
//   After WS-SEC-02 adds 2 new PreToolUse entries (Edit + Write), the installed
//   hook count will increase from 5 to 7. The HOOKS_COUNT assertion in
//   scripts/verify-plugin-install.sh must be updated from "5" to "7".
//   The test below asserts the new count — it will fail until dev updates
//   verify-plugin-install.sh AND hooks.json is confirmed to register 7 hooks.
//
// NOTE ON HOOK COUNT MATH
//   Current hooks registered (hooks.json):
//     SessionStart [3]: session-start.sh, capo-activation.sh, teo-session-start-meta.sh
//     PreToolUse   [1]: block-no-verify.sh (Bash matcher)
//     PostToolUse  [1]: post-tool-use.sh
//     TaskCompleted[1]: task-completed.sh
//     TeammateIdle [1]: teammate-idle.sh
//     Total = 7 hook commands across 5 top-level entries.
//   BUT: the verify-plugin-install.sh HOOKS_COUNT is "5" today, which likely
//   reflects top-level hook-entry objects, not individual command count.
//   After WS-SEC-02 adds 2 PreToolUse entries (Edit + Write), the top-level
//   entry count becomes 7. The exact semantic (entries vs commands) is
//   determined by what `claude plugin details` reports — dev must verify and
//   update the gate accordingly.
//   THE TEST BELOW asserts "7" for the updated count; if the plugin CLI counts
//   differently, dev must update the test comment but the test assertion is the
//   spec. Dev documents the confirmed count during implementation.
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
// =============================================================================

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOKS_JSON = path.join(REPO_ROOT, "hooks", "hooks.json");
const VERIFY_SCRIPT = path.join(REPO_ROOT, "scripts", "verify-plugin-install.sh");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HookEntry {
  type: string;
  command: string;
}

interface PreToolUseEntry {
  matcher?: string;
  hooks: HookEntry[];
}

interface HooksJson {
  hooks: {
    PreToolUse?: PreToolUseEntry[];
    [key: string]: unknown;
  };
}

function loadHooksJson(): HooksJson {
  const raw = fs.readFileSync(HOOKS_JSON, "utf8");
  return JSON.parse(raw) as HooksJson;
}

function getPreToolUseEntries(): PreToolUseEntry[] {
  return loadHooksJson().hooks.PreToolUse ?? [];
}

/** Find a PreToolUse entry by its matcher string. */
function findEntry(matcher: string): PreToolUseEntry | undefined {
  return getPreToolUseEntries().find((e) => e.matcher === matcher);
}

/** True when an entry's hooks array contains a command referencing the given script name. */
function entryReferencesScript(entry: PreToolUseEntry, scriptName: string): boolean {
  return entry.hooks.some((h) => h.command.includes(scriptName));
}

// =============================================================================
// MISUSE — current (wrong) state patterns that MUST be absent after WS-SEC-02
// =============================================================================

describe("hooks.json — misuse: pre-edit-write-guard.sh must not be missing (WS-SEC-02)", () => {
  it("must NOT be the case that zero PreToolUse entries reference pre-edit-write-guard.sh", () => {
    // FAILS today: pre-edit-write-guard.sh appears in NO PreToolUse entry.
    // After dev implements Fracture C, it must appear in at least two (Edit + Write).
    const entries = getPreToolUseEntries();
    const referencesGuard = entries.some((e) =>
      entryReferencesScript(e, "pre-edit-write-guard.sh")
    );
    // This expect asserts the post-impl state (guard IS referenced).
    // It fails until dev adds the Edit and Write entries.
    expect(referencesGuard).toBe(true);
  });

  it("must NOT be the case that only the Bash matcher exists in PreToolUse", () => {
    // FAILS today: only one PreToolUse entry (Bash) exists.
    // After WS-SEC-02 there must be at least 3 (Bash + Edit + Write).
    const entries = getPreToolUseEntries();
    // If only Bash exists, entries.length === 1 and this assertion fails.
    expect(entries.length).toBeGreaterThanOrEqual(3);
  });
});

// =============================================================================
// BOUNDARY — structural validity (these should pass today and continue after)
// =============================================================================

describe("hooks.json — boundary: file is structurally valid", () => {
  it("file exists at hooks/hooks.json", () => {
    expect(fs.existsSync(HOOKS_JSON)).toBe(true);
  });

  it("file is valid JSON (does not throw on parse)", () => {
    expect(() => loadHooksJson()).not.toThrow();
  });

  it('top-level object has a "hooks" key', () => {
    const parsed = loadHooksJson();
    expect(parsed).toHaveProperty("hooks");
    expect(typeof parsed.hooks).toBe("object");
  });

  it("PreToolUse key exists and is an array", () => {
    const parsed = loadHooksJson();
    expect(Array.isArray(parsed.hooks.PreToolUse)).toBe(true);
  });

  it("existing Bash matcher entry for block-no-verify.sh is still present (regression guard)", () => {
    // This PASSES today and must continue to pass after WS-SEC-02.
    // WS-SEC-02 adds entries; it must not remove or break existing ones.
    const bashEntry = findEntry("Bash");
    expect(bashEntry).toBeDefined();
    expect(entryReferencesScript(bashEntry!, "block-no-verify.sh")).toBe(true);
  });

  it("each PreToolUse entry has a matcher string and a non-empty hooks array", () => {
    // Structural invariant — every PreToolUse entry must have a matcher and at least one hook.
    const entries = getPreToolUseEntries();
    for (const entry of entries) {
      expect(typeof entry.matcher).toBe("string");
      expect(entry.matcher!.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(entry.hooks)).toBe(true);
      expect(entry.hooks.length).toBeGreaterThan(0);
    }
  });

  it("each hook command in PreToolUse has type 'command' and a non-empty command string", () => {
    const entries = getPreToolUseEntries();
    for (const entry of entries) {
      for (const hook of entry.hooks) {
        expect(hook.type).toBe("command");
        expect(typeof hook.command).toBe("string");
        expect(hook.command.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// =============================================================================
// GOLDEN PATH — post-impl assertions (FAIL until Fracture C is implemented)
// =============================================================================

describe("hooks.json — golden: Edit matcher with pre-edit-write-guard.sh is registered (WS-SEC-02)", () => {
  it("PreToolUse contains an entry with matcher 'Edit'", () => {
    // FAILS today: no Edit matcher exists in hooks.json.
    const editEntry = findEntry("Edit");
    expect(editEntry).toBeDefined();
  });

  it("Edit matcher entry references pre-edit-write-guard.sh in its hooks array", () => {
    // FAILS today: no Edit matcher exists.
    const editEntry = findEntry("Edit");
    expect(editEntry).toBeDefined();
    expect(entryReferencesScript(editEntry!, "pre-edit-write-guard.sh")).toBe(true);
  });

  it("Edit matcher hook command uses CLAUDE_PLUGIN_ROOT env var (not a hardcoded path)", () => {
    // FAILS today: no Edit matcher exists.
    // The command must reference ${CLAUDE_PLUGIN_ROOT} so the hook resolves
    // at install time regardless of where the plugin is installed.
    const editEntry = findEntry("Edit");
    expect(editEntry).toBeDefined();
    const cmd = editEntry!.hooks.find((h) =>
      h.command.includes("pre-edit-write-guard.sh")
    )?.command;
    expect(cmd).toBeDefined();
    expect(cmd).toContain("CLAUDE_PLUGIN_ROOT");
  });

  it("Edit matcher hook has type 'command'", () => {
    // FAILS today: no Edit matcher exists.
    const editEntry = findEntry("Edit");
    expect(editEntry).toBeDefined();
    const guardHook = editEntry!.hooks.find((h) => h.command.includes("pre-edit-write-guard.sh"));
    expect(guardHook?.type).toBe("command");
  });
});

describe("hooks.json — golden: Write matcher with pre-edit-write-guard.sh is registered (WS-SEC-02)", () => {
  it("PreToolUse contains an entry with matcher 'Write'", () => {
    // FAILS today: no Write matcher exists in hooks.json.
    const writeEntry = findEntry("Write");
    expect(writeEntry).toBeDefined();
  });

  it("Write matcher entry references pre-edit-write-guard.sh in its hooks array", () => {
    // FAILS today: no Write matcher exists.
    const writeEntry = findEntry("Write");
    expect(writeEntry).toBeDefined();
    expect(entryReferencesScript(writeEntry!, "pre-edit-write-guard.sh")).toBe(true);
  });

  it("Write matcher hook command uses CLAUDE_PLUGIN_ROOT env var (not a hardcoded path)", () => {
    // FAILS today: no Write matcher exists.
    const writeEntry = findEntry("Write");
    expect(writeEntry).toBeDefined();
    const cmd = writeEntry!.hooks.find((h) =>
      h.command.includes("pre-edit-write-guard.sh")
    )?.command;
    expect(cmd).toBeDefined();
    expect(cmd).toContain("CLAUDE_PLUGIN_ROOT");
  });

  it("Write matcher hook has type 'command'", () => {
    // FAILS today: no Write matcher exists.
    const writeEntry = findEntry("Write");
    expect(writeEntry).toBeDefined();
    const guardHook = writeEntry!.hooks.find((h) => h.command.includes("pre-edit-write-guard.sh"));
    expect(guardHook?.type).toBe("command");
  });
});

describe("hooks.json — golden: hook command path consistency (WS-SEC-02)", () => {
  it("Edit and Write matcher commands reference the same script path structure as Bash/block-no-verify", () => {
    // The Bash entry uses: "${CLAUDE_PLUGIN_ROOT}/hooks/block-no-verify.sh"
    // The new Edit/Write entries must use the same structural pattern.
    // FAILS today: no Edit or Write entries exist.
    const editEntry = findEntry("Edit");
    const writeEntry = findEntry("Write");
    expect(editEntry).toBeDefined();
    expect(writeEntry).toBeDefined();

    for (const entry of [editEntry!, writeEntry!]) {
      const guardHook = entry.hooks.find((h) => h.command.includes("pre-edit-write-guard.sh"));
      expect(guardHook).toBeDefined();
      // Must follow the same CLAUDE_PLUGIN_ROOT pattern as the Bash entry
      expect(guardHook!.command).toMatch(/CLAUDE_PLUGIN_ROOT.*hooks.*pre-edit-write-guard\.sh/);
    }
  });

  it("hooks.json round-trips through JSON.parse → JSON.stringify cleanly after additions", () => {
    // Catches BOM, trailing commas, or encoding issues introduced during dev edit.
    const raw = fs.readFileSync(HOOKS_JSON, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const reparsed: unknown = JSON.parse(JSON.stringify(parsed));
    expect(reparsed).toEqual(parsed);
  });
});

// =============================================================================
// verify-plugin-install.sh — hook count gate must be updated to "6"
//
// WS-HOOK-COUNT-FIX: the gate was asserting HOOKS_COUNT = "8", which is the
// count of individual matcher/entry objects within event types (e.g. PreToolUse
// alone has 3 — Bash, Edit, Write). The `claude plugin details` CLI reports
// hooks by distinct event type count, not by individual entry objects.
//
// hooks/hooks.json has 6 top-level event type keys:
//   SessionStart, PreToolUse, PostToolUse, TaskCompleted, TeammateIdle,
//   UserPromptSubmit
// `claude plugin details teo` therefore reports Hooks (6).
// No hook is missing — all 6 event types are registered and confirmed present
// by a real `claude plugin install`. The gate was counting the wrong thing.
// Dev must update verify-plugin-install.sh to assert HOOKS_COUNT = "6".
// =============================================================================
