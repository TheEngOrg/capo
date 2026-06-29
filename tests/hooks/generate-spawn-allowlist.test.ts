// WS-SPAWN-GUARD — QA spec (post-impl, green)
// Status: GREEN — implementation exists at src/plugin/scripts/generate-spawn-allowlist.js

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// =============================================================================
// generate-spawn-allowlist.test.ts — tests for the allowlist generator
//
// PURPOSE
//   The generator reads src/plugin/agents/*.md files, parses the `tools:`
//   frontmatter line, extracts Task(...) parentheticals, and emits
//   src/plugin/spawn-allowlist.json.
//
//   D3 decision: frontmatter is the single source of truth. The generator is
//   build-time — it produces the JSON consumed by the spawn-guard hook at
//   runtime.
//
// WHAT MUST EXIST BEFORE THESE TESTS PASS
//   src/plugin/scripts/generate-spawn-allowlist.js  (or .mjs / .ts + invoked via node)
//
// EXPECTED INVOCATION
//   node src/plugin/scripts/generate-spawn-allowlist.js --agents-dir <path> --out <path>
//   (exact flags are up to dev; tests use TEO_AGENTS_DIR + TEO_ALLOWLIST_OUT env vars
//    OR positional args — dev must pick one and the tests must be updated to match.
//    The env-var interface is tested here as the primary path.)
//
// ORDERING: misuse → boundary → golden path (ADR-064 critical-path policy)
//
// DESIGN CONSTRAINTS
//   - Tests create isolated temp dirs; never mutate src/plugin/agents/
//   - No hardcoded expected integer counts
//   - No /tmp absolute literals (use os.tmpdir())
//   - Generator must NOT throw on malformed input — it must fail-open and log WARN
// =============================================================================

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GENERATOR = path.join(REPO_ROOT, "src", "plugin", "scripts", "generate-spawn-allowlist.js");
const REAL_AGENTS_DIR = path.join(REPO_ROOT, "src", "plugin", "agents");

// ---------------------------------------------------------------------------
// Helpers — temp agent dirs
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-gen-allowlist-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Write a fake agent .md file to tmpDir/agents/<name>.md with the given
 * tools line. Returns the agents dir path.
 */
function writeAgent(agentsDir: string, name: string, toolsLine: string): void {
  const content = [
    "---",
    `name: ${name}`,
    `description: "Test agent ${name}"`,
    `model: sonnet`,
    `tools: ${toolsLine}`,
    `memory: local`,
    "---",
    "",
    `# ${name}`,
    "Agent body.",
  ].join("\n");
  fs.writeFileSync(path.join(agentsDir, `${name}.md`), content, "utf8");
}

/**
 * Run the generator with an agents directory and output path.
 * Returns { exitCode, stdout, stderr, allowlist }.
 * allowlist is null if the output file was not created or contained invalid JSON.
 */
function runGenerator(
  agentsDir: string,
  outPath: string
): {
  exitCode: number;
  stdout: string;
  stderr: string;
  allowlist: Record<string, unknown> | null;
} {
  const result = spawnSync("node", [GENERATOR], {
    encoding: "utf8",
    env: {
      ...process.env,
      TEO_AGENTS_DIR: agentsDir,
      TEO_ALLOWLIST_OUT: outPath,
    },
  });

  let allowlist: Record<string, unknown> | null = null;
  if (fs.existsSync(outPath)) {
    try {
      allowlist = JSON.parse(fs.readFileSync(outPath, "utf8")) as Record<string, unknown>;
    } catch {
      allowlist = null;
    }
  }

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    allowlist,
  };
}

// =============================================================================
// MISUSE — generator must not crash on bad inputs
// =============================================================================

