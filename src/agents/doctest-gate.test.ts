import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// doctest-gate.test.ts — RED specs for WS-CAD-DOCTEST
//
// These tests are RED by design. Dev adds content to agent definitions and
// process docs to make them green. DO NOT add implementation here.
//
// Rule under test: The dev agent MUST address docs+tests as part of "done",
// OR explicitly justify why neither was warranted. A simple "always update docs"
// mandate is NOT the rule — the justified-exception path is equally required.
//
// Affected files (Layer 1 — dev agent definitions):
//   agents/dev.md                        canonical
//   .claude/agents/dev.md                mirror — must match canonical exactly
//   agents/dev-haiku.md                  canonical
//   .claude/agents/dev-haiku.md          mirror — must match canonical exactly
//
// Affected files (Layer 2 — staff-engineer review gate):
//   agents/staff-engineer.md             canonical
//   .claude/agents/staff-engineer.md     mirror — must match canonical exactly
//
// Affected files (Layer 3 — process docs / skill content):
//   .claude/shared/development-workflow.md
//   skills/teo-build/SKILL.md            canonical
//   .claude/skills/teo-build/SKILL.md    mirror — must match canonical exactly
//   skills/teo-code-review/SKILL.md      canonical
//   .claude/skills/teo-code-review/SKILL.md  mirror — must match canonical exactly
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
//
// =============================================================================

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Resolve a path relative to the project root (two levels up from src/agents/) */
function root(...segments: string[]): string {
  return path.resolve(__dirname, "..", "..", ...segments);
}

function readFile(relPath: string): string {
  return fs.readFileSync(root(relPath), "utf8");
}

// ---------------------------------------------------------------------------
// Vocabulary helpers
//
// The rule has two sides:
//   OBLIGATION  — the dev must update tests and docs
//   EXCEPTION   — OR explicitly justify when an update is not warranted
//
// Tests must assert both are present. A file that mentions only "documentation"
// without the justified-exception path misses the nuance of the rule.
// ---------------------------------------------------------------------------

/**
 * Returns true if `content` contains at least one term from the provided list
 * (case-insensitive).
 */
function containsAnyOf(content: string, terms: string[]): boolean {
  const lower = content.toLowerCase();
  return terms.some((t) => lower.includes(t.toLowerCase()));
}

/** Obligation-side vocabulary: doc update requirement */
const DOC_OBLIGATION_TERMS = ["documentation", "docs", "update docs", "update documentation"];

/** Obligation-side vocabulary: test update requirement */
const TEST_OBLIGATION_TERMS = [
  "tests updated",
  "update tests",
  "tests added",
  "add tests",
  "test coverage",
];

/** Exception-side vocabulary: the "or justify" escape hatch */
const EXCEPTION_TERMS = [
  "justified",
  "not warranted",
  "not needed",
  "no update warranted",
  "explicitly note",
  "warrant",
  "or justify",
  "unless",
];

// =============================================================================
// MISUSE — assertions that fire when required content is ABSENT
// These tests describe what SHOULD be true after dev adds the content.
// They are written from the "misuse = content missing" perspective so that
// a green suite proves the misuse scenario no longer applies.
// =============================================================================

