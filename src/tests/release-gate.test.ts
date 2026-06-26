// src/tests/release-gate.test.ts
// WS-RELEASE-GATE-01 — Gate 1 QA spec (pre-impl)
//
// PURPOSE
//   CI-runnable guard that asserts the COUNT CONSTANTS in
//   scripts/verify-plugin-install.sh match the actual project state.
//   If a dev adds/removes an agent, skill, or hook event type without updating
//   the shell script constant, this test goes red in CI before a bad release
//   can be tagged.
//
// DESIGN CONSTRAINT: NO HARDCODED EXPECTED INTEGERS
//   Every count assertion derives the expected value from the filesystem or
//   hooks.json at test-run time. The script constant is parsed and compared to
//   the derived value. Neither side is hardcoded in this file.
//
// SUPERSEDES (dev must remove these stale count assertions after WS-RELEASE-GATE-01 lands):
//   1. src/tests/marketplace-github-source.test.ts — "Step 5 asset-count verification
//      block is still present (21 agents, 15 skills, 6 hook event types)"
//      (lines ~201-210): asserts script contains '"21"', '"15"', '"6"' as bare
//      strings. These are too loose (any occurrence matches) and hardcode the
//      count values. Replace with the dynamic cross-check in this file.
//   2. src/hooks/hooks-json.test.ts — the bottom section
//      "verify-plugin-install.sh — golden: HOOKS_COUNT corrected to 6 event types"
//      (lines ~291-316): asserts HOOKS_COUNT via a loose regex. Superseded by the
//      dynamic parse+compare in this file which also verifies the count is correct
//      against the filesystem rather than just present in the script.
//
// ORDERING: misuse → boundary → golden path (ADR-064 critical-path policy)
// TOOL: vitest. node:fs + node:path only — no subprocesses, no mocks.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VERIFY_SCRIPT = path.join(REPO_ROOT, "scripts", "verify-plugin-install.sh");
const HOOKS_JSON = path.join(REPO_ROOT, "src", "plugin", "hooks", "hooks.json");
const AGENTS_DIR = path.join(REPO_ROOT, "src", "plugin", "agents");
const SKILLS_DIR = path.join(REPO_ROOT, "src", "plugin", "skills");

// ---------------------------------------------------------------------------
// Helpers — filesystem-derived counts (no hardcoded integers)
// ---------------------------------------------------------------------------

/** Count of flat .md files directly in agents/ (not recursive). */
function deriveAgentCount(): number {
  const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).length;
}

/** Count of entries (dirs or files) directly in skills/ (top-level only). */
function deriveSkillCount(): number {
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  return entries.length;
}

/** Count of top-level keys under the "hooks" object in hooks/hooks.json.
 *  This matches what `claude plugin details` reports as the hook count:
 *  it counts distinct event type keys (e.g. SessionStart, PreToolUse, ...)
 *  not individual matcher-entry objects within those types. */
function deriveHookEventTypeCount(): number {
  const raw = fs.readFileSync(HOOKS_JSON, "utf8");
  const parsed = JSON.parse(raw) as { hooks: Record<string, unknown> };
  return Object.keys(parsed.hooks).length;
}

/** Read verify-plugin-install.sh as a string. */
function readScript(): string {
  return fs.readFileSync(VERIFY_SCRIPT, "utf8");
}

// ---------------------------------------------------------------------------
// Helpers — parse constants out of the shell script
// ---------------------------------------------------------------------------

/**
 * Extract the integer constant from a HOOKS_COUNT/AGENTS_COUNT/SKILLS_COUNT
 * assertion line of the form:
 *   if [ "${AGENTS_COUNT}" = "21" ]; then
 *
 * Returns undefined if the regex does not match (signals a structural problem
 * in the script — the constant or assertion block is missing).
 *
 * Each regex is anchored to the variable name to avoid cross-matches.
 */
function parseScriptConstant(
  script: string,
  varName: "AGENTS_COUNT" | "SKILLS_COUNT" | "HOOKS_COUNT"
): number | undefined {
  // Match: [ "${<VAR>}" = "<digits>" ]  (with optional spaces)
  // Escape the variable name for use in regex.
  const escapedVar = varName.replace(/_/g, "_"); // no-op but explicit
  const re = new RegExp(`\\[\\s*"\\$\\{${escapedVar}\\}"\\s*=\\s*"(\\d+)"\\s*\\]`, "g");
  const matches = [...script.matchAll(re)];
  if (matches.length === 0) return undefined;
  // Return the value from the first (and ideally only) match.
  return parseInt(matches[0][1], 10);
}