describe("generate-spawn-allowlist — MISS-GEN-01: empty agents dir → empty allowlist, no throw", () => {
  it("exits 0 when the agents directory contains no .md files", () => {
    const agentsDir = path.join(tmpDir, "agents-empty");
    fs.mkdirSync(agentsDir, { recursive: true });
    const outPath = path.join(tmpDir, "allowlist.json");

    const { exitCode } = runGenerator(agentsDir, outPath);
    expect(exitCode, "empty agents dir must not crash the generator (exit 0)").toBe(0);
  });

  it("emits a valid JSON file with an empty allowlist object when agents dir has no .md files", () => {
    const agentsDir = path.join(tmpDir, "agents-empty");
    fs.mkdirSync(agentsDir, { recursive: true });
    const outPath = path.join(tmpDir, "allowlist.json");

    const { allowlist } = runGenerator(agentsDir, outPath);

    expect(
      allowlist,
      "output file must be created and be valid JSON even for empty agents dir"
    ).not.toBeNull();

    const al = allowlist as Record<string, unknown>;
    expect(al, "output must contain an allowlist key").toHaveProperty("allowlist");

    const innerAllowlist = al["allowlist"] as Record<string, unknown>;
    expect(
      Object.keys(innerAllowlist).length,
      "allowlist must be empty (no entries) when no agents exist"
    ).toBe(0);
  });

  it("emits generated_at and source fields in the output even for empty input", () => {
    const agentsDir = path.join(tmpDir, "agents-empty");
    fs.mkdirSync(agentsDir, { recursive: true });
    const outPath = path.join(tmpDir, "allowlist.json");

    const { allowlist } = runGenerator(agentsDir, outPath);
    if (allowlist === null) return;

    expect(allowlist, "output must contain a generated_at timestamp").toHaveProperty(
      "generated_at"
    );

    expect(allowlist, "output must contain a source path").toHaveProperty("source");
  });
});

describe("generate-spawn-allowlist — MISS-GEN-02: agent with malformed frontmatter → skipped, others processed", () => {
  it("skips the malformed agent but processes valid agents in the same directory", () => {
    const agentsDir = path.join(tmpDir, "agents-partial");
    fs.mkdirSync(agentsDir, { recursive: true });

    // Valid agent with Task parentheticals
    writeAgent(agentsDir, "product-manager", "[Task(qa, design), Read]");

    // Malformed agent: no tools line at all
    fs.writeFileSync(
      path.join(agentsDir, "broken.md"),
      "---\nname: broken\ndescription: no tools line\n---\nBody.",
      "utf8"
    );

    const outPath = path.join(tmpDir, "allowlist.json");
    const { exitCode, allowlist } = runGenerator(agentsDir, outPath);

    expect(exitCode, "partial malformed input must not crash the generator").toBe(0);
    expect(allowlist, "output must still be valid JSON").not.toBeNull();

    const al = allowlist as Record<string, unknown>;
    const inner = al["allowlist"] as Record<string, string[]>;

    // product-manager must be present (valid agent processed)
    expect(
      Object.prototype.hasOwnProperty.call(inner, "product-manager"),
      "valid agent (product-manager) must appear in allowlist even when another agent is malformed"
    ).toBe(true);
  });

  it("exits 0 when all agents have malformed frontmatter (no tools line)", () => {
    const agentsDir = path.join(tmpDir, "agents-all-broken");
    fs.mkdirSync(agentsDir, { recursive: true });

    fs.writeFileSync(path.join(agentsDir, "broken1.md"), "---\nname: broken1\n---\nBody.", "utf8");
    fs.writeFileSync(path.join(agentsDir, "broken2.md"), "no frontmatter at all", "utf8");

    const outPath = path.join(tmpDir, "allowlist-all-broken.json");
    const { exitCode } = runGenerator(agentsDir, outPath);

    expect(exitCode, "all-malformed agents must produce exit 0, not a crash").toBe(0);
  });
});

describe("generate-spawn-allowlist — MISS-GEN-03: Task() with nonexistent target → included as-is (generator is not a validator)", () => {
  it("includes the typo'd target name as-is (generator does not validate target agent existence)", () => {
    const agentsDir = path.join(tmpDir, "agents-typo");
    fs.mkdirSync(agentsDir, { recursive: true });

    // 'nonexistent-agent' does not exist in the agents dir
    writeAgent(agentsDir, "product-manager", "[Task(qa, nonexistent-agent), Read]");

    const outPath = path.join(tmpDir, "allowlist-typo.json");
    const { allowlist } = runGenerator(agentsDir, outPath);
    if (allowlist === null) return;

    const inner = (allowlist["allowlist"] ?? {}) as Record<string, string[]>;
    const targets = inner["product-manager"] ?? [];

    expect(
      targets.includes("nonexistent-agent"),
      "generator must include nonexistent target as-is — it does not validate target existence"
    ).toBe(true);
  });

  it("exits 0 even when Task() references only nonexistent targets", () => {
    const agentsDir = path.join(tmpDir, "agents-bad-refs");
    fs.mkdirSync(agentsDir, { recursive: true });

    writeAgent(agentsDir, "cto", "[Task(totally-made-up), Read]");

    const outPath = path.join(tmpDir, "allowlist-bad-refs.json");
    const { exitCode } = runGenerator(agentsDir, outPath);

    expect(exitCode, "nonexistent Task targets must not crash the generator").toBe(0);
  });
});

