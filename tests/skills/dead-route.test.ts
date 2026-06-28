// =============================================================================
// tests/skills/dead-route.test.ts — QA spec for WS-DEAD-ROUTE-FIX
//
// WORKSTREAM SUMMARY:
//   Remove 5 phantom utility routes from SKILL.md (teo-validate, teo-login,
//   teo-upgrade, teo-audit, teo-process) and a stale reference to
//   "teo-validate invocations" in staff-engineer.md.
//   These skills do not exist in the plugin; the routes are dead code in the
//   prompt layer and mislead LLM routing decisions.
//
// WHAT THESE TESTS VERIFY:
//   AC-1  (misuse):    SKILL.md has zero occurrences of the 5 phantom skill names
//   AC-2  (misuse):    No-Args Mode menu does not contain backtick entries for the 5 phantoms
//   AC-3  (misuse):    SKILL.md does not contain '/teo-validate' anywhere
//   AC-4  (misuse):    staff-engineer.md lacks "teo-validate invocations" AND retains "Bash is restricted to"
//   AC-5  (boundary):  SKILL.md retains all legitimate routes and structural sections
//   AC-6  (boundary):  No .md file under src/plugin/ contains a leading-slash phantom route to any of the 5 removed skills
//   AC-7  (golden):    This test file exists and the test suite exits 0
//   AC-8  (golden):    scripts/verify-plugin-install.sh still asserts Skills (15) — count unchanged
//
// IMPLEMENTATION STATUS: GREEN — WS-DEAD-ROUTE-FIX doc changes applied.
//   All 29 tests pass. Phantom entries removed from SKILL.md (No-Args menu,
//   Path 1 routing table, Misuse Guards row) and stale teo-validate reference
//   removed from staff-engineer.md Bash constraint sentence.
//
// Test order: misuse → boundary → golden path  (QA ADR-064 policy)
// =============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Path resolution — always from repo root; never hardcoded /tmp or /Users.
// This file lives at tests/skills/dead-route.test.ts — two dirs up is repo root.
// ---------------------------------------------------------------------------
const REPO_ROOT = new URL("../../", import.meta.url).pathname;

const SKILL_MD = join(REPO_ROOT, "src", "plugin", "skills", "teo", "SKILL.md");
const STAFF_ENGINEER_MD = join(REPO_ROOT, "src", "plugin", "agents", "staff-engineer.md");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts", "verify-plugin-install.sh");

// The 5 phantom skill identifiers being removed.
const PHANTOM_SKILL_NAMES = [
  "teo-validate",
  "teo-login",
  "teo-upgrade",
  "teo-audit",
  "teo-process",
] as const;

// The 5 phantom /teo <subcommand> surface entries in No-Args Mode menu.
const PHANTOM_MENU_ENTRIES = [
  "`/teo validate`",
  "`/teo login`",
  "`/teo upgrade`",
  "`/teo audit`",
  "`/teo process`",
] as const;

// ---------------------------------------------------------------------------
// File content — loaded once at module scope.
// If a file is missing the test fails with a clear ENOENT, not an "undefined".
// ---------------------------------------------------------------------------
const skillContent = readFileSync(SKILL_MD, "utf8");
const staffContent = readFileSync(STAFF_ENGINEER_MD, "utf8");
const verifyScript = readFileSync(VERIFY_SCRIPT, "utf8");

// =============================================================================
// AC-1 (MISUSE-FIRST): SKILL.md must not contain any phantom skill identifiers.
//
// Mirrors: grep -c "teo-validate\|teo-login\|teo-audit\|teo-upgrade\|teo-process"
//
// FAILS NOW: SKILL.md contains all 5 names in the routing table and menu.
// PASSES AFTER: the Path 1 routing table and No-Args menu entries are removed.
// =============================================================================

describe("AC-1 (misuse): SKILL.md must contain zero phantom skill-name references", () => {
  for (const phantomName of PHANTOM_SKILL_NAMES) {
    it(`AC-1: SKILL.md does NOT reference '${phantomName}'`, () => {
      // MISUSE: any reference to a non-existent skill keeps the dead route alive
      // in the LLM routing layer, causing silent routing failures.
      //
      // FAILS NOW: routing table has entries like "| `login` | `/teo-login` |"
      // PASSES AFTER: all Path 1 routing table entries are deleted.
      expect(
        skillContent,
        `SKILL.md must not reference '${phantomName}' — skill does not exist`
      ).not.toContain(phantomName);
    });
  }
});

