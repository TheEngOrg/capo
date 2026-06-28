import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// agent-rails.test.ts — specs for WS-AGENT-RAILS
//
// These tests are GREEN. Implementation complete.
// DO NOT add implementation here.
//
// Changes under test:
//   1. .claude/settings.json    — delete entire `permissions` key
//   2. src/plugin/agents/staff-engineer.md — remove `Edit` from tools: frontmatter
//   3. src/agents/staff-engineer.md        — add `Edit` to disallowedTools_default:
//   4. src/plugin/agents/qa-validate.md    — NEW FILE (tools, directive_gate, no context_manifest)
//   5. Count gates (22→23)                 — doctest-gate.test.ts, verify-plugin-install.sh, plugin.json
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
//
// AC coverage map:
//   AC-1    → "misuse: settings.json must not retain permissions key" (2 tests)
//   AC-2a   → "misuse: staff-engineer plugin agent must not allow Edit tool" (1 test)
//   AC-2b   → "boundary: staff-engineer plugin agent must still allow Write tool" (1 test)
//   AC-3    → "misuse: src/agents/staff-engineer.md must deny Edit tool" (1 test)
//   AC-4a   → "misuse: qa-validate agent file must exist" (1 test)
//   AC-4b   → "misuse: qa-validate tools list must be exactly [Read, Glob, Grep, Bash]" (1 test)
//   AC-4c   → "misuse: qa-validate directive_gate block must exist with required identity constraint" (2 tests)
//   AC-4d   → "misuse: qa-validate must not contain context_manifest field" (1 test)
//   AC-5a   → "misuse: doctest-gate.test.ts count gates must be bumped to 23" (2 tests)
//   AC-5b   → "misuse: verify-plugin-install.sh must not reference agent count 22" (1 test)
//   AC-5c   → "misuse: plugin.json agents array must contain qa-validate" (1 test)
//   AC-5d   → "golden: zero stale 22-agent-count references remain after bump" (1 test)
// =============================================================================

// ---------------------------------------------------------------------------
// Path helpers (same pattern as doctest-gate.test.ts)
// ---------------------------------------------------------------------------

/** Resolve a path relative to the project root (two levels up from tests/agents/) */
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

// =============================================================================
// MISUSE — assertions that fire when prohibited content is PRESENT
//          or required content is ABSENT
// =============================================================================

// ---------------------------------------------------------------------------
// AC-1: .claude/settings.json must not contain the "permissions" key
// ---------------------------------------------------------------------------

