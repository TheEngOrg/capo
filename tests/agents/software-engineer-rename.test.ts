import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

function root(...segments: string[]): string {
  return path.resolve(__dirname, "..", "..", ...segments);
}

function readFile(relPath: string): string {
  return fs.readFileSync(root(relPath), "utf8");
}

function readFileOrNull(relPath: string): string | null {
  const fullPath = root(relPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf8");
}

// ─── GROUP 1: agents/software-engineer.md — identity and internal text fixes ───

describe("misuse: SE-IDENTITY — software-engineer.md must NOT say 'I am dev' anywhere", () => {
  it("AC-1: software-engineer.md identity constraints do not say 'I am dev'", () => {
    const content = readFile("src/plugin/agents/software-engineer.md");
    // "I am Sr Software Engineer" is correct; "I am dev" is the stale text
    expect(content).not.toMatch(/I am dev\b/);
  });
});

describe("misuse: SE-MECHANICAL-TEXT — software-engineer.md MECHANICAL section must not say 'Dev handles'", () => {
  it("AC-2: MECHANICAL section does not say 'Dev handles the full TDD cycle'", () => {
    const content = readFile("src/plugin/agents/software-engineer.md");
    expect(content).not.toContain("Dev handles the full TDD cycle");
  });
  it("AC-3: MECHANICAL section does not say 'Dev is responsible'", () => {
    const content = readFile("src/plugin/agents/software-engineer.md");
    expect(content).not.toContain("Dev is responsible");
  });
});

describe("misuse: SE-GO-SIGNAL — software-engineer.md GO-signal must say from_agent software-engineer", () => {
  it("AC-4: GO-signal JSON example has from_agent: software-engineer, not dev", () => {
    const content = readFile("src/plugin/agents/software-engineer.md");
    // The GO-signal JSON block must NOT have "from_agent": "dev"
    expect(content).not.toContain('"from_agent": "dev"');
  });
  it("AC-4b: GO-signal JSON example has from_agent: software-engineer", () => {
    const content = readFile("src/plugin/agents/software-engineer.md");
    expect(content).toContain('"from_agent": "software-engineer"');
  });
});

describe("boundary: SE-TASKS-QUEUE-COMMENT — software-engineer.md tasks-dev.json line has intentional-name comment", () => {
  it("AC-5: Memory Protocol tasks-dev.json reference includes a comment noting intentional filename", () => {
    const content = readFile("src/plugin/agents/software-engineer.md");
    // The comment must be present near the tasks-dev.json reference
    const hasComment =
      content.includes("tasks-dev.json") &&
      (content.includes("# intentional") ||
        content.includes("# internal") ||
        content.includes("# queue name") ||
        /tasks-dev\.json.*#.*(?:intentional|internal|do not rename)/i.test(content));
    expect(hasComment).toBe(true);
  });
});

// ─── GROUP 2: agents/dev-haiku.md — cascade target fixes ───

describe("misuse: DEVHAIKU-CASCADE — dev-haiku.md must not say 'fallback to dev (Sonnet)'", () => {
  it("AC-6: dev-haiku.md frontmatter description says software-engineer not dev as fallback", () => {
    const content = readFile("src/plugin/agents/dev-haiku.md");
    expect(content).not.toContain("Cascade fallback to dev (Sonnet)");
  });
  it("AC-6b: dev-haiku.md frontmatter description says software-engineer as Sonnet fallback", () => {
    const content = readFile("src/plugin/agents/dev-haiku.md");
    expect(content).toContain("software-engineer (Sonnet)");
  });
  it("AC-7: dev-haiku.md escalation body does not say 'Sonnet-tier dev agent'", () => {
    const content = readFile("src/plugin/agents/dev-haiku.md");
    expect(content).not.toContain("Sonnet-tier dev agent");
  });
  it("AC-7b: dev-haiku.md escalation body says software-engineer as Sonnet-tier agent", () => {
    const content = readFile("src/plugin/agents/dev-haiku.md");
    expect(content).toContain("Sonnet-tier software-engineer");
  });
});

describe("boundary: DEVHAIKU-TASKS-QUEUE-COMMENT — dev-haiku.md tasks-dev.json line has intentional-name comment", () => {
  it("AC-8: Memory Protocol tasks-dev.json reference includes intentional-name comment", () => {
    const content = readFile("src/plugin/agents/dev-haiku.md");
    const hasComment =
      content.includes("tasks-dev.json") &&
      (content.includes("# intentional") ||
        content.includes("# internal") ||
        content.includes("# queue name") ||
        /tasks-dev\.json.*#.*(?:intentional|internal|do not rename)/i.test(content));
    expect(hasComment).toBe(true);
  });
});

// ─── GROUP 3: agents/staff-engineer.md — spawn wiring fixes ───

describe("misuse: SE-STAFF-TOOLS — staff-engineer.md tools must list Task(software-engineer) not Task(dev)", () => {
  it("AC-9: staff-engineer.md frontmatter tools does not say Task(dev)", () => {
    const content = readFile("src/plugin/agents/staff-engineer.md");
    expect(content).not.toContain("Task(dev)");
  });
  it("AC-9b: staff-engineer.md frontmatter tools says Task(software-engineer)", () => {
    const content = readFile("src/plugin/agents/staff-engineer.md");
    expect(content).toContain("Task(software-engineer)");
  });
  it("AC-10: staff-engineer.md tools scope constraint does not say 'route through dev via teo-apply-edit'", () => {
    const content = readFile("src/plugin/agents/staff-engineer.md");
    expect(content).not.toContain("route through dev via teo-apply-edit");
  });
  it("AC-11: staff-engineer.md Delegation table says software-engineer for Implementation fixes", () => {
    const content = readFile("src/plugin/agents/staff-engineer.md");
    expect(content).toContain("| Implementation fixes | software-engineer |");
  });
});

// ─── GROUP 4: agents/engineering-manager.md — spawn wiring fixes ───

describe("misuse: SE-EM-TOOLS — engineering-manager.md tools must list Task(software-engineer) not Task(dev)", () => {
  it("AC-12: engineering-manager.md frontmatter tools does not list dev in Task(...)", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    // Check the tools frontmatter line specifically
    const toolsLine = content.split("\n").find((l) => l.trim().startsWith("tools:"));
    expect(toolsLine).toBeDefined();
    expect(toolsLine!).not.toContain("Task(qa, dev,");
    expect(toolsLine!).not.toMatch(/Task\(.*\bdev\b.*\)/);
  });
  it("AC-12b: engineering-manager.md frontmatter tools includes Task(software-engineer)", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    expect(content).toContain("Task(qa, software-engineer, staff-engineer)");
  });
  it("AC-13: engineering-manager.md constitution rule does not say 'Spawn dev or qa'", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    expect(content).not.toContain("Spawn dev or qa");
  });
  it("AC-13b: constitution rule says 'Spawn software-engineer or qa'", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    expect(content).toContain("Spawn software-engineer or qa");
  });
  it("AC-14: constitution rule does not say 'goes to dev (implementation)'", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    expect(content).not.toContain("goes to dev (implementation)");
  });
  it("AC-15: SPAWN_REQUEST format does not say 'Need dev to implement'", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    expect(content).not.toContain("Need dev to implement");
  });
  it("AC-15b: SPAWN_REQUEST format says 'Need software-engineer to implement'", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    expect(content).toContain("Need software-engineer to implement");
  });
  it("AC-16: memory protocol spawn line does not say 'spawn: dev | qa'", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    expect(content).not.toContain("spawn: dev | qa");
  });
  it("AC-17: delegated_to value does not say dev", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    expect(content).not.toContain("delegated_to: dev");
  });
  it("AC-18: Delegation table 'Implement feature' row says software-engineer", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    expect(content).toContain("| Implement feature | software-engineer |");
  });
  it("AC-19: Protected Path Write Policy does not say 'Delegate any such writes to dev'", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    expect(content).not.toContain("Delegate any such writes to `dev`");
    expect(content).not.toContain("Delegate any such writes to dev");
  });
  it("AC-20: Boundaries CAN does not say 'Assign tasks to dev/qa'", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    expect(content).not.toContain("Assign tasks to dev/qa/staff-engineer");
  });
  it("AC-20b: Boundaries CAN says 'Assign tasks to software-engineer/qa'", () => {
    const content = readFile("src/plugin/agents/engineering-manager.md");
    expect(content).toContain("Assign tasks to software-engineer");
  });
});