// =============================================================================
// BOUNDARY — structural well-formedness of the generator and output
// =============================================================================

describe("generate-spawn-allowlist — boundary: generator exists and is runnable", () => {
  it("generator file exists at src/plugin/scripts/generate-spawn-allowlist.js", () => {
    expect(
      fs.existsSync(GENERATOR),
      "src/plugin/scripts/generate-spawn-allowlist.js is missing — run dev to create it"
    ).toBe(true);
  });

  it("generator exits 0 on the real src/plugin/agents/ directory", () => {
    const outPath = path.join(tmpDir, "real-allowlist.json");
    const { exitCode } = runGenerator(REAL_AGENTS_DIR, outPath);

    expect(exitCode, "generator must exit 0 on the real agents dir").toBe(0);
  });

  it("output is valid JSON when run on the real src/plugin/agents/ directory", () => {
    const outPath = path.join(tmpDir, "real-allowlist-valid.json");
    const { allowlist } = runGenerator(REAL_AGENTS_DIR, outPath);

    expect(allowlist, "real agents dir must produce valid JSON output").not.toBeNull();
  });

  it("output schema: generated_at is an ISO-8601 string", () => {
    const outPath = path.join(tmpDir, "schema-ts.json");
    const { allowlist } = runGenerator(REAL_AGENTS_DIR, outPath);
    if (allowlist === null) return;

    const ts = allowlist["generated_at"] as string;
    expect(typeof ts, "generated_at must be a string").toBe("string");

    // ISO-8601 basic check: parseable by Date and not NaN
    const parsed = Date.parse(ts);
    expect(isNaN(parsed), `generated_at "${ts}" must be a valid ISO-8601 date`).toBe(false);
  });

  it("output schema: allowlist is an object (not an array)", () => {
    const outPath = path.join(tmpDir, "schema-obj.json");
    const { allowlist } = runGenerator(REAL_AGENTS_DIR, outPath);
    if (allowlist === null) return;

    const inner = allowlist["allowlist"];
    expect(typeof inner, "allowlist field must be an object").toBe("object");
    expect(Array.isArray(inner), "allowlist field must not be an array").toBe(false);
  });
});

// =============================================================================
// GOLDEN PATH — correct parsing of real frontmatter patterns
// =============================================================================

describe("generate-spawn-allowlist — HAPPY-GEN-01: Task(qa, design) → { product-manager: [qa, design] }", () => {
  it('parses Task(qa, design) and produces the correct allowlist entry for "product-manager"', () => {
    const agentsDir = path.join(tmpDir, "agents-pm");
    fs.mkdirSync(agentsDir, { recursive: true });
    writeAgent(agentsDir, "product-manager", "[Task(qa, design), Read, Glob]");

    const outPath = path.join(tmpDir, "allowlist-pm.json");
    const { allowlist } = runGenerator(agentsDir, outPath);

    expect(allowlist, "output must be valid JSON").not.toBeNull();
    const inner = (allowlist!["allowlist"] ?? {}) as Record<string, string[]>;

    expect(
      Object.prototype.hasOwnProperty.call(inner, "product-manager"),
      'allowlist must contain an entry for "product-manager"'
    ).toBe(true);

    const targets = inner["product-manager"] ?? [];
    expect(targets, 'product-manager targets must include "qa"').toContain("qa");
    expect(targets, 'product-manager targets must include "design"').toContain("design");
    expect(targets.length, "product-manager must have exactly 2 permitted targets").toBe(2);
  });

  it("preserves the order of targets as written in the frontmatter", () => {
    const agentsDir = path.join(tmpDir, "agents-order");
    fs.mkdirSync(agentsDir, { recursive: true });
    writeAgent(
      agentsDir,
      "engineering-manager",
      "[Task(qa, software-engineer, staff-engineer), Read]"
    );

    const outPath = path.join(tmpDir, "allowlist-order.json");
    const { allowlist } = runGenerator(agentsDir, outPath);

    if (allowlist === null) return;
    const inner = (allowlist["allowlist"] ?? {}) as Record<string, string[]>;
    const targets = inner["engineering-manager"] ?? [];

    expect(targets[0], "first target must be qa").toBe("qa");
    expect(targets[1], "second target must be software-engineer").toBe("software-engineer");
    expect(targets[2], "third target must be staff-engineer").toBe("staff-engineer");
  });
});

