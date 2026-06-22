import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

// =============================================================================
// capo-capo-rename.test.ts — RED specs for WS-RENAME-T2-FIX
//
// These tests are RED before the fix and GREEN after.
//
// Root cause being fixed: WS-RENAME-T2 (PR #35) grepped only quoted lowercase
// "capo" in agents/+hooks/, missing:
//   - ESCALATED-TO-SAGE (unquoted uppercase)
//   - Prose in README/docs
//   - Artifact filenames capo-result.json / capo-pipeline-log.json
//   - Comments in src/ test files
//
// Decision: Zero remaining Capo persona references anywhere in the repo.
// The artifact filename carveout (capo-result.json for alpha) is REVOKED.
//
// PROTECTED patterns — these are stable API contracts, NOT persona references:
//   sagePlan()           — TypeScript method name
//   PQ_03_SAGE_AS_EXECUTOR — error code
//   agent_id: "capo" in src/adapters/claude-code.test.ts (attack payload under test)
//   TEOSageGlyph         — external font filename in hooks/session-start.sh
//
// FALSE POSITIVE categories — substring matches, not persona refs:
//   message/messages/errorMessage/defaultError — JS/TS keywords
//   "USAGE" / "## Usage" / "usage" in skill/script files — section headings
//   "capo-like-agent" in spawn-agent.test.ts — fixture name, not persona ref
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
// Regression guard helpers
//
// git grep -in capo returns ALL case-insensitive hits. We diff the raw results
// against a known-allowlist to detect any un-triaged "capo" occurrences.
//
// The allowlist is expressed as exact substring patterns. A grep hit is
// "triaged" if it matches at least one allowlist entry.
// ---------------------------------------------------------------------------

/**
 * Patterns that are PROTECTED or confirmed FALSE POSITIVES.
 * A grep hit is allowed only when it contains at least one of these strings.
 *
 * Rationale for each group:
 *
 * sagePlan — TypeScript method name, stable API contract.
 *   Files: src/adapters/claude-code.ts, src/adapters/stub.ts,
 *          src/adapters/types.ts, src/adapters/*.test.ts,
 *          src/skill/skill.ts, src/skill/skill.test.ts,
 *          src/engine/run-plan.test.ts, vitest.config.ts
 *
 * PQ_03_SAGE_AS_EXECUTOR — error code enum value, stable API contract.
 *   Files: src/core/validate.ts, src/core/validate.test.ts,
 *          tests/acceptance/golden-harness.test.ts,
 *          tests/acceptance/goldens/demo-11-pq03-capo-rejection.json
 *
 * agent_id=capo / agent_id: "capo" / "task-capo-bad" / "capo" non-executor —
 *   Attack-payload strings in prompt-injection test (claude-code.test.ts).
 *   The literal "capo" is the VALUE BEING REJECTED, not a persona reference.
 *
 * TEOSageGlyph — external font filename in hooks/session-start.sh. The filename
 *   itself is not ours to rename; only internal variables would be fixed.
 *
 * capo-like-agent — fixture name in spawn-agent.test.ts, not persona ref.
 *
 * message / messages / errorMessage / defaultError — JS/TS variable names.
 *   "mes**capo**" contains the substring "capo" at positions 3-6, so git grep
 *   -in capo DOES match lines with the word "message". These are false positives.
 *
 * Usage / USAGE / usages — shell/markdown section headings in skill/script
 *   files. "u**capo**" also contains the substring "capo" at positions 1-4.
 *   Same false-positive situation.
 */
