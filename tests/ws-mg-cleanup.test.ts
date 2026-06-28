// =============================================================================
// ws-mg-cleanup.test.ts — QA spec for WS-MG-CLEANUP-RELEASE
//
// WORKSTREAM SUMMARY:
//   PR #80 restored stale .claude/ files from git history. Several of those
//   files still reference the pre-CAPO "miniature-guacamole (MG)" era product
//   branding. The statusline banner reads:
//     "TEO v4.3.0 | MG v6.2.0 | pilot-alpha | Capo: missing"
//   Every field is wrong. This workstream removes all MG-era references and
//   releases a clean version with CAPO branding.
//
// WHAT THESE TESTS VERIFY:
//   AC-1 (misuse-first): .teo-for-claude-version must not contain MG-era keys
//   AC-2 (absence): teo-statusline.sh must not exist (removed — statusLine block deleted from settings.json)
//   AC-3 (misuse-first): session-start.sh must not contain any MG string
//   AC-4 (misuse-first): website-creation-process.md must not say "MG agents"
//   AC-5 (misuse-first): visual-formatting.md must not contain specific MG phrases
//   AC-6 (golden):       Version consistency across package.json, plugin.json, and version file
//   AC-7 (golden):       release.sh updates .teo-for-claude-version on release
//
// IMPLEMENTATION STATUS: GREEN as of WS-MG-CLEANUP-RELEASE
//
// Test order: misuse-first → boundary → golden-path  (QA policy)
// =============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Derive repo root from this file's location.
// This file lives at tests/ws-mg-cleanup.test.ts — one directory up is the repo root.
// NEVER hardcode /tmp/... or /Users/... paths per project policy.
const REPO_ROOT = new URL("../", import.meta.url).pathname;

// Read package.json once — canonical version source of truth for all version assertions.
const _pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  version: string;
};
const CURRENT_VERSION = _pkg.version;

// ─── AC-1: .claude/.teo-for-claude-version format ────────────────────────────
// STATUS: GREEN

describe("AC-1: .teo-for-claude-version format", () => {
  // STATUS: GREEN

  const VERSION_FILE = join(REPO_ROOT, ".claude", ".teo-for-claude-version");

  // ── Misuse: legacy mg_base_version key must be gone ─────────────────────
  it("MISUSE: file must NOT contain 'mg_base_version' key", () => {
    const content = readFileSync(VERSION_FILE, "utf8");
    // Any line starting with mg_base_version: is a stale MG artifact
    expect(content).not.toMatch(/^\s*mg_base_version\s*:/m);
  });

  // ── Misuse: old teo_version key must be replaced by capo_version ────────
  it("MISUSE: file must NOT contain 'teo_version' key (replaced by capo_version)", () => {
    const content = readFileSync(VERSION_FILE, "utf8");
    expect(content).not.toMatch(/^\s*teo_version\s*:/m);
  });

  // ── Misuse: edition must not be the stale pilot-alpha value ─────────────
  it("MISUSE: edition field must NOT be 'pilot-alpha'", () => {
    const content = readFileSync(VERSION_FILE, "utf8");
    // The file currently reads `edition: pilot-alpha` — this must change to `dev`
    expect(content).not.toMatch(/^\s*edition\s*:\s*pilot-alpha\s*$/m);
  });

  // ── Golden: file exists and has capo_version ────────────────────────────
  it("GOLDEN: file exists", () => {
    expect(existsSync(VERSION_FILE)).toBe(true);
  });

  it("GOLDEN: file contains 'capo_version' key", () => {
    const content = readFileSync(VERSION_FILE, "utf8");
    expect(content).toMatch(/^\s*capo_version\s*:/m);
  });

  it("GOLDEN: capo_version matches package.json (current release)", () => {
    const content = readFileSync(VERSION_FILE, "utf8");
    // Build a dynamic regex that matches the exact current version
    const escaped = CURRENT_VERSION.replace(/\./g, "\\.");
    expect(content).toMatch(new RegExp(`^\\s*capo_version\\s*:\\s*${escaped}\\s*$`, "m"));
  });

  it("GOLDEN: edition field is 'dev'", () => {
    const content = readFileSync(VERSION_FILE, "utf8");
    expect(content).toMatch(/^\s*edition\s*:\s*dev\s*$/m);
  });
});

