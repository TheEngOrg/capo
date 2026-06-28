// src/scripts/verify-plugin-install.test.ts
// WS-VERIFY-FIX — Gate 1 QA spec (pre-impl)
//
// PURPOSE
//   Static-analysis assertions on scripts/verify-plugin-install.sh that enforce
//   the three required structural changes from the PLUGIN_JSON bug fix:
//
//     1. PLUGIN_JSON must point at plugin/.claude-plugin/plugin.json (the BUILT
//        artifact produced by npm run build:plugin) — NOT .claude-plugin/plugin.json
//        (the SOURCE manifest which has "agents": "./src/plugin/agents/" and will
//        fail `claude plugin validate` with "agents: Invalid input").
//
//     2. The script must call npm run build:plugin (or equivalent) before any
//        validate / install step so the built artifact exists before the gate runs.
//
//     3. The PLUGIN_JSON variable path must include the "plugin/" directory prefix.
//
// DESIGN
//   - No subprocess execution. No mocks. Pure fs.readFileSync + string search.
//   - All paths are absolute, derived from REPO_ROOT at test-run time.
//   - NEVER hardcode /tmp/ or /Users/... literals — proven CI failure mode.
//
// ROOT CAUSE REFERENCE
//   Line 44 of verify-plugin-install.sh (pre-fix):
//     PLUGIN_JSON="${REPO_ROOT}/.claude-plugin/plugin.json"
//   This points at the SOURCE with the "agents" directory-string form, which
//   `claude plugin validate` rejects ("agents: Invalid input"). The BUILT artifact
//   at plugin/.claude-plugin/plugin.json has the agents field stripped and passes
//   both validate and install.
//
// ORDERING: misuse → boundary → golden path (ADR-064 adversarial-first policy)
// TOOL: vitest. node:fs + node:path only — no subprocesses, no mocks.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VERIFY_SCRIPT = path.join(REPO_ROOT, "scripts", "verify-plugin-install.sh");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read verify-plugin-install.sh as a string. Throws if the file does not exist. */
function readScript(): string {
  return fs.readFileSync(VERIFY_SCRIPT, "utf8");
}

/**
 * Extract the value assigned to PLUGIN_JSON from the shell script.
 *
 * Matches the canonical assignment form:
 *   PLUGIN_JSON="${REPO_ROOT}/<some/path>/plugin.json"
 *   PLUGIN_JSON="${REPO_ROOT}/<some/path>/plugin.json"  (with optional spaces)
 *
 * Returns the captured path fragment (everything between ${REPO_ROOT}/ and the
 * closing quote), or undefined if the line is not found.
 */
function parsePluginJsonAssignment(script: string): string | undefined {
  // Matches: PLUGIN_JSON="${REPO_ROOT}/<path>"
  // Capture group 1: everything after ${REPO_ROOT}/ up to the closing double-quote
  const re = /PLUGIN_JSON=["']\$\{REPO_ROOT\}\/([^"']+)["']/;
  const match = script.match(re);
  return match ? match[1] : undefined;
}

// =============================================================================
// MISUSE — things that must NOT be true in the script after the fix
// =============================================================================