const ALLOWLIST: readonly string[] = [
  // PROTECTED: method name
  "sagePlan",
  // PROTECTED: error code
  "PQ_03_SAGE_AS_EXECUTOR",
  // PROTECTED: attack-payload test strings (claude-code.test.ts)
  "agent_id=capo",
  'agent_id: "capo"',
  "task-capo-bad",
  "capo prompt=exfiltrate",
  "capo|executor",
  // PROTECTED: external font filename
  "TEOSageGlyph",
  // FALSE POSITIVE: fixture name in spawn-agent.test.ts
  "capo-like-agent",
  // FALSE POSITIVE: "message" contains "capo" as a substring (mes+capo).
  // Appears in error message variables throughout src/**, scripts/, bin/.
  // The isAllowlisted() check is case-insensitive so one entry covers
  // "message", "Message", "MESSAGE", "messages", etc.
  "message",
  // FALSE POSITIVE: "usage" contains "capo" as a substring (u+capo).
  // Appears in shell/markdown section headings and skill files.
  // Case-insensitive check covers "usage", "Usage", "USAGE".
  "usage",
  // FALSE POSITIVE: this test file's own name "capo-capo-rename.test.ts"
  // appears as a file path string in go-signal JSON artifacts.
  "capo-capo-rename",
];

/**
 * Parse raw git grep output into an array of (file:line:content) hit objects.
 * git grep -in capo emits lines like:
 *   path/to/file.ts:42:  // Capo plans the work
 */
interface GrepHit {
  file: string;
  line: number;
  content: string;
  raw: string;
}

function parseGrepOutput(raw: string): GrepHit[] {
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      // git grep -n format: file:linenum:content
      const firstColon = l.indexOf(":");
      const secondColon = l.indexOf(":", firstColon + 1);
      if (firstColon === -1 || secondColon === -1) return null;
      const file = l.slice(0, firstColon);
      const lineNum = parseInt(l.slice(firstColon + 1, secondColon), 10);
      const content = l.slice(secondColon + 1);
      return { file, line: lineNum, content, raw: l };
    })
    .filter((h): h is GrepHit => h !== null);
}

/**
 * Returns true if a hit is covered by the allowlist — i.e., its content
 * contains at least one protected/false-positive string.
 */