/** Count how many times the variable assertion appears in the script.
 *  Used in boundary tests to assert exactly-one-occurrence (no ambiguity). */
function countScriptConstantMatches(
  script: string,
  varName: "AGENTS_COUNT" | "SKILLS_COUNT" | "HOOKS_COUNT"
): number {
  const re = new RegExp(`\\[\\s*"\\$\\{${varName}\\}"\\s*=\\s*"(\\d+)"\\s*\\]`, "g");
  return [...script.matchAll(re)].length;
}

// =============================================================================
// MISUSE — things that must NOT be true
// =============================================================================

describe("release-gate — misuse: script constants must not be zero or empty", () => {
  it("AGENTS_COUNT in the script must not be 0 (no agent-count assertion set to zero)", () => {
    // A zero constant would mean all real installs would fail the gate while
    // an empty plugin repo would incorrectly pass.
    const script = readScript();
    const parsed = parseScriptConstant(script, "AGENTS_COUNT");
    // Parsed must be a positive integer — not zero, not NaN.
    expect(parsed).toBeDefined();
    expect(parsed).toBeGreaterThan(0);
  });

  it("SKILLS_COUNT in the script must not be 0", () => {
    const script = readScript();
    const parsed = parseScriptConstant(script, "SKILLS_COUNT");
    expect(parsed).toBeDefined();
    expect(parsed).toBeGreaterThan(0);
  });

  it("HOOKS_COUNT in the script must not be 0", () => {
    const script = readScript();
    const parsed = parseScriptConstant(script, "HOOKS_COUNT");
    expect(parsed).toBeDefined();
    expect(parsed).toBeGreaterThan(0);
  });

  it("AGENTS_COUNT regex must not return undefined (guards against the assertion block being deleted)", () => {
    // If dev deletes the AGENTS_COUNT assertion entirely, parseScriptConstant
    // returns undefined and the golden-path test becomes a false-green vacuous
    // pass. This misuse test catches that structural omission explicitly.
    const script = readScript();
    const parsed = parseScriptConstant(script, "AGENTS_COUNT");
    expect(
      parsed,
      "verify-plugin-install.sh is missing the AGENTS_COUNT assertion block — the release gate has been neutered"
    ).not.toBeUndefined();
  });

  it("SKILLS_COUNT regex must not return undefined", () => {
    const script = readScript();
    const parsed = parseScriptConstant(script, "SKILLS_COUNT");
    expect(
      parsed,
      "verify-plugin-install.sh is missing the SKILLS_COUNT assertion block — the release gate has been neutered"
    ).not.toBeUndefined();
  });

  it("HOOKS_COUNT regex must not return undefined", () => {
    const script = readScript();
    const parsed = parseScriptConstant(script, "HOOKS_COUNT");
    expect(
      parsed,
      "verify-plugin-install.sh is missing the HOOKS_COUNT assertion block — the release gate has been neutered"
    ).not.toBeUndefined();
  });

  it("AGENTS_COUNT in the script must not mismatch the filesystem agent count", () => {
    // This is the core regression guard — expressed here in the misuse section
    // as a precondition framing. The full assertion is in the golden-path block.
    // Here: assert the script constant is NOT a known-wrong sentinel value (0 or NaN).
    const script = readScript();
    const parsed = parseScriptConstant(script, "AGENTS_COUNT");
    expect(parsed).not.toBeNaN();
    expect(parsed).not.toBe(0);
  });
});

// =============================================================================
// BOUNDARY — file existence, parse robustness, regex uniqueness
// =============================================================================

