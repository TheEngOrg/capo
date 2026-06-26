// =============================================================================
// build-plugin.test.ts — QA spec for WS-BUILD-PLUGIN
//
// STATUS: GREEN — build script implemented in scripts/build-plugin.mjs

//
// ARCHITECTURE
//   src/plugin/  ← single source of truth (22 agents, hooks, skills)
//   scripts/build-plugin.mjs  ← build script (to be implemented by dev)
//   plugin/      ← built output at repo root (gitignored, not committed)
//   plugin/.claude-plugin/plugin.json  ← must omit "agents" field
//   plugin/agents/<name>.md  ← flat layout (no subdirs)
//
// ORDERING: misuse/negative paths first, then boundary, then golden path.
//   (ADR-064 adversarial-first policy)
//
// ACs COVERED
//   AC-1   Build script exists; plugin/ absent before build
//   AC-2   npm run build:plugin creates plugin/ with agents/, hooks/, skills/,
//          .claude-plugin/plugin.json
//   AC-3   plugin.json does NOT contain an "agents" field
//   AC-4   All files in plugin/agents/ are flat .md files (no subdirs)
//   AC-5   plugin/hooks/hooks.json is present in built output
//   AC-6   package.json has build:plugin + build:all scripts, no postinstall
//   AC-7   .gitignore contains plugin/ as an ignored path
//   AC-8   Running build:plugin twice is idempotent (no error, same output)
//   AC-9   src/plugin/agents/ files are unchanged after the build (copy, not move)
//   AC-10  plugin.json version matches package.json version
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Paths — resolved from process.cwd() (vitest sets cwd to project root).
// NEVER use hardcoded /tmp/ or /Users/... literals — proven CI failure mode.
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const PLUGIN_DIR = path.join(REPO_ROOT, "plugin");
const PLUGIN_AGENTS_DIR = path.join(PLUGIN_DIR, "agents");
const PLUGIN_HOOKS_DIR = path.join(PLUGIN_DIR, "hooks");
const PLUGIN_SKILLS_DIR = path.join(PLUGIN_DIR, "skills");
const PLUGIN_JSON_PATH = path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json");
const BUILD_SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "build-plugin.mjs");
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, "package.json");
const GITIGNORE_PATH = path.join(REPO_ROOT, ".gitignore");
const SRC_PLUGIN_AGENTS_DIR = path.join(REPO_ROOT, "src", "plugin", "agents");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run npm run build:plugin in the repo root. Throws on non-zero exit. */
function runBuild(): void {
  execSync("npm run build:plugin", {
    cwd: REPO_ROOT,
    stdio: "pipe",
    timeout: 60000,
  });
}

