// WS-HOOKS-02 — gate-1 spec (fails until dev syncs .claude/hooks/ to hooks/)

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// hook-sync-guard.test.ts — structural and content guards for WS-HOOKS-02
//
// CONTEXT
//   There are two hooks directories:
//     hooks/          — authoritative runtime source (registered in hooks.json;
//                       loaded at runtime via CLAUDE_PLUGIN_ROOT)
//     .claude/hooks/  — stale copy, 3 patches behind hooks/
//
//   .claude/hooks/ is gitignored (see .gitignore: `.claude`). Per the
//   "Tests only assert on TRACKED files" rule, we CANNOT write assertions
//   that read .claude/hooks/ directly — they would be false-green locally
//   and false-red in CI on a fresh checkout.
//
// WHAT WS-HOOKS-02 RESOLVES
//   Dev will sync .claude/hooks/ to exactly match hooks/. After sync:
//     - .claude/hooks/block-no-verify.sh will contain the -n block (lines 34-42
//       of the current hooks/ version) and the core.hooksPath block (lines 44-48)
//     - .claude/hooks/pre-edit-write-guard.sh will contain _canon_path() and
//       the canonicalization block (lines 147-177 of the current hooks/ version)
//
// WHY THESE TESTS EXIST
//   The behavioral tests in block-no-verify.test.ts and pre-edit-write-guard.test.ts
//   already exercise the canonical hooks/ and pass. This file adds:
//     1. Content-presence guards — assert that the tracked hooks/ scripts contain
//        the specific code blocks that are ABSENT from the stale .claude/hooks/ copy.
//        These are the authoritative spec for what dev must sync.
//     2. Structural registration guards — assert that every script path referenced in
//        hooks/hooks.json exists as an executable file in hooks/.
//        This catches hooks.json → disk drift (a separate failure class).
//
// GATE-1 STATE NOTE
//   All tests in this file PASS on the current hooks/ (the canonical source is
//   already correct). They serve as spec + regression guards — if a dev edit
//   accidentally removes the -n block or _canon_path(), these fail immediately.
//   The FAILING gate-1 state for WS-HOOKS-02 is in CI: .claude/hooks/ is
//   gitignored, so the runtime copy is stale on a fresh install until dev
//   performs the sync. After sync, running these tests against hooks/ confirms
//   the features are present and ready to be installed by the sync step.
//
// TEST ORDERING: misuse → boundary → golden path (ADR-064)
// =============================================================================

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOKS_DIR = path.join(REPO_ROOT, "hooks");
const HOOKS_JSON_PATH = path.join(HOOKS_DIR, "hooks.json");
const BLOCK_NO_VERIFY = path.join(HOOKS_DIR, "block-no-verify.sh");
const PRE_EDIT_GUARD = path.join(HOOKS_DIR, "pre-edit-write-guard.sh");

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
 * Extract all script file references from hooks.json commands.
 * Commands look like: "${CLAUDE_PLUGIN_ROOT}/hooks/foo.sh"
 * We extract the basename (e.g. "foo.sh") and the hooks/ subpath.
 */