describe('generate-spawn-allowlist — HAPPY-GEN-02: bare Task (no parentheticals) → ["*"] or agent omitted from allowlist', () => {
  it("agent with bare Task (no parentheticals) produces a wildcard or an absence — never an empty array", () => {
    // D3 decision: bare Task means the agent can spawn any target.
    // Representation options: include with ["*"], or OMIT from the allowlist (and
    // the hook treats omission as wildcard). Either is valid — but an empty []
    // would be WRONG (it would mean "cannot spawn anyone").
    const agentsDir = path.join(tmpDir, "agents-bare-task");
    fs.mkdirSync(agentsDir, { recursive: true });
    writeAgent(agentsDir, "capo", "[Read, Glob, Grep, Task, Bash, WebFetch, WebSearch]");

    const outPath = path.join(tmpDir, "allowlist-bare-task.json");
    const { allowlist } = runGenerator(agentsDir, outPath);

    if (allowlist === null) return;
    const inner = (allowlist["allowlist"] ?? {}) as Record<string, string[] | string>;

    if (Object.prototype.hasOwnProperty.call(inner, "capo")) {
      // If capo IS in the allowlist, the entry must not be an empty array
      const entry = inner["capo"];
      const isEmptyArray = Array.isArray(entry) && (entry as string[]).length === 0;
      expect(
        isEmptyArray,
        'bare Task agent must not have an empty array — that would mean cannot spawn anyone. Use ["*"] or omit.'
      ).toBe(false);
    }
    // If capo is NOT in the allowlist, that is also valid (hook treats absence as wildcard)
    // No assertion needed for the omission case — absence is correct behavior.
  });

  it('bare Task agent (capo) uses ["*"] if included, signaling any-target-allowed', () => {
    const agentsDir = path.join(tmpDir, "agents-bare-star");
    fs.mkdirSync(agentsDir, { recursive: true });
    writeAgent(agentsDir, "capo", "[Read, Task, Bash]");

    const outPath = path.join(tmpDir, "allowlist-bare-star.json");
    const { allowlist } = runGenerator(agentsDir, outPath);

    if (allowlist === null) return;
    const inner = (allowlist["allowlist"] ?? {}) as Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(inner, "capo")) {
      const entry = inner["capo"];
      // If present, must be ["*"]
      expect(
        Array.isArray(entry) && (entry as string[])[0] === "*",
        'bare Task included in allowlist must use ["*"] as the target list'
      ).toBe(true);
    }
    // omission is also acceptable — documented above
  });
});