/** Return parsed JSON from a file path. */
function readJson(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// =============================================================================
// AC-1: MISUSE — build does not exist yet (negative/pre-condition assertions)
// These must NOT depend on the build having run. They validate the pre-build
// state and the existence of the build script file itself.
// =============================================================================

describe("AC-1: pre-build state and build script existence", () => {
  it("build script file exists at scripts/build-plugin.mjs", () => {
    // This test will fail RED until dev creates the file.
    expect(fs.existsSync(BUILD_SCRIPT_PATH)).toBe(true);
  });

  it("plugin/ directory does not exist before the build has been run (or is gitignored)", () => {
    // Verifies that plugin/ is not a committed/tracked directory.
    // git ls-files --error-unmatch exits 1 for untracked/ignored files.
    let isTracked: boolean;
    try {
      execSync(`git ls-files --error-unmatch plugin/`, {
        cwd: REPO_ROOT,
        stdio: "pipe",
      });
      isTracked = true;
    } catch {
      isTracked = false;
    }
    expect(isTracked).toBe(false);
  });
});

// =============================================================================
// AC-6: package.json scripts — static assertion, no build required
// Test early (before build tests) because it validates the prerequisite
// that build:plugin even exists as an npm script.
// =============================================================================

describe("AC-6: package.json scripts", () => {
  it("package.json has a build:plugin script", () => {
    const pkg = readJson(PACKAGE_JSON_PATH);
    const scripts = pkg["scripts"] as Record<string, string> | undefined;
    expect(scripts).toBeDefined();
    expect(scripts?.["build:plugin"]).toBeDefined();
    expect(typeof scripts?.["build:plugin"]).toBe("string");
  });

  it("package.json has a build:all script", () => {
    const pkg = readJson(PACKAGE_JSON_PATH);
    const scripts = pkg["scripts"] as Record<string, string> | undefined;
    expect(scripts?.["build:all"]).toBeDefined();
    expect(typeof scripts?.["build:all"]).toBe("string");
  });

  it("package.json does NOT have a postinstall script", () => {
    const pkg = readJson(PACKAGE_JSON_PATH);
    const scripts = pkg["scripts"] as Record<string, string> | undefined;
    // postinstall running npm run bundle on fresh installs is the behavior
    // to remove — the build is now explicit, not hook-driven.
    expect(scripts?.["postinstall"]).toBeUndefined();
  });
});

// =============================================================================
// AC-7: .gitignore — static assertion, no build required
// =============================================================================

describe("AC-7: .gitignore contains plugin/ entry", () => {
  it(".gitignore file contains plugin/ as an ignored path", () => {
    const content = fs.readFileSync(GITIGNORE_PATH, "utf8");
    const lines = content.split("\n").map((l) => l.trim());
    // Accept either "plugin/" or "/plugin/" — both correctly ignore the dir
    const hasEntry = lines.some((l) => l === "plugin/" || l === "/plugin/");
    expect(hasEntry).toBe(true);
  });

  it("git check-ignore confirms plugin/ is ignored", () => {
    // Use --no-index so the check works whether or not a stale plugin/ is on disk
    let exitCode: number;
    try {
      execSync(`git check-ignore --quiet --no-index "plugin/"`, {
        cwd: REPO_ROOT,
        stdio: "pipe",
      });
      exitCode = 0;
    } catch (err: unknown) {
      exitCode = (err as { status?: number }).status ?? 1;
    }
    expect(exitCode).toBe(0); // 0 = path IS ignored
  });
});

// =============================================================================
// Build-dependent tests — these all require npm run build:plugin to succeed.
// All will be RED until dev implements the build script.
// =============================================================================

describe("build-dependent tests (AC-2 through AC-10)", () => {
  // Run the build once before all tests in this describe block.
  // beforeAll throws on build failure — tests are skipped if build itself fails,
  // which clearly signals the root cause rather than cascading assertion failures.
  beforeAll(() => {
    runBuild();
  });

  // ---------------------------------------------------------------------------
  // AC-2: plugin/ directory structure
  // ---------------------------------------------------------------------------

  describe("AC-2: build:plugin creates plugin/ with expected structure", () => {
    it("plugin/ directory exists after build", () => {
      expect(fs.existsSync(PLUGIN_DIR)).toBe(true);
      expect(fs.statSync(PLUGIN_DIR).isDirectory()).toBe(true);
    });

    it("plugin/agents/ directory exists", () => {
      expect(fs.existsSync(PLUGIN_AGENTS_DIR)).toBe(true);
      expect(fs.statSync(PLUGIN_AGENTS_DIR).isDirectory()).toBe(true);
    });

    it("plugin/agents/ contains at least 22 .md files", () => {
      const entries = fs.readdirSync(PLUGIN_AGENTS_DIR);
      const mdFiles = entries.filter((f) => f.endsWith(".md"));
      expect(mdFiles.length).toBeGreaterThanOrEqual(22);
    });

    it("plugin/hooks/ directory exists", () => {
      expect(fs.existsSync(PLUGIN_HOOKS_DIR)).toBe(true);
      expect(fs.statSync(PLUGIN_HOOKS_DIR).isDirectory()).toBe(true);
    });

    it("plugin/skills/ directory exists", () => {
      expect(fs.existsSync(PLUGIN_SKILLS_DIR)).toBe(true);
      expect(fs.statSync(PLUGIN_SKILLS_DIR).isDirectory()).toBe(true);
    });

    it("plugin/.claude-plugin/plugin.json exists", () => {
      expect(fs.existsSync(PLUGIN_JSON_PATH)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-3: plugin.json omits the "agents" field
  // ---------------------------------------------------------------------------

  describe("AC-3: plugin.json does NOT contain an agents field", () => {
    it("plugin.json is valid JSON", () => {
      expect(() => readJson(PLUGIN_JSON_PATH)).not.toThrow();
    });

    it("plugin.json does not have an agents field (must use auto-discovery)", () => {
      const pluginJson = readJson(PLUGIN_JSON_PATH);
      // The plugin loader auto-discovers agents from plugin/agents/*.md.
      // An "agents" field overrides auto-discovery and would break agent loading
      // when the plugin/ directory structure doesn't match what the field lists.
      expect(Object.prototype.hasOwnProperty.call(pluginJson, "agents")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-4: flat agent files — no subdirectories in plugin/agents/
  // ---------------------------------------------------------------------------

  describe("AC-4: plugin/agents/ contains only flat .md files (no subdirs)", () => {
    it("every entry in plugin/agents/ is a file (not a directory)", () => {
      const entries = fs.readdirSync(PLUGIN_AGENTS_DIR);
      for (const entry of entries) {
        const fullPath = path.join(PLUGIN_AGENTS_DIR, entry);
        const stat = fs.statSync(fullPath);
        expect(stat.isFile(), `Expected flat file but found directory: ${entry}`).toBe(true);
      }
    });

    it("every entry in plugin/agents/ has a .md extension", () => {
      const entries = fs.readdirSync(PLUGIN_AGENTS_DIR);
      for (const entry of entries) {
        expect(entry.endsWith(".md"), `Non-.md file found in plugin/agents/: ${entry}`).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // AC-5: hooks.json present in built output
  // ---------------------------------------------------------------------------

  describe("AC-5: plugin/hooks/hooks.json exists", () => {
    it("hooks.json is present in the built plugin/hooks/ directory", () => {
      const hooksJsonPath = path.join(PLUGIN_HOOKS_DIR, "hooks.json");
      expect(fs.existsSync(hooksJsonPath)).toBe(true);
    });

    it("plugin/hooks/hooks.json is valid JSON", () => {
      const hooksJsonPath = path.join(PLUGIN_HOOKS_DIR, "hooks.json");
      expect(() => readJson(hooksJsonPath)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // AC-8: idempotent build — running build:plugin twice produces the same output
  // ---------------------------------------------------------------------------

  describe("AC-8: build:plugin is idempotent (second run succeeds)", () => {
    it("running build:plugin a second time does not throw or corrupt output", () => {
      // First run already happened in beforeAll — this is the second run.
      expect(() => runBuild()).not.toThrow();
    });

    it("plugin/agents/ still contains at least 22 .md files after second build", () => {
      const entries = fs.readdirSync(PLUGIN_AGENTS_DIR);
      const mdFiles = entries.filter((f) => f.endsWith(".md"));
      expect(mdFiles.length).toBeGreaterThanOrEqual(22);
    });

    it("plugin/.claude-plugin/plugin.json is still valid JSON after second build", () => {
      expect(() => readJson(PLUGIN_JSON_PATH)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // AC-9: source files not mutated — src/plugin/agents/ unchanged after build
  // ---------------------------------------------------------------------------

  describe("AC-9: build is a copy, not a move — src/plugin/agents/ still intact", () => {
    it("src/plugin/agents/ directory still exists after build", () => {
      expect(fs.existsSync(SRC_PLUGIN_AGENTS_DIR)).toBe(true);
      expect(fs.statSync(SRC_PLUGIN_AGENTS_DIR).isDirectory()).toBe(true);
    });

    it("src/plugin/agents/ still contains exactly 22 .md files after build", () => {
      const entries = fs.readdirSync(SRC_PLUGIN_AGENTS_DIR);
      const mdFiles = entries.filter((f) => f.endsWith(".md"));
      // Source must retain the exact same count — build must never delete source files.
      expect(mdFiles.length).toBe(22);
    });

    it("agent filenames in src/plugin/agents/ are unchanged after build", () => {
      const srcEntries = fs.readdirSync(SRC_PLUGIN_AGENTS_DIR).sort();
      const dstEntries = fs.readdirSync(PLUGIN_AGENTS_DIR).sort();
      // The build output must contain at least all source filenames (may add others).
      for (const name of srcEntries) {
        expect(
          dstEntries.includes(name),
          `Source agent ${name} missing from built plugin/agents/`
        ).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // AC-10: plugin.json version matches package.json version
  // ---------------------------------------------------------------------------

  describe("AC-10: plugin.json version matches package.json version", () => {
    it("plugin.json contains a version field", () => {
      const pluginJson = readJson(PLUGIN_JSON_PATH);
      expect(pluginJson["version"]).toBeDefined();
      expect(typeof pluginJson["version"]).toBe("string");
    });

    it("plugin.json version matches package.json version", () => {
      const pkg = readJson(PACKAGE_JSON_PATH);
      const pluginJson = readJson(PLUGIN_JSON_PATH);
      // Version sync prevents shipping a plugin.json that is out of step with
      // the npm package version — a known footgun from prior release cycles.
      expect(pluginJson["version"]).toBe(pkg["version"]);
    });
  });
});