// ─── GROUP 5: agents/capo.md — pipeline description and roster fixes ───

describe("misuse: SE-CAPO-ROSTER — capo.md Team Roster must have software-engineer not dev", () => {
  it("AC-21: capo.md Team Roster does not have dev entry for code implementation", () => {
    const content = readFile("src/plugin/agents/capo.md");
    // The roster table entry "`dev` | Code implementation" must be replaced
    expect(content).not.toContain("| `dev` | Code implementation");
  });
  it("AC-21b: capo.md Team Roster has software-engineer entry", () => {
    const content = readFile("src/plugin/agents/capo.md");
    expect(content).toContain("| `software-engineer` |");
  });
  it("AC-22: capo.md MECHANICAL pipeline does not say 'dev (implement to green)'", () => {
    const content = readFile("src/plugin/agents/capo.md");
    expect(content).not.toContain("→ dev (implement to green) →");
  });
  it("AC-22b: capo.md MECHANICAL pipeline says 'software-engineer (implement to green)'", () => {
    const content = readFile("src/plugin/agents/capo.md");
    expect(content).toContain("software-engineer (implement to green)");
  });
  it("AC-23: capo.md ARCHITECTURAL CAD wave does not say 'dev (build to spec)'", () => {
    const content = readFile("src/plugin/agents/capo.md");
    expect(content).not.toContain("dev (build to spec)");
  });
  it("AC-24: capo.md dispatch example does not name dev as example subagent_type", () => {
    const content = readFile("src/plugin/agents/capo.md");
    // The example says (e.g. `staff-engineer`, `cto`, `dev`) — dev must be replaced
    expect(content).not.toContain("`staff-engineer`, `cto`, `dev`");
  });
});

