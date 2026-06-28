// =============================================================================
// dead-route.test.ts — WS-DEAD-ROUTE-FIX characterization tests
//
// WHAT THESE TESTS VERIFY:
//   Remove 5 phantom utility routes from src/plugin/skills/teo/SKILL.md:
//     teo-validate, teo-login, teo-audit, teo-upgrade, teo-process
//   These appear in three locations within SKILL.md:
//     1. No-Args menu (Utility section)
//     2. Path 1 routing table (keyword→skill mappings)
//     3. Misuse Guards row (teo-validate row)
//
//   Also remove the "teo-validate invocations," fragment from
//   src/plugin/agents/staff-engineer.md Bash constraint sentence.
//
// IMPLEMENTATION STATUS: COMPLETE — all 43 tests PASS (WS-DEAD-ROUTE-FIX applied).
//
// AFFECTED FILES:
//   src/plugin/skills/teo/SKILL.md
//   src/plugin/agents/staff-engineer.md
//
// Test order: misuse → boundary → golden path  (QA ADR-064 policy)
// =============================================================================

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Path helpers — resolve from repo root (tests/skills/ is two levels below root)
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SKILL_MD = path.join(REPO_ROOT, "src", "plugin", "skills", "teo", "SKILL.md");
const STAFF_ENGINEER_MD = path.join(REPO_ROOT, "src", "plugin", "agents", "staff-engineer.md");

const skillContent = fs.readFileSync(SKILL_MD, "utf8");
const staffContent = fs.readFileSync(STAFF_ENGINEER_MD, "utf8");

// ---------------------------------------------------------------------------
// The 5 phantom skills to be removed
// ---------------------------------------------------------------------------
const PHANTOM_SKILLS = [
  "teo-validate",
  "teo-login",
  "teo-audit",
  "teo-upgrade",
  "teo-process",
] as const;

// ---------------------------------------------------------------------------
// The 15 real skills that must remain intact (as directories under src/plugin/skills/)
// ---------------------------------------------------------------------------
const REAL_SKILLS = [
  "teo",
  "teo-accessibility-review",
  "teo-add-context",
  "teo-assess",
  "teo-assess-tech",
  "teo-build",
  "teo-code-review",
  "teo-debug",
  "teo-design",
  "teo-design-review",
  "teo-document",
  "teo-refactor",
  "teo-security-review",
  "teo-spec",
  "teo-tidy",
] as const;

const SKILLS_DIR = path.join(REPO_ROOT, "src", "plugin", "skills");

// =============================================================================
// MISUSE — phantom routes must NOT appear anywhere in SKILL.md after the fix.
//
// These tests FAIL NOW because the phantom routes ARE present.
// They PASS after the fix removes all 5 phantom routes.
// =============================================================================

describe("misuse: DEAD-ROUTE — phantom skills must not appear in No-Args menu", () => {
  it("DEAD-ROUTE-01: No-Args menu does not list /teo validate", () => {
    // PASSES: the validate menu entry was removed from the No-Args Utility section
    expect(skillContent).not.toContain("/teo validate");
  });

  it("DEAD-ROUTE-02: No-Args menu does not list /teo login", () => {
    // PASSES: the login menu entry was removed from the No-Args Utility section
    expect(skillContent).not.toContain("/teo login");
  });

  it("DEAD-ROUTE-03: No-Args menu does not list /teo audit", () => {
    // PASSES: the audit menu entry was removed from the No-Args Utility section
    expect(skillContent).not.toContain("/teo audit");
  });

  it("DEAD-ROUTE-04: No-Args menu does not list /teo upgrade", () => {
    // PASSES: the upgrade menu entry was removed from the No-Args Utility section
    expect(skillContent).not.toContain("/teo upgrade");
  });

  it("DEAD-ROUTE-05: No-Args menu does not list /teo process", () => {
    // PASSES: the process menu entry was removed from the No-Args Utility section
    expect(skillContent).not.toContain("/teo process");
  });
});

