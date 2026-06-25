// STATUS: FAILING (tests 2, 3, 6, 8) — G1 gateway routing not yet wired in skills/teo/SKILL.md
// Tests 1, 4, 5, 7 should pass; tests 2, 3, 6, 8 fail until dev implements G1 wire
//
// WS-05: G1 gateway routing — teo/SKILL.md routes Capo-delegated BUILD requests through teo-build
//
// TEST ORDERING: misuse → boundary → golden path (ADR-064 adversarial-first policy)
//
// What these tests drive:
//   - skills/teo/SKILL.md MUST reference "teo-build" in its Delegation section
//   - .claude/skills/teo/SKILL.md (mirror) MUST be byte-identical to canonical
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
const CANONICAL = path.join(REPO_ROOT, "skills/teo/SKILL.md");
const MIRROR = path.join(REPO_ROOT, ".claude/skills/teo/SKILL.md");

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
  // Test 1: Both files are readable. If either file is missing, everything else is moot.
  // This SHOULD pass before and after dev's change.
  it("1. canonical SKILL.md exists and is readable", () => {
    expect(() => readFile(CANONICAL)).not.toThrow();
    const content = readFile(CANONICAL);
    expect(content.length).toBeGreaterThan(0);
  });

  it("1b. mirror SKILL.md exists and is readable", () => {
    expect(() => readFile(MIRROR)).not.toThrow();
    const content = readFile(MIRROR);
    expect(content.length).toBeGreaterThan(0);
  });

  // Test 2: Canonical MUST reference "teo-build" in its Delegation section.
  // FAILS until dev adds the G1 routing wire to skills/teo/SKILL.md.
  it("2. [EXPECTED FAIL] canonical Delegation section references 'teo-build'", () => {
    const content = readFile(CANONICAL);
    const delegation = extractDelegationSection(content);
    expect(delegation).not.toBe(""); // Delegation section must exist
    expect(delegation).toContain("teo-build");
  });

  // Test 3: Mirror MUST reference "teo-build" in its Delegation section.
  // FAILS until dev adds the G1 routing wire AND syncs the mirror.
  it("3. [EXPECTED FAIL] mirror Delegation section references 'teo-build'", () => {
    const content = readFile(MIRROR);
    const delegation = extractDelegationSection(content);
    expect(delegation).not.toBe(""); // Delegation section must exist
    expect(delegation).toContain("teo-build");
  });
});

// =============================================================================
// BOUNDARY TESTS — routing logic constraints
// =============================================================================

describe("WS-05 G1 gateway — boundary: routing logic must not create loops or remove Capo fallback", () => {
  // Test 4: teo-build routing must NOT itself invoke Capo (infinite loop guard).
  // The Delegation section may mention Capo elsewhere, but the specific text that
  // handles teo-build-delegated BUILD work must not route back to "Task(teo:capo)".
  //
  // Strategy: assert that the phrase "teo-build" does not appear on the same line
  // as "Task(teo:capo)" in the canonical file. This catches the naive mis-wiring
  // where a dev writes "if BUILD → Task(teo:capo)" instead of "if BUILD → Task(teo-build)".
  //
  // This SHOULD pass even before dev's change (because teo-build isn't mentioned at all yet).
  it("4. canonical: 'teo-build' routing does not loop back to Task(teo:capo) on the same line", () => {
    const content = readFile(CANONICAL);
    const lines = content.split("\n");
    const loopingLines = lines.filter(
      (line) => line.includes("teo-build") && line.includes("Task(teo:capo)")
    );
    expect(loopingLines).toHaveLength(0);
  });

  // Test 5: Capo routing must still be present for non-build requests.
  // The gateway MUST preserve "teo:capo" as a routing target — we're adding a
  // wire, not replacing Capo. If this fails after dev's change, dev broke the Capo fallback.
  //
  // This SHOULD pass before dev's change (Capo routing is there now) and MUST still
  // pass after dev's change (we're adding teo-build alongside Capo, not replacing it).
  it("5. canonical still contains teo:capo routing (non-build requests still go to Capo)", () => {
    const content = readFile(CANONICAL);
    // Either the Task invocation pattern or the subagent_type reference is acceptable
    const hasCapoRouting = content.includes("teo:capo") || content.includes("Task(teo:capo)");
    expect(hasCapoRouting).toBe(true);
  });
});

// =============================================================================
// MIRROR PARITY TESTS (golden path)
// =============================================================================

describe("WS-05 G1 gateway — mirror parity: canonical and mirror must be byte-identical", () => {
  // Test 6: Canonical and mirror are byte-identical.
  // FAILS right now because the WS-03 parity incident left the files diverged.
  // Dev must bring the mirror in sync as part of the G1 implementation.
  // This test MUST pass after dev's change.
  it("6. [EXPECTED FAIL] canonical and mirror are byte-identical", () => {
    const canonical = readFile(CANONICAL);
    const mirror = readFile(MIRROR);
    expect(mirror).toBe(canonical);
  });

  // Test 7: Both files have valid YAML frontmatter.
  // SHOULD pass before and after dev's change. If this fails, the file was corrupted.
  it("7a. canonical has valid YAML frontmatter (starts with ---, contains name: teo)", () => {
    const content = readFile(CANONICAL);
    expect(content.startsWith("---")).toBe(true);
    expect(content).toContain("name: teo");
  });

  it("7b. mirror has valid YAML frontmatter (starts with ---, contains name: teo)", () => {
    const content = readFile(MIRROR);
    expect(content.startsWith("---")).toBe(true);
    expect(content).toContain("name: teo");
  });

  // Test 8: Both files reference teo-build in the Delegation section.
  // FAILS until dev adds the G1 wire to BOTH canonical and mirror.
  // This is the combined assertion for the parity + content requirement.
  it("8a. [EXPECTED FAIL] canonical Delegation section references teo-build (parity content check)", () => {
    const content = readFile(CANONICAL);
    const delegation = extractDelegationSection(content);
    expect(delegation).toContain("teo-build");
  });

  it("8b. [EXPECTED FAIL] mirror Delegation section references teo-build (parity content check)", () => {
    const content = readFile(MIRROR);
    const delegation = extractDelegationSection(content);
    expect(delegation).toContain("teo-build");
  });
});