function isAllowlisted(hit: GrepHit): boolean {
  return ALLOWLIST.some(
    (pattern) =>
      hit.content.includes(pattern) ||
      // Case-insensitive check for uppercase variants (e.g. SAGEGLYPH)
      hit.content.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Runs a git grep command and returns its stdout, or null if no hits (exit 1).
 * Throws for any other error. This avoids the `let raw = ""` useless-assignment
 * lint pattern while preserving the "no hits = pass" semantics.
 */
function runGrepOrEmpty(cmd: string): string | null {
  try {
    return execSync(cmd, { cwd: root(), encoding: "utf8" });
  } catch (e: unknown) {
    const err = e as { status?: number };
    if (err.status === 1) return null; // git grep exits 1 = no hits
    throw e;
  }
}

// =============================================================================
// MISUSE — assertions that fire when stale Capo persona references are PRESENT
//
// These tests describe what SHOULD be true after dev applies the fix.
// They are RED before the fix. A green suite proves the misuse no longer applies.
// =============================================================================

describe("misuse: artifact filenames — capo-result.json must not appear in any tracked file", () => {
  it("no tracked file references capo-result.json as an artifact filename", () => {
    // MISUSE: the artifact filename capo-result.json was the primary miss in
    // PR #35. Any remaining reference means code is still writing/reading the
    // old filename. This test fails before the rename and passes after.
    //
    // Note: the physical file .claude/memory/pipeline/capo-result.json may
    // still exist on disk (runtime artifact from a prior run) but must NOT
    // be referenced by any tracked source file.
    const raw = runGrepOrEmpty('git grep -rn "capo-result\\.json"');
    if (raw === null) return; // no hits = PASS
    // Exclude this test file itself (it mentions the old name in comments/descriptions)
    const hits = parseGrepOutput(raw).filter((h) => !h.file.endsWith("capo-capo-rename.test.ts"));
    expect(
      hits,
      `Found capo-result.json references in tracked files:\n${hits.map((h) => h.raw).join("\n")}`
    ).toHaveLength(0);
  });

  it("no tracked file references capo-pipeline-log.json as an artifact filename", () => {
    // MISUSE: same pattern as capo-result.json — this artifact filename must
    // be renamed to capo-pipeline-log.json everywhere.
    const raw = runGrepOrEmpty('git grep -rn "capo-pipeline-log\\.json"');
    if (raw === null) return; // no hits = PASS
    // Exclude this test file itself (it mentions the old name in comments/descriptions)
    const hits = parseGrepOutput(raw).filter((h) => !h.file.endsWith("capo-capo-rename.test.ts"));
    expect(
      hits,
      `Found capo-pipeline-log.json references in tracked files:\n${hits.map((h) => h.raw).join("\n")}`
    ).toHaveLength(0);
  });
});

describe("misuse: ESCALATED-TO-SAGE must not appear in acceptance-engineer.md", () => {
  it("agents/acceptance-engineer.md contains zero ESCALATED-TO-SAGE strings", () => {
    // MISUSE: the disposition table template and escalation trigger rules in
    // acceptance-engineer.md still had ESCALATED-TO-SAGE after PR #35.
    // All occurrences must be ESCALATED-TO-CAPO.
    const content = readFile("agents/acceptance-engineer.md");
    expect(content).not.toContain("ESCALATED-TO-SAGE");
  });

  it(".claude/agents/acceptance-engineer.md contains zero ESCALATED-TO-SAGE strings", () => {
    // MISUSE: mirror must also be updated — PR #35 missed the mirror entirely.
    const content = readFile(".claude/agents/acceptance-engineer.md");
    expect(content).not.toContain("ESCALATED-TO-SAGE");
  });
});

describe("misuse: capo.md must not reference capo-result.json", () => {
  it("agents/capo.md contains zero capo-result.json references", () => {
    // MISUSE: capo.md's Turn-end Protocol and Memory Protocol sections both
    // named the old artifact path. Capo must now write capo-result.json.
    const content = readFile("agents/capo.md");
    expect(content).not.toContain("capo-result.json");
  });

  it(".claude/agents/capo.md contains zero capo-result.json references", () => {
    const content = readFile(".claude/agents/capo.md");
    expect(content).not.toContain("capo-result.json");
  });
});

describe("misuse: README.md must not refer to Capo as the orchestrator persona", () => {
  it('README.md does not contain "ask Capo to orchestrate"', () => {
    // MISUSE: the /teo command table and narrative prose still named Capo.
    // The replacement is "ask Capo to orchestrate".
    const content = readFile("README.md");
    expect(content.toLowerCase()).not.toContain("ask capo");
  });

  it('README.md does not contain "routes your request to Capo"', () => {
    const content = readFile("README.md");
    expect(content.toLowerCase()).not.toContain("routes your request to capo");
  });

  it('README.md does not contain "A single orchestrator (**Capo**)"', () => {
    // MISUSE: introductory paragraph named Capo explicitly.
    const content = readFile("README.md");
    expect(content).not.toContain("(**Capo**)");
  });

  it('README.md does not contain "Capo, the dispatcher" (docs link description)', () => {
    const content = readFile("README.md");
    expect(content).not.toContain("Capo, the dispatcher");
  });
});

describe("misuse: docs/getting-started.md must not refer to Capo as the orchestrator", () => {
  it('getting-started.md does not contain "hand Capo a piece of work"', () => {
    const content = readFile("docs/getting-started.md");
    expect(content.toLowerCase()).not.toContain("hand capo");
  });

  it('getting-started.md does not contain "Capo classifies the request"', () => {
    const content = readFile("docs/getting-started.md");
    expect(content.toLowerCase()).not.toContain("capo classifies");
  });

  it('getting-started.md does not contain "Capo routes it"', () => {
    const content = readFile("docs/getting-started.md");
    expect(content.toLowerCase()).not.toContain("capo routes");
  });

  it('getting-started.md does not contain "Ask Capo to orchestrate"', () => {
    const content = readFile("docs/getting-started.md");
    expect(content.toLowerCase()).not.toContain("ask capo");
  });
});

describe("misuse: hooks/teo-post-spawn-citation-check.sh must not refer to Capo", () => {
  it('citation-check hook does not contain "before Capo reads it"', () => {
    // MISUSE: the BLOCK reason string in the hook named "Capo" as the consumer
    // of research files. Must now say "Capo".
    const content = readFile("hooks/teo-post-spawn-citation-check.sh");
    expect(content.toLowerCase()).not.toContain("before capo reads it");
  });
});

describe("misuse: sandbox/scripts/verify-traces.sh must not reference capo-result.json", () => {
  it("verify-traces.sh path variable does not point to capo-result.json", () => {
    // MISUSE: the CAPO_RESULT variable was correctly named but still pointed
    // to the old capo-result.json path.
    const content = readFile("sandbox/scripts/verify-traces.sh");
    expect(content).not.toContain("capo-result.json");
  });
});

describe("misuse: sandbox/README.md must not reference capo-result.json", () => {
  it("sandbox/README.md contains zero capo-result.json references", () => {
    // MISUSE: 11+ occurrences across STEP-3A/3B/4 documentation.
    const content = readFile("sandbox/README.md");
    expect(content).not.toContain("capo-result.json");
  });
});

describe("misuse: .claude/shared/gate-evaluator-protocol.md must not reference old Capo artifacts", () => {
  it("gate-evaluator-protocol.md does not reference capo-pipeline-log.json", () => {
    const content = readFile(".claude/shared/gate-evaluator-protocol.md");
    expect(content).not.toContain("capo-pipeline-log.json");
  });

  it('gate-evaluator-protocol.md does not contain "session_id": "capo-', () => {
    // MISUSE: sample JSON used "capo-2026-03-25-001" as the session_id format.
    const content = readFile(".claude/shared/gate-evaluator-protocol.md");
    expect(content).not.toContain('"capo-2026-');
  });

  it('gate-evaluator-protocol.md does not contain prose "the Capo" as persona', () => {
    // MISUSE: "the Capo presents the gate", "the Capo reads gate definitions",
    // "Capo pipeline execution", "Capo-managed work".
    const content = readFile(".claude/shared/gate-evaluator-protocol.md");
    expect(content.toLowerCase()).not.toContain("the capo ");
    expect(content.toLowerCase()).not.toContain("capo pipeline execution");
    expect(content.toLowerCase()).not.toContain("capo-managed work");
  });
});

describe("misuse: .claude/shared/error-recovery.md must not reference capo-pipeline-log.json", () => {
  it("error-recovery.md does not reference capo-pipeline-log.json", () => {
    // MISUSE: four occurrences in error taxonomy / recovery action descriptions.
    const content = readFile(".claude/shared/error-recovery.md");
    expect(content).not.toContain("capo-pipeline-log.json");
  });
});

describe("misuse: .claude/shared/process-matcher-protocol.md must not reference old Capo artifacts", () => {
  it("process-matcher-protocol.md does not reference capo-pipeline-log.json", () => {
    const content = readFile(".claude/shared/process-matcher-protocol.md");
    expect(content).not.toContain("capo-pipeline-log.json");
  });

  it('process-matcher-protocol.md does not contain session_id format "capo-{date}"', () => {
    const content = readFile(".claude/shared/process-matcher-protocol.md");
    expect(content).not.toContain('"capo-{date}');
  });
});

describe("misuse: src/agents/coordinator.md must not refer to Capo as the plan author", () => {
  it('coordinator.md does not contain "Receives a Plan from Capo"', () => {
    // MISUSE: the What coordinator does section named Capo as the plan source.
    const content = readFile("src/agents/coordinator.md");
    expect(content.toLowerCase()).not.toContain("receives a plan from capo");
  });

  it('coordinator.md does not contain "max 3 Capo rotations"', () => {
    const content = readFile("src/agents/coordinator.md");
    expect(content.toLowerCase()).not.toContain("capo rotations");
  });
});

describe("misuse: src/adapters/claude-code.ts must not refer to Capo in prose comments or prompts", () => {
  it("claude-code.ts system prompt does not say 'You are Capo'", () => {
    // MISUSE: the LLM prompt literal told the planning agent it was "Capo".
    // This is a live system prompt, not a comment — must say "Capo".
    const content = readFile("src/adapters/claude-code.ts");
    expect(content).not.toContain("You are Capo");
  });

  it("claude-code.ts file header comment does not say 'LLM call site for Capo planning'", () => {
    const content = readFile("src/adapters/claude-code.ts");
    expect(content.toLowerCase()).not.toContain("llm call site for capo");
  });

  it("claude-code.ts AgentRunner JSDoc does not say 'Run the Capo planning loop'", () => {
    const content = readFile("src/adapters/claude-code.ts");
    // The JSDoc "Run the Capo planning loop" is in the AgentRunner interface.
    // The method name sagePlan is protected; this check targets the prose only.
    const hasSagePlanningProse =
      content.includes("Run the Capo planning loop") || content.includes("the Capo planning");
    expect(hasSagePlanningProse).toBe(false);
  });
});

describe("misuse: src/core/plan-builder.test.ts must not refer to Capo in prose comments", () => {
  it("plan-builder.test.ts does not contain 'Capo treats' in comments", () => {
    // MISUSE: line 134 had "Capo treats { accepted: false } as a self-correctable
    // rejection" — persona prose in a test comment.
    const content = readFile("src/core/plan-builder.test.ts");
    expect(content).not.toContain("Capo treats");
  });

  it("plan-builder.test.ts does not contain 'Capo drives the builder' in comments", () => {
    const content = readFile("src/core/plan-builder.test.ts");
    expect(content).not.toContain("Capo drives the builder");
  });

  it("plan-builder.test.ts it() description does not say 'Capo self-corrects'", () => {
    // MISUSE: line 214 had "returns AddTaskResult (Capo self-corrects)" in the
    // it() description string. Should say "Capo self-corrects".
    const content = readFile("src/core/plan-builder.test.ts");
    expect(content).not.toContain("Capo self-corrects");
  });

  it("plan-builder.test.ts comment does not say 'so Capo can self-correct'", () => {
    const content = readFile("src/core/plan-builder.test.ts");
    expect(content).not.toContain("so Capo can self-correct");
  });

  it("plan-builder.test.ts comment does not say 'so Capo knows what to add'", () => {
    const content = readFile("src/core/plan-builder.test.ts");
    expect(content).not.toContain("so Capo knows");
  });

  it("plan-builder.test.ts file header does not say 'Capo self-corrects on rejection'", () => {
    // MISUSE: line 38 in the file header used "Capo self-corrects on rejection".
    const content = readFile("src/core/plan-builder.test.ts");
    expect(content).not.toContain("Capo self-corrects on rejection");
  });
});

describe("misuse: src/agents/load.test.ts must not use SAGE_BLOCKED_TOOLS identifier", () => {
  it("load.test.ts does not contain SAGE_BLOCKED_TOOLS constant name", () => {
    // MISUSE: the constant was named SAGE_BLOCKED_TOOLS at line 96 and used at
    // line 301. The persona has been renamed to Capo; the constant must follow.
    const content = readFile("src/agents/load.test.ts");
    expect(content).not.toContain("SAGE_BLOCKED_TOOLS");
  });
});

describe("misuse: src/core/sign.test.ts must use capo as actor_id in pipeline test fixture", () => {
  it("sign.test.ts full-pipeline fixture does not use actor_id 'capo'", () => {
    // MISUSE: line 649 set actor_id: "capo" in the full-pipeline round-trip
    // fixture. This is test data for Capo's signing, not an attack payload.
    // The attack payload is in claude-code.test.ts (which stays as-is).
    const content = readFile("src/core/sign.test.ts");
    // We look for the specific fixture context (full pipeline test) to avoid
    // false-positive matching on the PQ_03_SAGE_AS_EXECUTOR error code tests.
    // The full-pipeline fixture is the only place where actor_id: "capo" appears.
    expect(content).not.toContain('actor_id: "capo"');
  });
});

describe("misuse: vitest.config.ts must not refer to Capo in comments", () => {
  it("vitest.config.ts coverage comment does not say 'LLM call site #1, the Capo'", () => {
    // MISUSE: line 134 comment "LLM call site #1, the Capo".
    const content = readFile("vitest.config.ts");
    expect(content.toLowerCase()).not.toContain("the capo");
  });
});

describe("misuse: .claude/shared/visual-formatting.md must not refer to Capo as orchestrator", () => {
  it("visual-formatting.md INDIGO color comment does not say 'SAGE — orchestrator'", () => {
    // MISUSE: line 27 named the INDIGO color "SAGE — orchestrator (TEO-only)".
    // Should now say "CAPO — orchestrator (TEO-only)".
    const content = readFile(".claude/shared/visual-formatting.md");
    expect(content).not.toContain("SAGE — orchestrator");
  });

  it("visual-formatting.md pipeline progress section does not say 'Displayed by the Capo'", () => {
    // MISUSE: line 138 "Displayed by the Capo after each pipeline step completes."
    const content = readFile(".claude/shared/visual-formatting.md");
    expect(content.toLowerCase()).not.toContain("displayed by the capo");
  });

  it("visual-formatting.md pipeline badge example does not say '[SAGE]'", () => {
    // MISUSE: line 141 example badge "🔮 [SAGE] Pipeline: {INTENT}".
    const content = readFile(".claude/shared/visual-formatting.md");
    expect(content).not.toContain("[SAGE]");
  });
});

describe("misuse: docs/gemini-independent-review.md must not reference capo-pipeline-log.json", () => {
  it("gemini-independent-review.md does not reference capo-pipeline-log.json", () => {
    const content = readFile("docs/gemini-independent-review.md");
    expect(content).not.toContain("capo-pipeline-log.json");
  });
});

describe("misuse: .claude/memory/go-signals/ws-sandbox-e2e-qa-spec.json must not reference old artifacts", () => {
  it("ws-sandbox-e2e-qa-spec.json does not reference capo-result.json", () => {
    // MISUSE: the go-signal spec file had 16+ lines with capo-result.json.
    const content = readFile(".claude/memory/go-signals/ws-sandbox-e2e-qa-spec.json");
    expect(content).not.toContain("capo-result.json");
  });

  it("ws-sandbox-e2e-qa-spec.json prose does not say 'routes to Capo immediately'", () => {
    // MISUSE: line 114 note text still named Capo.
    const content = readFile(".claude/memory/go-signals/ws-sandbox-e2e-qa-spec.json");
    expect(content.toLowerCase()).not.toContain("routes to capo");
  });

  it("ws-sandbox-e2e-qa-spec.json prose does not say 'Capo did NOT attempt'", () => {
    // MISUSE: line 66 pass criterion named Capo as the actor.
    const content = readFile(".claude/memory/go-signals/ws-sandbox-e2e-qa-spec.json");
    expect(content).not.toContain("Capo did NOT attempt");
  });

  it('ws-sandbox-e2e-qa-spec.json prose does not say "Capo\'s plan output"', () => {
    const content = readFile(".claude/memory/go-signals/ws-sandbox-e2e-qa-spec.json");
    expect(content.toLowerCase()).not.toContain("capo's plan output");
  });

  it("ws-sandbox-e2e-qa-spec.json prose does not say 'Capo may legitimately write'", () => {
    const content = readFile(".claude/memory/go-signals/ws-sandbox-e2e-qa-spec.json");
    expect(content.toLowerCase()).not.toContain("capo may legitimately");
  });
});

// =============================================================================
// BOUNDARY — mirror-sync assertions and edge-case coverage
//
// Every change to agents/<name>.md MUST apply to .claude/agents/<name>.md.
// These tests enforce byte-identity for all modified file pairs.
// =============================================================================

describe("boundary: mirror sync — acceptance-engineer.md canonical vs mirror", () => {
  it("agents/acceptance-engineer.md and .claude/agents/acceptance-engineer.md are byte-identical", () => {
    // BOUNDARY: PR #35 updated canonical but missed the mirror. Both files must
    // be identical so plugin and local-dev paths see the same agent definition.
    const canonical = readFile("agents/acceptance-engineer.md");
    const mirror = readFile(".claude/agents/acceptance-engineer.md");
    expect(canonical).toBe(mirror);
  });
});

describe("boundary: mirror sync — capo.md canonical vs mirror", () => {
  it("agents/capo.md and .claude/agents/capo.md are byte-identical", () => {
    // BOUNDARY: capo.md had multiple capo-result.json references. Both copies
    // must be fixed identically.
    const canonical = readFile("agents/capo.md");
    const mirror = readFile(".claude/agents/capo.md");
    expect(canonical).toBe(mirror);
  });
});

describe("boundary: acceptance-engineer.md uses consistent ESCALATED-TO-CAPO throughout", () => {
  it("agents/acceptance-engineer.md contains ESCALATED-TO-CAPO in disposition table template", () => {
    // BOUNDARY: after the fix, the disposition enum row must show ESCALATED-TO-CAPO,
    // not be blank. We verify the correct replacement was applied — not just that
    // the wrong value was removed.
    const content = readFile("agents/acceptance-engineer.md");
    expect(content).toContain("ESCALATED-TO-CAPO");
  });

  it("agents/acceptance-engineer.md escalation trigger rule says 'ESCALATED-TO-CAPO'", () => {
    // BOUNDARY: the "A finding MUST use ..." rule must also name ESCALATED-TO-CAPO.
    // If only the table template was fixed but the rule text wasn't, the agent
    // would read contradictory instructions.
    const content = readFile("agents/acceptance-engineer.md");
    const rulePattern = /a finding must use `?escalated-to-capo`?/i;
    expect(rulePattern.test(content)).toBe(true);
  });
});

describe("boundary: capo.md uses capo-result.json consistently in all references", () => {
  it("agents/capo.md Turn-end Protocol names capo-result.json as the output file", () => {
    // BOUNDARY: the Turn-end Protocol was the canonical statement of what file
    // Capo writes. If it says capo-result.json but the Memory Protocol still
    // says capo-result.json, agents will get conflicting instructions.
    const content = readFile("agents/capo.md");
    expect(content).toContain("capo-result.json");
  });
});

describe("boundary: capo.md does not mix old and new artifact names", () => {
  it("agents/capo.md has zero capo-result.json AND has capo-result.json", () => {
    // BOUNDARY: partial rename (some lines changed, some not) is worse than
    // either extreme — it creates non-deterministic behavior. Assert both
    // the absence of the old name and presence of the new name in one test.
    const content = readFile("agents/capo.md");
    expect(content).not.toContain("capo-result.json");
    expect(content).toContain("capo-result.json");
  });
});

describe("boundary: vitest.config.ts coverage comment still identifies claude-code.ts correctly", () => {
  it("vitest.config.ts still identifies claude-code.ts as the Capo planning loop coverage target", () => {
    // BOUNDARY: the coverage comment must be updated to say Capo, but must NOT
    // accidentally drop the reference to the coverage target entirely.
    // Verify the replacement is coherent: "Capo" is present near the coverage entry.
    const content = readFile("vitest.config.ts");
    const claudeCodeSection = content.slice(
      content.indexOf("src/adapters/claude-code.ts"),
      content.indexOf("src/adapters/claude-code.ts") + 300
    );
    // The comment should mention Capo (not Capo) in the coverage block
    expect(claudeCodeSection.toLowerCase()).toContain("capo");
  });
});

describe("boundary: coordinator.md uses Capo as the plan source throughout", () => {
  it("src/agents/coordinator.md contains 'Receives a Plan from Capo'", () => {
    // BOUNDARY: after the fix, the correct persona name must appear.
    const content = readFile("src/agents/coordinator.md");
    expect(content.toLowerCase()).toContain("receives a plan from capo");
  });

  it("src/agents/coordinator.md rotation cap says 'Capo rotations'", () => {
    const content = readFile("src/agents/coordinator.md");
    expect(content.toLowerCase()).toContain("capo rotations");
  });
});

// =============================================================================
// GOLDEN PATH — regression guard (the core non-recurrence test)
//
// Runs git grep -in capo repo-wide and asserts every remaining hit is covered
// by the allowlist. This test FAILS before the fix (stale hits exist outside
// the allowlist) and PASSES after (only protected/false-positive hits remain).
// =============================================================================

describe("golden: full repo git grep — zero un-triaged Capo persona references", () => {
  it("every 'capo' hit in git grep is either PROTECTED or a FALSE POSITIVE", () => {
    // GOLDEN: this is the regression guard. It must run git grep repo-wide,
    // parse every hit, and assert all are covered by the allowlist.
    //
    // A future rename or new file that introduces "capo" as a persona reference
    // will FAIL this test, forcing an explicit triage decision.
    //
    // Why not just grep for count=0? Because some hits are legitimate (sagePlan,
    // PQ_03_SAGE_AS_EXECUTOR, attack-payload tests) and must remain. The
    // allowlist is the explicit triage record.

    const raw = runGrepOrEmpty("git grep -in capo");
    if (raw === null) {
      // No hits at all — better than expected, still a PASS.
      return;
    }

    const hits = parseGrepOutput(raw).filter(
      // Exclude this test file itself — it mentions "capo" in comments and
      // test descriptions that document what WAS changed. These are not
      // persona references; they're the test's own documentation.
      (h) => !h.file.endsWith("capo-capo-rename.test.ts")
    );
    const untriaged = hits.filter((h) => !isAllowlisted(h));

    if (untriaged.length > 0) {
      const report = untriaged.map((h) => `  ${h.file}:${h.line}: ${h.content.trim()}`).join("\n");
      expect.fail(
        `${untriaged.length} un-triaged Sage persona reference(s) found.\n` +
          `Each must be either fixed or added to the ALLOWLIST with justification:\n\n` +
          report
      );
    }

    // All remaining hits are allowlisted — PASS.
    expect(untriaged).toHaveLength(0);
  });
});

describe("golden: capo-result.json is the canonical artifact name", () => {
  it("README.md now refers to capo-result.json (or omits artifact names entirely)", () => {
    // GOLDEN: README is the entry point — readers should see capo-result.json
    // if the artifact is mentioned. If README doesn't mention it, that's fine too.
    // What's not fine is README mentioning capo-result.json.
    const content = readFile("README.md");
    expect(content).not.toContain("capo-result.json");
  });

  it("sandbox/scripts/verify-traces.sh CAPO_RESULT variable points to capo-result.json", () => {
    // GOLDEN: the variable was already named CAPO_RESULT; now the path it holds
    // must also say capo-result.json.
    const content = readFile("sandbox/scripts/verify-traces.sh");
    expect(content).toContain("capo-result.json");
    // Confirm the variable assignment specifically
    expect(content).toMatch(/CAPO_RESULT=.*capo-result\.json/);
  });
});

describe("golden: all mirrors are byte-identical to their canonical sources", () => {
  it("agents/acceptance-engineer.md === .claude/agents/acceptance-engineer.md", () => {
    expect(readFile("agents/acceptance-engineer.md")).toBe(
      readFile(".claude/agents/acceptance-engineer.md")
    );
  });

  it("agents/capo.md === .claude/agents/capo.md", () => {
    expect(readFile("agents/capo.md")).toBe(readFile(".claude/agents/capo.md"));
  });
});

describe("golden: protected patterns are still present (no over-correction)", () => {
  it("sagePlan method name still appears in src/adapters/claude-code.ts", () => {
    // GOLDEN: the protected method name must NOT have been renamed. If it was,
    // the API contract is broken and all callers must be updated — that is a
    // separate, intentional decision, not a side-effect of this rename.
    const content = readFile("src/adapters/claude-code.ts");
    expect(content).toContain("sagePlan");
  });

  it("PQ_03_SAGE_AS_EXECUTOR error code still appears in src/core/validate.ts", () => {
    // GOLDEN: error code is a stable contract; renaming it would break all
    // consumers of the validate module.
    const content = readFile("src/core/validate.ts");
    expect(content).toContain("PQ_03_SAGE_AS_EXECUTOR");
  });

  it("attack-payload string 'agent_id: capo' still appears in claude-code.test.ts", () => {
    // GOLDEN: the prompt-injection test must continue to test rejection of
    // "capo" as an invalid agent_id. This string is the value being rejected,
    // not a persona reference. Removing it would remove the security test.
    const content = readFile("src/adapters/claude-code.test.ts");
    // The attack payload appears in comments and as a string value
    expect(content.toLowerCase()).toContain('agent_id: "capo"');
  });
});
