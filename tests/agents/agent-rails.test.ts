import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// agent-rails.test.ts — RED specs for WS-AGENT-RAILS
//
// These tests are RED by design. Dev implements all 5 changes to make them green.
// DO NOT add implementation here.
//
// Changes under test:
//   1. Delete `permissions` block from `.claude/settings.json`
//   2. Remove `Edit` from `tools:` in `src/plugin/agents/staff-engineer.md`
//   3. Add `Edit` to `disallowedTools_default:` in `src/agents/staff-engineer.md`
//   4. Create `src/plugin/agents/qa-validate.md` with read-only tool set
//   5. Update agent count 22→23 in doctest-gate.test.ts, verify-plugin-install.sh
//
// Test ordering: misuse → boundary → golden path (ADR-064)
//
// =============================================================================

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Resolve a path relative to the project root */
function root(...segments: string[]): string {
  return path.resolve(__dirname, "..", "..", ...segments);
}

function readFile(relPath: string): string {
  return fs.readFileSync(root(relPath), "utf8");
}

/**
 * Returns null when the file does not exist.
 * Used for optional / not-yet-created files in RED specs.
 */
function readFileOrNull(relPath: string): string | null {
  const fullPath = root(relPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf8");
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(root(relPath));
}

// =============================================================================
// MISUSE — assertions that fire when forbidden content IS present, or required
// content IS absent. These are the highest-severity failures: they describe
// situations where a mis-configured agent can silently over-reach or under-reach.
// =============================================================================

// ---------------------------------------------------------------------------
// AC-1: .claude/settings.json must NOT have a `permissions` key
//
// MISUSE: the `permissions` block in settings.json was a global allowlist that
// let any agent call any tool without per-agent restriction. Leaving it in place
// means per-agent tool rails in frontmatter are overridden at the session level
// and the entire RAILS workstream has no effect. Deleting it forces Claude Code
// to evaluate each agent's own `tools:` and `disallowedTools_default:` fields.
// ---------------------------------------------------------------------------

describe("misuse(AC-1): settings.json must not retain the permissions block", () => {
  it("AC-1: .claude/settings.json does NOT have a top-level 'permissions' key", () => {
    // MISUSE: if 'permissions' is present, per-agent tool rails are negated.
    // The entire WS-AGENT-RAILS workstream is rendered inert.
    // This test FAILS until the permissions block is removed from settings.json.
    const raw = readFile(".claude/settings.json");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, "permissions")).toBe(false);
  });

  it("AC-1 (structural): settings.json retains env, teammateMode, _provenance, _schema_version", () => {
    // BOUNDARY-adjacent: deleting the permissions block must not accidentally
    // wipe the other required keys. A settings.json missing teammateMode would
    // silently disable agent-team mode, breaking all multi-agent workflows.
    const raw = readFile(".claude/settings.json");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, "env")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(parsed, "teammateMode")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(parsed, "_provenance")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(parsed, "_schema_version")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-2a/2b: src/plugin/agents/staff-engineer.md tools: line
//
// MISUSE: staff-engineer currently has `Edit` in its tools list. This means
// the agent can mutate arbitrary files during a "review" pass — exactly the
// kind of silent capability that the rails workstream aims to close. A reviewer
// that can Edit is indistinguishable from an implementer.
// ---------------------------------------------------------------------------

describe("misuse(AC-2a): staff-engineer plugin agent must not have Edit in tools", () => {
  it("AC-2a: src/plugin/agents/staff-engineer.md tools: line does NOT contain 'Edit'", () => {
    // MISUSE: if Edit remains in the tools: list, staff-engineer retains write
    // access it should not have. Reviews can silently mutate files.
    // This test FAILS until Edit is removed from the tools line.
    const content = readFile("src/plugin/agents/staff-engineer.md");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    const toolsLine = frontmatter.split("\n").find((l) => l.startsWith("tools:")) ?? "";
    expect(toolsLine).not.toContain("Edit");
  });
});

describe("boundary(AC-2b): staff-engineer plugin agent must retain Write in tools", () => {
  it("AC-2b: src/plugin/agents/staff-engineer.md tools: line DOES contain 'Write'", () => {
    // BOUNDARY: Write must survive the Edit removal. staff-engineer needs Write
    // to produce review artifacts and approval verdicts. A strip that accidentally
    // removes Write breaks the agent's output capability.
    const content = readFile("src/plugin/agents/staff-engineer.md");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    const toolsLine = frontmatter.split("\n").find((l) => l.startsWith("tools:")) ?? "";
    expect(toolsLine).toContain("Write");
  });
});

// ---------------------------------------------------------------------------
// AC-3: src/agents/staff-engineer.md disallowedTools_default must contain Edit
//
// MISUSE: src/agents/staff-engineer.md is the canonical agent spec used by teo
// tooling (non-plugin path). Its disallowedTools_default: is currently empty,
// meaning there is no programmatic rail against Edit on the non-plugin path.
// If the rails enforcement relies solely on the plugin frontmatter, teo sessions
// that load agents from src/agents/ bypass the restriction entirely.
// ---------------------------------------------------------------------------

describe("misuse(AC-3): src/agents/staff-engineer.md must deny Edit by default", () => {
  it("AC-3: src/agents/staff-engineer.md disallowedTools_default: contains 'Edit'", () => {
    // MISUSE: an empty disallowedTools_default leaves the non-plugin path
    // unrestricted. Both code paths must enforce the same rail.
    // This test FAILS until Edit is added to disallowedTools_default.
    const content = readFile("src/agents/staff-engineer.md");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    const disallowedLine =
      frontmatter.split("\n").find((l) => l.startsWith("disallowedTools_default:")) ?? "";
    expect(disallowedLine).toContain("Edit");
  });
});

// ---------------------------------------------------------------------------
// AC-4a/4b/4c: src/plugin/agents/qa-validate.md must exist with correct config
//
// MISUSE: without a dedicated qa-validate agent, the QA role has no read-only
// validation agent. Any agent used for validation today may carry write tools,
// allowing a "validation" pass to mutate files it should only be reading.
// ---------------------------------------------------------------------------

describe("misuse(AC-4a): qa-validate.md must exist", () => {
  it("AC-4a: src/plugin/agents/qa-validate.md exists on disk", () => {
    // MISUSE: if the file does not exist, the qa-validate role is unregistered
    // and cannot be spawned by Capo. This test FAILS until the file is created.
    expect(fileExists("src/plugin/agents/qa-validate.md")).toBe(true);
  });
});

describe("misuse(AC-4b): qa-validate.md tools must be exactly the read-only set", () => {
  it("AC-4b: qa-validate.md tools: line is [Read, Glob, Grep, Bash] — no write tools", () => {
    // MISUSE: if qa-validate carries Edit, Write, Task, or Agent it is not a
    // read-only validator. The entire point of this agent is enforcement through
    // capability restriction. A validator with write tools is indistinguishable
    // from an implementer and defeats the RAILS model.
    // This test FAILS until the file exists with the correct tools: value.
    const content = readFileOrNull("src/plugin/agents/qa-validate.md");
    if (content === null) {
      // File does not exist yet — fail explicitly rather than silently skip.
      expect(content, "qa-validate.md must exist before asserting its tools line").not.toBeNull();
      return;
    }
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    const toolsLine = frontmatter.split("\n").find((l) => l.startsWith("tools:")) ?? "";

    // Must contain the allowed tools
    expect(toolsLine).toContain("Read");
    expect(toolsLine).toContain("Glob");
    expect(toolsLine).toContain("Grep");
    expect(toolsLine).toContain("Bash");

    // Must NOT contain any write/spawn tools
    expect(toolsLine).not.toContain("Edit");
    expect(toolsLine).not.toContain("Write");
    expect(toolsLine).not.toContain("Task");
    expect(toolsLine).not.toContain("Agent");
  });
});

describe("misuse(AC-4c): qa-validate.md must have a directive_gate with correct agent_name", () => {
  it('AC-4c: qa-validate.md contains a directive_gate block with agent_name: "qa-validate"', () => {
    // MISUSE: without a directive_gate block, the qa-validate agent has no
    // identity constraint enforcement. It can drift into implementation behavior
    // with no halting guard. The agent_name must match the file name exactly so
    // the gate fires for this agent and not a neighbor.
    // This test FAILS until the file exists with a properly named directive_gate.
    const content = readFileOrNull("src/plugin/agents/qa-validate.md");
    if (content === null) {
      expect(content, "qa-validate.md must exist before asserting directive_gate").not.toBeNull();
      return;
    }
    expect(content).toContain("directive_gate:");
    expect(content).toContain('agent_name: "qa-validate"');
  });
});

// =============================================================================
// BOUNDARY — count and manifest consistency gates
//
// These tests catch "blast radius" misses: changes to agents/ that forget to
// update the count references downstream. Per the "change the whole blast radius"
// SOP, every count reference must be updated in the same workstream.
// =============================================================================

// ---------------------------------------------------------------------------
// AC-5a: doctest-gate.test.ts SHIPPED_AGENTS array must include qa-validate.md
//
// BOUNDARY: doctest-gate.test.ts maintains the authoritative SHIPPED_AGENTS list
// and asserts the exact count. Adding a new agent without updating this array
// causes the count assertion to fail at release time, not at the PR gate —
// too late in the pipeline.
// ---------------------------------------------------------------------------

describe("boundary(AC-5a): doctest-gate.test.ts must list qa-validate.md in SHIPPED_AGENTS", () => {
  it('AC-5a: tests/agents/doctest-gate.test.ts contains "qa-validate.md" in the SHIPPED_AGENTS array', () => {
    // BOUNDARY: if doctest-gate.test.ts is not updated, its count assertion
    // will fail (22 vs 23) and the per-file existence test will not cover
    // the new agent. The SHIPPED_AGENTS list is the authoritative plugin roster.
    // This test FAILS until qa-validate.md is added to SHIPPED_AGENTS.
    const content = readFile("tests/agents/doctest-gate.test.ts");
    expect(content).toContain('"qa-validate.md"');
  });
});

// ---------------------------------------------------------------------------
// AC-5b: verify-plugin-install.sh must NOT assert agent count as "22"
//
// BOUNDARY: scripts/verify-plugin-install.sh hard-codes the expected agent count.
// After adding qa-validate.md the count is 23. A script still asserting "22"
// will fail the release gate with a false negative on every future release,
// or worse — pass incorrectly if the count happens to be 22 for other reasons.
// ---------------------------------------------------------------------------

describe('boundary(AC-5b): verify-plugin-install.sh agent count must not be "22"', () => {
  it('AC-5b: scripts/verify-plugin-install.sh does not assert Agents count as "22"', () => {
    // BOUNDARY: the script currently checks `[ "${AGENTS_COUNT}" = "22" ]`.
    // After the new agent is added, this check must read "23".
    // We assert the old string "22" is NOT present in an agent-count context.
    // The test targets lines that pair the number with agent-count semantics
    // (i.e., lines containing both an agent-count token and "22").
    const content = readFile("scripts/verify-plugin-install.sh");
    const lines = content.split("\n");
    const agentCountLines = lines.filter(
      (l) =>
        // Lines that reference the agents count check — the = "22" comparison
        // and the echo/FAIL messages that name the expected count.
        l.includes("AGENTS_COUNT") || l.includes("Agents (22)") || l.includes("Agents(22)")
    );
    // None of the agent-count-relevant lines should still contain "22" as the target number
    for (const line of agentCountLines) {
      expect(line, `Line still asserts count 22: ${line}`).not.toContain('"22"');
    }
  });
});

// ---------------------------------------------------------------------------
// AC-5c: plugin manifest's agents directory must contain qa-validate.md
//
// BOUNDARY: .claude-plugin/plugin.json points to `./src/plugin/agents/` as the
// agents directory. This is how Claude Code discovers all agents at install time.
// The manifest does not enumerate files explicitly — it reads the directory.
// Therefore the "manifest references qa-validate" requirement is equivalent to:
// the agents directory that the manifest resolves to contains qa-validate.md.
// If the file is absent from that directory, the manifest effectively does NOT
// reference it at install time.
// ---------------------------------------------------------------------------

describe("boundary(AC-5c): plugin manifest agents directory contains qa-validate.md", () => {
  it("AC-5c: qa-validate.md is present in the agents directory referenced by .claude-plugin/plugin.json", () => {
    // BOUNDARY: read plugin.json, resolve the agents path, and assert the file
    // is present. This is the mechanical equivalent of "manifest references
    // qa-validate" for a directory-based manifest.
    // This test FAILS until qa-validate.md is created in src/plugin/agents/.
    const manifestRaw = readFile(".claude-plugin/plugin.json");
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
    const agentsField = manifest["agents"];
    expect(typeof agentsField, "plugin.json must have an agents field").toBe("string");

    // Resolve the agents path relative to the manifest file
    const manifestDir = root(".claude-plugin");
    const agentsDir = path.resolve(manifestDir, agentsField as string);
    const qaValidatePath = path.join(agentsDir, "qa-validate.md");
    expect(fs.existsSync(qaValidatePath), `qa-validate.md must exist at ${qaValidatePath}`).toBe(
      true
    );
  });
});

// =============================================================================
// GOLDEN PATH — full post-implementation state
//
// All five changes landed, all count references updated, new agent is well-formed.
// =============================================================================

describe("golden(WS-AGENT-RAILS): settings.json is clean — no permissions, required keys present", () => {
  it("golden: settings.json has env, teammateMode, _provenance, _schema_version and no permissions", () => {
    const raw = readFile(".claude/settings.json");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, "permissions")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, "env")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(parsed, "teammateMode")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(parsed, "_provenance")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(parsed, "_schema_version")).toBe(true);
  });
});

