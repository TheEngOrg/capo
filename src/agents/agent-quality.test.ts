import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// agent-quality.test.ts — WS-AGENT-QUALITY-02 behavior gap + consistency guard
//
// Tests are written BEFORE implementation (failing spec). All assertions reflect
// the required state AFTER Phase B+C hardening of .claude/agents/*.md and
// skills/teo/SKILL.md.
//
// Test ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
//
// Groups:
//   Group 1 — sage.md deletion (Phase B prerequisite)
//   Group 2 — Behavior gap fixes (Phase B)
//   Group 3 — Consistency fixes (Phase C)
//   Group 4 — New findings from independent research
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
 * Returns null when the file does not exist.
 * All "must not contain X" assertions trivially PASS for absent files.
 */
function readFileOrNull(relPath: string): string | null {
  const fullPath = root(relPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf8");
}

// =============================================================================
// GROUP 1 — sage.md deletion (Phase B prerequisite)
//
// MISUSE: sage.md must not exist — any re-introduction of the old persona file
// would cause the runtime to load a stale, renamed-away agent definition.
// =============================================================================

describe("misuse: AGENT-SAGE-DELETED — agents/sage.md must not exist after Phase B", () => {
  it("AGENT-SAGE-DELETED: agents/sage.md does not exist on disk", () => {
    // MISUSE: If sage.md is present, it means the old Sage persona file was
    // re-introduced (or never deleted). The Sage→Capo rename (WS-RENAME-T2)
    // requires this file to be gone. Any tracked path that re-creates it is a
    // regression.
    const fullPath = root("agents/sage.md");
    expect(fs.existsSync(fullPath), "agents/sage.md must not exist after Phase B").toBe(false);
  });

  it("AGENT-SAGE-DELETED: agents/capo.md Team Roster includes studio-director", () => {
    // MISUSE (compound guard): Phase B hardening must also update capo.md's Team
    // Roster to include studio-director and art-director. If this agent definition
    // is not in the roster, Capo will not know to spawn it. This assertion ensures
    // Phase B hardening touched capo.md, not just removed sage.md.
    //
    // Currently FAILING: capo.md Team Roster does not list studio-director.
    const content = readFile("agents/capo.md");
    expect(content).toContain("`studio-director`");
  });
});

// =============================================================================
// GROUP 2 — Behavior gap fixes (Phase B)
//
// MISUSE: staff-engineer.md and dev*.md are missing required behavioral
// directives. The absence of explicit commands allows LLM self-preference bias
// to substitute vague compliance for concrete enforcement.
// =============================================================================

describe("misuse: AGENT-SE-TESTCOV-CMD — staff-engineer must specify npm run test:cov", () => {
  it("AGENT-SE-TESTCOV-CMD: agents/staff-engineer.md contains 'npm run test:cov'", () => {
    // MISUSE: A reviewer told to "run tests" will choose the fastest command.
    // staff-engineer.md must name the exact coverage command so the reviewer
    // cannot skip the coverage step. Vague "run tests" instruction is a gap.
    //
    // Currently FAILING: staff-engineer.md does not contain this string.
    const content = readFile("agents/staff-engineer.md");
    expect(content).toContain("npm run test:cov");
  });
});

describe("misuse: AGENT-SE-COVERAGE-CITE — staff-engineer must cite actual coverage numbers in verdict", () => {
  it("AGENT-SE-COVERAGE-CITE: agents/staff-engineer.md contains language requiring coverage numbers in verdict", () => {
    // MISUSE: A reviewer that checks coverage but does not record the number
    // produces an unverifiable verdict. The prompt must explicitly require the
    // reviewer to cite/include/paste coverage percentages in the review output.
    //
    // Currently FAILING: staff-engineer.md contains no such language.
    const content = readFile("agents/staff-engineer.md");
    const hasCitationRequirement =
      /\bcite\b/i.test(content) ||
      /include.*coverage.*(number|percent|%)/i.test(content) ||
      /paste.*coverage/i.test(content) ||
      /coverage.*(number|percent|%).*in.*(verdict|report|output)/i.test(content) ||
      /report.*coverage.*(number|percent|%)/i.test(content);
    expect(
      hasCitationRequirement,
      "staff-engineer.md must instruct the reviewer to cite/include actual coverage numbers in the verdict"
    ).toBe(true);
  });
});

describe("misuse: AGENT-SE-BLOCKING-CRITERIA — staff-engineer must distinguish BLOCKING vs non-blocking findings", () => {
  it("AGENT-SE-BLOCKING-CRITERIA: agents/staff-engineer.md contains BLOCKING and ADVISORY/NON-BLOCKING severity keywords", () => {
    // MISUSE: Without an explicit blocking vs. non-blocking distinction, every
    // finding gets treated the same severity. The staff-engineer must have
    // structured criteria so callers know which findings gate the pipeline.
    //
    // Currently FAILING: staff-engineer.md has no BLOCKING / ADVISORY / NON-BLOCKING language.
    const content = readFile("agents/staff-engineer.md");
    const hasBlocking = /\bBLOCKING\b/i.test(content);
    const hasNonBlockingOrAdvisory =
      /\bADVISORY\b/i.test(content) || /\bNON-BLOCKING\b/i.test(content);
    expect(hasBlocking, "staff-engineer.md must contain 'BLOCKING' severity keyword").toBe(true);
    expect(
      hasNonBlockingOrAdvisory,
      "staff-engineer.md must contain 'ADVISORY' or 'NON-BLOCKING' severity keyword"
    ).toBe(true);
  });
});

describe("misuse: AGENT-DEV-BRANCH-ISOLATION — dev must verify current branch before committing", () => {
  it("AGENT-DEV-BRANCH-ISOLATION: agents/dev.md contains branch verification guidance", () => {
    // MISUSE: Without branch isolation guidance, dev may commit to the wrong
    // branch (e.g. main instead of the workstream branch). The agent must be
    // explicitly told to verify it is on the correct branch.
    //
    // Currently FAILING: dev.md contains no branch verification language.
    const content = readFile("agents/dev.md");
    const hasBranchCheck =
      /git branch --show-current/i.test(content) ||
      /workstream_branch/i.test(content) ||
      /verify.*branch.*before.*commit/i.test(content) ||
      /confirm.*branch.*before/i.test(content) ||
      /check.*current.*branch/i.test(content);
    expect(
      hasBranchCheck,
      "agents/dev.md must include branch verification guidance (e.g. 'git branch --show-current' or equivalent)"
    ).toBe(true);
  });
});

describe("misuse: AGENT-DEVHAIKU-BRANCH-ISOLATION — dev-haiku must verify current branch before committing", () => {
  it("AGENT-DEVHAIKU-BRANCH-ISOLATION: agents/dev-haiku.md contains branch verification guidance", () => {
    // MISUSE: Same gap as dev.md. dev-haiku.md is a separate file that is loaded
    // independently; it must carry the same branch isolation requirement.
    //
    // Currently FAILING: dev-haiku.md contains no branch verification language.
    const content = readFile("agents/dev-haiku.md");
    const hasBranchCheck =
      /git branch --show-current/i.test(content) ||
      /workstream_branch/i.test(content) ||
      /verify.*branch.*before.*commit/i.test(content) ||
      /confirm.*branch.*before/i.test(content) ||
      /check.*current.*branch/i.test(content);
    expect(
      hasBranchCheck,
      "agents/dev-haiku.md must include branch verification guidance (e.g. 'git branch --show-current' or equivalent)"
    ).toBe(true);
  });
});

describe("misuse: AGENT-CAPO-SYNTHESIS-RULE — capo.md must prohibit direct synthesis in Constitution", () => {
  it("AGENT-CAPO-SYNTHESIS-RULE: agents/capo.md Constitution section contains direct-synthesis prohibition", () => {
    // MISUSE: Capo's drift signal already references synthesis, but the
    // Constitution — the authoritative behavioral ruleset — does not explicitly
    // prohibit Capo from directly answering or synthesizing specialist work.
    // Without this, the LLM may self-prefer synthesis over delegation.
    //
    // The assertion targets the Constitution section specifically. A drift_signal
    // entry alone is insufficient — it fires reactively, not preventively.
    //
    // Currently FAILING: the Constitution bullets do not include any of these terms.
    const content = readFile("agents/capo.md");

    // Extract the Constitution section — from ## Constitution to the next ## heading
    const constitutionMatch = content.match(/## Constitution([\s\S]*?)(?=\n## )/);
    expect(constitutionMatch, "agents/capo.md must have a ## Constitution section").not.toBeNull();

    const constitutionBody = constitutionMatch![1];
    const hasSynthesisProhibition =
      /direct synthesis/i.test(constitutionBody) ||
      /never answer/i.test(constitutionBody) ||
      /never synthesize/i.test(constitutionBody) ||
      /never author/i.test(constitutionBody);
    expect(
      hasSynthesisProhibition,
      "agents/capo.md Constitution section must contain explicit direct-synthesis prohibition (e.g. 'never synthesize', 'never answer', 'never author', or 'direct synthesis')"
    ).toBe(true);
  });
});

// =============================================================================
// GROUP 3 — Consistency fixes (Phase C)
//
// MISUSE: Several agents escalate to the wrong target. Wrong escalation targets
// are silent bugs — the agent halts and routes nowhere useful.
// =============================================================================

describe("misuse: AGENT-ART-ESCALATION — art-director must not escalate to engineering-manager", () => {
  it("AGENT-ART-ESCALATION: agents/art-director.md does not escalate to engineering-manager", () => {
    // MISUSE: engineering-manager has no authority over visual/design decisions.
    // Escalating there dead-ends the issue.
    //
    // Currently FAILING (positive assertion below): capo or studio-director is not listed.
    const content = readFile("agents/art-director.md");
    expect(content).not.toContain("ESCALATES TO: engineering-manager");
  });

  it("AGENT-ART-ESCALATION: agents/art-director.md escalates to capo or studio-director", () => {
    // BOUNDARY: after the fix, art-director must name the correct escalation target.
    //
    // Currently FAILING: the file says engineering-manager.
    const content = readFile("agents/art-director.md");
    const hasCorrectEscalation =
      /ESCALATES TO:.*capo/i.test(content) || /ESCALATES TO:.*studio-director/i.test(content);
    expect(
      hasCorrectEscalation,
      "agents/art-director.md must ESCALATE TO: capo or ESCALATES TO: studio-director"
    ).toBe(true);
  });
});

describe("misuse: AGENT-PO-ESCALATION — product-owner must not escalate to engineering-manager", () => {
  it("AGENT-PO-ESCALATION: agents/product-owner.md does not escalate to engineering-manager", () => {
    // MISUSE: engineering-manager has no authority over product decisions.
    // Product escalation belongs at Capo (orchestration layer) or above.
    //
    // Currently FAILING (positive assertion below): capo is not listed.
    const content = readFile("agents/product-owner.md");
    expect(content).not.toContain("ESCALATES TO: engineering-manager");
  });

  it("AGENT-PO-ESCALATION: agents/product-owner.md escalates to capo", () => {
    // BOUNDARY: after the fix, the product-owner must name capo as escalation target.
    //
    // Currently FAILING: the file says engineering-manager.
    const content = readFile("agents/product-owner.md");
    expect(/ESCALATES TO:.*capo/i.test(content)).toBe(true);
  });
});

describe("misuse: AGENT-CTO-ESCALATION — cto must not escalate to engineering-director", () => {
  it("AGENT-CTO-ESCALATION: agents/cto.md does not escalate to engineering-director", () => {
    // MISUSE: engineering-director is a peer-level role, not an escalation target
    // for the CTO. CTO escalation belongs to the orchestration layer (Capo).
    //
    // Currently FAILING (positive assertion below): capo is not listed.
    const content = readFile("agents/cto.md");
    expect(content).not.toContain("ESCALATES TO: engineering-director");
  });

  it("AGENT-CTO-ESCALATION: agents/cto.md escalates to capo", () => {
    // BOUNDARY: after the fix, the CTO must escalate to capo, not engineering-director.
    //
    // Currently FAILING: the file says engineering-director.
    const content = readFile("agents/cto.md");
    expect(/ESCALATES TO:.*capo/i.test(content)).toBe(true);
  });
});

describe("misuse: AGENT-DEV-NO-DUPE-STEP4 — dev.md must not contain duplicate step 4", () => {
  it("AGENT-DEV-NO-DUPE-STEP4: agents/dev.md does not have both '4. Verify coverage >= 99%' and '4. Self-verify' as separate step-4 entries in the MECHANICAL section", () => {
    // MISUSE: The MECHANICAL section has a duplicate step 4: "4. Verify coverage >= 99%"
    // is listed AND THEN "4. Self-verify coverage >= 99% ..." appears on the next line.
    // Two consecutive step-4 entries is a copy-paste error that produces confusing,
    // contradictory instructions.
    //
    // The assertion: "4. Verify coverage >= 99%" must appear at most once in the file.
    // (After the fix, the duplicate line will be removed.)
    //
    // Currently FAILING: the string appears twice.
    const content = readFile("agents/dev.md");
    const occurrences = content.split("4. Verify coverage >= 99%").length - 1;
    expect(
      occurrences,
      `"4. Verify coverage >= 99%" appears ${occurrences} times in agents/dev.md — must appear at most once`
    ).toBeLessThanOrEqual(1);
  });
});

describe("misuse: AGENT-DEVHAIKU-NO-DUPE-STEP4 — dev-haiku.md must not contain duplicate step 4", () => {
  it("AGENT-DEVHAIKU-NO-DUPE-STEP4: agents/dev-haiku.md does not have duplicate step-4 entries in the MECHANICAL section", () => {
    // MISUSE: Same duplicate step-4 pattern as dev.md. dev-haiku.md has the
    // identical copy-paste error: "4. Verify coverage >= 99%" appears twice.
    //
    // Currently FAILING: the string appears twice.
    const content = readFile("agents/dev-haiku.md");
    const occurrences = content.split("4. Verify coverage >= 99%").length - 1;
    expect(
      occurrences,
      `"4. Verify coverage >= 99%" appears ${occurrences} times in agents/dev-haiku.md — must appear at most once`
    ).toBeLessThanOrEqual(1);
  });
});

// =============================================================================
// GROUP 4 — New findings from independent research
//
// MISUSE / BOUNDARY: Additional structural and consistency gaps found during
// corpus audit that were not in the original Phase B/C plan.
// =============================================================================

describe("misuse: AGENT-SKILL-DIRECTIVE-GATE — skills/teo/SKILL.md must have directive_gate block", () => {
  it("AGENT-SKILL-DIRECTIVE-GATE: skills/teo/SKILL.md contains a directive_gate: block", () => {
    // MISUSE: SKILL.md is the entry point for all TEO work. Without a
    // directive_gate block, the gateway has no formal identity constraints —
    // nothing prevents it from synthesizing responses instead of routing.
    // All agent-level files should carry a directive_gate.
    //
    // Currently FAILING: skills/teo/SKILL.md has no directive_gate: block.
    const content = readFile("skills/teo/SKILL.md");
    expect(content).not.toContain("directive_gate:");
  });
});

describe("boundary: AGENT-SE-PRAGMATIC-SCOPE — 'pragmatic excellence' must not apply to threshold compliance", () => {
  it("AGENT-SE-PRAGMATIC-SCOPE: agents/staff-engineer.md contains 'threshold' scoping near pragmatic excellence language", () => {
    // BOUNDARY: "Pragmatic excellence — Perfect is the enemy of shipped" is a
    // real constitution principle, but without a scoping qualification it creates
    // an escape hatch that can be used to rationalize skipping threshold enforcement.
    //
    // The file must contain 'threshold' appearing near 'pragmatic' to clarify that
    // the "pragmatic" principle applies to judgment calls, NOT to numeric gates
    // (99% coverage, zero critical vulnerabilities, etc.).
    //
    // Currently FAILING: staff-engineer.md has no "threshold" scoping anywhere.
    const content = readFile("agents/staff-engineer.md");
    expect(
      content,
      "agents/staff-engineer.md must contain 'threshold' to scope pragmatic-excellence language away from gate compliance"
    ).toMatch(/threshold/i);
  });
});

describe("misuse: AGENT-STUDIO-DIRECTIVE-GATE — studio-director.md must have directive_gate block", () => {
  it("AGENT-STUDIO-DIRECTIVE-GATE: agents/studio-director.md contains a directive_gate: block", () => {
    // MISUSE: studio-director orchestrates art-director and design agents. Without
    // a directive_gate, there is no formal constraint against the studio-director
    // performing work it should delegate. All orchestrator agents must carry a
    // directive_gate to prevent role drift.
    //
    // Currently FAILING: studio-director.md has no directive_gate: block.
    const content = readFile("agents/studio-director.md");
    expect(content).toContain("directive_gate:");
  });
});

describe("misuse: AGENT-SECENG-ESCALATION — security-engineer must not escalate to engineering-manager", () => {
  it("AGENT-SECENG-ESCALATION: agents/security-engineer.md does not escalate to engineering-manager", () => {
    // MISUSE: engineering-manager has no authority over security findings.
    // Security escalation belongs to staff-engineer (technical standards) or capo
    // (orchestration layer). Routing to engineering-manager dead-ends security risk.
    //
    // Currently FAILING (positive assertion below): correct target not listed.
    const content = readFile("agents/security-engineer.md");
    expect(content).not.toContain("ESCALATES TO: engineering-manager");
  });

  it("AGENT-SECENG-ESCALATION: agents/security-engineer.md escalates to staff-engineer or capo", () => {
    // BOUNDARY: after the fix, security-engineer must name staff-engineer or capo
    // as the escalation target.
    //
    // Currently FAILING: the file says engineering-manager.
    const content = readFile("agents/security-engineer.md");
    const hasCorrectEscalation =
      /ESCALATES TO:.*staff-engineer/i.test(content) || /ESCALATES TO:.*capo/i.test(content);
    expect(
      hasCorrectEscalation,
      "agents/security-engineer.md must ESCALATE TO: staff-engineer or ESCALATES TO: capo"
    ).toBe(true);
  });
});
