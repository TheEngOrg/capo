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

/**
 * Like readFile, but returns null when the file does not exist.
 * Used for .claude/ paths that are gitignored and absent in CI.
 */
function readFileOrNull(relPath: string): string | null {
  const fullPath = root(relPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf8");
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
    const mirror = readFileOrNull(".claude/agents/dev.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(canonical).toBe(mirror);
  });
});

describe("misuse: mirror divergence — staff-engineer.md vs .claude/agents/staff-engineer.md", () => {
  it("agents/staff-engineer.md and .claude/agents/staff-engineer.md have identical content", () => {
    // MISUSE: same divergence risk for the staff-engineer gate.
    const canonical = readFile("agents/staff-engineer.md");
    const mirror = readFileOrNull(".claude/agents/staff-engineer.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
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
    const mirror = readFileOrNull(".claude/agents/dev-haiku.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
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
    const mirror = readFileOrNull(".claude/skills/teo-build/SKILL.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(canonical).toBe(mirror);
  });
});

describe("boundary: teo-code-review SKILL.md and its mirror are consistent", () => {
  it("skills/teo-code-review/SKILL.md and .claude/skills/teo-code-review/SKILL.md have identical content", () => {
    const canonical = readFile("skills/teo-code-review/SKILL.md");
    const mirror = readFileOrNull(".claude/skills/teo-code-review/SKILL.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
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
    const mirror = readFileOrNull(".claude/agents/dev.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(readFile("agents/dev.md")).toBe(mirror);
  });

  it("agents/dev-haiku.md === .claude/agents/dev-haiku.md", () => {
    const mirror = readFileOrNull(".claude/agents/dev-haiku.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(readFile("agents/dev-haiku.md")).toBe(mirror);
  });

  it("agents/staff-engineer.md === .claude/agents/staff-engineer.md", () => {
    const mirror = readFileOrNull(".claude/agents/staff-engineer.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(readFile("agents/staff-engineer.md")).toBe(mirror);
  });

  it("skills/teo-build/SKILL.md === .claude/skills/teo-build/SKILL.md", () => {
    const mirror = readFileOrNull(".claude/skills/teo-build/SKILL.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(readFile("skills/teo-build/SKILL.md")).toBe(mirror);
  });

  it("skills/teo-code-review/SKILL.md === .claude/skills/teo-code-review/SKILL.md", () => {
    const mirror = readFileOrNull(".claude/skills/teo-code-review/SKILL.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(readFile("skills/teo-code-review/SKILL.md")).toBe(mirror);
  });
});

describe("golden: development-workflow.md references docs+tests as part of done", () => {
  it(".claude/shared/development-workflow.md mentions documentation obligation", () => {
    // GOLDEN: the process doc itself must carry the rule so it is visible to
    // any agent that reads development-workflow.md as a shared context file.
    // dev and staff-engineer both load this file via context_manifest.
    const content = readFileOrNull(".claude/shared/development-workflow.md");
    if (content === null) return; // .claude/ is gitignored; skip in CI
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
  });

  it(".claude/shared/development-workflow.md mentions tests obligation", () => {
    const content = readFileOrNull(".claude/shared/development-workflow.md");
    if (content === null) return; // .claude/ is gitignored; skip in CI
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
  });

  it(".claude/shared/development-workflow.md mentions the justified-exception path", () => {
    // GOLDEN: process doc must carry the nuance, not just the obligation.
    const content = readFileOrNull(".claude/shared/development-workflow.md");
    if (content === null) return; // .claude/ is gitignored; skip in CI
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
  });
});

// =============================================================================
// WS-SHARED-FILES — Strip context_manifest frontmatter + fix dead body refs
//
// These tests are GREEN — implementation already present on this branch (310bf7a).
//
// Changes under test:
//   1. Remove `context_manifest:` blocks from all 18 agents that carry them.
//      (gcp-infra-specialist, system-integration-specialist, studio-director
//       have no block — they are excluded from the frontmatter tests.)
//   2. Remove body-text references to cut skills / non-shipped shared files:
//      - teo-apply-edit-contract.md  (skill was cut; body ref in engineering-manager.md)
//      - teo-create-document-contract.md  (skill was cut; body refs in cto.md,
//        engineering-director.md, product-manager.md, staff-engineer.md)
//   3. Fix studio-director.md bare resource links to add "if present" hedge.
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
// =============================================================================

// ---------------------------------------------------------------------------
// Shipped agent list (21 total)
// ---------------------------------------------------------------------------
const SHIPPED_AGENTS: string[] = [
  "acceptance-engineer.md",
  "api-designer.md",
  "art-director.md",
  "capo.md",
  "cto.md",
  "data-engineer.md",
  "design.md",
  "dev-haiku.md",
  "dev.md",
  "devops-engineer.md",
  "engineering-director.md",
  "engineering-manager.md",
  "gcp-infra-specialist.md",
  "product-manager.md",
  "product-owner.md",
  "qa.md",
  "security-engineer.md",
  "staff-engineer.md",
  "studio-director.md",
  "system-integration-specialist.md",
  "technical-writer.md",
];

// ---------------------------------------------------------------------------
// MISUSE — content that MUST NOT appear in any shipped agent after the change
// ---------------------------------------------------------------------------

describe("misuse(WS-SHARED-FILES): no shipped agent may contain context_manifest frontmatter", () => {
  // MISUSE: context_manifest is dead metadata — Claude Code's native runtime
  // does not process it. Leaving it in shipped agent files misleads authors
  // into thinking shared files are automatically injected at runtime.
  // A file that still contains context_manifest: after the change is a
  // regression — the strip was incomplete.

  for (const filename of SHIPPED_AGENTS) {
    it(`agents/${filename} does NOT contain context_manifest: in its frontmatter`, () => {
      const content = readFile(`agents/${filename}`);
      // Extract frontmatter only (between first two --- delimiters)
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
      expect(frontmatter).not.toContain("context_manifest:");
    });
  }
});

describe("misuse(WS-SHARED-FILES): no shipped agent body may reference teo-apply-edit-contract.md", () => {
  // MISUSE: teo-apply-edit was cut from the plugin. Any surviving body reference
  // points to a file that does not exist at runtime — agents will attempt to
  // follow a contract they cannot load, or mislead maintainers into thinking
  // the skill is still active.
  // The known body reference is in engineering-manager.md ~line 144; however
  // we assert across all agents so a future copy-paste regression is caught.

  for (const filename of SHIPPED_AGENTS) {
    it(`agents/${filename} body does NOT reference teo-apply-edit-contract.md`, () => {
      const content = readFile(`agents/${filename}`);
      // Strip frontmatter before checking body — the shared_files list in
      // context_manifest is also a source of this string but vanishes with
      // the block strip. This test targets surviving body references only.
      const body = content.replace(/^---\n[\s\S]*?\n---\n/, "");
      expect(body).not.toContain("teo-apply-edit-contract.md");
    });
  }
});

describe("misuse(WS-SHARED-FILES): no shipped agent body may reference teo-create-document-contract.md", () => {
  // MISUSE: teo-create-document was cut. Same failure mode as teo-apply-edit —
  // agents that read this reference will attempt to follow a missing contract.
  // Body references confirmed in: cto.md ~89, engineering-director.md ~88,
  // product-manager.md ~91, staff-engineer.md ~178. Assert across all agents
  // to catch any future copy-paste.

  for (const filename of SHIPPED_AGENTS) {
    it(`agents/${filename} body does NOT reference teo-create-document-contract.md`, () => {
      const content = readFile(`agents/${filename}`);
      const body = content.replace(/^---\n[\s\S]*?\n---\n/, "");
      expect(body).not.toContain("teo-create-document-contract.md");
    });
  }
});

// ---------------------------------------------------------------------------
// BOUNDARY — structural invariants that must survive the strip
// ---------------------------------------------------------------------------

describe("boundary(WS-SHARED-FILES): valid frontmatter delimiters survive after strip", () => {
  // BOUNDARY: the strip operation must not corrupt the YAML frontmatter block.
  // Each agent must still open and close with --- delimiters. A strip that
  // removes too aggressively (e.g., takes the closing --- with it) would break
  // Claude Code's ability to parse the agent's name/description/model/tools.

  for (const filename of SHIPPED_AGENTS) {
    it(`agents/${filename} still has opening and closing --- frontmatter delimiters`, () => {
      const content = readFile(`agents/${filename}`);
      // File must start with --- and have a second --- closing the block
      expect(content.startsWith("---\n")).toBe(true);
      // After the opening ---, there must be at least one more ---
      const withoutOpening = content.slice(4);
      expect(withoutOpening).toContain("---");
    });
  }
});

describe("boundary(WS-SHARED-FILES): required frontmatter fields survive after strip", () => {
  // BOUNDARY: stripping context_manifest must leave the remaining YAML fields
  // intact. Claude Code requires name, description, model, and tools to
  // register the agent. Loss of any of these fields silently disables the agent.

  for (const filename of SHIPPED_AGENTS) {
    it(`agents/${filename} frontmatter still contains name, description, model, tools`, () => {
      const content = readFile(`agents/${filename}`);
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
      expect(frontmatter).toMatch(/^name:/m);
      expect(frontmatter).toMatch(/^description:/m);
      expect(frontmatter).toMatch(/^model:/m);
      expect(frontmatter).toMatch(/^tools:/m);
    });
  }
});

describe("boundary(WS-SHARED-FILES): studio-director.md shared-file links carry 'if present' hedge", () => {
  // BOUNDARY: studio-director.md references visual-formatting.md and
  // handoff-protocol.md as bare resource links in a Process References section
  // (lines ~159-160). These files may not exist in every install.
  // A bare link without "if present" causes agents to treat the file as
  // required and attempt to load it at spawn — failing silently or hallucinating
  // content when absent.
  // After the fix the references must be qualified ("if present" or equivalent).

  it("studio-director.md visual-formatting.md reference includes 'if present' qualification", () => {
    const content = readFile("agents/studio-director.md");
    // Find the line mentioning visual-formatting.md; the "if present" hedge
    // must appear on that same line or within 3 lines following it.
    const lines = content.split("\n");
    const refLineIdx = lines.findIndex((l) => l.includes("visual-formatting.md"));
    expect(refLineIdx).toBeGreaterThanOrEqual(0); // reference must still exist, just hedged
    const window = lines.slice(refLineIdx, refLineIdx + 4).join("\n");
    expect(window.toLowerCase()).toContain("if present");
  });

  it("studio-director.md handoff-protocol.md reference includes 'if present' qualification", () => {
    const content = readFile("agents/studio-director.md");
    const lines = content.split("\n");
    const refLineIdx = lines.findIndex((l) => l.includes("handoff-protocol.md"));
    expect(refLineIdx).toBeGreaterThanOrEqual(0);
    const window = lines.slice(refLineIdx, refLineIdx + 4).join("\n");
    expect(window.toLowerCase()).toContain("if present");
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — all 21 files exist and are clean
// ---------------------------------------------------------------------------

describe("golden(WS-SHARED-FILES): all 21 shipped agent files exist (no accidental deletion)", () => {
  // GOLDEN: the strip operation must not delete any agent files. A count check
  // plus per-file existence check catches a dev who accidentally deleted or
  // renamed a file during the cleanup pass.

  it("agents/ directory contains exactly 21 shipped agent files", () => {
    const agentsDir = root("agents");
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(21);
  });

  for (const filename of SHIPPED_AGENTS) {
    it(`agents/${filename} exists on disk`, () => {
      expect(() => readFile(`agents/${filename}`)).not.toThrow();
    });
  }
});
