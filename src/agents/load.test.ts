import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// =============================================================================
// load.test.ts — FAILING specs for src/agents/load.ts (WS-P1-06)
//
// These tests are RED by design. Dev implements load.ts and the 10 agent .md
// files to make them green. DO NOT add implementation here.
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
//
// --- LOADER API CONTRACT (what dev must export from src/agents/load.ts) ------
//
//   interface AgentDefinition {
//     agent_id: string;              // must match the requested id / filename stem
//     name: string;                  // non-empty display name
//     role: string;                  // non-empty role description
//     disallowedTools_default: string[];  // list of tool names disallowed by default
//     body: string;                  // the constitution body text (post-frontmatter)
//   }
//
//   loadAgentDefinition(id: string, dir?: string): AgentDefinition
//     - Reads <dir>/<id>.md (dir defaults to the bundled src/agents/ directory,
//       resolved relative to load.ts itself so it works from any cwd).
//     - Parses YAML frontmatter.
//     - Validates with Zod: agent_id, name, role, disallowedTools_default are
//       all required. Missing or wrong type → throws a clear Error.
//     - Validates that frontmatter agent_id matches the requested id → throws
//       on mismatch.
//     - Rejects unknown ids / missing files → throws a clear Error (not undefined).
//     - Rejects path-traversal attempts (id containing "..", "/", or "\") → throws.
//     - Returns AgentDefinition on success.
//
//   listAgentIds(dir?: string): string[]
//     - Returns the stem names of every *.md file in dir.
//     - dir defaults to same bundled src/agents/ directory as loadAgentDefinition.
//     - Returns a plain string array (order not contractual).
//
// --- CAPO EXECUTOR-BLOCK CONTRACT -------------------------------------------
//
//   capo.md frontmatter disallowedTools_default MUST include ALL of the
//   following tool name strings (exact match, case-sensitive):
//     "Write", "Edit", "Bash"
//
//   Rationale: Capo is the planner; it must never act as a task executor.
//   These three tools cover the key file-write, file-edit, and code-execution
//   surfaces. Belt-and-suspenders with PQ-03 (validate.ts).
//
// --- FRONTMATTER PARSING NOTE FOR DEV ----------------------------------------
//
//   No YAML parser is currently in package.json dependencies. Dev may:
//     a) Parse the minimal flat frontmatter inline (simple key: value, no nesting
//        or multi-line values needed for these files), OR
//     b) Add a minimal YAML parsing library (e.g. js-yaml, yaml).
//   Tests assert on the PARSED result only — the parsing mechanism is dev's choice.
//   The frontmatter format is standard "---\nkey: value\n---\n" delimiters.
//
// --- COVERAGE NOTE FOR DEV ---------------------------------------------------
//
//   load.ts must be added to vitest.config.ts perFile thresholds at 100% lines/
//   branches/functions/statements. The 10 .md data files are NOT TypeScript — they
//   are not instrumented and need no coverage entry.
//
// =============================================================================

// These imports WILL FAIL until dev creates src/agents/load.ts.
// That is the intended failing state.
import { loadAgentDefinition, listAgentIds } from "./load.js";
import type { AgentDefinition } from "./load.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The 10 canonical agent ids TEO provisions. */
const EXPECTED_AGENT_IDS: readonly string[] = [
  "software-engineer",
  "frontend-engineer",
  "data-engineer",
  "devops-engineer",
  "capo",
  "qa",
  "staff-engineer",
  "security-engineer",
  "coordinator",
  "technical-writer",
] as const;

/**
 * Exact tool name strings that capo.md's disallowedTools_default MUST include.
 * Dev must put these exact strings in the capo.md frontmatter list.
 * Case-sensitive.
 */
const SAGE_BLOCKED_TOOLS: readonly string[] = ["Write", "Edit", "Bash"] as const;

// ---------------------------------------------------------------------------
// Fixture helpers — temp dir with hand-crafted .md files for misuse tests
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  // Create a fresh isolated directory for each fixture-based test.
  // loadAgentDefinition's injectable `dir` param is used instead of the real
  // src/agents/ dir — we're testing the loader's validation, not breaking real files.
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-ws-p1-06-"));
});