describe("misuse: DEAD-ROUTE — phantom skills must not appear in Path 1 routing table", () => {
  it("DEAD-ROUTE-06: Path 1 table does not route to /teo-validate", () => {
    // PASSES: the teo-validate row was removed from the Path 1 table
    expect(skillContent).not.toContain("/teo-validate");
  });

  it("DEAD-ROUTE-07: Path 1 table does not route to /teo-login", () => {
    // PASSES: the teo-login row was removed from the Path 1 table
    expect(skillContent).not.toContain("/teo-login");
  });

  it("DEAD-ROUTE-08: Path 1 table does not route to /teo-audit", () => {
    // PASSES: the teo-audit row was removed from the Path 1 table
    expect(skillContent).not.toContain("/teo-audit");
  });

  it("DEAD-ROUTE-09: Path 1 table does not route to /teo-upgrade", () => {
    // PASSES: the teo-upgrade row was removed from the Path 1 table
    expect(skillContent).not.toContain("/teo-upgrade");
  });

  it("DEAD-ROUTE-10: Path 1 table does not route to /teo-process", () => {
    // PASSES: the teo-process row was removed from the Path 1 table
    expect(skillContent).not.toContain("/teo-process");
  });
});

describe("misuse: DEAD-ROUTE — phantom skill strings absent from Misuse Guards", () => {
  it("DEAD-ROUTE-11: Misuse Guards does not contain a teo-validate guard row", () => {
    // PASSES: the '/teo validate' → 'Route to /teo-validate' row was removed from Misuse Guards
    expect(skillContent).not.toContain("Route to `/teo-validate`");
  });
});

describe("misuse: DEAD-ROUTE — staff-engineer.md Bash constraint must not name teo-validate", () => {
  it("DEAD-ROUTE-12: staff-engineer.md does not contain 'teo-validate invocations'", () => {
    // PASSES: 'teo-validate invocations,' was removed from the Bash constraint sentence
    expect(staffContent).not.toContain("teo-validate invocations");
  });
});

// =============================================================================
// BOUNDARY — invariants that must hold both before AND after the fix.
//
// Real skills survive; structural elements like Path 2 and No-Args Capo section
// are untouched.
// =============================================================================

describe("boundary: DEAD-ROUTE — real skill directories are preserved on disk", () => {
  for (const skill of REAL_SKILLS) {
    it(`DEAD-ROUTE-BOUNDARY: skill directory '${skill}' still exists on disk`, () => {
      // The fix touches only the routing text inside SKILL.md — it must NOT
      // remove or rename any actual skill directory.
      // PASSES before AND after the fix (these dirs are untouched).
      const skillDir = path.join(SKILLS_DIR, skill);
      expect(fs.existsSync(skillDir), `skills/${skill}/ must still exist`).toBe(true);
    });
  }
});

describe("boundary: DEAD-ROUTE — Path 2 heading is unchanged", () => {
  it("DEAD-ROUTE-BOUNDARY: SKILL.md still contains 'Path 2: Everything Else → Capo' heading", () => {
    // The workstream spec says: do NOT rename 'Path 2' heading.
    // This asserts the heading survives verbatim.
    expect(skillContent).toContain("### Path 2: Everything Else → Capo");
  });
});

describe("boundary: DEAD-ROUTE — No-Args Capo-Orchestrated block is preserved", () => {
  it("DEAD-ROUTE-BOUNDARY: No-Args menu Capo-Orchestrated section still present", () => {
    // The fix removes only the Utility section's 5 phantom entries.
    // The Capo-Orchestrated sub-block (/teo plan, /teo build, etc.) must remain.
    expect(skillContent).toContain("**Capo-Orchestrated:**");
  });

  it("DEAD-ROUTE-BOUNDARY: /teo build entry still present in No-Args menu", () => {
    expect(skillContent).toContain("/teo build");
  });

  it("DEAD-ROUTE-BOUNDARY: /teo plan entry still present in No-Args menu", () => {
    expect(skillContent).toContain("/teo plan");
  });
});