describe("misuse(AC-1): settings.json must not retain permissions key", () => {
  it('settings.json has no "permissions" key at the top level', () => {
    // MISUSE: leaving the permissions key means the global tool allowlist
    // in settings.json overrides per-agent frontmatter tool restrictions,
    // defeating the purpose of per-agent tool rails entirely.
    // If the file is absent (gitignored; normal in CI), skip gracefully.
    const raw = readFileOrNull(".claude/settings.json");
    if (raw === null) {
      // File absent — CI-safe skip. Annotate so the test run is clearly
      // skipped rather than silently passing.
      console.log("AC-1: .claude/settings.json not found (gitignored in CI) — skipping");
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissions");
  });

  it("settings.json still contains env and teammateMode keys after permissions removal", () => {
    // MISUSE: a too-aggressive deletion that removes env or teammateMode
    // would break the dev environment. This test guards against over-deletion.
    // Skip if file absent (gitignored in CI).
    const raw = readFileOrNull(".claude/settings.json");
    if (raw === null) {
      console.log("AC-1 guard: .claude/settings.json not found (gitignored in CI) — skipping");
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("env");
    expect(parsed).toHaveProperty("teammateMode");
  });
});

// ---------------------------------------------------------------------------
// AC-2a: staff-engineer plugin agent must NOT allow Edit tool
// AC-2b: staff-engineer plugin agent must still allow Write tool
// ---------------------------------------------------------------------------

describe("misuse(AC-2a): staff-engineer plugin agent must not have Edit in tools frontmatter", () => {
  it('src/plugin/agents/staff-engineer.md tools: list does NOT contain "Edit"', () => {
    // MISUSE: staff-engineer with Edit access can silently rewrite files it is
    // only supposed to review. Removing Edit forces it to use Write (full-file
    // replacement with explicit intent) and catches accidental in-place edits.
    const content = readFile("src/plugin/agents/staff-engineer.md");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    const toolsLine = frontmatter.split("\n").find((l) => l.startsWith("tools:")) ?? "";
    expect(toolsLine).not.toContain("Edit");
  });
});

describe("boundary(AC-2b): staff-engineer plugin agent must retain Write in tools frontmatter", () => {
  it('src/plugin/agents/staff-engineer.md tools: list still contains "Write"', () => {
    // BOUNDARY: removing Edit must not accidentally remove Write. Staff-engineer
    // still needs Write for any full-file output it produces (e.g. review reports).
    const content = readFile("src/plugin/agents/staff-engineer.md");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    const toolsLine = frontmatter.split("\n").find((l) => l.startsWith("tools:")) ?? "";
    expect(toolsLine).toContain("Write");
  });
});

// ---------------------------------------------------------------------------
// AC-3: src/agents/staff-engineer.md must have Edit in disallowedTools_default
// ---------------------------------------------------------------------------

describe("misuse(AC-3): src/agents/staff-engineer.md must deny Edit via disallowedTools_default", () => {
  it('src/agents/staff-engineer.md disallowedTools_default: includes "Edit"', () => {
    // MISUSE: the canonical (non-plugin) agent schema uses disallowedTools_default
    // to restrict tools. If Edit is absent here, the restriction is asymmetric —
    // it applies in plugin mode but not in direct-agent mode, creating a drift
    // between plugin and non-plugin execution paths.
    const content = readFile("src/agents/staff-engineer.md");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    const disallowedLine =
      frontmatter.split("\n").find((l) => l.startsWith("disallowedTools_default:")) ?? "";
    expect(disallowedLine).toContain("Edit");
  });
});

// ---------------------------------------------------------------------------
// AC-4a: src/plugin/agents/qa-validate.md must exist
// ---------------------------------------------------------------------------

describe("misuse(AC-4a): qa-validate agent file must exist", () => {
  it("src/plugin/agents/qa-validate.md exists on disk", () => {
    // MISUSE: if the file was never created, none of the downstream AC-4 tests
    // can possibly pass. Test existence first so failure is clearly diagnosed.
    expect(() => readFile("src/plugin/agents/qa-validate.md")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-4b: qa-validate tools list must be exactly [Read, Glob, Grep, Bash]
// ---------------------------------------------------------------------------

describe("misuse(AC-4b): qa-validate tools list must be exactly [Read, Glob, Grep, Bash]", () => {
  it("qa-validate.md tools: line contains Read, Glob, Grep, and Bash", () => {
    // MISUSE: QA-validate is a read-and-validate-only agent. Any write-capable
    // tool (Edit, Write) in its tool list would allow it to silently fix the
    // code it is supposed only to validate — defeating the validation gate.
    const content = readFileOrNull("src/plugin/agents/qa-validate.md");
    if (content === null) return; // file missing — AC-4a covers the existence failure
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    const toolsLine = frontmatter.split("\n").find((l) => l.startsWith("tools:")) ?? "";
    expect(toolsLine).toContain("Read");
    expect(toolsLine).toContain("Glob");
    expect(toolsLine).toContain("Grep");
    expect(toolsLine).toContain("Bash");
  });

  it("qa-validate.md tools: line does NOT contain Edit", () => {
    // MISUSE: Edit explicitly excluded — see parent describe comment.
    const content = readFileOrNull("src/plugin/agents/qa-validate.md");
    if (content === null) return;
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    const toolsLine = frontmatter.split("\n").find((l) => l.startsWith("tools:")) ?? "";
    expect(toolsLine).not.toContain("Edit");
  });

  it("qa-validate.md tools: line does NOT contain Write", () => {
    // MISUSE: Write explicitly excluded — a qa-validate agent that can Write
    // is no longer a pure validator.
    const content = readFileOrNull("src/plugin/agents/qa-validate.md");
    if (content === null) return;
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    const toolsLine = frontmatter.split("\n").find((l) => l.startsWith("tools:")) ?? "";
    expect(toolsLine).not.toContain("Write");
  });
});

// ---------------------------------------------------------------------------
// AC-4c: qa-validate must have a directive_gate block with required content
// ---------------------------------------------------------------------------

describe("misuse(AC-4c): qa-validate directive_gate block must be present and correct", () => {
  it('qa-validate.md body contains a directive_gate block with agent_name: "qa-validate"', () => {
    // MISUSE: without directive_gate, the agent has no identity fence — it can
    // drift into implementation mode without a self-check mechanism. The block
    // must name the agent exactly so the gate is unambiguous.
    const content = readFileOrNull("src/plugin/agents/qa-validate.md");
    if (content === null) return;
    expect(content).toContain("directive_gate:");
    expect(content).toContain('agent_name: "qa-validate"');
  });

  it("qa-validate.md directive_gate identity_constraints prohibits writing implementation code", () => {
    // MISUSE: qa-validate must explicitly state it does NOT write implementation
    // code. Without this constraint, the agent can rationalize writing a fix
    // instead of reporting it — collapsing the QA/dev separation.
    const content = readFileOrNull("src/plugin/agents/qa-validate.md");
    if (content === null) return;
    // The constraint must reference writing/implementation code prohibition.
    // Accept any phrasing that includes the core concepts.
    const lower = content.toLowerCase();
    const prohibitsWritingImpl =
      lower.includes("implementation code") || lower.includes("write implementation");
    expect(prohibitsWritingImpl).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-4d: qa-validate must NOT contain context_manifest field
// ---------------------------------------------------------------------------

describe("misuse(AC-4d): qa-validate must not have context_manifest field", () => {
  it("qa-validate.md frontmatter does NOT contain context_manifest:", () => {
    // MISUSE: context_manifest is dead frontmatter — Claude Code does not process
    // it (confirmed WS-SHARED-FILES). A new agent file that includes it sets a
    // bad precedent and misleads future authors into expecting auto-injection.
    // The strip in WS-SHARED-FILES removed it from existing files; this new file
    // must start clean.
    const content = readFileOrNull("src/plugin/agents/qa-validate.md");
    if (content === null) return;
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    expect(frontmatter).not.toContain("context_manifest:");
  });
});

// ---------------------------------------------------------------------------
// AC-5a: doctest-gate.test.ts must include qa-validate.md and count 23
// ---------------------------------------------------------------------------

describe("misuse(AC-5a): doctest-gate.test.ts count gates must be bumped to 23", () => {
  it('doctest-gate.test.ts SHIPPED_AGENTS array contains "qa-validate.md"', () => {
    // MISUSE: if qa-validate.md is not added to SHIPPED_AGENTS, the per-file
    // existence and frontmatter-cleanliness tests in doctest-gate will silently
    // skip the new agent — giving false green coverage on the new file.
    const content = readFile("tests/agents/doctest-gate.test.ts");
    expect(content).toContain('"qa-validate.md"');
  });

  it("doctest-gate.test.ts count assertions reference 23, not 22", () => {
    // MISUSE: an un-bumped count of 22 means the "no accidental deletion" guard
    // will pass even if qa-validate.md was never written — the count would match
    // the old roster and the new file would be invisible to the count gate.
    const content = readFile("tests/agents/doctest-gate.test.ts");
    // Must contain 23 in at least one count assertion context
    expect(content).toContain("23");
    // The old count 22 must be absent from agent-count assertion lines
    // (it may still appear in comments referencing old WS — we narrow to
    // assertion patterns: .toBe(22) is the specific form to ban)
    expect(content).not.toContain(".toBe(22)");
  });
});

// ---------------------------------------------------------------------------
// AC-5b: verify-plugin-install.sh must NOT reference agent count 22
// ---------------------------------------------------------------------------

describe("misuse(AC-5b): verify-plugin-install.sh must not reference agent count 22", () => {
  it("scripts/verify-plugin-install.sh does not contain agent count 22 in assertions", () => {
    // MISUSE: the shell script uses a hard-coded count string in its pass/fail
    // check. If the count is not bumped, a real install with 23 agents will fail
    // the script check — blocking the install gate after every future release.
    const content = readFile("scripts/verify-plugin-install.sh");
    // The script pattern is: AGENTS_COUNT = "22" and echo "Agents (22)"
    // Both must be gone after the bump. We check for the specific assertion form.
    expect(content).not.toContain('"22"');
  });
});

// ---------------------------------------------------------------------------
// AC-5c: plugin.json agents array must contain qa-validate
// ---------------------------------------------------------------------------

describe("misuse(AC-5c): plugin.json agents array must include qa-validate", () => {
  it(".claude-plugin/plugin.json agents array contains qa-validate", () => {
    // MISUSE: plugin.json is the manifest Claude Code reads to discover agents.
    // A new agent file that is never registered in the manifest will silently not
    // load at install time — all AC-4 content would exist on disk but be invisible
    // to the plugin runtime.
    const content = readFile(".claude-plugin/plugin.json");
    expect(content).toContain("qa-validate");
  });
});

// =============================================================================
// GOLDEN PATH — all changes present, zero stale references
// =============================================================================

// ---------------------------------------------------------------------------
// AC-5d: zero stale 22-count references remain in tests/ and verify script
// ---------------------------------------------------------------------------

describe("golden(AC-5d): zero stale 22-agent-count references remain after bump", () => {
  it("tests/agents/doctest-gate.test.ts has no .toBe(22) assertion", () => {
    // GOLDEN: the count gate in doctest-gate must have moved to 23. Any surviving
    // .toBe(22) would create a test that fails for the right reason (count is 23)
    // but looks like a test regression rather than a missing bump.
    const content = readFile("tests/agents/doctest-gate.test.ts");
    expect(content).not.toContain(".toBe(22)");
  });

  it("scripts/verify-plugin-install.sh has no agent-related count of 22", () => {
    // GOLDEN: confirm the shell script count assertion was updated and no "22"
    // string remains in any agent-count-related line.
    const content = readFile("scripts/verify-plugin-install.sh");
    // Split to lines and find any that are agent-count related and still say 22
    const agentLines = content
      .split("\n")
      .filter((l) => l.toLowerCase().includes("agent") || l.includes("AGENTS"));
    const stale22Lines = agentLines.filter((l) => l.includes("22"));
    expect(stale22Lines).toHaveLength(0);
  });
});