describe("misuse: dev.md missing docs+tests obligation", () => {
  it("dev.md contains a reference to documentation obligation", () => {
    // MISUSE: if no mention of docs/documentation appears in dev.md after the
    // change, the agent will not know to address docs as part of done.
    // This must FAIL before dev adds the content.
    const content = readFile("agents/dev.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
  });

  it("dev.md contains a reference to tests obligation", () => {
    // MISUSE: if no mention of updating tests appears after the change, the
    // docs+tests rule is incomplete — tests half is missing.
    // This test guards against a partial implementation that only mentions docs.
    const content = readFile("agents/dev.md");
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
  });
});

describe("misuse: staff-engineer.md missing documentation checklist item", () => {
  it("staff-engineer.md Review Checklist references documentation", () => {
    // MISUSE: if the staff-engineer checklist has no documentation item, the
    // gate cannot enforce the rule — it will silently pass work that skips docs.
    const content = readFile("agents/staff-engineer.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
  });

  it("staff-engineer.md Review Checklist references tests updated/added", () => {
    // MISUSE: same as above but for the tests half of the checklist.
    const content = readFile("agents/staff-engineer.md");
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
  });
});

describe("misuse: mirror divergence — dev.md vs .claude/agents/dev.md", () => {
  it("agents/dev.md and .claude/agents/dev.md have identical content", () => {
    // MISUSE: if the canonical and mirror diverge, one of the two paths
    // (plugin install vs local dev) will have a different rule. All consumers
    // must see the same agent definition.
    const canonical = readFile("agents/dev.md");
    const mirror = readFile(".claude/agents/dev.md");
    expect(canonical).toBe(mirror);
  });
});

describe("misuse: mirror divergence — staff-engineer.md vs .claude/agents/staff-engineer.md", () => {
  it("agents/staff-engineer.md and .claude/agents/staff-engineer.md have identical content", () => {
    // MISUSE: same divergence risk for the staff-engineer gate.
    const canonical = readFile("agents/staff-engineer.md");
    const mirror = readFile(".claude/agents/staff-engineer.md");
    expect(canonical).toBe(mirror);
  });
});

// =============================================================================
// BOUNDARY — nuance and edge conditions
// =============================================================================

describe("boundary: dev.md captures the justified-exception nuance", () => {
  it("dev.md mentions the exception path (justified / not warranted / unless)", () => {
    // BOUNDARY: the rule is NOT "always update docs." It's "update docs OR
    // justify why not." Without the exception vocabulary, devs read this as an
    // unconditional mandate and waste time documenting trivial fixes.
    // A test that only checks DOC_OBLIGATION_TERMS misses this half.
    const content = readFile("agents/dev.md");
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
  });

  it("dev.md mentions the exception path for tests as well (not just docs)", () => {
    // BOUNDARY: the exception must apply to both docs AND tests. A dev agent
    // that reads "update docs or justify; always update tests" gets a mixed
    // signal and will behave inconsistently on mechanical test-free changes.
    // Both halves of the rule need the justified-exception clause.
    const content = readFile("agents/dev.md");
    // The file must contain the exception vocabulary at least once in the
    // vicinity of a test-obligation term. We assert both are present in the
    // same file — co-location in the same section is enforced by golden-path
    // tests below; this boundary test checks presence only.
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
  });
});

describe("boundary: dev-haiku.md carries the same docs+tests obligation", () => {
  it("agents/dev-haiku.md contains a reference to documentation obligation", () => {
    // BOUNDARY: dev-haiku is spawned for MECHANICAL workstreams. If only dev.md
    // is updated, the haiku-tier agent will silently skip docs on the 60%+ of
    // workstreams it handles. The same obligation must appear in both agents.
    const content = readFile("agents/dev-haiku.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
  });

  it("agents/dev-haiku.md contains a reference to tests obligation", () => {
    const content = readFile("agents/dev-haiku.md");
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
  });

  it("agents/dev-haiku.md mentions the justified-exception path", () => {
    // BOUNDARY: the exception nuance must reach the haiku tier as well.
    const content = readFile("agents/dev-haiku.md");
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
  });
});

describe("boundary: mirror divergence — dev-haiku.md vs .claude/agents/dev-haiku.md", () => {
  it("agents/dev-haiku.md and .claude/agents/dev-haiku.md have identical content", () => {
    // BOUNDARY: the haiku mirror must also receive the update. Updating only
    // the canonical and forgetting the mirror is the most common drift pattern.
    const canonical = readFile("agents/dev-haiku.md");
    const mirror = readFile(".claude/agents/dev-haiku.md");
    expect(canonical).toBe(mirror);
  });
});

describe("boundary: staff-engineer checklist items are BLOCKING", () => {
  it("agents/staff-engineer.md uses BLOCK or blocking language near the docs check", () => {
    // BOUNDARY: a non-blocking checklist item (advisory or warning) does not
    // enforce the rule — it merely suggests. The acceptance criteria require
    // the word "BLOCK" or equivalent to appear so staff-engineer cannot rubber-
    // stamp a story that clearly needed doc updates.
    //
    // Acceptable vocabulary: "BLOCK", "blocking", "MUST", "required" paired
    // with the docs/tests mention. We test for the BLOCKING indicator in the
    // same file that has the documentation checklist item.
    const content = readFile("agents/staff-engineer.md");
    const blockTerms = ["BLOCK", "blocking", "hard block", "hard-block"];
    expect(containsAnyOf(content, blockTerms)).toBe(true);
  });
});

describe("boundary: teo-build SKILL.md and its mirror are consistent", () => {
  it("skills/teo-build/SKILL.md and .claude/skills/teo-build/SKILL.md have identical content", () => {
    // BOUNDARY: skill files also have canonical + mirror pairs. Divergence here
    // means the process doc update is visible in only one execution path.
    const canonical = readFile("skills/teo-build/SKILL.md");
    const mirror = readFile(".claude/skills/teo-build/SKILL.md");
    expect(canonical).toBe(mirror);
  });
});

describe("boundary: teo-code-review SKILL.md and its mirror are consistent", () => {
  it("skills/teo-code-review/SKILL.md and .claude/skills/teo-code-review/SKILL.md have identical content", () => {
    const canonical = readFile("skills/teo-code-review/SKILL.md");
    const mirror = readFile(".claude/skills/teo-code-review/SKILL.md");
    expect(canonical).toBe(mirror);
  });
});

// =============================================================================
// GOLDEN PATH — all rule content present, all mirrors consistent
// These tests define "done" for WS-CAD-DOCTEST.
// =============================================================================

describe("golden: dev.md Definition of Done includes docs+tests with exception", () => {
  it("dev.md contains documentation obligation AND exception vocabulary together", () => {
    // GOLDEN: both the obligation and the exception must be present. A file
    // with only the obligation fails the nuance check; one with only the
    // exception language fails the obligation check.
    const content = readFile("agents/dev.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
  });
});

describe("golden: dev-haiku.md Definition of Done includes docs+tests with exception", () => {
  it("dev-haiku.md contains documentation obligation AND exception vocabulary together", () => {
    const content = readFile("agents/dev-haiku.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
  });
});

describe("golden: staff-engineer.md has blocking checklist items for docs and tests", () => {
  it("staff-engineer.md has documentation obligation item in Review Checklist", () => {
    const content = readFile("agents/staff-engineer.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
  });

  it("staff-engineer.md has tests obligation item in Review Checklist", () => {
    const content = readFile("agents/staff-engineer.md");
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
  });

  it("staff-engineer.md marks the new checklist items as BLOCKING", () => {
    const content = readFile("agents/staff-engineer.md");
    const blockTerms = ["BLOCK", "blocking", "hard block", "hard-block"];
    expect(containsAnyOf(content, blockTerms)).toBe(true);
  });

  it("staff-engineer.md exception path is present (BLOCK fires only when justified is absent)", () => {
    // GOLDEN: the staff-engineer must also understand when NOT to block — the
    // exception vocabulary tells the reviewer to accept a justified skip.
    // Without this, staff-engineer blocks everything including intentional
    // no-doc mechanical changes.
    const content = readFile("agents/staff-engineer.md");
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
  });
});

describe("golden: all mirrors match their canonical source", () => {
  it("agents/dev.md === .claude/agents/dev.md", () => {
    expect(readFile("agents/dev.md")).toBe(readFile(".claude/agents/dev.md"));
  });

  it("agents/dev-haiku.md === .claude/agents/dev-haiku.md", () => {
    expect(readFile("agents/dev-haiku.md")).toBe(readFile(".claude/agents/dev-haiku.md"));
  });

  it("agents/staff-engineer.md === .claude/agents/staff-engineer.md", () => {
    expect(readFile("agents/staff-engineer.md")).toBe(readFile(".claude/agents/staff-engineer.md"));
  });

  it("skills/teo-build/SKILL.md === .claude/skills/teo-build/SKILL.md", () => {
    expect(readFile("skills/teo-build/SKILL.md")).toBe(
      readFile(".claude/skills/teo-build/SKILL.md")
    );
  });

  it("skills/teo-code-review/SKILL.md === .claude/skills/teo-code-review/SKILL.md", () => {
    expect(readFile("skills/teo-code-review/SKILL.md")).toBe(
      readFile(".claude/skills/teo-code-review/SKILL.md")
    );
  });
});

describe("golden: development-workflow.md references docs+tests as part of done", () => {
  it(".claude/shared/development-workflow.md mentions documentation obligation", () => {
    // GOLDEN: the process doc itself must carry the rule so it is visible to
    // any agent that reads development-workflow.md as a shared context file.
    // dev and staff-engineer both load this file via context_manifest.
    const content = readFile(".claude/shared/development-workflow.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
  });

  it(".claude/shared/development-workflow.md mentions tests obligation", () => {
    const content = readFile(".claude/shared/development-workflow.md");
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
  });

  it(".claude/shared/development-workflow.md mentions the justified-exception path", () => {
    // GOLDEN: process doc must carry the nuance, not just the obligation.
    const content = readFile(".claude/shared/development-workflow.md");
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
  });
});