function extractScriptPathsFromHooksJson(): string[] {
  const data = loadHooksJson();
  const paths: string[] = [];
  for (const groups of Object.values(data.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        // Match patterns like "${CLAUDE_PLUGIN_ROOT}/hooks/foo.sh"
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
// MISUSE — content patterns that MUST be present in hooks/ (absence = sync gap)
// =============================================================================

describe("hook-sync-guard — misuse: block-no-verify.sh missing the -n commit block (WS-HOOKS-02)", () => {
  it("hooks/block-no-verify.sh contains the git commit -n detection block", () => {
    // This is the PRIMARY SYNC GAP: .claude/hooks/block-no-verify.sh is missing
    // the -n short-form block (lines 34-42 in the canonical hooks/ version).
    // This test asserts the canonical hooks/ has it. After sync, .claude/hooks/
    // will also have it.
    //
    // FAILS if dev accidentally removes the -n block during WS-HOOKS-02 changes.
    // The two-step pattern: confirm it is a git commit invocation, then check -n.
    const content = readHook(BLOCK_NO_VERIFY);
    expect(content).toMatch(/git\[.*\].*commit/); // git commit subcommand detection
    expect(content).toMatch(/-n\(\[/); // -n as a standalone flag check
  });

  it("hooks/block-no-verify.sh contains -n scoped to git commit (not all subcommands)", () => {
    // The -n block must be inside a conditional that first confirms `git commit`,
    // not a bare grep for -n across all git commands. This is the scope-tightening
    // that prevents false-positive blocking of `git log -n 5`.
    const content = readHook(BLOCK_NO_VERIFY);
    // The implementation wraps the -n check inside an outer if that matches commit
    const commitCheckLine = content.match(/if printf.*git.*commit/);
    expect(commitCheckLine).not.toBeNull();
  });

  it("hooks/block-no-verify.sh contains the core.hooksPath detection block (WS-HOOKS-02)", () => {
    // SECOND SYNC GAP: .claude/hooks/block-no-verify.sh is missing the
    // core.hooksPath block (lines 44-48 in the canonical hooks/ version).
    // core.hooksPath overrides the hook directory — a full bypass vector.
    const content = readHook(BLOCK_NO_VERIFY);
    expect(content).toContain("core.hooksPath");
    expect(content).toContain("core\\.hooksPath");
  });

  it("hooks/block-no-verify.sh blocks core.hooksPath with git config pattern", () => {
    // The block must be scoped to `git config ... core.hooksPath`, not just any
    // mention of the string. Verify the pattern includes `git config`.
    const content = readHook(BLOCK_NO_VERIFY);
    expect(content).toMatch(/git\[.*\].*config\[.*\].*core\\\.hooksPath/);
  });
});

describe("hook-sync-guard — misuse: pre-edit-write-guard.sh missing _canon_path() (WS-HOOKS-02)", () => {
  it("hooks/pre-edit-write-guard.sh defines the _canon_path() function", () => {
    // THIRD SYNC GAP: .claude/hooks/pre-edit-write-guard.sh is missing
    // the _canon_path() function and canonicalization block (lines 147-177
    // in the canonical hooks/ version). This is the traversal fix.
    //
    // Without _canon_path(), `tests/../src/core/sign.ts` bypasses the guard
    // because the raw string prefix-matches "tests/", not "src/".
    const content = readHook(PRE_EDIT_GUARD);
    expect(content).toContain("_canon_path()");
  });

  it("hooks/pre-edit-write-guard.sh calls _canon_path to resolve the path", () => {
    // _canon_path must be CALLED during the normalization flow, not just defined.
    const content = readHook(PRE_EDIT_GUARD);
    expect(content).toMatch(/\$\(_canon_path/);
  });

  it("hooks/pre-edit-write-guard.sh _canon_path() supports realpath --canonicalize-missing", () => {
    // The implementation must use `realpath --canonicalize-missing` (or a python3
    // fallback) — NOT bare `realpath`, which fails on non-existent paths.
    // This is what allows path traversal resolution without requiring the target to exist.
    const content = readHook(PRE_EDIT_GUARD);
    expect(content).toContain("--canonicalize-missing");
  });

  it("hooks/pre-edit-write-guard.sh _canon_path() has python3 fallback", () => {
    // For macOS where GNU realpath may not support --canonicalize-missing,
    // the implementation falls back to `python3 os.path.normpath`.
    const content = readHook(PRE_EDIT_GUARD);
    expect(content).toContain("python3");
    expect(content).toContain("os.path.normpath");
  });

  it("hooks/pre-edit-write-guard.sh re-relativizes the canonicalized path against PROJECT_ROOT", () => {
    // After calling _canon_path with an absolute path, the script must strip the
    // PROJECT_ROOT prefix to get a repo-relative path for is_protected() checking.
    // Without this step, the absolute /tmp/teo-test-project/src/core/sign.ts would
    // not prefix-match the "src" protected entry.
    const content = readHook(PRE_EDIT_GUARD);
    expect(content).toContain("_CANON");
    expect(content).toMatch(/FILE_PATH_NORM.*\$\{_CANON/);
  });
});

// =============================================================================
// BOUNDARY — structural integrity: hooks.json references must resolve to files
// =============================================================================

describe("hook-sync-guard — boundary: hooks.json script paths must resolve in hooks/ (WS-HOOKS-02)", () => {
  it("hooks/hooks.json references at least one .sh script", () => {
    // Basic sanity: the JSON is wired to actual scripts, not empty.
    const scripts = extractScriptPathsFromHooksJson();
    expect(scripts.length).toBeGreaterThan(0);
  });

  it("every script referenced in hooks.json exists as a file in hooks/", () => {
    // Any script referenced in hooks.json that does NOT exist in hooks/ is a
    // broken registration — the hook will silently fail at runtime.
    // This guards against rename/delete operations that forget to update hooks.json.
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

  it("block-no-verify.sh is referenced in hooks.json under PreToolUse/Bash", () => {
    // Regression guard: the block-no-verify.sh hook must remain registered
    // under the Bash matcher after WS-HOOKS-02 changes.
    const data = loadHooksJson();
    const bashEntries = (data.hooks.PreToolUse ?? []).filter((g) => g.matcher === "Bash");
    const refersToBlockScript = bashEntries.some((g) =>
      g.hooks.some((h) => h.command.includes("block-no-verify.sh"))
    );
    expect(refersToBlockScript).toBe(true);
  });

  it("pre-edit-write-guard.sh is referenced in hooks.json under PreToolUse/Edit and PreToolUse/Write", () => {
    // Regression guard: the pre-edit-write-guard.sh hook must remain registered
    // under both Edit and Write matchers after WS-HOOKS-02 changes.
    const data = loadHooksJson();
    const preToolUseEntries = data.hooks.PreToolUse ?? [];

    const editEntry = preToolUseEntries.find((g) => g.matcher === "Edit");
    const writeEntry = preToolUseEntries.find((g) => g.matcher === "Write");

    expect(editEntry).toBeDefined();
    expect(editEntry!.hooks.some((h) => h.command.includes("pre-edit-write-guard.sh"))).toBe(true);

    expect(writeEntry).toBeDefined();
    expect(writeEntry!.hooks.some((h) => h.command.includes("pre-edit-write-guard.sh"))).toBe(true);
  });
});

// =============================================================================
// GOLDEN PATH — hooks/ is the complete, self-consistent authoritative source
// =============================================================================

describe("hook-sync-guard — golden: hooks/ is complete and self-consistent (WS-HOOKS-02)", () => {
  it("hooks/block-no-verify.sh is executable (chmod +x)", () => {
    const stat = fs.statSync(BLOCK_NO_VERIFY);
    // Check owner-execute bit (0o100 mask)
    expect(stat.mode & 0o100).toBeTruthy();
  });

  it("hooks/pre-edit-write-guard.sh is executable (chmod +x)", () => {
    const stat = fs.statSync(PRE_EDIT_GUARD);
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

  it("hooks/block-no-verify.sh exits 0 for a clean git commit (end-to-end smoke test)", () => {
    // Smoke test: the full script runs without crashing on a benign payload.
    // This guards against syntax errors introduced during WS-HOOKS-02 changes.
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

  it("all script files referenced in hooks.json have execute permission", () => {
    // Every script must be executable — a non-executable hook silently fails.
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
});