// =============================================================================
// AC-2 (MISUSE): No-Args Mode menu must not contain backtick entries for phantoms.
//
// FAILS NOW: SKILL.md No-Args Mode menu contains all 5 phantom entries.
// PASSES AFTER: those 5 lines are removed from the menu block.
// =============================================================================

describe("AC-2 (misuse): SKILL.md No-Args Mode menu must not list phantom backtick entries", () => {
  for (const entry of PHANTOM_MENU_ENTRIES) {
    it(`AC-2: No-Args menu does NOT contain '${entry}'`, () => {
      // MISUSE: a menu entry for a non-existent utility skill tells users to invoke
      // a route that will silently fail or route nowhere valid.
      //
      // FAILS NOW: e.g. "`/teo validate` — Framework structural integrity checks"
      // PASSES AFTER: the 5 Utility lines are deleted from the No-Args Mode block.
      expect(
        skillContent,
        `SKILL.md No-Args Mode menu must not include the phantom entry ${entry}`
      ).not.toContain(entry);
    });
  }
});

// =============================================================================
// AC-3 (MISUSE): SKILL.md must not contain '/teo-validate' with a leading slash.
//
// FAILS NOW: Misuse Guards table row contains "| `/teo validate` | Route to `/teo-validate` |"
// PASSES AFTER: that row is removed from the Misuse Guards table.
// =============================================================================

describe("AC-3 (misuse): SKILL.md must not contain '/teo-validate' anywhere", () => {
  it("AC-3: SKILL.md does NOT contain the string '/teo-validate'", () => {
    // MISUSE: a Misuse Guards row that routes /teo validate to /teo-validate still
    // asserts a dead skill is the authoritative handler — every other phantom could
    // reappear through a future copy-paste of this row.
    //
    // FAILS NOW: line "| `/teo validate` | Route to `/teo-validate` |" is present.
    // PASSES AFTER: that Misuse Guards row is deleted.
    expect(skillContent, "SKILL.md must not contain '/teo-validate' (dead route)").not.toContain(
      "/teo-validate"
    );
  });
});

// =============================================================================
// AC-4 (MISUSE): staff-engineer.md must not contain 'teo-validate invocations'
//                AND must still contain 'Bash is restricted to'.
//
// FAILS NOW: staff-engineer.md line 34 reads:
//   "Bash is restricted to read-only git queries, teo-validate invocations, and memory script invocations."
// PASSES AFTER: "teo-validate invocations," is removed from that sentence.
// =============================================================================

describe("AC-4 (misuse): staff-engineer.md phantom validate reference removed, sentence intact", () => {
  it("AC-4a: staff-engineer.md does NOT contain 'teo-validate invocations'", () => {
    // MISUSE: permitting 'teo-validate invocations' in the Bash constraint sentence
    // implies a non-existent skill is a valid invocation target for the staff engineer.
    //
    // FAILS NOW: the phrase is on line 34 of staff-engineer.md.
    // PASSES AFTER: "teo-validate invocations," is deleted from that sentence.
    expect(
      staffContent,
      "staff-engineer.md must not contain 'teo-validate invocations' — teo-validate does not exist"
    ).not.toContain("teo-validate invocations");
  });

  it("AC-4b: staff-engineer.md still contains 'Bash is restricted to' (sentence preserved)", () => {
    // BOUNDARY: the broader constraint sentence must survive the edit intact.
    // Deleting too much would remove legitimate Bash guards.
    //
    // PASSES NOW: the sentence exists. Must continue to pass after the fix.
    expect(
      staffContent,
      "staff-engineer.md must retain 'Bash is restricted to' — only the phantom fragment is removed"
    ).toContain("Bash is restricted to");
  });
});

// =============================================================================
// AC-5 (BOUNDARY): SKILL.md must retain all legitimate content.
//
// These are golden-path route identifiers and sections that MUST remain after
// the phantom routes are excised. Any regression here means the dev over-deleted.
//
// PASSES NOW (pre-fix) for all items below. Must continue to pass after the fix.
// =============================================================================

describe("AC-5 (boundary): SKILL.md retains all legitimate routes and structural sections", () => {
  const REQUIRED_ROUTES = [
    "/teo plan",
    "/teo build",
    "/teo fix",
    "/teo review",
    "/teo improve",
    "/teo ship",
  ];

  for (const route of REQUIRED_ROUTES) {
    it(`AC-5: SKILL.md still contains '${route}'`, () => {
      expect(skillContent, `SKILL.md must retain the legitimate route '${route}'`).toContain(route);
    });
  }

  it("AC-5: SKILL.md still contains 'Path 2: Everything Else' heading (must NOT be renamed)", () => {
    // KEY CONSTRAINT: do NOT rename "Path 2" to "Path 1" even though Path 1 is removed.
    // The heading "Path 2: Everything Else" must remain verbatim.
    expect(skillContent, "SKILL.md must retain 'Path 2: Everything Else' verbatim").toContain(
      "Path 2: Everything Else"
    );
  });

  it("AC-5: SKILL.md still contains 'G1: Capo-Delegated BUILD Routing' section", () => {
    expect(skillContent, "SKILL.md must retain the G1 BUILD routing section").toContain(
      "G1: Capo-Delegated BUILD Routing"
    );
  });
});