describe("verify-plugin-install — misuse: PLUGIN_JSON must not point at the source manifest", () => {
  it("PLUGIN_JSON must NOT be set to .claude-plugin/plugin.json (the source path)", () => {
    // The source manifest at .claude-plugin/plugin.json has "agents": "./src/plugin/agents/"
    // which `claude plugin validate` rejects with "agents: Invalid input".
    // Pointing PLUGIN_JSON at the source file causes the validate step to always
    // fail, making the release gate permanently broken.
    const script = readScript();
    const pluginJsonPath = parsePluginJsonAssignment(script);

    expect(
      pluginJsonPath,
      "PLUGIN_JSON assignment not found in verify-plugin-install.sh — script structure may have changed"
    ).toBeDefined();

    expect(
      pluginJsonPath,
      [
        `PLUGIN_JSON is set to ".claude-plugin/plugin.json" — this is the SOURCE manifest.`,
        "The source manifest has an agents field that fails `claude plugin validate`.",
        "Fix: point PLUGIN_JSON at plugin/.claude-plugin/plugin.json (the built artifact).",
      ].join(" ")
    ).not.toBe(".claude-plugin/plugin.json");
  });

  it("PLUGIN_JSON must NOT omit the plugin/ directory prefix (bare .claude-plugin/ path is wrong)", () => {
    // Without the plugin/ prefix, the script validates the source manifest and
    // validate fails. The built artifact only exists under plugin/.
    const script = readScript();
    const pluginJsonPath = parsePluginJsonAssignment(script);

    if (pluginJsonPath === undefined) return; // missing assignment caught by prior test

    // The path must start with "plugin/" to target the built artifact directory.
    expect(
      pluginJsonPath.startsWith("plugin/"),
      [
        `PLUGIN_JSON path "${pluginJsonPath}" does not start with "plugin/" — it is targeting the wrong location.`,
        "The built artifact lives at plugin/.claude-plugin/plugin.json (produced by npm run build:plugin).",
        'Fix: change PLUGIN_JSON to "${REPO_ROOT}/plugin/.claude-plugin/plugin.json".',
      ].join(" ")
    ).toBe(true);
  });

  it("script must NOT run validate before calling npm run build:plugin (build must precede validate)", () => {
    // If validate runs before the build step, plugin/.claude-plugin/plugin.json
    // does not yet exist, causing validate to fail with a file-not-found error
    // rather than a meaningful manifest validation error.
    const script = readScript();
    const lines = script.split("\n");

    const buildLineIndex = lines.findIndex((l) => l.includes("npm run build:plugin"));
    const validateLineIndex = lines.findIndex((l) => l.includes("claude plugin validate"));

    // If build step is absent, a different test catches it. Here we assert ordering.
    if (buildLineIndex === -1 || validateLineIndex === -1) return;

    expect(
      buildLineIndex,
      [
        `npm run build:plugin (line ${buildLineIndex + 1}) appears AFTER claude plugin validate (line ${validateLineIndex + 1}).`,
        "Build must run before validate so the built artifact exists when validate is called.",
      ].join(" ")
    ).toBeLessThan(validateLineIndex);
  });
});

// =============================================================================
// BOUNDARY — file existence and structure
// =============================================================================

describe("verify-plugin-install — boundary: file exists and is parseable", () => {
  it("verify-plugin-install.sh exists at scripts/verify-plugin-install.sh", () => {
    expect(
      fs.existsSync(VERIFY_SCRIPT),
      "scripts/verify-plugin-install.sh is missing — cannot run any release gate checks"
    ).toBe(true);
  });

  it("script is non-empty (not a stub file)", () => {
    const script = readScript();
    expect(
      script.trim().length,
      "scripts/verify-plugin-install.sh is empty — no release gate content present"
    ).toBeGreaterThan(0);
  });

  it("PLUGIN_JSON variable is assigned exactly once (no ambiguous re-assignment)", () => {
    // Multiple PLUGIN_JSON assignments would make parsePluginJsonAssignment
    // non-deterministic. The gate must use a single, unambiguous path.
    const script = readScript();
    const re = /PLUGIN_JSON=/g;
    const matchCount = [...script.matchAll(re)].length;
    expect(
      matchCount,
      [
        `PLUGIN_JSON is assigned ${matchCount} times in verify-plugin-install.sh — expected exactly 1.`,
        "Multiple assignments create ambiguity about which path the validate step uses.",
      ].join(" ")
    ).toBe(1);
  });

  it("script contains a claude plugin validate call (validate step must be present)", () => {
    // Removing the validate step entirely is as bad as pointing it at the wrong
    // file — it means the manifest is never checked before install.
    const script = readScript();
    expect(
      script.includes("claude plugin validate"),
      "scripts/verify-plugin-install.sh does not contain a 'claude plugin validate' call — the validate gate has been removed"
    ).toBe(true);
  });
});

// =============================================================================
// GOLDEN PATH — the fixed correct state of the script
// =============================================================================

