#!/usr/bin/env node
// =============================================================================
// generate-spawn-allowlist.js — Build-time allowlist generator
//
// PURPOSE
//   Reads src/plugin/agents/*.md files, parses the `tools:` frontmatter line,
//   extracts Task() parentheticals, and emits spawn-allowlist.json.
//
//   D3 decision: frontmatter is the single source of truth for spawn permissions.
//   This script is build-time — it produces the JSON consumed by teo-spawn-guard.sh.
//
// USAGE
//   node src/plugin/scripts/generate-spawn-allowlist.js
//
// ENV VARS
//   TEO_AGENTS_DIR     Directory containing *.md agent files
//                      (default: src/plugin/agents/ relative to repo root)
//   TEO_ALLOWLIST_OUT  Output path for spawn-allowlist.json
//                      (default: src/plugin/spawn-allowlist.json relative to repo root)
//
// OUTPUT FORMAT
//   {
//     "generated_at": "<ISO-8601>",
//     "source": "<relative agents dir path>",
//     "allowlist": {
//       "capo": ["*"],
//       "staff-engineer": ["software-engineer"],
//       ...
//     }
//   }
//
// DESIGN
//   - Agents with NO Task in their tools line are NOT in the allowlist
//   - Bare Task (no parentheticals) → ["*"] (wildcard: can spawn any agent)
//   - Task(qa, design) → ["qa", "design"]
//   - Malformed frontmatter (no tools: line): skips agent, logs WARN to stderr
//   - Empty dir or nonexistent dir: emits {} allowlist, exits 0
// =============================================================================

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

const agentsDir = process.env.TEO_AGENTS_DIR
  ? resolve(process.env.TEO_AGENTS_DIR)
  : join(REPO_ROOT, "src", "plugin", "agents");

const outPath = process.env.TEO_ALLOWLIST_OUT
  ? resolve(process.env.TEO_ALLOWLIST_OUT)
  : join(REPO_ROOT, "src", "plugin", "spawn-allowlist.json");

// Compute a relative source path for the output metadata
const sourceRelative = relative(REPO_ROOT, agentsDir) + "/";

// ---------------------------------------------------------------------------
// Parse a tools: frontmatter line and extract Task targets
//
// Returns:
//   { hasTask: false }                    — no Task in tools
//   { hasTask: true, targets: ["*"] }     — bare Task (wildcard)
//   { hasTask: true, targets: ["a","b"] } — Task(a, b)
// ---------------------------------------------------------------------------
function parseTaskFromToolsLine(toolsLine) {
  // Match Task with optional parentheticals: Task or Task(...)
  // The line looks like: [Read, Glob, Task(qa, design), Bash]
  // or: [Read, Task, Bash]
  const taskWithArgsRe = /\bTask\s*\(([^)]*)\)/;
  const bareTaskRe = /\bTask\b(?!\s*\()/;

  const withArgsMatch = toolsLine.match(taskWithArgsRe);
  if (withArgsMatch) {
    // Has parentheticals — extract the comma-separated list
    const argsRaw = withArgsMatch[1];
    const targets = argsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return { hasTask: true, targets };
  }

  if (bareTaskRe.test(toolsLine)) {
    // Bare Task with no parentheticals — wildcard
    return { hasTask: true, targets: ["*"] };
  }

  return { hasTask: false };
}

// ---------------------------------------------------------------------------
// Extract the tools: value from a frontmatter block
//
// Returns the raw string value after "tools:" or null if not found.
// Frontmatter is defined as the content between the first two "---" lines.
// ---------------------------------------------------------------------------
function extractToolsLine(content) {
  const lines = content.split("\n");

  // Find the opening frontmatter delimiter
  let frontmatterStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      frontmatterStart = i;
      break;
    }
  }
  if (frontmatterStart === -1) return null;

  // Find the closing frontmatter delimiter
  let frontmatterEnd = -1;
  for (let i = frontmatterStart + 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      frontmatterEnd = i;
      break;
    }
  }
  if (frontmatterEnd === -1) return null;

  // Search for tools: line within frontmatter
  for (let i = frontmatterStart + 1; i < frontmatterEnd; i++) {
    const line = lines[i];
    const match = line.match(/^\s*tools:\s*(.+)$/);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Write output helper
// ---------------------------------------------------------------------------
function writeOutput(allowlist) {
  const output = {
    generated_at: new Date().toISOString(),
    source: sourceRelative,
    allowlist,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  // Handle missing or empty agents dir
  if (!existsSync(agentsDir)) {
    writeOutput({});
    console.log("spawn-allowlist.json generated");
    console.log("  agents dir not found — empty allowlist written");
    return;
  }

  let entries;
  try {
    entries = readdirSync(agentsDir);
  } catch (err) {
    process.stderr.write(
      `WARN [generate-spawn-allowlist]: cannot read agents dir "${agentsDir}": ${err.message}\n`
    );
    writeOutput({});
    console.log("spawn-allowlist.json generated");
    console.log("  could not read agents dir — empty allowlist written");
    return;
  }

  const mdFiles = entries.filter((e) => e.endsWith(".md"));
  const allowlist = {};
  let processed = 0;
  let skipped = 0;

  for (const file of mdFiles) {
    const agentName = file.replace(/\.md$/, "");
    const filePath = join(agentsDir, file);

    let content;
    try {
      content = readFileSync(filePath, "utf8");
    } catch (err) {
      process.stderr.write(
        `WARN [generate-spawn-allowlist]: cannot read "${file}": ${err.message}\n`
      );
      skipped++;
      continue;
    }

    const toolsLine = extractToolsLine(content);
    if (toolsLine === null) {
      process.stderr.write(
        `WARN [generate-spawn-allowlist]: no "tools:" line found in frontmatter of "${file}" — skipping\n`
      );
      skipped++;
      continue;
    }

    const parsed = parseTaskFromToolsLine(toolsLine);
    if (!parsed.hasTask) {
      // Not in allowlist — cannot spawn
      processed++;
      continue;
    }

    allowlist[agentName] = parsed.targets;
    processed++;
  }

  writeOutput(allowlist);

  const entryCount = Object.keys(allowlist).length;
  console.log("spawn-allowlist.json generated");
  console.log(`  agents processed: ${processed}, skipped: ${skipped}`);
  console.log(`  allowlist entries: ${entryCount}`);
  console.log(`  output: ${outPath}`);
}

main();