afterEach(() => {
  // Clean up temp fixtures — best-effort
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

/** Write a raw string as <stem>.md in tempDir */
function writeFixture(stem: string, content: string): void {
  fs.writeFileSync(path.join(tempDir, `${stem}.md`), content, "utf8");
}

/** Minimal valid frontmatter block with all required keys present */
function validFrontmatter(stem: string): string {
  return (
    `---\n` +
    `agent_id: ${stem}\n` +
    `name: Test Agent\n` +
    `role: A test role description.\n` +
    `disallowedTools_default:\n` +
    `  - SomeTool\n` +
    `---\n\n` +
    `# Constitution body\n\nThis is the agent constitution.\n`
  );
}

// =============================================================================
// MISUSE — bad inputs that must throw clear errors
// =============================================================================

describe("loadAgentDefinition — misuse: nonexistent id", () => {
  it("throws (not undefined) when the requested id does not exist", () => {
    // A caller that forgets to check the return value must get an error, not
    // a silent undefined. Fundamental contract: no successful-looking no-op.
    expect(() => loadAgentDefinition("nonexistent")).toThrow();
  });

  it("thrown error message references the unknown id", () => {
    let msg = "";
    try {
      loadAgentDefinition("does-not-exist-at-all");
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toMatch(/does-not-exist-at-all/);
  });
});

describe("loadAgentDefinition — misuse: path-traversal rejection", () => {
  it("throws when id contains '..' (path traversal attempt)", () => {
    // An adversary could pass "../../../etc/passwd" to escape the agents dir.
    // The loader must reject ids containing ".." before constructing any path.
    expect(() => loadAgentDefinition("../sneaky")).toThrow();
  });

  it("throws when id contains a forward slash", () => {
    expect(() => loadAgentDefinition("sub/agent")).toThrow();
  });

  it("throws when id contains a backslash", () => {
    expect(() => loadAgentDefinition("sub\\agent")).toThrow();
  });

  it("error message for path-traversal does not contain the attempted escape content", () => {
    // Safety: the error must not inadvertently surface path info
    let msg = "";
    try {
      loadAgentDefinition("../etc/passwd");
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    // Should not contain the raw path beyond the controlled error surface
    expect(msg).not.toContain("/etc/passwd");
  });
});

describe("loadAgentDefinition — misuse: malformed frontmatter in injected fixture", () => {
  it("throws when the .md file is missing the 'name' required key", () => {
    // Missing 'name' — loader must reject via Zod, not silently return undefined
    writeFixture(
      "bad-agent",
      `---\nagent_id: bad-agent\nrole: Something.\ndisallowedTools_default:\n  - Tool\n---\n\nBody.\n`
    );
    expect(() => loadAgentDefinition("bad-agent", tempDir)).toThrow();
  });

  it("throws when the .md file is missing the 'role' required key", () => {
    writeFixture(
      "bad-agent",
      `---\nagent_id: bad-agent\nname: Bad Agent\ndisallowedTools_default:\n  - Tool\n---\n\nBody.\n`
    );
    expect(() => loadAgentDefinition("bad-agent", tempDir)).toThrow();
  });

  it("throws when the .md file is missing 'agent_id'", () => {
    writeFixture(
      "bad-agent",
      `---\nname: Bad Agent\nrole: Something.\ndisallowedTools_default:\n  - Tool\n---\n\nBody.\n`
    );
    expect(() => loadAgentDefinition("bad-agent", tempDir)).toThrow();
  });

  it("throws when 'disallowedTools_default' is missing", () => {
    writeFixture(
      "bad-agent",
      `---\nagent_id: bad-agent\nname: Bad Agent\nrole: Something.\n---\n\nBody.\n`
    );
    expect(() => loadAgentDefinition("bad-agent", tempDir)).toThrow();
  });

  it("throws when 'disallowedTools_default' is a string instead of a list", () => {
    // Scalar where array expected — Zod must catch this
    writeFixture(
      "bad-agent",
      `---\nagent_id: bad-agent\nname: Bad Agent\nrole: Something.\ndisallowedTools_default: NotAList\n---\n\nBody.\n`
    );
    expect(() => loadAgentDefinition("bad-agent", tempDir)).toThrow();
  });

  it("throws when the file has no frontmatter delimiters at all", () => {
    writeFixture("bad-agent", `Just a plain markdown file with no frontmatter.\n`);
    expect(() => loadAgentDefinition("bad-agent", tempDir)).toThrow();
  });

  it("throws when the frontmatter block is not closed (missing closing ---)", () => {
    writeFixture(
      "bad-agent",
      `---\nagent_id: bad-agent\nname: Bad Agent\nrole: Something.\ndisallowedTools_default:\n  - Tool\n\nBody without closing delimiter.\n`
    );
    expect(() => loadAgentDefinition("bad-agent", tempDir)).toThrow();
  });
});

describe("loadAgentDefinition — misuse: agent_id frontmatter mismatch", () => {
  it("throws when the frontmatter agent_id does not match the requested id", () => {
    // If someone edits the frontmatter agent_id without renaming the file,
    // the loader must catch the inconsistency and reject it.
    writeFixture(
      "actual-name",
      `---\nagent_id: wrong-name\nname: Mismatch Agent\nrole: Something.\ndisallowedTools_default:\n  - Tool\n---\n\nBody.\n`
    );
    expect(() => loadAgentDefinition("actual-name", tempDir)).toThrow();
  });

  it("thrown error for agent_id mismatch references both the requested id and the frontmatter value", () => {
    writeFixture(
      "alpha",
      `---\nagent_id: beta\nname: Wrong\nrole: Mismatch.\ndisallowedTools_default:\n  - Tool\n---\n\nBody.\n`
    );
    let msg = "";
    try {
      loadAgentDefinition("alpha", tempDir);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    // Both the filename stem and the frontmatter value should appear in the error
    expect(msg).toMatch(/alpha/);
    expect(msg).toMatch(/beta/);
  });
});

// =============================================================================
// BOUNDARY — edge cases and structural invariants
// =============================================================================

describe("loadAgentDefinition — boundary: capo executor-blocking tools", () => {
  it("capo's disallowedTools_default includes 'Write' (file-write surface)", () => {
    // Capo is the planner — it must never be able to write files.
    // 'Write' is the Claude Code tool that writes file contents.
    const capo = loadAgentDefinition("capo");
    expect(capo.disallowedTools_default).toContain("Write");
  });

  it("capo's disallowedTools_default includes 'Edit' (file-edit surface)", () => {
    // 'Edit' is the Claude Code tool that performs string replacements in files.
    const capo = loadAgentDefinition("capo");
    expect(capo.disallowedTools_default).toContain("Edit");
  });

  it("capo's disallowedTools_default includes 'Bash' (code-execution surface)", () => {
    // 'Bash' is the Claude Code tool that executes shell commands.
    const capo = loadAgentDefinition("capo");
    expect(capo.disallowedTools_default).toContain("Bash");
  });

  it("capo's disallowedTools_default contains all three required executor-blocking tools at once", () => {
    // Belt-and-suspenders: single assertion covering all three required entries
    const capo = loadAgentDefinition("capo");
    for (const tool of SAGE_BLOCKED_TOOLS) {
      expect(capo.disallowedTools_default).toContain(tool);
    }
  });

  it("capo's disallowedTools_default is a non-empty array", () => {
    const capo = loadAgentDefinition("capo");
    expect(Array.isArray(capo.disallowedTools_default)).toBe(true);
    expect(capo.disallowedTools_default.length).toBeGreaterThan(0);
  });
});

describe("loadAgentDefinition — boundary: injectable dir", () => {
  it("loads from an injected temp dir instead of the bundled src/agents/ dir", () => {
    writeFixture("custom-agent", validFrontmatter("custom-agent"));
    const result = loadAgentDefinition("custom-agent", tempDir);
    expect(result.agent_id).toBe("custom-agent");
  });

  it("still throws for a nonexistent id even in an injected dir", () => {
    // The temp dir exists but has no files for this id
    expect(() => loadAgentDefinition("ghost", tempDir)).toThrow();
  });

  it("returned body is non-empty when the fixture has a constitution body", () => {
    writeFixture("my-agent", validFrontmatter("my-agent"));
    const result = loadAgentDefinition("my-agent", tempDir);
    expect(result.body.trim().length).toBeGreaterThan(0);
  });
});

describe("listAgentIds — boundary: injectable dir", () => {
  it("returns an empty array for an empty directory", () => {
    const ids = listAgentIds(tempDir);
    expect(ids).toEqual([]);
  });

  it("returns only stem names (no .md extension) for fixtures in the injected dir", () => {
    writeFixture("alpha", validFrontmatter("alpha"));
    writeFixture("beta", validFrontmatter("beta"));
    const ids = listAgentIds(tempDir);
    expect(ids).toContain("alpha");
    expect(ids).toContain("beta");
    // Must not include the extension
    for (const id of ids) {
      expect(id).not.toMatch(/\.md$/);
    }
  });

  it("ignores non-.md files in the directory", () => {
    writeFixture("real-agent", validFrontmatter("real-agent"));
    // Plant a non-.md file — must not appear in results
    fs.writeFileSync(path.join(tempDir, "README.txt"), "not an agent", "utf8");
    fs.writeFileSync(path.join(tempDir, "load.ts"), "not an agent", "utf8");
    const ids = listAgentIds(tempDir);
    expect(ids).toContain("real-agent");
    expect(ids).not.toContain("README");
    expect(ids).not.toContain("load");
  });
});

// =============================================================================
// GOLDEN PATH — all 10 canonical agents load successfully
// =============================================================================

describe("listAgentIds — golden: bundled src/agents/ directory", () => {
  it("returns exactly the 10 expected agent ids", () => {
    // The bundled dir default is used — no injected dir.
    // Will FAIL until dev creates all 10 .md files.
    const ids = listAgentIds();
    const sorted = [...ids].sort();
    const expectedSorted = [...EXPECTED_AGENT_IDS].sort();
    expect(sorted).toEqual(expectedSorted);
  });

  it("returns a plain string array (not a Set, not an object)", () => {
    const ids = listAgentIds();
    expect(Array.isArray(ids)).toBe(true);
    for (const id of ids) {
      expect(typeof id).toBe("string");
    }
  });
});

describe("loadAgentDefinition — golden: each of the 10 agents loads successfully", () => {
  it.each([...EXPECTED_AGENT_IDS])("agent '%s' loads without throwing", (id) => {
    // Will FAIL until dev creates all 10 .md files and load.ts.
    expect(() => loadAgentDefinition(id)).not.toThrow();
  });

  it.each([...EXPECTED_AGENT_IDS])(
    "agent '%s' has a non-empty agent_id matching the requested id",
    (id) => {
      const def = loadAgentDefinition(id);
      expect(def.agent_id).toBe(id);
    }
  );

  it.each([...EXPECTED_AGENT_IDS])("agent '%s' has a non-empty name", (id) => {
    const def = loadAgentDefinition(id);
    expect(typeof def.name).toBe("string");
    expect(def.name.trim().length).toBeGreaterThan(0);
  });

  it.each([...EXPECTED_AGENT_IDS])("agent '%s' has a non-empty role", (id) => {
    const def = loadAgentDefinition(id);
    expect(typeof def.role).toBe("string");
    expect(def.role.trim().length).toBeGreaterThan(0);
  });

  it.each([...EXPECTED_AGENT_IDS])(
    "agent '%s' has a disallowedTools_default that is a string array",
    (id) => {
      const def = loadAgentDefinition(id);
      expect(Array.isArray(def.disallowedTools_default)).toBe(true);
      for (const tool of def.disallowedTools_default) {
        expect(typeof tool).toBe("string");
      }
    }
  );

  it.each([...EXPECTED_AGENT_IDS])("agent '%s' has a non-empty constitution body", (id) => {
    const def = loadAgentDefinition(id);
    expect(typeof def.body).toBe("string");
    expect(def.body.trim().length).toBeGreaterThan(0);
  });
});

describe("AgentDefinition — golden: shape contract", () => {
  it("returned object has exactly the expected shape (no extra undeclared fields break callers)", () => {
    // Validate the full shape of the returned object.
    // This test exists so that if dev adds fields to AgentDefinition they do it
    // intentionally and update the type export — callers rely on this shape.
    // Uses "qa" — a stable executor agent present in every roster revision.
    const def: AgentDefinition = loadAgentDefinition("qa");
    expect(def).toHaveProperty("agent_id");
    expect(def).toHaveProperty("name");
    expect(def).toHaveProperty("role");
    expect(def).toHaveProperty("disallowedTools_default");
    expect(def).toHaveProperty("body");
  });

  it("loadAgentDefinition is synchronous — return value is not a Promise", () => {
    // load.ts reads files — if dev accidentally makes this async the callers break.
    const result = loadAgentDefinition("qa");
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof (result as AgentDefinition).agent_id).toBe("string");
  });
});
