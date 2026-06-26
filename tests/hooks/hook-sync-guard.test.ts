// WS-STARTUP-CLEANUP — passing (post-impl, CAD gate 1 spec)

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// hook-sync-guard.test.ts — structural and content guards for WS-STARTUP-CLEANUP
//
// CONTEXT
//   There are two hooks directories:
//     hooks/          — authoritative runtime source (registered in hooks.json;
//                       loaded at runtime via CLAUDE_PLUGIN_ROOT)
//     .claude/hooks/  — gitignored local copy; tests NEVER assert on it
//                       (see "Tests only assert on TRACKED files" rule)
//
// WHAT WS-STARTUP-CLEANUP RESOLVES
//   Five stub/stale hook files are deleted from hooks/:
//     - post-tool-use.sh      (exit 0 stub)
//     - task-completed.sh     (exit 0 stub)
//     - teammate-idle.sh      (exit 0 stub)
//     - teo-session-start-meta.sh (exit 0 stub)
//     - session-start.sh      (stale: emits TEO branding, checks agents/capo.md
//                              which never exists in dev repo; superseded by
//                              teo-statusline.sh for status bar output)
//   hooks/hooks.json is updated to remove references to all five files.
//   hooks/ retains: block-no-verify.sh, capo-activation.sh,
//                   pre-edit-write-guard.sh, teo-post-spawn-citation-check.sh,
//                   teo-prompt-router.sh
//
// WHY THESE TESTS EXIST
//   1. Absence guards — assert that the 5 deleted scripts no longer exist in
//      hooks/ and are not referenced in hooks.json. Guards against dev
//      forgetting to delete from one place but not the other.
//   2. Registration consistency — every script referenced in hooks.json must
//      exist in hooks/ AND every expected script in hooks/ must be registered.
//      Catches hooks.json → disk drift in either direction.
//   3. Regression guards for surviving hooks — block-no-verify.sh and
//      pre-edit-write-guard.sh must remain present, executable, and registered.
//
// TEST ORDERING: misuse → boundary → golden path (ADR-064)
// =============================================================================

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOKS_DIR = path.join(REPO_ROOT, "src", "plugin", "hooks");
const HOOKS_JSON_PATH = path.join(HOOKS_DIR, "hooks.json");
const BLOCK_NO_VERIFY = path.join(HOOKS_DIR, "block-no-verify.sh");
const PRE_EDIT_GUARD = path.join(HOOKS_DIR, "pre-edit-write-guard.sh");
const CAPO_ACTIVATION = path.join(HOOKS_DIR, "capo-activation.sh");
const PROMPT_ROUTER = path.join(HOOKS_DIR, "teo-prompt-router.sh");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readHook(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

interface HookEntry {
  type: string;
  command: string;
}

interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

interface HooksJsonShape {
  hooks: Record<string, HookGroup[]>;
}

function loadHooksJson(): HooksJsonShape {
  return JSON.parse(fs.readFileSync(HOOKS_JSON_PATH, "utf8")) as HooksJsonShape;
}

/**
 * Extract all script basenames referenced by hooks.json commands.
 * Commands look like: "${CLAUDE_PLUGIN_ROOT}/hooks/foo.sh"
 */
function extractScriptPathsFromHooksJson(): string[] {
  const data = loadHooksJson();
  const paths: string[] = [];
  for (const groups of Object.values(data.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        const match = hook.command.match(/\/hooks\/([^"'\s]+\.sh)/);
        if (match) {
          paths.push(match[1]);
        }
      }
    }
  }
  return [...new Set(paths)];
}

// =============================================================================
// MISUSE — patterns that must NOT exist in hooks/ after WS-STARTUP-CLEANUP
// =============================================================================

describe("hook-sync-guard — misuse: deleted stub files must not remain in hooks/ (WS-STARTUP-CLEANUP)", () => {
  it("hooks/post-tool-use.sh must not exist (exit 0 stub removed)", () => {
    // post-impl: hooks/post-tool-use.sh was deleted (exit 0 stub removed). Confirmed absent.
    expect(fs.existsSync(path.join(HOOKS_DIR, "post-tool-use.sh"))).toBe(false);
  });

  it("hooks/task-completed.sh must not exist (exit 0 stub removed)", () => {
    // post-impl: hooks/task-completed.sh was deleted (exit 0 stub removed). Confirmed absent.
    expect(fs.existsSync(path.join(HOOKS_DIR, "task-completed.sh"))).toBe(false);
  });

  it("hooks/teammate-idle.sh must not exist (exit 0 stub removed)", () => {
    // post-impl: hooks/teammate-idle.sh was deleted (exit 0 stub removed). Confirmed absent.
    expect(fs.existsSync(path.join(HOOKS_DIR, "teammate-idle.sh"))).toBe(false);
  });

  it("hooks/teo-session-start-meta.sh must not exist (exit 0 stub removed)", () => {
    // post-impl: hooks/teo-session-start-meta.sh was deleted (exit 0 stub removed). Confirmed absent.
    expect(fs.existsSync(path.join(HOOKS_DIR, "teo-session-start-meta.sh"))).toBe(false);
  });

  it("hooks/session-start.sh must not exist (stale file removed)", () => {
    // post-impl: hooks/session-start.sh was deleted (stale file removed).
    // It emitted "TEO v${TEO_VERSION}" (wrong brand) and checked agents/capo.md
    // (never present in dev repo). teo-statusline.sh supersedes it. Confirmed absent.
    expect(fs.existsSync(path.join(HOOKS_DIR, "session-start.sh"))).toBe(false);
  });
});

describe("hook-sync-guard — misuse: deleted scripts must not be referenced in hooks.json (WS-STARTUP-CLEANUP)", () => {
  it("hooks.json must not reference post-tool-use.sh", () => {
    // post-impl: PostToolUse event type and post-tool-use.sh reference removed from hooks.json. Confirmed absent.
    const scripts = extractScriptPathsFromHooksJson();
    expect(scripts).not.toContain("post-tool-use.sh");
  });

  it("hooks.json must not reference task-completed.sh", () => {
    // post-impl: TaskCompleted event type and task-completed.sh reference removed from hooks.json. Confirmed absent.
    const scripts = extractScriptPathsFromHooksJson();
    expect(scripts).not.toContain("task-completed.sh");
  });

  it("hooks.json must not reference teammate-idle.sh", () => {
    // post-impl: TeammateIdle event type and teammate-idle.sh reference removed from hooks.json. Confirmed absent.
    const scripts = extractScriptPathsFromHooksJson();
    expect(scripts).not.toContain("teammate-idle.sh");
  });

  it("hooks.json must not reference teo-session-start-meta.sh", () => {
    // post-impl: teo-session-start-meta.sh reference removed from SessionStart in hooks.json. Confirmed absent.
    const scripts = extractScriptPathsFromHooksJson();
    expect(scripts).not.toContain("teo-session-start-meta.sh");
  });

  it("hooks.json must not reference session-start.sh", () => {
    // post-impl: session-start.sh reference removed from SessionStart in hooks.json. Confirmed absent.
    const scripts = extractScriptPathsFromHooksJson();
    expect(scripts).not.toContain("session-start.sh");
  });
});

// =============================================================================
// BOUNDARY — structural integrity: hooks.json references must resolve to files
// =============================================================================

describe("hook-sync-guard — boundary: hooks.json script paths must resolve in hooks/ (WS-STARTUP-CLEANUP)", () => {
  it("hooks/hooks.json references at least one .sh script", () => {
    const scripts = extractScriptPathsFromHooksJson();
    expect(scripts.length).toBeGreaterThan(0);
  });

  it("every script referenced in hooks.json exists as a file in hooks/", () => {
    // Any script referenced in hooks.json that does NOT exist in hooks/ is a
    // broken registration — the hook will silently fail at runtime.
    const scripts = extractScriptPathsFromHooksJson();
    const missing: string[] = [];
    for (const scriptName of scripts) {
      const diskPath = path.join(HOOKS_DIR, scriptName);
      if (!fs.existsSync(diskPath)) {
        missing.push(scriptName);
      }
    }
    expect(missing).toEqual([]);
  });

  it("block-no-verify.sh is referenced in hooks.json under PreToolUse/Bash (regression guard)", () => {
    const data = loadHooksJson();
    const bashEntries = (data.hooks.PreToolUse ?? []).filter((g) => g.matcher === "Bash");
    const refersToBlockScript = bashEntries.some((g) =>
      g.hooks.some((h) => h.command.includes("block-no-verify.sh"))
    );
    expect(refersToBlockScript).toBe(true);
  });

  it("pre-edit-write-guard.sh is referenced in hooks.json under PreToolUse/Edit and PreToolUse/Write (regression guard)", () => {
    const data = loadHooksJson();
    const preToolUseEntries = data.hooks.PreToolUse ?? [];

    const editEntry = preToolUseEntries.find((g) => g.matcher === "Edit");
    const writeEntry = preToolUseEntries.find((g) => g.matcher === "Write");

    expect(editEntry).toBeDefined();
    expect(editEntry!.hooks.some((h) => h.command.includes("pre-edit-write-guard.sh"))).toBe(true);

    expect(writeEntry).toBeDefined();
    expect(writeEntry!.hooks.some((h) => h.command.includes("pre-edit-write-guard.sh"))).toBe(true);
  });

  it("capo-activation.sh is referenced in hooks.json under SessionStart (regression guard)", () => {
    // post-impl: SessionStart has exactly 1 command (capo-activation.sh) after the other 2
    // stubs were removed. Confirmed capo-activation.sh is still present and registered.

    const data = loadHooksJson();
    const ssGroups = data.hooks["SessionStart"] ?? [];
    const refs = ssGroups.flatMap((g) => g.hooks.map((h) => h.command));
    expect(refs.some((cmd) => cmd.includes("capo-activation.sh"))).toBe(true);
  });

  it("teo-prompt-router.sh is referenced in hooks.json under UserPromptSubmit (regression guard)", () => {
    const data = loadHooksJson();
    const groups = data.hooks["UserPromptSubmit"] ?? [];
    const refs = groups.flatMap((g) => g.hooks.map((h) => h.command));
    expect(refs.some((cmd) => cmd.includes("teo-prompt-router.sh"))).toBe(true);
  });
});

// =============================================================================
// GOLDEN PATH — hooks/ is complete and self-consistent after cleanup
// =============================================================================

describe("hook-sync-guard — golden: surviving hooks exist and are executable (WS-STARTUP-CLEANUP)", () => {
  it("hooks/block-no-verify.sh exists", () => {
    expect(fs.existsSync(BLOCK_NO_VERIFY)).toBe(true);
  });

  it("hooks/pre-edit-write-guard.sh exists", () => {
    expect(fs.existsSync(PRE_EDIT_GUARD)).toBe(true);
  });

  it("hooks/capo-activation.sh exists", () => {
    expect(fs.existsSync(CAPO_ACTIVATION)).toBe(true);
  });

  it("hooks/teo-prompt-router.sh exists", () => {
    expect(fs.existsSync(PROMPT_ROUTER)).toBe(true);
  });

  it("hooks/block-no-verify.sh is executable (chmod +x)", () => {
    const stat = fs.statSync(BLOCK_NO_VERIFY);
    expect(stat.mode & 0o100).toBeTruthy();
  });

  it("hooks/pre-edit-write-guard.sh is executable (chmod +x)", () => {
    const stat = fs.statSync(PRE_EDIT_GUARD);
    expect(stat.mode & 0o100).toBeTruthy();
  });

  it("hooks/capo-activation.sh is executable (chmod +x)", () => {
    const stat = fs.statSync(CAPO_ACTIVATION);
    expect(stat.mode & 0o100).toBeTruthy();
  });

  it("hooks/teo-prompt-router.sh is executable (chmod +x)", () => {
    const stat = fs.statSync(PROMPT_ROUTER);
    expect(stat.mode & 0o100).toBeTruthy();
  });

  it("hooks/block-no-verify.sh has shebang #!/usr/bin/env bash", () => {
    const content = readHook(BLOCK_NO_VERIFY);
    expect(content.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("hooks/pre-edit-write-guard.sh has shebang #!/usr/bin/env bash", () => {
    const content = readHook(PRE_EDIT_GUARD);
    expect(content.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("all scripts referenced in hooks.json have execute permission", () => {
    const scripts = extractScriptPathsFromHooksJson();
    const nonExecutable: string[] = [];
    for (const scriptName of scripts) {
      const diskPath = path.join(HOOKS_DIR, scriptName);
      if (!fs.existsSync(diskPath)) continue; // covered by the missing-file test
      const stat = fs.statSync(diskPath);
      if (!(stat.mode & 0o100)) {
        nonExecutable.push(scriptName);
      }
    }
    expect(nonExecutable).toEqual([]);
  });

  it("hooks/block-no-verify.sh exits 0 for a clean git commit (end-to-end smoke test)", () => {
    // Smoke test: the full script runs without crashing on a benign payload.
    // Guards against syntax errors introduced during cleanup changes.
    const payload = JSON.stringify({ tool_input: { command: "git commit -m 'fix: test'" } });
    const escaped = payload.replace(/'/g, "'\\''");
    let exitCode = 0;
    try {
      execSync(`echo '${escaped}' | bash "${BLOCK_NO_VERIFY}"`, {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      exitCode = (err as { status?: number }).status ?? 1;
    }
    expect(exitCode).toBe(0);
  });
});

describe("hook-sync-guard — golden: hooks/ has exactly the expected set of hook files (WS-STARTUP-CLEANUP)", () => {
  const EXPECTED_HOOK_FILES = new Set([
    "block-no-verify.sh",
    "capo-activation.sh",
    "hooks.json",
    "pre-edit-write-guard.sh",
    "teo-post-spawn-citation-check.sh",
    "teo-prompt-router.sh",
  ]);

  it("hooks/ contains no unexpected .sh files (no stale stubs)", () => {
    // post-impl: 5 stub/stale .sh files have been removed from hooks/.
    // hooks/ now contains exactly the 5 expected .sh files listed above.
    const files = fs.readdirSync(HOOKS_DIR).filter((f) => f.endsWith(".sh"));
    const unexpected = files.filter((f) => !EXPECTED_HOOK_FILES.has(f));
    expect(unexpected).toEqual([]);
  });

  it("hooks/ contains all expected .sh files (none accidentally deleted)", () => {
    const files = new Set(fs.readdirSync(HOOKS_DIR));
    const missing = [...EXPECTED_HOOK_FILES]
      .filter((f) => f.endsWith(".sh"))
      .filter((f) => !files.has(f));
    expect(missing).toEqual([]);
  });
});