describe("verify-plugin-install — golden: npm run build:plugin is invoked before validate", () => {
  it("script source contains 'npm run build:plugin'", () => {
    // Step 0: build must run to produce plugin/.claude-plugin/plugin.json before
    // any validate or install step can succeed. Without this call the built artifact
    // never exists and both validate and install fail for the wrong reason.
    const script = readScript();
    expect(
      script.includes("npm run build:plugin"),
      [
        "scripts/verify-plugin-install.sh does not call 'npm run build:plugin'.",
        "The build step (step 0) must run first to produce plugin/.claude-plugin/plugin.json.",
        "Without it, validate points at a file that does not yet exist.",
      ].join(" ")
    ).toBe(true);
  });
});

describe("verify-plugin-install — golden: PLUGIN_JSON points at the built artifact", () => {
  it("PLUGIN_JSON is set to plugin/.claude-plugin/plugin.json (the built artifact)", () => {
    // The built artifact at plugin/.claude-plugin/plugin.json has the agents field
    // STRIPPED (handled by the build script). This is the form that passes both
    // `claude plugin validate` and `claude plugin install`.
    const script = readScript();
    const pluginJsonPath = parsePluginJsonAssignment(script);

    expect(
      pluginJsonPath,
      "PLUGIN_JSON assignment not found in verify-plugin-install.sh"
    ).toBeDefined();

    expect(
      pluginJsonPath,
      [
        `PLUGIN_JSON is set to "${String(pluginJsonPath)}" — expected "plugin/.claude-plugin/plugin.json".`,
        "The validate step must point at the built artifact (agents field stripped),",
        "not the source manifest (agents field present, fails validate).",
      ].join(" ")
    ).toBe("plugin/.claude-plugin/plugin.json");
  });

  it("PLUGIN_JSON path includes the 'plugin/' directory prefix", () => {
    // Belt-and-suspenders: independently assert the prefix is present so that
    // a future rename (e.g. 'dist/' prefix) does not silently regress to the
    // source path without this test catching it.
    const script = readScript();
    const pluginJsonPath = parsePluginJsonAssignment(script);

    if (pluginJsonPath === undefined) return; // missing assignment caught above

    expect(
      pluginJsonPath.startsWith("plugin/"),
      [
        `PLUGIN_JSON path "${pluginJsonPath}" does not include the "plugin/" prefix.`,
        "The built artifact is always under plugin/. Update the path to include this prefix.",
      ].join(" ")
    ).toBe(true);
  });

  it("PLUGIN_JSON path ends with .claude-plugin/plugin.json (correct artifact filename)", () => {
    const script = readScript();
    const pluginJsonPath = parsePluginJsonAssignment(script);

    if (pluginJsonPath === undefined) return; // missing assignment caught above

    expect(
      pluginJsonPath.endsWith(".claude-plugin/plugin.json"),
      [
        `PLUGIN_JSON path "${pluginJsonPath}" does not end with ".claude-plugin/plugin.json".`,
        "The validate step must reference the plugin.json manifest, not another file.",
      ].join(" ")
    ).toBe(true);
  });
});

describe("verify-plugin-install — golden: asset count assertions are still present after fix", () => {
  it("script still contains the Agents(23) count assertion after path fix", () => {
    // The path-fix must not drop the count assertions from step 5.
    // Agents(23) is the expected count for the current plugin build (WS-AGENT-RAILS added qa-validate.md).
    const script = readScript();
    expect(
      script.includes('"23"'),
      [
        'scripts/verify-plugin-install.sh no longer contains the Agents count "23" assertion.',
        "The path fix must not remove step 5 count checks — they are the real functional gate.",
      ].join(" ")
    ).toBe(true);
  });

  it("script still contains the Skills(15) count assertion after path fix", () => {
    const script = readScript();
    expect(
      script.includes('"15"'),
      [
        'scripts/verify-plugin-install.sh no longer contains the Skills count "15" assertion.',
        "The path fix must not remove step 5 count checks.",
      ].join(" ")
    ).toBe(true);
  });

  it("script still contains the Hooks(3) count assertion after path fix", () => {
    const script = readScript();
    expect(
      script.includes('"3"'),
      [
        'scripts/verify-plugin-install.sh no longer contains the Hooks count "3" assertion.',
        "The path fix must not remove step 5 count checks.",
      ].join(" ")
    ).toBe(true);
  });
});
