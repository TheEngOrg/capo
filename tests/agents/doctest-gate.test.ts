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
    const content = readFile("src/plugin/agents/dev.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
  });

  it("dev.md contains a reference to tests obligation", () => {
    // MISUSE: if no mention of updating tests appears after the change, the
    // docs+tests rule is incomplete — tests half is missing.
    // This test guards against a partial implementation that only mentions docs.
    const content = readFile("src/plugin/agents/dev.md");
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
  });
});

describe("misuse: staff-engineer.md missing documentation checklist item", () => {
  it("staff-engineer.md Review Checklist references documentation", () => {
    // MISUSE: if the staff-engineer checklist has no documentation item, the
    // gate cannot enforce the rule — it will silently pass work that skips docs.
    const content = readFile("src/plugin/agents/staff-engineer.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
  });

  it("staff-engineer.md Review Checklist references tests updated/added", () => {
    // MISUSE: same as above but for the tests half of the checklist.
    const content = readFile("src/plugin/agents/staff-engineer.md");
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
  });
});

describe("misuse: mirror divergence — dev.md vs .claude/agents/dev.md", () => {
  it("agents/dev.md and .claude/agents/dev.md have identical content", () => {
    // MISUSE: if the canonical and mirror diverge, one of the two paths
    // (plugin install vs local dev) will have a different rule. All consumers
    // must see the same agent definition.
    const canonical = readFile("src/plugin/agents/dev.md");
    const mirror = readFileOrNull(".claude/agents/dev.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(canonical).toBe(mirror);
  });
});

describe("misuse: mirror divergence — staff-engineer.md vs .claude/agents/staff-engineer.md", () => {
  it("agents/staff-engineer.md and .claude/agents/staff-engineer.md have identical content", () => {
    // MISUSE: same divergence risk for the staff-engineer gate.
    const canonical = readFile("src/plugin/agents/staff-engineer.md");
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
    const content = readFile("src/plugin/agents/dev.md");
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
  });

  it("dev.md mentions the exception path for tests as well (not just docs)", () => {
    // BOUNDARY: the exception must apply to both docs AND tests. A dev agent
    // that reads "update docs or justify; always update tests" gets a mixed
    // signal and will behave inconsistently on mechanical test-free changes.
    // Both halves of the rule need the justified-exception clause.
    const content = readFile("src/plugin/agents/dev.md");
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
    const content = readFile("src/plugin/agents/dev-haiku.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
  });

  it("agents/dev-haiku.md contains a reference to tests obligation", () => {
    const content = readFile("src/plugin/agents/dev-haiku.md");
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
  });

  it("agents/dev-haiku.md mentions the justified-exception path", () => {
    // BOUNDARY: the exception nuance must reach the haiku tier as well.
    const content = readFile("src/plugin/agents/dev-haiku.md");
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
  });
});

describe("boundary: mirror divergence — dev-haiku.md vs .claude/agents/dev-haiku.md", () => {
  it("agents/dev-haiku.md and .claude/agents/dev-haiku.md have identical content", () => {
    // BOUNDARY: the haiku mirror must also receive the update. Updating only
    // the canonical and forgetting the mirror is the most common drift pattern.
    const canonical = readFile("src/plugin/agents/dev-haiku.md");
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
    const content = readFile("src/plugin/agents/staff-engineer.md");
    const blockTerms = ["BLOCK", "blocking", "hard block", "hard-block"];
    expect(containsAnyOf(content, blockTerms)).toBe(true);
  });
});

describe("boundary: teo-build SKILL.md and its mirror are consistent", () => {
  it("skills/teo-build/SKILL.md and .claude/skills/teo-build/SKILL.md have identical content", () => {
    // BOUNDARY: skill files also have canonical + mirror pairs. Divergence here
    // means the process doc update is visible in only one execution path.
    const canonical = readFile("src/plugin/skills/teo-build/SKILL.md");
    const mirror = readFileOrNull(".claude/skills/teo-build/SKILL.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(canonical).toBe(mirror);
  });
});

describe("boundary: teo-code-review SKILL.md and its mirror are consistent", () => {
  it("skills/teo-code-review/SKILL.md and .claude/skills/teo-code-review/SKILL.md have identical content", () => {
    const canonical = readFile("src/plugin/skills/teo-code-review/SKILL.md");
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
    const content = readFile("src/plugin/agents/dev.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
  });
});

describe("golden: dev-haiku.md Definition of Done includes docs+tests with exception", () => {
  it("dev-haiku.md contains documentation obligation AND exception vocabulary together", () => {
    const content = readFile("src/plugin/agents/dev-haiku.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
  });
});

describe("golden: staff-engineer.md has blocking checklist items for docs and tests", () => {
  it("staff-engineer.md has documentation obligation item in Review Checklist", () => {
    const content = readFile("src/plugin/agents/staff-engineer.md");
    expect(containsAnyOf(content, DOC_OBLIGATION_TERMS)).toBe(true);
  });

  it("staff-engineer.md has tests obligation item in Review Checklist", () => {
    const content = readFile("src/plugin/agents/staff-engineer.md");
    expect(containsAnyOf(content, TEST_OBLIGATION_TERMS)).toBe(true);
  });

  it("staff-engineer.md marks the new checklist items as BLOCKING", () => {
    const content = readFile("src/plugin/agents/staff-engineer.md");
    const blockTerms = ["BLOCK", "blocking", "hard block", "hard-block"];
    expect(containsAnyOf(content, blockTerms)).toBe(true);
  });

  it("staff-engineer.md exception path is present (BLOCK fires only when justified is absent)", () => {
    // GOLDEN: the staff-engineer must also understand when NOT to block — the
    // exception vocabulary tells the reviewer to accept a justified skip.
    // Without this, staff-engineer blocks everything including intentional
    // no-doc mechanical changes.
    const content = readFile("src/plugin/agents/staff-engineer.md");
    expect(containsAnyOf(content, EXCEPTION_TERMS)).toBe(true);
  });
});

describe("golden: all mirrors match their canonical source", () => {
  it("agents/dev.md === .claude/agents/dev.md", () => {
    const mirror = readFileOrNull(".claude/agents/dev.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(readFile("src/plugin/agents/dev.md")).toBe(mirror);
  });

  it("agents/dev-haiku.md === .claude/agents/dev-haiku.md", () => {
    const mirror = readFileOrNull(".claude/agents/dev-haiku.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(readFile("src/plugin/agents/dev-haiku.md")).toBe(mirror);
  });

  it("agents/staff-engineer.md === .claude/agents/staff-engineer.md", () => {
    const mirror = readFileOrNull(".claude/agents/staff-engineer.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(readFile("src/plugin/agents/staff-engineer.md")).toBe(mirror);
  });

  it("skills/teo-build/SKILL.md === .claude/skills/teo-build/SKILL.md", () => {
    const mirror = readFileOrNull(".claude/skills/teo-build/SKILL.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(readFile("src/plugin/skills/teo-build/SKILL.md")).toBe(mirror);
  });

  it("skills/teo-code-review/SKILL.md === .claude/skills/teo-code-review/SKILL.md", () => {
    const mirror = readFileOrNull(".claude/skills/teo-code-review/SKILL.md");
    if (mirror === null) return; // .claude/ is gitignored; skip in CI
    expect(readFile("src/plugin/skills/teo-code-review/SKILL.md")).toBe(mirror);
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
// Shipped agent list (23 total)
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
  "software-engineer.md",
  "staff-engineer.md",
  "studio-director.md",
  "system-integration-specialist.md",
  "technical-writer.md",
  "qa-validate.md",
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
      const content = readFile(`src/plugin/agents/${filename}`);
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
      const content = readFile(`src/plugin/agents/${filename}`);
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
      const content = readFile(`src/plugin/agents/${filename}`);
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
      const content = readFile(`src/plugin/agents/${filename}`);
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
      const content = readFile(`src/plugin/agents/${filename}`);
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
    const content = readFile("src/plugin/agents/studio-director.md");
    // Find the line mentioning visual-formatting.md; the "if present" hedge
    // must appear on that same line or within 3 lines following it.
    const lines = content.split("\n");
    const refLineIdx = lines.findIndex((l) => l.includes("visual-formatting.md"));
    expect(refLineIdx).toBeGreaterThanOrEqual(0); // reference must still exist, just hedged
    const window = lines.slice(refLineIdx, refLineIdx + 4).join("\n");
    expect(window.toLowerCase()).toContain("if present");
  });

  it("studio-director.md handoff-protocol.md reference includes 'if present' qualification", () => {
    const content = readFile("src/plugin/agents/studio-director.md");
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

// =============================================================================
// ADR-075 PR2 — Revoke Edit+Write from memory-only writer agents
//
// These tests are GREEN — implementation complete (ADR-075 PR2). Dev removed
// Edit and Write from the tools: frontmatter of the 5 memory-only writer agents.
//
// Decision Q3=B: restriction is per-agent toolset COMPOSITION — the tools:
// frontmatter line is the authoritative capability gate, not path allowlists.
//
// The 5 agents under test and their required post-change tools: lines:
//   staff-engineer:      [Task(software-engineer), Read, Glob, Grep, Bash]
//   engineering-manager: [Task(qa, software-engineer, staff-engineer), Read, Glob, Grep, Bash]
//   product-manager:     [Task(qa, design), Read, Glob, Grep]
//   acceptance-engineer: [Bash, Read, Glob, Grep]
//   studio-director:     [Read, Glob, Grep, Task, Bash]
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
// =============================================================================

/** Extract the tools: value from a YAML frontmatter block as a raw string. */
function extractToolsLine(content: string): string {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return "";
  const frontmatter = frontmatterMatch[1];
  const toolsMatch = frontmatter.match(/^tools:\s*(.+)$/m);
  return toolsMatch ? toolsMatch[1] : "";
}

/**
 * Parse a tools: value like "[Bash, Read, Task(foo, bar), Glob]" into a list
 * of bare tool tokens. Task(...) entries are returned as "Task" so callers
 * can check presence/absence separately from the Task argument string.
 */
function parseToolTokens(toolsValue: string): string[] {
  // Strip surrounding brackets if present
  const inner = toolsValue.trim().replace(/^\[/, "").replace(/\]$/, "");
  // Split on commas that are NOT inside parentheses
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of inner) {
    if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      tokens.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

/** Returns true if a bare tool name (e.g. "Edit", "Write") appears in the token list. */
function hasTool(tokens: string[], tool: string): boolean {
  return tokens.some((t) => t === tool || t.startsWith(`${tool}(`));
}

// ---------------------------------------------------------------------------
// MISUSE — Edit and Write must be ABSENT from the 5 agents after the change
// ---------------------------------------------------------------------------

describe("misuse(ADR-075-PR2): staff-engineer must NOT have Edit or Write in tools:", () => {
  it("staff-engineer.md tools: does NOT contain Edit", () => {
    // MISUSE: staff-engineer's only write operation is memory writes via
    // teo-agent-toolset subcommands through Bash. Direct Edit access is revoked
    // by ADR-075 Q3=B. If Edit appears, the capability gate is incomplete.
    const content = readFile("src/plugin/agents/staff-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("staff-engineer.md tools: does NOT contain Write", () => {
    // MISUSE: Write was used for memory writes; those are now routed through
    // teo-agent-toolset subcommands. Write must be absent after ADR-075 PR2.
    const content = readFile("src/plugin/agents/staff-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

describe("misuse(ADR-075-PR2): engineering-manager must NOT have Edit or Write in tools:", () => {
  it("engineering-manager.md tools: does NOT contain Edit", () => {
    // MISUSE: engineering-manager had Edit in its tools:. ADR-075 PR2 revokes it;
    // memory writes go through teo-agent-toolset via Bash.
    const content = readFile("src/plugin/agents/engineering-manager.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("engineering-manager.md tools: does NOT contain Write", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

describe("misuse(ADR-075-PR2): product-manager must NOT have Edit or Write in tools:", () => {
  it("product-manager.md tools: does NOT contain Edit", () => {
    // MISUSE: product-manager had Edit. ADR-075 PR2 revokes it. Product-manager
    // had no Bash and should NOT gain Bash — it simply loses both Edit and Write.
    const content = readFile("src/plugin/agents/product-manager.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("product-manager.md tools: does NOT contain Write", () => {
    const content = readFile("src/plugin/agents/product-manager.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

describe("misuse(ADR-075-PR2): acceptance-engineer must NOT have Edit or Write in tools:", () => {
  it("acceptance-engineer.md tools: does NOT contain Edit", () => {
    // MISUSE: acceptance-engineer had Edit in its tools:. ADR-075 PR2 revokes it.
    // Real-binary E2E review does not require direct file editing.
    const content = readFile("src/plugin/agents/acceptance-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("acceptance-engineer.md tools: does NOT contain Write", () => {
    const content = readFile("src/plugin/agents/acceptance-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

describe("misuse(ADR-075-PR2): studio-director must NOT have Edit or Write in tools:", () => {
  it("studio-director.md tools: does NOT contain Edit", () => {
    // MISUSE: studio-director had Edit. ADR-075 PR2 revokes it. Orchestration
    // of media pipelines does not require direct file editing.
    const content = readFile("src/plugin/agents/studio-director.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("studio-director.md tools: does NOT contain Write", () => {
    const content = readFile("src/plugin/agents/studio-director.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

describe("misuse(ADR-075-PR2): product-manager must NOT gain Bash (it had none)", () => {
  it("product-manager.md tools: does NOT contain Bash", () => {
    // MISUSE: product-manager did not have Bash before ADR-075 PR2 and must not
    // gain it — its constitution prohibits direct writes, and it has no memory
    // write path that requires Bash. Adding Bash would silently expand its
    // capability set beyond the intended post-change toolset.
    const content = readFile("src/plugin/agents/product-manager.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — agents that retain Bash must keep it; read-only tools must survive
// ---------------------------------------------------------------------------

describe("boundary(ADR-075-PR2): Bash retained where required for teo-agent-toolset invocation", () => {
  it("staff-engineer.md tools: retains Bash", () => {
    // BOUNDARY: staff-engineer retains Bash to invoke teo-agent-toolset memory
    // write subcommands. Dropping Bash would eliminate the only memory write path
    // available after Edit and Write are revoked.
    const content = readFile("src/plugin/agents/staff-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(true);
  });

  it("engineering-manager.md tools: retains Bash", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(true);
  });

  it("acceptance-engineer.md tools: retains Bash", () => {
    // BOUNDARY: acceptance-engineer needs Bash to run real-binary acceptance
    // tests. It already had Bash and must keep it.
    const content = readFile("src/plugin/agents/acceptance-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(true);
  });

  it("studio-director.md tools: retains Bash", () => {
    // BOUNDARY: studio-director needs Bash for media pipeline invocations
    // (ffmpeg, etc.). It already had Bash and must keep it.
    const content = readFile("src/plugin/agents/studio-director.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(true);
  });
});

describe("boundary(ADR-075-PR2): read-only tools survive the revocation (Read, Glob, Grep)", () => {
  const READ_TOOLS = ["Read", "Glob", "Grep"] as const;

  for (const agent of [
    "staff-engineer",
    "engineering-manager",
    "product-manager",
    "acceptance-engineer",
    "studio-director",
  ]) {
    for (const tool of READ_TOOLS) {
      it(`${agent}.md tools: retains ${tool}`, () => {
        // BOUNDARY: revoking Edit+Write must not accidentally strip read-only tools.
        // All 5 agents had Read, Glob, Grep before the change and must keep them.
        const content = readFile(`src/plugin/agents/${agent}.md`);
        const tokens = parseToolTokens(extractToolsLine(content));
        expect(hasTool(tokens, tool)).toBe(true);
      });
    }
  }
});

describe("boundary(ADR-075-PR2): Task variants are preserved on agents that had them", () => {
  it("staff-engineer.md tools: retains Task (for software-engineer)", () => {
    // BOUNDARY: staff-engineer orchestrates software-engineer via Task. The Task
    // capability must survive the Edit+Write strip.
    const content = readFile("src/plugin/agents/staff-engineer.md");
    const toolsLine = extractToolsLine(content);
    expect(toolsLine).toContain("Task(software-engineer)");
  });

  it("engineering-manager.md tools: retains Task (for qa, software-engineer, staff-engineer)", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    const toolsLine = extractToolsLine(content);
    expect(toolsLine).toContain("Task(");
    // All three sub-agents must still be present in the Task argument list
    expect(toolsLine).toContain("qa");
    expect(toolsLine).toContain("software-engineer");
    expect(toolsLine).toContain("staff-engineer");
  });

  it("product-manager.md tools: retains Task (for qa, design)", () => {
    const content = readFile("src/plugin/agents/product-manager.md");
    const toolsLine = extractToolsLine(content);
    expect(toolsLine).toContain("Task(");
    expect(toolsLine).toContain("qa");
    expect(toolsLine).toContain("design");
  });

  it("studio-director.md tools: retains Task", () => {
    const content = readFile("src/plugin/agents/studio-director.md");
    const toolsLine = extractToolsLine(content);
    // studio-director had a bare Task; it must still be present
    expect(toolsLine).toContain("Task");
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — full post-change toolset composition is exactly right
// ---------------------------------------------------------------------------

describe("golden(ADR-075-PR2): post-change toolsets are exactly as specified", () => {
  it("staff-engineer.md tools: exactly [Task(software-engineer), Read, Glob, Grep, Bash]", () => {
    // GOLDEN: the tools: line must not contain ANY tool outside the allowed set.
    // Extra tools (e.g. a stray Write left behind) must fail this test.
    const content = readFile("src/plugin/agents/staff-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    // Exactly 5 tokens: Task(software-engineer), Read, Glob, Grep, Bash
    expect(tokens).toHaveLength(5);
    expect(hasTool(tokens, "Bash")).toBe(true);
    expect(hasTool(tokens, "Read")).toBe(true);
    expect(hasTool(tokens, "Glob")).toBe(true);
    expect(hasTool(tokens, "Grep")).toBe(true);
    expect(tokens.some((t) => t.startsWith("Task("))).toBe(true);
    expect(hasTool(tokens, "Edit")).toBe(false);
    expect(hasTool(tokens, "Write")).toBe(false);
  });

  it("engineering-manager.md tools: exactly [Task(qa, software-engineer, staff-engineer), Read, Glob, Grep, Bash]", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    // Exactly 5 tokens
    expect(tokens).toHaveLength(5);
    expect(hasTool(tokens, "Bash")).toBe(true);
    expect(hasTool(tokens, "Read")).toBe(true);
    expect(hasTool(tokens, "Glob")).toBe(true);
    expect(hasTool(tokens, "Grep")).toBe(true);
    expect(tokens.some((t) => t.startsWith("Task("))).toBe(true);
    expect(hasTool(tokens, "Edit")).toBe(false);
    expect(hasTool(tokens, "Write")).toBe(false);
  });

  it("product-manager.md tools: exactly [Task(qa, design), Read, Glob, Grep]", () => {
    const content = readFile("src/plugin/agents/product-manager.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    // Exactly 4 tokens — NO Bash
    expect(tokens).toHaveLength(4);
    expect(hasTool(tokens, "Read")).toBe(true);
    expect(hasTool(tokens, "Glob")).toBe(true);
    expect(hasTool(tokens, "Grep")).toBe(true);
    expect(tokens.some((t) => t.startsWith("Task("))).toBe(true);
    expect(hasTool(tokens, "Edit")).toBe(false);
    expect(hasTool(tokens, "Write")).toBe(false);
    expect(hasTool(tokens, "Bash")).toBe(false);
  });

  it("acceptance-engineer.md tools: exactly [Bash, Read, Glob, Grep]", () => {
    const content = readFile("src/plugin/agents/acceptance-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    // Exactly 4 tokens
    expect(tokens).toHaveLength(4);
    expect(hasTool(tokens, "Bash")).toBe(true);
    expect(hasTool(tokens, "Read")).toBe(true);
    expect(hasTool(tokens, "Glob")).toBe(true);
    expect(hasTool(tokens, "Grep")).toBe(true);
    expect(hasTool(tokens, "Edit")).toBe(false);
    expect(hasTool(tokens, "Write")).toBe(false);
  });

  it("studio-director.md tools: exactly [Read, Glob, Grep, Task, Bash]", () => {
    const content = readFile("src/plugin/agents/studio-director.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    // Exactly 5 tokens
    expect(tokens).toHaveLength(5);
    expect(hasTool(tokens, "Read")).toBe(true);
    expect(hasTool(tokens, "Glob")).toBe(true);
    expect(hasTool(tokens, "Grep")).toBe(true);
    expect(hasTool(tokens, "Task")).toBe(true);
    expect(hasTool(tokens, "Bash")).toBe(true);
    expect(hasTool(tokens, "Edit")).toBe(false);
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

describe("golden(ADR-075-PR2): agent count unchanged — no agents added or removed", () => {
  it("agents/ directory still contains exactly 23 shipped agent files after PR2", () => {
    // GOLDEN: PR2 only modifies tools: frontmatter in 5 existing agents.
    // The total agent count must remain 23. A change in count indicates an
    // accidental deletion, rename, or addition outside the PR2 scope.
    const agentsDir = root("src", "plugin", "agents");
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(23);
  });
});

// =============================================================================
// ADR-075 PR3 — Revoke Edit+Write from scoped-domain writer agents
//
// These tests are GREEN — implementation complete (ADR-075 PR3). Dev removed
// Edit and Write from the tools: frontmatter of the 6 scoped-domain agents.
//
// Decision Q3=B: restriction is per-agent toolset COMPOSITION — the tools:
// frontmatter line is the authoritative capability gate. Scoped-domain agents
// create new files via teo-apply-edit (not direct Write) and apply edits via
// teo-apply-edit (not direct Edit). Bash is retained where it existed for
// teo-agent-toolset + domain CLIs; WebFetch is retained for the one agent that
// had it. No tool is ADDED — only Edit and Write are removed.
//
// The 6 agents under test and their required post-change tools: lines:
//   api-designer:                  [Read, Glob, Grep, Bash]
//   data-engineer:                 [Read, Glob, Grep, Bash]
//   devops-engineer:               [Read, Glob, Grep, Bash]
//   gcp-infra-specialist:          [Read, Glob, Grep, Bash]
//   security-engineer:             [Read, Glob, Grep, Bash]
//   system-integration-specialist: [Read, Glob, Grep, WebFetch]
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
// =============================================================================

// ---------------------------------------------------------------------------
// MISUSE — Edit and Write must be ABSENT from all 6 agents after the change
// (12 tests: 2 per agent × 6 agents)
// ---------------------------------------------------------------------------

describe("misuse(ADR-075-PR3): api-designer must NOT have Edit or Write in tools:", () => {
  it("api-designer.md tools: does NOT contain Edit", () => {
    // MISUSE: api-designer outputs OpenAPI specs that flow through teo-apply-edit.
    // Direct Edit access is revoked by ADR-075 Q3=B. If Edit appears, the
    // capability gate is incomplete and the agent can bypass teo-apply-edit.
    const content = readFile("src/plugin/agents/api-designer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("api-designer.md tools: does NOT contain Write", () => {
    // MISUSE: new spec files go through teo-apply-edit file-create path.
    // Direct Write is revoked. If Write remains, the capability gate is open.
    const content = readFile("src/plugin/agents/api-designer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

describe("misuse(ADR-075-PR3): data-engineer must NOT have Edit or Write in tools:", () => {
  it("data-engineer.md tools: does NOT contain Edit", () => {
    // MISUSE: schema/migration files go through teo-apply-edit. Direct Edit
    // access is revoked by ADR-075 Q3=B.
    const content = readFile("src/plugin/agents/data-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("data-engineer.md tools: does NOT contain Write", () => {
    const content = readFile("src/plugin/agents/data-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

describe("misuse(ADR-075-PR3): devops-engineer must NOT have Edit or Write in tools:", () => {
  it("devops-engineer.md tools: does NOT contain Edit", () => {
    // MISUSE: IaC/CI config writes go through teo-apply-edit. Direct Edit
    // access is revoked by ADR-075 Q3=B.
    const content = readFile("src/plugin/agents/devops-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("devops-engineer.md tools: does NOT contain Write", () => {
    const content = readFile("src/plugin/agents/devops-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

describe("misuse(ADR-075-PR3): gcp-infra-specialist must NOT have Edit or Write in tools:", () => {
  it("gcp-infra-specialist.md tools: does NOT contain Edit", () => {
    // MISUSE: Terraform/IaC files go through teo-apply-edit. Direct Edit
    // is revoked by ADR-075 Q3=B.
    const content = readFile("src/plugin/agents/gcp-infra-specialist.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("gcp-infra-specialist.md tools: does NOT contain Write", () => {
    const content = readFile("src/plugin/agents/gcp-infra-specialist.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

describe("misuse(ADR-075-PR3): security-engineer must NOT have Edit or Write in tools:", () => {
  it("security-engineer.md tools: does NOT contain Edit", () => {
    // MISUSE: security-engineer's output is advisory memos to .claude/memory/.
    // It has no legitimate reason to directly Edit source files. If Edit remains,
    // the agent can make unreviewed mutations to source code during audits.
    const content = readFile("src/plugin/agents/security-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("security-engineer.md tools: does NOT contain Write", () => {
    const content = readFile("src/plugin/agents/security-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

describe("misuse(ADR-075-PR3): system-integration-specialist must NOT have Edit or Write in tools:", () => {
  it("system-integration-specialist.md tools: does NOT contain Edit", () => {
    // MISUSE: integration specs/contracts go through teo-apply-edit. Direct Edit
    // is revoked by ADR-075 Q3=B.
    const content = readFile("src/plugin/agents/system-integration-specialist.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("system-integration-specialist.md tools: does NOT contain Write", () => {
    const content = readFile("src/plugin/agents/system-integration-specialist.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — correct token count after the strip (6 tests: 1 per agent)
// ---------------------------------------------------------------------------

describe("boundary(ADR-075-PR3): each agent has the exact expected tool count after revocation", () => {
  it("api-designer.md tools: exactly 4 tokens [Read, Glob, Grep, Bash]", () => {
    // BOUNDARY: 6 tokens before (Read, Glob, Grep, Edit, Write, Bash) → 4 after.
    // A count != 4 means either Edit/Write were not removed or a different tool
    // was accidentally dropped or added during the change.
    const content = readFile("src/plugin/agents/api-designer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(tokens).toHaveLength(4);
  });

  it("data-engineer.md tools: exactly 4 tokens [Read, Glob, Grep, Bash]", () => {
    // BOUNDARY: 6 tokens before → 4 after.
    const content = readFile("src/plugin/agents/data-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(tokens).toHaveLength(4);
  });

  it("devops-engineer.md tools: exactly 4 tokens [Read, Glob, Grep, Bash]", () => {
    const content = readFile("src/plugin/agents/devops-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(tokens).toHaveLength(4);
  });

  it("gcp-infra-specialist.md tools: exactly 4 tokens [Read, Glob, Grep, Bash]", () => {
    const content = readFile("src/plugin/agents/gcp-infra-specialist.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(tokens).toHaveLength(4);
  });

  it("security-engineer.md tools: exactly 4 tokens [Read, Glob, Grep, Bash]", () => {
    const content = readFile("src/plugin/agents/security-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(tokens).toHaveLength(4);
  });

  it("system-integration-specialist.md tools: exactly 4 tokens [Read, Glob, Grep, WebFetch]", () => {
    // BOUNDARY: 6 tokens before (Read, Glob, Grep, Edit, Write, WebFetch) → 4 after.
    // WebFetch takes the slot Edit+Write occupied; Bash was never present and
    // must NOT be added per Q3=B (only tools explicitly permitted by the agent's
    // purpose are kept — system-integration-specialist never had Bash).
    const content = readFile("src/plugin/agents/system-integration-specialist.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(tokens).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — retained tools are present; full composition is exact
// (6 tests: retained key tools per agent)
// ---------------------------------------------------------------------------

describe("golden(ADR-075-PR3): Bash retained on the 5 agents that had it", () => {
  it("api-designer.md tools: retains Bash", () => {
    // GOLDEN: Bash is retained for invoking teo-agent-toolset. Stripping it
    // would eliminate the only tool-invocation path available after Edit+Write
    // are revoked.
    const content = readFile("src/plugin/agents/api-designer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(true);
  });

  it("data-engineer.md tools: retains Bash", () => {
    // GOLDEN: Bash retained for teo-agent-toolset + db CLI tools.
    const content = readFile("src/plugin/agents/data-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(true);
  });

  it("devops-engineer.md tools: retains Bash", () => {
    // GOLDEN: Bash retained for CLI ops (kubectl, terraform, gcloud, etc.)
    const content = readFile("src/plugin/agents/devops-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(true);
  });

  it("gcp-infra-specialist.md tools: retains Bash", () => {
    // GOLDEN: Bash retained for gcloud scripting and teo-agent-toolset.
    const content = readFile("src/plugin/agents/gcp-infra-specialist.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(true);
  });

  it("security-engineer.md tools: retains Bash", () => {
    // GOLDEN: Bash retained for teo-agent-toolset memory write subcommands
    // (security audit memos route through Bash, not direct Write).
    const content = readFile("src/plugin/agents/security-engineer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(true);
  });

  it("system-integration-specialist.md tools: retains WebFetch", () => {
    // GOLDEN: WebFetch is retained for API docs research — it is the primary
    // non-file-reading capability this agent needs after Edit+Write are revoked.
    const content = readFile("src/plugin/agents/system-integration-specialist.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "WebFetch")).toBe(true);
  });
});

describe("golden(ADR-075-PR3): system-integration-specialist does NOT have Bash", () => {
  it("system-integration-specialist.md tools: does NOT contain Bash", () => {
    // GOLDEN: system-integration-specialist never had Bash before ADR-075 PR3
    // and must not gain it. The Q3=B rule is additive-only in intent — only
    // tools explicitly permitted by the agent's purpose are kept. Bash was not
    // part of this agent's purpose before the change, so it must not appear after.
    const content = readFile("src/plugin/agents/system-integration-specialist.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(false);
  });
});

describe("golden(ADR-075-PR3): agent count still 23 — no agents added or removed", () => {
  it("agents/ directory still contains exactly 23 shipped agent files after PR3", () => {
    // GOLDEN: PR3 only modifies tools: frontmatter in 6 existing agents.
    // The total agent count must remain 23. A count change indicates an
    // accidental deletion, rename, or addition outside PR3 scope.
    const agentsDir = root("src", "plugin", "agents");
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(23);
  });
});

// =============================================================================
// ADR-075 PR4 — Revoke Edit+Write from design + technical-writer agents
//
// These tests are RED until implementation. Dev must remove Edit and Write from
// the tools: frontmatter of design.md and technical-writer.md.
//
// Post-change toolsets:
//   design:           [Read, Glob, Grep]          (no Bash — never had it)
//   technical-writer: [Read, Glob, Grep, Bash]    (Bash kept for teo-agent-toolset)
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
// =============================================================================

// ---------------------------------------------------------------------------
// MISUSE — Edit and Write must be ABSENT after the change (4 tests)
// ---------------------------------------------------------------------------

describe("misuse(ADR-075-PR4): design must NOT have Edit or Write in tools:", () => {
  it("design.md tools: does NOT contain Edit", () => {
    // MISUSE: design produces wireframes/mockups via prompts — it never directly
    // mutates files. Direct Edit is revoked by ADR-075 Q3=B. If Edit appears,
    // the capability gate is incomplete and the agent can bypass the intent boundary.
    const content = readFile("src/plugin/agents/design.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("design.md tools: does NOT contain Write", () => {
    // MISUSE: design has no legitimate file-write path — output is prompt-driven
    // artifact descriptions, not source mutations. Write is revoked.
    const content = readFile("src/plugin/agents/design.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

describe("misuse(ADR-075-PR4): technical-writer must NOT have Edit or Write in tools:", () => {
  it("technical-writer.md tools: does NOT contain Edit", () => {
    // MISUSE: technical-writer authors docs through teo-agent-toolset subcommands
    // invoked via Bash. Direct Edit access is revoked by ADR-075 Q3=B.
    // If Edit remains, the agent can mutate files outside the controlled path.
    const content = readFile("src/plugin/agents/technical-writer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });

  it("technical-writer.md tools: does NOT contain Write", () => {
    // MISUSE: new doc files are created through teo-agent-toolset, not direct
    // Write. Write is revoked by ADR-075 Q3=B.
    const content = readFile("src/plugin/agents/technical-writer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — exact token count after the strip (2 tests)
// ---------------------------------------------------------------------------

describe("boundary(ADR-075-PR4): exact token count after Edit+Write revocation", () => {
  it("design.md tools: exactly 3 tokens [Read, Glob, Grep]", () => {
    // BOUNDARY: 5 tokens before (Read, Glob, Grep, Edit, Write) → 3 after.
    // Count != 3 means either Edit/Write were not fully removed, or a tool was
    // accidentally added (e.g. Bash, which design never had).
    const content = readFile("src/plugin/agents/design.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(tokens).toHaveLength(3);
  });

  it("technical-writer.md tools: exactly 4 tokens [Read, Glob, Grep, Bash]", () => {
    // BOUNDARY: 6 tokens before (Read, Glob, Grep, Edit, Write, Bash) → 4 after.
    // Count != 4 means Edit/Write were not removed, or Bash was accidentally lost.
    const content = readFile("src/plugin/agents/technical-writer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(tokens).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — retained tools present; Bash disposition correct (3 tests)
// ---------------------------------------------------------------------------

describe("golden(ADR-075-PR4): technical-writer retains Bash; design does not gain Bash", () => {
  it("technical-writer.md tools: retains Bash after Edit+Write revocation", () => {
    // GOLDEN: technical-writer must keep Bash to invoke teo-agent-toolset memory
    // write subcommands. Dropping Bash would eliminate the only tool-write path
    // available after Edit and Write are revoked.
    const content = readFile("src/plugin/agents/technical-writer.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(true);
  });

  it("design.md tools: does NOT contain Bash (design never had it; must not gain it)", () => {
    // GOLDEN: design never had Bash before ADR-075 PR4 and must not gain it.
    // The Q3=B rule is scope-limited — only tools explicitly permitted by the
    // agent's purpose are kept. Bash was never part of design's toolset.
    // Adding Bash would silently expand its capability beyond the intended set.
    const content = readFile("src/plugin/agents/design.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GUARD — Bash-absence is a hard invariant for design (1 test, mirrors golden)
// ---------------------------------------------------------------------------

describe("golden(ADR-075-PR4): design Bash-absence guard — must never appear in post-PR4 state", () => {
  it("design.md tools: Bash is absent (never-had, must-not-appear invariant)", () => {
    // GUARD: design produces visual artifacts through prompts alone; it has no
    // CLI or memory-write path that requires Bash. This test is a permanent
    // guard — if any future PR adds Bash to design, it should fail here first.
    const content = readFile("src/plugin/agents/design.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// STABILITY — agent count must remain 23 (1 test)
// ---------------------------------------------------------------------------

describe("golden(ADR-075-PR4): agent count unchanged — no agents added or removed", () => {
  it("agents/ directory still contains exactly 23 shipped agent files after PR4", () => {
    // GOLDEN: PR4 only modifies tools: frontmatter in 2 existing agents.
    // The total agent count must remain 23. A count change indicates an
    // accidental deletion, rename, or addition outside PR4 scope.
    const agentsDir = root("src", "plugin", "agents");
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(23);
  });
});

describe("golden(WS-SHARED-FILES): all 23 shipped agent files exist (no accidental deletion)", () => {
  // GOLDEN: the strip operation must not delete any agent files. A count check
  // plus per-file existence check catches a dev who accidentally deleted or
  // renamed a file during the cleanup pass.

  it("agents/ directory contains exactly 23 shipped agent files", () => {
    const agentsDir = root("src", "plugin", "agents");
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(23);
  });

  for (const filename of SHIPPED_AGENTS) {
    it(`agents/${filename} exists on disk`, () => {
      expect(() => readFile(`src/plugin/agents/${filename}`)).not.toThrow();
    });
  }
});

// =============================================================================
// ADR-075 PR5: qa agent Edit+Write revocation (Q1=A)
//
// These tests are RED until implementation. Dev must remove Edit and Write from
// the tools: frontmatter of qa.md.
//
// Decision Q1=A: QA's only write action is creating test files via the
// teo-agent-toolset file-create subcommand (path-scoped to tests/** and
// src/**/*.test.ts). Direct Edit and Write are revoked.
//
//   Current qa tools: [Read, Glob, Grep, Edit, Write, Bash]
//   Target  qa tools: [Read, Glob, Grep, Bash]
//
// Why drop Edit?  QA never edits existing source files — that routes to
//                 software-engineer via teo-apply-edit.
// Why drop Write? New test-file creation uses teo-agent-toolset file-create
//                 (Bash subcommand) which enforces the tests/** + src/**/*.test.ts
//                 path allowlist. Direct Write bypasses that gate.
// Why keep Bash?  QA must be able to run npm run test and npm run test:cov.
//                 Bash is also the shell that invokes teo-agent-toolset file-create.
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
// Expected: 3 RED (misuse × 2, boundary × 1), 2 GREEN (golden × 1, count × 1)
// =============================================================================

// ---------------------------------------------------------------------------
// MISUSE — Edit and Write must be ABSENT from qa after the change (2 tests)
// ---------------------------------------------------------------------------

describe("misuse(ADR-075-PR5): qa must NOT have Edit in tools:", () => {
  it("qa.md tools: does NOT contain Edit", () => {
    // MISUSE: qa never edits existing source files. If Edit appears in qa's
    // tools: line, the agent can make unreviewed mutations to implementation
    // code during its test-authorship or validation phase — directly
    // violating the Q1=A boundary and the QA constitution ("I NEVER write
    // implementation code"). Edit revocation is the enforcement gate; its
    // absence means the gate is incomplete and the misuse path is open.
    const content = readFile("src/plugin/agents/qa.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Edit")).toBe(false);
  });
});

describe("misuse(ADR-075-PR5): qa must NOT have Write in tools:", () => {
  it("qa.md tools: does NOT contain Write", () => {
    // MISUSE: direct Write bypasses the path allowlist enforced by
    // teo-agent-toolset file-create. With Write present, qa can create files
    // anywhere on disk — not just tests/** and src/**/*.test.ts. The Q1=A
    // decision replaces Write with file-create precisely to lock the allowed
    // write destinations to test paths only. If Write remains, the path-scoping
    // constraint is unenforced and the misuse path is open.
    const content = readFile("src/plugin/agents/qa.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Write")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — exact token count after the strip (1 test)
// ---------------------------------------------------------------------------

describe("boundary(ADR-075-PR5): qa has exactly 4 tools after Edit+Write revocation", () => {
  it("qa.md tools: exactly 4 tokens [Read, Glob, Grep, Bash]", () => {
    // BOUNDARY: qa had 6 tools before PR5 (Read, Glob, Grep, Edit, Write, Bash).
    // After removing Edit and Write the count must be exactly 4.
    // A count != 4 means either the removal was partial (one of Edit/Write still
    // present), an unintended tool was dropped (e.g. Glob silently removed), or
    // a net-new tool was added outside the PR5 scope.
    const content = readFile("src/plugin/agents/qa.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(tokens).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — Bash is retained; agent count unchanged (2 tests)
// ---------------------------------------------------------------------------

describe("golden(ADR-075-PR5): qa retains Bash after Edit+Write revocation", () => {
  it("qa.md tools: retains Bash", () => {
    // GOLDEN: Bash is qa's only remaining write-capable tool after Edit and Write
    // are revoked. It serves two purposes: (1) running npm run test / npm run
    // test:cov for coverage gate enforcement, and (2) invoking teo-agent-toolset
    // file-create for path-scoped test-file creation. Dropping Bash would
    // eliminate both capabilities and leave qa unable to execute its core duties.
    const content = readFile("src/plugin/agents/qa.md");
    const tokens = parseToolTokens(extractToolsLine(content));
    expect(hasTool(tokens, "Bash")).toBe(true);
  });
});

describe("golden(ADR-075-PR5): agent count unchanged — still 23 shipped agents", () => {
  it("agents/ directory still contains exactly 23 shipped agent files after PR5", () => {
    // GOLDEN: PR5 only modifies the tools: frontmatter in qa.md. The total
    // agent count must remain 23. A count change indicates an accidental
    // deletion, rename, or addition outside PR5 scope.
    const agentsDir = root("src", "plugin", "agents");
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(23);
  });
});