// ─── GROUP 6: agents/qa.md — identity constraint and MECHANICAL exception ───

describe("misuse: SE-QA-IDENTITY — qa.md identity must not say 'I am NOT dev'", () => {
  it("AC-26: qa.md identity constraint does not say 'I am NOT dev'", () => {
    const content = readFile("src/plugin/agents/qa.md");
    expect(content).not.toContain("I am NOT dev —");
  });
  it("AC-26b: qa.md identity constraint says 'I am NOT software-engineer'", () => {
    const content = readFile("src/plugin/agents/qa.md");
    expect(content).toContain("I am NOT software-engineer");
  });
  it("AC-25: qa.md MECHANICAL exception does not say 'dev handles the full TDD cycle'", () => {
    const content = readFile("src/plugin/agents/qa.md");
    expect(content).not.toContain("dev handles the full TDD cycle including test authorship");
  });
  it("AC-25b: qa.md MECHANICAL exception says 'software-engineer handles'", () => {
    const content = readFile("src/plugin/agents/qa.md");
    expect(content).toContain("software-engineer handles the full TDD cycle");
  });
});

// ─── GROUP 7: scripts/verify-plugin-install.sh — AGENTS_COUNT ───

describe("misuse: SE-AGENTS-COUNT — verify-plugin-install.sh AGENTS_COUNT must be 23", () => {
  it("AC-30: scripts/verify-plugin-install.sh AGENTS_COUNT constant is not 21 (stale pre-SE-RENAME value)", () => {
    const script = readFile("scripts/verify-plugin-install.sh");
    // Parse the check line: if [ "${AGENTS_COUNT}" = "21" ]; then
    // After the fix it must say "22" or higher
    const oldCheck = /\[ "\$\{AGENTS_COUNT\}" = "21" \]/.test(script);
    expect(oldCheck, "AGENTS_COUNT check still says 21 — must be updated").toBe(false);
  });
  it("AC-30b: scripts/verify-plugin-install.sh AGENTS_COUNT check says 23 (bumped by WS-AGENT-RAILS)", () => {
    const script = readFile("scripts/verify-plugin-install.sh");
    expect(script).toMatch(/\$\{AGENTS_COUNT\}" = "23"/);
  });
});

// ─── GROUP 8: .claude/agents/ mirror parity (skipped in CI) ───

describe("boundary: SE-MIRROR — .claude/agents/software-engineer.md must exist and be byte-identical", () => {
  it("AC-29: .claude/agents/software-engineer.md exists and is byte-identical to agents/software-engineer.md", () => {
    const canonical = readFile("src/plugin/agents/software-engineer.md");
    const mirror = readFileOrNull(".claude/agents/software-engineer.md");
    if (mirror === null) return; // gitignored — skip in CI
    expect(mirror).toBe(canonical);
  });
});

// ─── GROUP 9: KEEP guards (gate_type "dev" and tasks-dev.json must NOT be changed) ───

describe("golden: KEEP-GATE-ENUM — gate_type 'dev' in src/ must be preserved", () => {
  it("AC-31: evaluate-gate-cli.test.ts still has gate_type 'dev' fixture", () => {
    // D1 decision: gate_type 'dev' is kept as-is. Must appear in evaluate-gate-cli.test.ts.
    const gateContent = readFile("src/skill/evaluate-gate-cli.test.ts");
    expect(gateContent).toContain('gate_type: "dev"');
  });
  it.skip("AC-31b: retired — subsumed by AC-31", () => {
    // retired
    expect(true).toBe(true); // retired
  });
});

describe("golden: KEEP-QUEUE-FILENAME — tasks-dev.json filename must not be renamed", () => {
  it("AC-32: software-engineer.md still references tasks-dev.json (file not renamed)", () => {
    const content = readFile("src/plugin/agents/software-engineer.md");
    expect(content).toContain("tasks-dev.json");
  });
});