describe("release-gate — boundary: required files exist and are parseable", () => {
  it("verify-plugin-install.sh exists at scripts/verify-plugin-install.sh", () => {
    expect(
      fs.existsSync(VERIFY_SCRIPT),
      "scripts/verify-plugin-install.sh is missing — cannot run the release gate at all"
    ).toBe(true);
  });

  it("hooks/hooks.json exists and is valid JSON", () => {
    expect(fs.existsSync(HOOKS_JSON), "hooks/hooks.json is missing").toBe(true);
    expect(() => JSON.parse(fs.readFileSync(HOOKS_JSON, "utf8"))).not.toThrow();
  });

  it('hooks/hooks.json top-level "hooks" key exists and is an object', () => {
    const parsed = JSON.parse(fs.readFileSync(HOOKS_JSON, "utf8")) as Record<string, unknown>;
    expect(typeof parsed.hooks).toBe("object");
    expect(parsed.hooks).not.toBeNull();
  });

  it("agents/ directory has at least 1 .md file", () => {
    const count = deriveAgentCount();
    expect(
      count,
      "agents/ directory has no .md files — the repo is in an invalid state"
    ).toBeGreaterThan(0);
  });

  it("skills/ directory has at least 1 entry", () => {
    const count = deriveSkillCount();
    expect(
      count,
      "skills/ directory has no entries — the repo is in an invalid state"
    ).toBeGreaterThan(0);
  });

  it("AGENTS_COUNT assertion appears exactly once in the script (no ambiguous multi-match)", () => {
    // If the regex matches more than one line, parseScriptConstant silently
    // uses the first — a second stale assertion could mask a drift.
    const script = readScript();
    const matchCount = countScriptConstantMatches(script, "AGENTS_COUNT");
    expect(
      matchCount,
      `AGENTS_COUNT assertion regex matched ${matchCount} times in verify-plugin-install.sh — expected exactly 1`
    ).toBe(1);
  });

  it("SKILLS_COUNT assertion appears exactly once in the script (no ambiguous multi-match)", () => {
    const script = readScript();
    const matchCount = countScriptConstantMatches(script, "SKILLS_COUNT");
    expect(
      matchCount,
      `SKILLS_COUNT assertion regex matched ${matchCount} times in verify-plugin-install.sh — expected exactly 1`
    ).toBe(1);
  });

  it("HOOKS_COUNT assertion appears exactly once in the script (no ambiguous multi-match)", () => {
    const script = readScript();
    const matchCount = countScriptConstantMatches(script, "HOOKS_COUNT");
    expect(
      matchCount,
      `HOOKS_COUNT assertion regex matched ${matchCount} times in verify-plugin-install.sh — expected exactly 1`
    ).toBe(1);
  });
});

// =============================================================================
// GOLDEN PATH — script constants match filesystem-derived counts
// =============================================================================

describe("release-gate — golden: AGENTS_COUNT matches filesystem", () => {
  it("script AGENTS_COUNT == count of flat .md files in agents/ (top-level only)", () => {
    const script = readScript();
    const scriptConstant = parseScriptConstant(script, "AGENTS_COUNT");
    const fsCount = deriveAgentCount();

    expect(
      scriptConstant,
      [
        `verify-plugin-install.sh AGENTS_COUNT is ${String(scriptConstant)} but agents/ has ${fsCount} .md files`,
        "— update the AGENTS_COUNT constant in the script before release",
      ].join(" ")
    ).toEqual(fsCount);
  });
});

describe("release-gate — golden: SKILLS_COUNT matches filesystem", () => {
  it("script SKILLS_COUNT == count of entries in skills/ (top-level only)", () => {
    const script = readScript();
    const scriptConstant = parseScriptConstant(script, "SKILLS_COUNT");
    const fsCount = deriveSkillCount();

    expect(
      scriptConstant,
      [
        `verify-plugin-install.sh SKILLS_COUNT is ${String(scriptConstant)} but skills/ has ${fsCount} entries`,
        "— update the SKILLS_COUNT constant in the script before release",
      ].join(" ")
    ).toEqual(fsCount);
  });
});

describe("release-gate — golden: HOOKS_COUNT matches hooks/hooks.json event type keys", () => {
  it("script HOOKS_COUNT == count of top-level keys under hooks.hooks (distinct event types)", () => {
    // `claude plugin details` reports hooks by distinct event type key, not by
    // individual matcher-entry objects. hooks.json has 6 event type keys:
    //   SessionStart, PreToolUse, PostToolUse, TaskCompleted, TeammateIdle,
    //   UserPromptSubmit
    // The script constant must match this derived count exactly.
    const script = readScript();
    const scriptConstant = parseScriptConstant(script, "HOOKS_COUNT");
    const derivedCount = deriveHookEventTypeCount();

    expect(
      scriptConstant,
      [
        `verify-plugin-install.sh HOOKS_COUNT is ${String(scriptConstant)} but hooks/hooks.json has ${derivedCount} event types`,
        "— update the HOOKS_COUNT constant in the script before release",
      ].join(" ")
    ).toEqual(derivedCount);
  });
});
