// src/tests/plugin-manifest.test.ts
// WS-STRUCT-01 regression guard — plugin.json agents field format
//
// PURPOSE
//   After WS-STRUCT-01 moved agents from `agents/` (repo root) to
//   `src/plugin/agents/`, plugin.json was updated to an explicit array of
//   individual .md file paths. Claude Code does NOT load agents from an array
//   of individual file paths — `claude plugin details` shows Agents(0). The fix
//   is to use a directory string, exactly like skills uses "./src/plugin/skills/".
//
//   These tests guard against regressing back to the broken array format.
//   They FAIL on the current plugin.json (agents is an array) and PASS after
//   the fix (agents becomes a directory string).
//
// DESIGN CONSTRAINTS
//   - No hardcoded integer counts — derive all counts from the filesystem
//   - No hardcoded absolute paths — use path.resolve(__dirname, "..", "..")
//   - No subprocesses, no mocks, no network — node:fs + node:path only
//   - No /tmp paths in any assertion
//
// ORDERING: misuse → boundary → golden path (ADR-064 critical-path policy)
//   Misuse: things that must NOT be true about plugin.json
//   Boundary: structural well-formedness guards
//   Golden path: the working directory-string contract is fully present

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PLUGIN_JSON = path.join(REPO_ROOT, ".claude-plugin", "plugin.json");
const AGENTS_DIR = path.join(REPO_ROOT, "src", "plugin", "agents");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse plugin.json and return the typed object. */
function readPluginManifest(): Record<string, unknown> {
  const raw = fs.readFileSync(PLUGIN_JSON, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Count flat .md files directly in src/plugin/agents/ (not recursive). */
function deriveAgentCount(): number {
  const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).length;
}

// =============================================================================
// MISUSE — things that must NOT be true in plugin.json
// =============================================================================

describe("plugin-manifest — misuse: agents field must not be an array of file paths", () => {
  it("agents field must not be an Array (array-of-files format is broken — Claude Code loads Agents(0))", () => {
    const manifest = readPluginManifest();
    expect(
      Array.isArray(manifest.agents),
      [
        "plugin.json agents field is an Array — Claude Code cannot load agents from an array of file paths.",
        'Fix: change agents to a directory string e.g. "./src/plugin/agents/"',
      ].join(" ")
    ).toBe(false);
  });

  it("agents array items must not be individual .md file paths (detects the specific broken pattern)", () => {
    const manifest = readPluginManifest();
    if (!Array.isArray(manifest.agents)) return;

    const items = manifest.agents as unknown[];
    const mdFilePaths = items.filter(
      (item) => typeof item === "string" && (item as string).endsWith(".md")
    );

    expect(
      mdFilePaths.length,
      [
        `plugin.json agents array contains ${mdFilePaths.length} individual .md file path(s).`,
        "This format silently produces Agents(0) on install.",
        'Fix: replace the array with a directory string e.g. "./src/plugin/agents/"',
      ].join(" ")
    ).toBe(0);
  });
});

// =============================================================================
// BOUNDARY — structural well-formedness
// =============================================================================

describe("plugin-manifest — boundary: agents field must exist and be non-empty", () => {
  it("plugin.json must exist at .claude-plugin/plugin.json", () => {
    expect(
      fs.existsSync(PLUGIN_JSON),
      ".claude-plugin/plugin.json is missing — cannot validate the plugin manifest"
    ).toBe(true);
  });

  it("plugin.json must be valid JSON", () => {
    const raw = fs.readFileSync(PLUGIN_JSON, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("plugin.json must have an agents field", () => {
    const manifest = readPluginManifest();
    expect(
      Object.prototype.hasOwnProperty.call(manifest, "agents"),
      "plugin.json is missing the agents field entirely"
    ).toBe(true);
  });

  it("plugin.json agents field must be truthy and non-empty", () => {
    const manifest = readPluginManifest();
    const agents = manifest.agents;

    const isEmpty =
      agents === null ||
      agents === undefined ||
      agents === "" ||
      (Array.isArray(agents) && (agents as unknown[]).length === 0);

    expect(
      isEmpty,
      "plugin.json agents field is falsy or an empty array — no agents will load"
    ).toBe(false);
  });

  it("src/plugin/agents/ directory must exist", () => {
    expect(
      fs.existsSync(AGENTS_DIR),
      "src/plugin/agents/ directory does not exist — agents cannot be loaded from any path"
    ).toBe(true);
  });

  it("src/plugin/agents/ must contain at least one .md file", () => {
    const count = deriveAgentCount();
    expect(
      count,
      "src/plugin/agents/ has no .md files — the agents directory is empty or missing agent definitions"
    ).toBeGreaterThan(0);
  });
});

// =============================================================================
// GOLDEN PATH — directory-string format is present and the target exists
// =============================================================================

describe("plugin-manifest — golden: agents field is a directory string pointing to an existing directory", () => {
  it("agents field is a string, not an array or object (directory string format)", () => {
    const manifest = readPluginManifest();
    expect(
      typeof manifest.agents,
      [
        `plugin.json agents field is type "${typeof manifest.agents}" — expected "string".`,
        'Claude Code loads agents from a directory string (e.g. "./src/plugin/agents/"),',
        "not from an array of individual file paths.",
      ].join(" ")
    ).toBe("string");
  });

  it("agents string points to a directory that exists on disk (relative to repo root)", () => {
    const manifest = readPluginManifest();
    if (typeof manifest.agents !== "string") return;

    const agentsPath = path.resolve(REPO_ROOT, manifest.agents as string);
    expect(
      fs.existsSync(agentsPath),
      `plugin.json agents points to "${manifest.agents as string}" which does not exist at resolved path: ${agentsPath}`
    ).toBe(true);

    const stat = fs.statSync(agentsPath);
    expect(
      stat.isDirectory(),
      `plugin.json agents points to "${manifest.agents as string}" but it resolves to a file, not a directory`
    ).toBe(true);
  });

  it("agents directory contains only flat .md files (no nested subdirectories)", () => {
    const manifest = readPluginManifest();
    if (typeof manifest.agents !== "string") return;

    const agentsPath = path.resolve(REPO_ROOT, manifest.agents as string);
    if (!fs.existsSync(agentsPath)) return;

    const entries = fs.readdirSync(agentsPath, { withFileTypes: true });
    const subdirs = entries.filter((e) => e.isDirectory());

    expect(
      subdirs.length,
      [
        `agents directory contains ${subdirs.length} subdirectory(ies): ${subdirs.map((d) => d.name).join(", ")}.`,
        "Claude Code requires flat agent .md files — subdirectories break agent loading.",
      ].join(" ")
    ).toBe(0);
  });

  it("agents directory .md file count is non-zero (no agent files dropped during format change)", () => {
    const manifest = readPluginManifest();
    if (typeof manifest.agents !== "string") return;

    const agentsPath = path.resolve(REPO_ROOT, manifest.agents as string);
    if (!fs.existsSync(agentsPath)) return;

    const fsCount = deriveAgentCount();
    expect(
      fsCount,
      "src/plugin/agents/ has no .md files even though agents is now a directory string — agent definitions are missing"
    ).toBeGreaterThan(0);
  });
});

// =============================================================================
// GOLDEN PATH — all paths in plugin.json resolve to existing files or directories
// =============================================================================

describe("plugin-manifest — golden: all plugin.json paths resolve to existing files or directories", () => {
  it("skills path resolves to an existing directory", () => {
    const manifest = readPluginManifest();
    const skills = manifest.skills;

    expect(typeof skills, `plugin.json skills field must be a string, got: ${typeof skills}`).toBe(
      "string"
    );

    const resolved = path.resolve(REPO_ROOT, skills as string);
    expect(
      fs.existsSync(resolved),
      `plugin.json skills "${skills as string}" does not resolve to an existing path: ${resolved}`
    ).toBe(true);

    const stat = fs.statSync(resolved);
    expect(
      stat.isDirectory(),
      `plugin.json skills "${skills as string}" resolves to a file, expected a directory`
    ).toBe(true);
  });

  it("hooks path resolves to an existing file", () => {
    const manifest = readPluginManifest();
    const hooks = manifest.hooks;

    expect(typeof hooks, `plugin.json hooks field must be a string, got: ${typeof hooks}`).toBe(
      "string"
    );

    const resolved = path.resolve(REPO_ROOT, hooks as string);
    expect(
      fs.existsSync(resolved),
      `plugin.json hooks "${hooks as string}" does not resolve to an existing path: ${resolved}`
    ).toBe(true);

    const stat = fs.statSync(resolved);
    expect(
      stat.isFile(),
      `plugin.json hooks "${hooks as string}" resolves to a directory, expected a file`
    ).toBe(true);
  });

  it("agents path (after fix) resolves to an existing directory, consistent with skills and hooks patterns", () => {
    const manifest = readPluginManifest();
    const agents = manifest.agents;

    if (typeof agents !== "string") {
      expect(
        typeof agents,
        [
          `plugin.json agents is type "${typeof agents}" — must be a string directory path.`,
          "Fix the array → directory string issue first (see misuse tests above).",
        ].join(" ")
      ).toBe("string");
      return;
    }

    const resolved = path.resolve(REPO_ROOT, agents);
    expect(
      fs.existsSync(resolved),
      `plugin.json agents "${agents}" does not resolve to an existing path: ${resolved}`
    ).toBe(true);

    const stat = fs.statSync(resolved);
    expect(
      stat.isDirectory(),
      `plugin.json agents "${agents}" resolves to a file — expected a directory (same pattern as skills)`
    ).toBe(true);
  });
});