describe("boundary: DEAD-ROUTE — phantom skill names absent from entire SKILL.md", () => {
  // Comprehensive sweep: after the fix, none of the 5 phantom skill names
  // should appear ANYWHERE in SKILL.md (menu, table, prose, guard).
  // These are equivalent to the misuse assertions above but expressed as a
  // parameterized loop across ALL occurrences — not just specific table locations.
  for (const skill of PHANTOM_SKILLS) {
    it(`DEAD-ROUTE-SWEEP: '${skill}' does not appear anywhere in SKILL.md`, () => {
      // PASSES: all occurrences of each phantom skill were removed from SKILL.md
      expect(skillContent).not.toContain(skill);
    });
  }
});

describe("boundary: DEAD-ROUTE — staff-engineer.md Bash constraint still references git and memory", () => {
  it("DEAD-ROUTE-BOUNDARY: staff-engineer.md Bash constraint still mentions git queries", () => {
    // The fix only removes 'teo-validate invocations,' from the Bash sentence.
    // The rest of the sentence (git queries, memory script invocations) must remain.
    expect(staffContent).toMatch(/Bash is restricted to read-only git queries/i);
  });

  it("DEAD-ROUTE-BOUNDARY: staff-engineer.md Bash constraint still mentions memory script invocations", () => {
    expect(staffContent).toContain("memory script invocations");
  });
});

// =============================================================================
// GOLDEN PATH — full post-implementation state.
//
// These assert the complete desired state after the fix and PASS only after
// ALL phantom routes are removed and all real routes are intact.
// =============================================================================

describe("golden: DEAD-ROUTE — post-fix SKILL.md has no phantom routes, all real routes intact", () => {
  it("DEAD-ROUTE-GOLDEN-01: no phantom skill appears anywhere in SKILL.md", () => {
    // Belt-and-suspenders: single assertion covering all 5 phantom skills.
    for (const skill of PHANTOM_SKILLS) {
      expect(skillContent, `'${skill}' must not appear in SKILL.md`).not.toContain(skill);
    }
  });

  it("DEAD-ROUTE-GOLDEN-02: all 15 real skill directories still exist on disk", () => {
    // The fix only edits routing text in SKILL.md — no skill directory should
    // be removed or renamed as a side effect.
    for (const skill of REAL_SKILLS) {
      const skillDir = path.join(SKILLS_DIR, skill);
      expect(fs.existsSync(skillDir), `skills/${skill}/ must still exist`).toBe(true);
    }
  });

  it("DEAD-ROUTE-GOLDEN-03: staff-engineer.md Bash constraint has no teo-validate reference", () => {
    expect(staffContent).not.toContain("teo-validate");
  });

  it("DEAD-ROUTE-GOLDEN-04: staff-engineer.md Bash constraint sentence is intact minus phantom fragment", () => {
    // After removing 'teo-validate invocations,' the sentence should still be
    // grammatically complete and contain git + memory references.
    expect(staffContent).toMatch(
      /Bash is restricted to read-only git queries.*memory script invocations/s
    );
  });

  it("DEAD-ROUTE-GOLDEN-05: SKILL.md No-Args Utility section has no entries", () => {
    // After the fix the '**Utility:**' heading either disappears or has no entries beneath it.
    // Assert that no '/teo <phantom>' line follows the Utility heading.
    const utilitySection = skillContent.match(
      /\*\*Utility:\*\*([\s\S]*?)\*\*Capo-Orchestrated:\*\*/
    );
    if (utilitySection) {
      // If the Utility heading still exists, it should have no route entries beneath it
      const between = utilitySection[1];
      expect(between).not.toMatch(/`\/teo \w/);
    }
    // If the Utility heading was removed entirely, this test passes vacuously — that is correct.
  });
});