// =============================================================================
// AC-6 (BOUNDARY): No .md file under src/plugin/ may contain a leading-slash
//                  phantom route referencing any of the 5 removed skills.
//
// Pattern: '/<phantom-skill-name>' where phantom is one of the 5 removed skills.
//
// FAILS NOW: SKILL.md and staff-engineer.md both match.
// PASSES AFTER: all occurrences removed from both files.
// =============================================================================

/**
 * Recursively collect all .md files under a directory.
 */
function collectMdFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectMdFiles(full));
    } else if (entry.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

describe("AC-6 (boundary): no .md file under src/plugin/ contains a leading-slash phantom route", () => {
  const srcPluginDir = join(REPO_ROOT, "src", "plugin");
  const allMdFiles = collectMdFiles(srcPluginDir);

  for (const phantomName of PHANTOM_SKILL_NAMES) {
    const slashRoute = `/${phantomName}`;
    it(`AC-6: no src/plugin/**/*.md file contains '${slashRoute}'`, () => {
      // MISUSE: a leading-slash form is the clearest invocation pattern for a
      // non-existent skill — any file that still contains it after the fix
      // will keep the dead route alive.
      //
      // FAILS NOW: SKILL.md has e.g. "| `/teo-validate` |" in the routing table.
      // PASSES AFTER: all occurrences are removed.
      const offenders: string[] = [];
      for (const file of allMdFiles) {
        const content = readFileSync(file, "utf8");
        if (content.includes(slashRoute)) {
          offenders.push(file.replace(REPO_ROOT, ""));
        }
      }
      expect(
        offenders,
        `'${slashRoute}' found in: ${offenders.join(", ")} — must be removed`
      ).toHaveLength(0);
    });
  }
});

// =============================================================================
// AC-7 (GOLDEN): This test file itself exists and runs.
//
// Structural self-reference — if this file doesn't exist the suite can't run.
// PASSES NOW and must continue to pass.
// =============================================================================

describe("AC-7 (golden): test file exists and is runnable", () => {
  it("AC-7: tests/skills/dead-route.test.ts exists on disk", () => {
    const testFilePath = join(REPO_ROOT, "tests", "skills", "dead-route.test.ts");
    expect(
      existsSync(testFilePath),
      "test file must exist at tests/skills/dead-route.test.ts"
    ).toBe(true);
  });
});

// =============================================================================
// AC-8 (GOLDEN): scripts/verify-plugin-install.sh still asserts Skills (15).
//
// The 5 phantom routes are doc-only removals — no actual skill files change.
// The Skills count in the gate script must NOT change as a result of this WS.
//
// PASSES NOW and must continue to pass after the fix (regression guard).
// =============================================================================

describe("AC-8 (golden): verify-plugin-install.sh still asserts Skills (15)", () => {
  it("AC-8: scripts/verify-plugin-install.sh contains Skills count assertion of 15", () => {
    // BOUNDARY: removing the 5 phantom route descriptions from SKILL.md does NOT
    // remove any skill files from the plugin. The installed Skills count stays at 15.
    // If dev accidentally updated this count, the gate would silently accept the wrong number.
    //
    // Assert the exact assertion string the script uses to check the installed count.
    // PASSES NOW: the script has '[ "${SKILLS_COUNT}" = "15" ]'.
    // Must continue to pass after the fix — dev must NOT change this line.
    expect(
      verifyScript,
      "verify-plugin-install.sh must still check Skills count of 15 — phantom route removal does not change installed skills"
    ).toContain('"15"');
  });

  it("AC-8: scripts/verify-plugin-install.sh does NOT assert Skills (10) or any reduced count", () => {
    // MISUSE: if dev mistakenly concluded that removing 5 routes = removing 5 skills
    // and updated the gate to assert 10, the real-install gate would silently accept
    // a broken plugin.
    //
    // Assert no reduced-count assertion appears.
    expect(
      verifyScript,
      "verify-plugin-install.sh must not have Skills count reduced to 10 — phantom routes are not real skills"
    ).not.toMatch(/SKILLS_COUNT.*=.*"10"/);
  });
});