describe("golden(WS-AGENT-RAILS): staff-engineer tool rails are consistent on both paths", () => {
  it("golden: src/plugin/agents/staff-engineer.md has Write but not Edit in tools:", () => {
    const content = readFile("src/plugin/agents/staff-engineer.md");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    const toolsLine = frontmatter.split("\n").find((l) => l.startsWith("tools:")) ?? "";
    expect(toolsLine).toContain("Write");
    expect(toolsLine).not.toContain("Edit");
  });

  it("golden: src/agents/staff-engineer.md disallowedTools_default: contains Edit", () => {
    const content = readFile("src/agents/staff-engineer.md");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    const disallowedLine =
      frontmatter.split("\n").find((l) => l.startsWith("disallowedTools_default:")) ?? "";
    expect(disallowedLine).toContain("Edit");
  });
});

describe("golden(WS-AGENT-RAILS): qa-validate.md is a well-formed read-only agent", () => {
  it("golden: qa-validate.md exists, has valid frontmatter fields, correct tools, and directive_gate", () => {
    const content = readFileOrNull("src/plugin/agents/qa-validate.md");
    if (content === null) {
      expect(content, "qa-validate.md must exist for the golden path check").not.toBeNull();
      return;
    }

    // Frontmatter structure
    expect(content.startsWith("---\n")).toBe(true);
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
    expect(frontmatter).toMatch(/^name:/m);
    expect(frontmatter).toMatch(/^description:/m);
    expect(frontmatter).toMatch(/^model:/m);
    expect(frontmatter).toMatch(/^tools:/m);

    // Tool restriction
    const toolsLine = frontmatter.split("\n").find((l) => l.startsWith("tools:")) ?? "";
    expect(toolsLine).toContain("Read");
    expect(toolsLine).toContain("Glob");
    expect(toolsLine).toContain("Grep");
    expect(toolsLine).toContain("Bash");
    expect(toolsLine).not.toContain("Edit");
    expect(toolsLine).not.toContain("Write");
    expect(toolsLine).not.toContain("Task");
    expect(toolsLine).not.toContain("Agent");

    // Identity guard
    expect(content).toContain("directive_gate:");
    expect(content).toContain('agent_name: "qa-validate"');
  });
});

describe("golden(WS-AGENT-RAILS): agent count is 23 across all registry references", () => {
  it("golden: doctest-gate.test.ts SHIPPED_AGENTS has 23 entries and includes qa-validate.md", () => {
    const content = readFile("tests/agents/doctest-gate.test.ts");
    expect(content).toContain('"qa-validate.md"');

    // The count assertion in that file should reference 23, not 22
    // We check that the file now asserts 23 in its directory count test
    expect(content).toContain("23");
  });

  it("golden: verify-plugin-install.sh expects Agents (23)", () => {
    const content = readFile("scripts/verify-plugin-install.sh");
    // After the bump, lines asserting the agent count must name "23"
    expect(content).toContain("23");
    // And the old count is gone from agent-count context lines
    const lines = content.split("\n");
    const agentCountLines = lines.filter(
      (l) => l.includes("AGENTS_COUNT") || l.includes("Agents (")
    );
    for (const line of agentCountLines) {
      expect(line, `Line still uses old count 22: ${line}`).not.toContain('"22"');
    }
  });
});
