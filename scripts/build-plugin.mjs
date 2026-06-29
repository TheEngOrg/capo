#!/usr/bin/env node
// scripts/build-plugin.mjs — Build the plugin/ directory from src/plugin/
//
// Produces a self-contained plugin/ directory at the repo root that can be
// installed directly with `claude plugin install`. The built output:
//   - plugin/agents/          flat .md files (auto-discovered by the plugin loader)
//   - plugin/hooks/           hooks.json + shell scripts
//   - plugin/skills/          skill directories (recursive copy)
//   - plugin/.claude-plugin/plugin.json  (agents field removed, version synced)
//
// Run with: node scripts/build-plugin.mjs  (or npm run build:plugin)
// Must be idempotent — safe to run multiple times.

import {
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const PLUGIN_DIR = join(REPO_ROOT, "plugin");
const SRC_AGENTS_DIR = join(REPO_ROOT, "src", "plugin", "agents");
const SRC_HOOKS_DIR = join(REPO_ROOT, "src", "plugin", "hooks");
const SRC_SKILLS_DIR = join(REPO_ROOT, "src", "plugin", "skills");
const SRC_PLUGIN_JSON = join(REPO_ROOT, ".claude-plugin", "plugin.json");
const PACKAGE_JSON = join(REPO_ROOT, "package.json");

// ---------------------------------------------------------------------------
// Step 1: Clean + recreate plugin/
// ---------------------------------------------------------------------------
if (existsSync(PLUGIN_DIR)) {
  rmSync(PLUGIN_DIR, { recursive: true, force: true });
}
mkdirSync(PLUGIN_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Step 2: Copy agents/ (flat .md files only — no subdirectories)
// ---------------------------------------------------------------------------
const dstAgentsDir = join(PLUGIN_DIR, "agents");
mkdirSync(dstAgentsDir, { recursive: true });

const agentEntries = readdirSync(SRC_AGENTS_DIR);
for (const entry of agentEntries) {
  const srcPath = join(SRC_AGENTS_DIR, entry);
  const stat = statSync(srcPath);
  if (stat.isFile() && entry.endsWith(".md")) {
    // Flat copy — file only, no subdirectory nesting
    cpSync(srcPath, join(dstAgentsDir, entry));
  }
}

// ---------------------------------------------------------------------------
// Step 3: Copy hooks/ (hooks.json + shell scripts)
// ---------------------------------------------------------------------------
const dstHooksDir = join(PLUGIN_DIR, "hooks");
cpSync(SRC_HOOKS_DIR, dstHooksDir, { recursive: true });

// ---------------------------------------------------------------------------
// Step 4: Copy skills/ (recursive)
// ---------------------------------------------------------------------------
const dstSkillsDir = join(PLUGIN_DIR, "skills");
cpSync(SRC_SKILLS_DIR, dstSkillsDir, { recursive: true });

// ---------------------------------------------------------------------------
// Step 5: Build plugin/.claude-plugin/plugin.json
//   - Remove the "agents" field (auto-discovery from plugin/agents/*.md)
//   - Sync version from package.json
//   - Keep hooks/skills paths relative to the plugin root
// ---------------------------------------------------------------------------
const dstClaudePluginDir = join(PLUGIN_DIR, ".claude-plugin");
mkdirSync(dstClaudePluginDir, { recursive: true });

const sourcePluginJson = JSON.parse(readFileSync(SRC_PLUGIN_JSON, "utf8"));
const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));

// Remove agents field — loader auto-discovers from plugin/agents/*.md
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { agents: _agents, ...pluginJsonWithoutAgents } = sourcePluginJson;

// Sync version from package.json
pluginJsonWithoutAgents.version = packageJson.version;

// Rewrite hooks/skills paths to be relative to plugin root (not repo root)
// These point into the plugin/ directory structure we've built.
pluginJsonWithoutAgents.hooks = "./hooks/hooks.json";
pluginJsonWithoutAgents.skills = "./skills/";

const dstPluginJsonPath = join(dstClaudePluginDir, "plugin.json");
writeFileSync(dstPluginJsonPath, JSON.stringify(pluginJsonWithoutAgents, null, 2) + "\n", "utf8");

// ---------------------------------------------------------------------------
// Step 6: Write plugin/.claude-plugin/marketplace.json for local dev install
//   - plugins[].source uses "./" (relative path) so the CLI reads the plugin
//     from the marketplace directory itself — NOT from GitHub.
//   - Proven working format from local plugin probes: source: "./" is the
//     directory-type local source that the plugin loader supports.
//   - The GitHub marketplace.json at .claude-plugin/marketplace.json uses
//     {source:"github"} and is the release/production install path.
// ---------------------------------------------------------------------------
const localMarketplaceJson = {
  name: "teo-marketplace",
  owner: { name: "TheEngOrg" },
  plugins: [
    {
      name: "capo",
      source: "./",
      description: "Multi-agent orchestration for Claude Code",
    },
  ],
};
const dstMarketplaceJsonPath = join(dstClaudePluginDir, "marketplace.json");
writeFileSync(dstMarketplaceJsonPath, JSON.stringify(localMarketplaceJson, null, 2) + "\n", "utf8");

// ---------------------------------------------------------------------------
// Step 7: Generate spawn-allowlist.json and copy to plugin/
// ---------------------------------------------------------------------------
const srcAllowlistOut = join(REPO_ROOT, "src", "plugin", "spawn-allowlist.json");
execFileSync(
  process.execPath,
  [join(REPO_ROOT, "src", "plugin", "scripts", "generate-spawn-allowlist.js")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      TEO_AGENTS_DIR: SRC_AGENTS_DIR,
      TEO_ALLOWLIST_OUT: srcAllowlistOut,
    },
  }
);
cpSync(srcAllowlistOut, join(PLUGIN_DIR, "spawn-allowlist.json"));
console.log("spawn-allowlist.json generated");

console.log("build:plugin complete");
console.log(`  agents : ${readdirSync(dstAgentsDir).length} files`);
console.log(`  hooks  : ${readdirSync(dstHooksDir).length} files`);
console.log(`  skills : ${readdirSync(dstSkillsDir).length} entries`);
console.log(`  plugin.json version: ${pluginJsonWithoutAgents.version}`);