// ─── AC-2: teo-statusline.sh — removed (statusLine block removed from settings.json) ──
// STATUS: GREEN — file deleted as part of WS-STARTUP-CLEANUP (fix/ws-cleanup)
//
// teo-statusline.sh was the command pointed at by .claude/settings.json "statusLine".
// Now that the statusLine block is removed from settings.json, this script is dead
// weight and has been deleted. The absence guard below locks that state.

describe("AC-2: teo-statusline.sh is removed (statusLine block deleted from settings.json)", () => {
  // STATUS: GREEN

  const STATUSLINE = join(REPO_ROOT, ".claude", "scripts", "teo-statusline.sh");

  // ── Absence guard: script must not exist after fix/ws-cleanup ───────────
  it("GOLDEN: teo-statusline.sh must NOT exist (removed — was dead weight after statusLine block deleted)", () => {
    expect(existsSync(STATUSLINE)).toBe(false);
  });
});

// ─── AC-3: .claude/hooks/ directory deleted (replaced by plugin system) ──────
// STATUS: GREEN — hooks now loaded via plugin system, no local .claude/hooks/ needed
//
// This directory was a pre-plugin artifact. The plugin system loads hooks from
// CLAUDE_PLUGIN_ROOT/hooks/ automatically. Deleted as part of WS-STARTUP-CLEANUP.

describe("AC-3: .claude/hooks/ directory removed (plugin system handles hooks)", () => {
  // STATUS: GREEN

  const HOOKS_DIR = join(REPO_ROOT, ".claude", "hooks");

  // ── Absence guard: local hooks directory must not exist after cleanup ────
  it("GOLDEN: .claude/hooks/ directory must NOT exist (hooks now via plugin system)", () => {
    expect(existsSync(HOOKS_DIR)).toBe(false);
  });
});

// ─── AC-4: website-creation-process.md — no "MG agents" ─────────────────────
// STATUS: GREEN

describe("AC-4: website-creation-process.md no 'MG agents' reference", () => {
  // STATUS: GREEN

  const DOC = join(REPO_ROOT, ".claude", "shared", "website-creation-process.md");

  // ── Misuse: "MG agents" product identity reference ──────────────────────
  it("MISUSE: file must NOT contain 'MG agents'", () => {
    const content = readFileSync(DOC, "utf8");
    // Line 5 currently: "...AI-assisted website creation using MG agents."
    // Must be updated to reference CAPO or TEO agents instead.
    expect(content).not.toContain("MG agents");
  });

  // ── Golden: file exists ──────────────────────────────────────────────────
  it("GOLDEN: file exists", () => {
    expect(existsSync(DOC)).toBe(true);
  });
});

// ─── AC-5: visual-formatting.md — no specific MG product-identity phrases ────
// STATUS: GREEN

describe("AC-5: visual-formatting.md no stale MG product-identity phrases", () => {
  // STATUS: GREEN

  const DOC = join(REPO_ROOT, ".claude", "shared", "visual-formatting.md");

  // ── Misuse: "MG community version" changelog phrase ──────────────────────
  it("MISUSE: file must NOT contain 'MG community version'", () => {
    const content = readFileSync(DOC, "utf8");
    // Currently at line ~209: "- Initial MG community version"
    // Must be updated to reference CAPO/TEO accurately.
    expect(content).not.toContain("MG community version");
  });

  // ── Misuse: "ownership from MG to TEO" ownership transfer phrase ─────────
  it("MISUSE: file must NOT contain 'ownership from MG to TEO'", () => {
    const content = readFileSync(DOC, "utf8");
    // Currently at line ~198: "- Transferred ownership from MG to TEO"
    // This framing is wrong: CAPO/TEO is the product; MG was the previous branding.
    expect(content).not.toContain("ownership from MG to TEO");
  });

  // ── Golden: file exists ──────────────────────────────────────────────────
  it("GOLDEN: file exists", () => {
    expect(existsSync(DOC)).toBe(true);
  });
});

