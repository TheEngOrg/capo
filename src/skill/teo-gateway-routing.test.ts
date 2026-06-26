// STATUS: PASSING — 6 tests green (CI-stable). G1 gateway routing wired in skills/teo/SKILL.md (WS-05).
// Tests 2, 8a were expected-fail pre-impl; now pass. Tests 1b, 3, 6, 7b, 8b removed:
// .claude/skills/teo/SKILL.md is gitignored — CI can't read it (tests-only-assert-tracked-files rule).
// Mirror parity verified locally: diff skills/teo/SKILL.md .claude/skills/teo/SKILL.md
//
// WS-05: G1 gateway routing — teo/SKILL.md routes Capo-delegated BUILD requests through teo-build
//
// TEST ORDERING: misuse → boundary → golden path (ADR-064 adversarial-first policy)
//
// What these tests drive:
//   - skills/teo/SKILL.md MUST reference "teo-build" in its Delegation section
//   - .claude/skills/teo/SKILL.md (mirror) MUST be byte-identical to canonical — verified locally, not in CI
//   - The teo-build routing must NOT create an infinite loop (no "Task(teo:capo)" as the teo-build handler)
//   - Non-build requests MUST still route to Capo (existing Capo routing preserved)
//
// These are pure structural/content assertions via fs.readFileSync.
// No CLI spawns or process.env manipulation needed.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../");
const CANONICAL = path.join(REPO_ROOT, "src/plugin/skills/teo/SKILL.md");

// ---------------------------------------------------------------------------
// Helper: read a file and return its contents, throwing if unreadable
// ---------------------------------------------------------------------------
function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

// ---------------------------------------------------------------------------
// Helper: extract the Delegation section from a SKILL.md file.
// Returns the text from "## Delegation" to the next "##" section (exclusive),
// or to end-of-file if no subsequent section exists.
// ---------------------------------------------------------------------------
function extractDelegationSection(content: string): string {
  const delegationStart = content.indexOf("## Delegation");
  if (delegationStart === -1) return "";
  // Find the next top-level section after Delegation
  const afterDelegation = content.indexOf("\n## ", delegationStart + 1);
  return afterDelegation === -1
    ? content.slice(delegationStart)
    : content.slice(delegationStart, afterDelegation);
}

// =============================================================================
// MISUSE / GUARD TESTS — assert what must NOT happen when G1 is absent
// =============================================================================

describe("WS-05 G1 gateway — misuse/guard: files exist and are readable", () => {
  // Test 1: Canonical file is readable. If missing, everything else is moot.
  it("1. canonical SKILL.md exists and is readable", () => {
    expect(() => readFile(CANONICAL)).not.toThrow();
    const content = readFile(CANONICAL);
    expect(content.length).toBeGreaterThan(0);
  });

  // 1b REMOVED: .claude/skills/teo/SKILL.md is gitignored — CI can't read it.
  // Mirror parity verified locally: diff skills/teo/SKILL.md .claude/skills/teo/SKILL.md

  // Test 2: Canonical MUST reference "teo-build" in its Delegation section.
  it("2. canonical Delegation section references 'teo-build'", () => {
    const content = readFile(CANONICAL);
    const delegation = extractDelegationSection(content);
    expect(delegation).not.toBe(""); // Delegation section must exist
    expect(delegation).toContain("teo-build");
  });

  // Test 3 REMOVED: .claude/skills/teo/SKILL.md is gitignored — CI can't read it.
});

// =============================================================================
// BOUNDARY TESTS — routing logic constraints
// =============================================================================

describe("WS-05 G1 gateway — boundary: routing logic must not create loops or remove Capo fallback", () => {
  // Test 4: teo-build routing must NOT itself invoke Capo (infinite loop guard).
  // Strategy: assert that "teo-build" and "Task(teo:capo)" don't appear on the same line.
  it("4. canonical: 'teo-build' routing does not loop back to Task(teo:capo) on the same line", () => {
    const content = readFile(CANONICAL);
    const lines = content.split("\n");
    const loopingLines = lines.filter(
      (line) => line.includes("teo-build") && line.includes("Task(teo:capo)")
    );
    expect(loopingLines).toHaveLength(0);
  });

  // Test 5: Capo routing must still be present for non-build requests.
  it("5. canonical still contains teo:capo routing (non-build requests still go to Capo)", () => {
    const content = readFile(CANONICAL);
    const hasCapoRouting = content.includes("teo:capo") || content.includes("Task(teo:capo)");
    expect(hasCapoRouting).toBe(true);
  });
});

// =============================================================================
// GOLDEN PATH TESTS — content correctness
// =============================================================================

describe("WS-05 G1 gateway — golden path: content correctness", () => {
  // Test 6 REMOVED: .claude/skills/teo/SKILL.md is gitignored — byte-identical assertion
  // would be false-green locally, red in CI. Mirror parity verified at push time locally.

  // Test 7a: Canonical has valid YAML frontmatter.
  it("7a. canonical has valid YAML frontmatter (starts with ---, contains name: teo)", () => {
    const content = readFile(CANONICAL);
    expect(content.startsWith("---")).toBe(true);
    expect(content).toContain("name: teo");
  });

  // Test 7b REMOVED: .claude/skills/teo/SKILL.md is gitignored — CI can't read it.

  // Test 8a: Canonical Delegation section references teo-build.
  it("8a. canonical Delegation section references teo-build (content check)", () => {
    const content = readFile(CANONICAL);
    const delegation = extractDelegationSection(content);
    expect(delegation).toContain("teo-build");
  });

  // Test 8b REMOVED: .claude/skills/teo/SKILL.md is gitignored — CI can't read it.
});