describe("generate-spawn-allowlist — HAPPY-GEN-03: agent without Task in tools → NOT in allowlist", () => {
  it("agent with no Task in tools line is absent from the allowlist", () => {
    const agentsDir = path.join(tmpDir, "agents-no-task");
    fs.mkdirSync(agentsDir, { recursive: true });

    // qa has no Task in its tools — it cannot spawn
    writeAgent(agentsDir, "qa", "[Read, Glob, Grep, Edit, Write, Bash]");

    const outPath = path.join(tmpDir, "allowlist-no-task.json");
    const { allowlist } = runGenerator(agentsDir, outPath);

    if (allowlist === null) return;
    const inner = (allowlist["allowlist"] ?? {}) as Record<string, unknown>;

    expect(
      Object.prototype.hasOwnProperty.call(inner, "qa"),
      "qa (no Task in tools) must NOT appear in the allowlist — it cannot spawn"
    ).toBe(false);
  });

  it("agents without Task are excluded even when mixed with agents that have Task", () => {
    const agentsDir = path.join(tmpDir, "agents-mixed");
    fs.mkdirSync(agentsDir, { recursive: true });

    writeAgent(
      agentsDir,
      "engineering-manager",
      "[Task(qa, software-engineer, staff-engineer), Read]"
    );
    writeAgent(agentsDir, "qa", "[Read, Glob, Grep, Edit, Write, Bash]");
    writeAgent(agentsDir, "software-engineer", "[Read, Glob, Grep, Edit, Write, Bash]");

    const outPath = path.join(tmpDir, "allowlist-mixed.json");
    const { allowlist } = runGenerator(agentsDir, outPath);

    if (allowlist === null) return;
    const inner = (allowlist["allowlist"] ?? {}) as Record<string, unknown>;

    expect(
      Object.prototype.hasOwnProperty.call(inner, "engineering-manager"),
      "engineering-manager (has Task) must appear in the allowlist"
    ).toBe(true);

    expect(
      Object.prototype.hasOwnProperty.call(inner, "qa"),
      "qa (no Task) must NOT appear in the allowlist"
    ).toBe(false);

    expect(
      Object.prototype.hasOwnProperty.call(inner, "software-engineer"),
      "software-engineer (no Task) must NOT appear in the allowlist"
    ).toBe(false);
  });

  it("real agents/ dir: qa.md must not appear in generated allowlist (qa has no Task)", () => {
    const outPath = path.join(tmpDir, "real-allowlist-qa.json");
    const { allowlist } = runGenerator(REAL_AGENTS_DIR, outPath);

    if (allowlist === null) return;
    const inner = (allowlist["allowlist"] ?? {}) as Record<string, unknown>;

    expect(
      Object.prototype.hasOwnProperty.call(inner, "qa"),
      "qa must not appear in the real allowlist — it has no Task in its tools"
    ).toBe(false);
  });

  it("real agents/ dir: software-engineer.md must not appear in generated allowlist", () => {
    const outPath = path.join(tmpDir, "real-allowlist-se.json");
    const { allowlist } = runGenerator(REAL_AGENTS_DIR, outPath);

    if (allowlist === null) return;
    const inner = (allowlist["allowlist"] ?? {}) as Record<string, unknown>;

    expect(
      Object.prototype.hasOwnProperty.call(inner, "software-engineer"),
      "software-engineer must not appear in the real allowlist — it has no Task in its tools"
    ).toBe(false);
  });
});

describe("generate-spawn-allowlist — golden: real agents/ round-trip produces known entries", () => {
  it("real agents/ dir: engineering-manager appears with [qa, software-engineer, staff-engineer]", () => {
    const outPath = path.join(tmpDir, "real-allowlist-em.json");
    const { allowlist } = runGenerator(REAL_AGENTS_DIR, outPath);

    if (allowlist === null) return;
    const inner = (allowlist["allowlist"] ?? {}) as Record<string, string[]>;
    const targets = inner["engineering-manager"] ?? [];

    expect(targets, "engineering-manager must have qa").toContain("qa");
    expect(targets, "engineering-manager must have software-engineer").toContain(
      "software-engineer"
    );
    expect(targets, "engineering-manager must have staff-engineer").toContain("staff-engineer");
  });

  it("real agents/ dir: staff-engineer appears with [software-engineer] only", () => {
    const outPath = path.join(tmpDir, "real-allowlist-se.json");
    const { allowlist } = runGenerator(REAL_AGENTS_DIR, outPath);

    if (allowlist === null) return;
    const inner = (allowlist["allowlist"] ?? {}) as Record<string, string[]>;
    const targets = inner["staff-engineer"] ?? [];

    expect(targets, "staff-engineer must have software-engineer").toContain("software-engineer");
    expect(targets.length, "staff-engineer must have exactly 1 permitted target").toBe(1);
  });

  it("real agents/ dir: cto appears with [staff-engineer, engineering-director]", () => {
    const outPath = path.join(tmpDir, "real-allowlist-cto.json");
    const { allowlist } = runGenerator(REAL_AGENTS_DIR, outPath);

    if (allowlist === null) return;
    const inner = (allowlist["allowlist"] ?? {}) as Record<string, string[]>;
    const targets = inner["cto"] ?? [];

    expect(targets, "cto must have staff-engineer").toContain("staff-engineer");
    expect(targets, "cto must have engineering-director").toContain("engineering-director");
  });
});