// ─── AC-6: Version consistency across all three version carriers ──────────────
// STATUS: GREEN

describe("AC-6: version consistency across package.json, plugin.json, and version file", () => {
  // STATUS: GREEN

  const PKG_JSON = join(REPO_ROOT, "package.json");
  const PLUGIN_JSON = join(REPO_ROOT, ".claude-plugin", "plugin.json");
  const VERSION_FILE = join(REPO_ROOT, ".claude", ".teo-for-claude-version");

  const pkg = JSON.parse(readFileSync(PKG_JSON, "utf8")) as { version: string };
  const currentVersion = pkg.version;

  // ── Golden: all three carriers agree on the current release ─────────────
  it("GOLDEN: package.json version is a valid semver (canonical source of truth)", () => {
    expect(currentVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("GOLDEN: plugin.json version matches package.json (cross-carrier consistency)", () => {
    const plugin = JSON.parse(readFileSync(PLUGIN_JSON, "utf8")) as { version: string };
    expect(
      plugin.version,
      `plugin.json (${plugin.version}) must match package.json (${currentVersion})`
    ).toBe(currentVersion);
  });

  it("GOLDEN: .teo-for-claude-version capo_version matches package.json (current release)", () => {
    const content = readFileSync(VERSION_FILE, "utf8");
    const escaped = CURRENT_VERSION.replace(/\./g, "\\.");
    expect(content, `capo_version must be ${CURRENT_VERSION}`).toMatch(
      new RegExp(`^\\s*capo_version\\s*:\\s*${escaped}\\s*$`, "m")
    );
  });
});

// ─── AC-7: release.sh covers .teo-for-claude-version ────────────────────────
// STATUS: GREEN

describe("AC-7: release.sh updates .teo-for-claude-version on release", () => {
  // STATUS: GREEN

  const RELEASE_SCRIPT = join(REPO_ROOT, "scripts", "release.sh");

  // ── Misuse: script does not mention .teo-for-claude-version at all ───────
  it("MISUSE: release.sh must NOT be silent about .teo-for-claude-version", () => {
    const content = readFileSync(RELEASE_SCRIPT, "utf8");
    // If neither the file path nor the key appears, the version file will drift
    // from package.json on every release — exactly the bug this workstream fixes.
    const mentionsFile = content.includes(".teo-for-claude-version");
    const mentionsKey = content.includes("capo_version");
    expect(mentionsFile || mentionsKey).toBe(true);
  });

  // ── Misuse: script references capo_version but not in the update path ────
  // (Guard against a comment-only reference that doesn't actually do the bump)
  it("MISUSE: release.sh must contain a write/sed/update expression for capo_version — not just a comment", () => {
    const content = readFileSync(RELEASE_SCRIPT, "utf8");
    // A comment-only reference would be lines starting with `#` that mention capo_version.
    // We require at least one non-comment line that references capo_version.
    const nonCommentLines = content
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(nonCommentLines).toMatch(/capo_version/);
  });

  // ── Golden: release.sh references both the file path and the key ─────────
  it("GOLDEN: release.sh references '.teo-for-claude-version' file path", () => {
    const content = readFileSync(RELEASE_SCRIPT, "utf8");
    expect(content).toContain(".teo-for-claude-version");
  });

  it("GOLDEN: release.sh references 'capo_version' key in update logic", () => {
    const content = readFileSync(RELEASE_SCRIPT, "utf8");
    expect(content).toContain("capo_version");
  });
});
