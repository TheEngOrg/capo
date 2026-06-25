import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// capo-plan-artifact.test.ts — RED specs for WS-03: PLAN_ARTIFACT protocol
//
// These tests are GREEN — implementation complete (WS-03 dev pass).
// agents/capo.md contains the PLAN_ARTIFACT section; all assertions pass.
//
// What WS-03 delivered (source: WS-03 acceptance criteria):
//   1. A "Two-Phase Output Format" section in agents/capo.md — Capo first
//      emits a PLAN_ARTIFACT JSON block, then executes.
//   2. The D1 hybrid-planner: task_id/agent_id/gate/deps declared upfront;
//      prompts use __DEFERRED__ as a placeholder filled at spawn time.
//   3. A plan_id field included in the PLAN_ARTIFACT block.
//   4. A "PLAN_ARTIFACT format" subsection whose schema is consistent with
//      WS-00's validateArtifact({ type: "PLAN_ARTIFACT", payload: ... }) —
//      meaning PlanSchema fields: plan_id, project_id, created_at, version,
//      tasks[].
//
// Test ordering: misuse -> boundary -> golden path (ADR-064 critical-path policy)
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

// =============================================================================
// MISUSE — assertions that fire when required invariants are violated.
//
// Misuse scenarios describe failure modes that MUST NOT occur after dev
// implements WS-03. These tests are the first line of defense against regressions
// introduced by LLM agents that produce plausible-looking but wrong content.
//
// Ordering note: existence guard must come first — all other assertions depend
// on the file being readable.
// =============================================================================

describe("misuse(WS-03): agents/capo.md does not exist or is not readable", () => {
  it("agents/capo.md exists and is readable", () => {
    // MISUSE: if the file is absent or unreadable, every downstream test
    // would produce a confusing ENOENT error instead of a clear assertion
    // failure. An existence guard here surfaces the real problem immediately.
    // After WS-03 this test remains green — the file must always be present.
    expect(() => readFile("agents/capo.md")).not.toThrow();
  });
});

describe("misuse(WS-03): agents/capo.md contains legacy GATEWAY_SPAWN_REQUEST text", () => {
  it("agents/capo.md does NOT contain 'GATEWAY_SPAWN_REQUEST'", () => {
    // MISUSE: GATEWAY_SPAWN_REQUEST is the legacy relay model removed by
    // WS-00-pre. Any reappearance of this string in capo.md means the relay
    // model regressed — agents reading this directive will emit the old fenced
    // delimiter block instead of calling Task() directly, causing a deadlock.
    // This test is a regression guard: it must stay GREEN after every edit.
    const content = readFile("agents/capo.md");
    expect(content).not.toContain("GATEWAY_SPAWN_REQUEST");
  });
});

describe("misuse(WS-03): agents/capo.md uses 'Dispatcher' as an identity label", () => {
  it("agents/capo.md does NOT contain 'Dispatcher' as an identity label", () => {
    // MISUSE: "Dispatcher" was a behavioral constraint label that was
    // over-interpreted into a two-tier relay model causing anomalous Capo
    // behavior (2026-06-24 incident). Its reappearance in capo.md would
    // reintroduce the identity confusion and proxy-relay failure mode.
    // This test is a regression guard: it must stay GREEN after every edit.
    //
    // Implementation note: the word "dispatcher" (lowercase, noun form) is
    // acceptable in prose about general dispatch patterns. The failing case is
    // "Dispatcher" as an identity — i.e., "I am the Dispatcher" or section
    // headers like "## Dispatcher Protocol". We check the capitalized form
    // which is used only as a label/identity, not in generic dispatch prose.
    const content = readFile("agents/capo.md");
    // Allow "dispatcher" (lowercase) in generic prose; reject "Dispatcher"
    // used as an identity noun. The identity form is always capitalized.
    const identityPattern = /\bDispatcher\b/g;
    const matches = content.match(identityPattern) ?? [];
    expect(matches).toHaveLength(0);
  });
});

// =============================================================================
// BOUNDARY — structural invariants and field presence checks.
//
// Boundary tests verify that the key schema fields and protocol markers are
// present in agents/capo.md. They do NOT verify prose correctness — that is
// golden-path territory. They verify the presence of the signal, not its form.
// =============================================================================

describe("boundary(WS-03): agents/capo.md does not contain PLAN_ARTIFACT section", () => {
  it("agents/capo.md contains the string 'PLAN_ARTIFACT'", () => {
    // BOUNDARY: WS-03's primary deliverable is adding a PLAN_ARTIFACT protocol
    // to capo.md. If this string is absent, the entire protocol is missing.
    // The string must appear either as a section header (## PLAN_ARTIFACT) or
    // prominently as a protocol name — dev chooses the exact form.
    const content = readFile("agents/capo.md");
    expect(content).toContain("PLAN_ARTIFACT");
  });
});

describe("boundary(WS-03): agents/capo.md does not contain __DEFERRED__ placeholder", () => {
  it("agents/capo.md contains '__DEFERRED__'", () => {
    // BOUNDARY: the D1 hybrid-planner requires that task prompts in the upfront
    // PLAN_ARTIFACT block use __DEFERRED__ as a placeholder for content that
    // will be filled in at spawn time. Without this marker in the protocol
    // definition, Capo will either omit prompts entirely (incomplete artifact)
    // or inline them all upfront (defeating the deferred design).
    // This string must appear in the section that describes the two-phase format.
    const content = readFile("agents/capo.md");
    expect(content).toContain("__DEFERRED__");
  });
});

describe("boundary(WS-03): agents/capo.md does not reference plan_id field", () => {
  it("agents/capo.md references 'plan_id'", () => {
    // BOUNDARY: plan_id is a required field in PlanSchema (src/core/plan.ts).
    // The PLAN_ARTIFACT block that Capo emits must include plan_id, so the
    // protocol description must reference it. Absence here means the schema
    // example is incomplete and any generated artifact would fail
    // validateArtifact({ type: "PLAN_ARTIFACT", payload: ... }).
    const content = readFile("agents/capo.md");
    expect(content).toContain("plan_id");
  });
});

describe("boundary(WS-03): agents/capo.md does not reference task_id field", () => {
  it("agents/capo.md references 'task_id'", () => {
    // BOUNDARY: the D1 hybrid-planner requires task_id declared upfront in the
    // PLAN_ARTIFACT. Without task_id in the protocol description, Capo-generated
    // artifacts will omit the field that STEP_RESULT_ARTIFACT and GATE_RESULT_ARTIFACT
    // use to correlate results back to their originating task. The wiring breaks.
    const content = readFile("agents/capo.md");
    expect(content).toContain("task_id");
  });
});

// =============================================================================
// GOLDEN PATH — all WS-03 acceptance criteria met.
//
// Golden-path tests verify the complete, correct implementation. They assert
// on combinations of fields (schema completeness), ordering invariants
// (PLAN_ARTIFACT section before Turn-end Protocol), and the removal of legacy
// content that should not appear in a post-WS-03 capo.md.
// =============================================================================

describe("golden(WS-03): agents/capo.md JSON example block contains required PlanSchema fields", () => {
  it("agents/capo.md contains a JSON example with plan_id, project_id, created_at, version, and tasks", () => {
    // GOLDEN: the PLAN_ARTIFACT subsection must include an example JSON block
    // that references all five required PlanSchema fields. An example that omits
    // any of them teaches Capo to emit non-validating artifacts.
    //
    // PlanSchema required fields (src/core/plan.ts):
    //   plan_id      — unique plan identifier
    //   project_id   — project this plan belongs to
    //   created_at   — ISO-8601 timestamp string
    //   version      — literal "1" (forward-evolvable)
    //   tasks        — array of TEOTask, min 1
    //
    // We check string presence rather than parsing the JSON block so the test
    // survives minor formatting differences in the example. An actual JSON parse
    // that validates against PlanSchema would be stronger but is golden-path
    // work for a follow-up acceptance-engineer test.
    const content = readFile("agents/capo.md");
    expect(content).toContain("plan_id");
    expect(content).toContain("project_id");
    expect(content).toContain("created_at");
    expect(content).toContain('"version"');
    expect(content).toContain("tasks");
  });
});

describe("golden(WS-03): agents/capo.md describes a two-phase output format", () => {
  it("agents/capo.md contains 'two-phase' or 'Two-Phase' (case-sensitive alternation)", () => {
    // GOLDEN: the protocol description must use the term "two-phase" or
    // "Two-Phase" to name the output format. This is the term agreed in the
    // acceptance criteria and used in agent spawn prompts. Using a different
    // term (e.g. "sequential", "staged") would break the shared vocabulary
    // that QA and dev use to identify the pattern in future workstreams.
    const content = readFile("agents/capo.md");
    const hasTwoPhase = content.includes("two-phase") || content.includes("Two-Phase");
    expect(hasTwoPhase).toBe(true);
  });
});

describe("golden(WS-03): agents/capo.md does not contain legacy 'mkdir' command", () => {
  it("agents/capo.md does NOT contain the string 'mkdir'", () => {
    // GOLDEN: 'mkdir' is a legacy session setup command that belongs in
    // initialization workstreams (WS-01), not in the Capo orchestrator definition.
    // Its presence here means either (a) stale session-init content was
    // accidentally carried over, or (b) dev copy-pasted a block that included
    // shell commands. Either way it is out of scope for capo.md and should not
    // appear after WS-03's clean edit of the PLAN_ARTIFACT section.
    const content = readFile("agents/capo.md");
    expect(content).not.toContain("mkdir");
  });
});

describe("golden(WS-03): PLAN_ARTIFACT section appears before Turn-end Protocol section", () => {
  it("'PLAN_ARTIFACT' appears earlier in capo.md than 'Turn-end Protocol'", () => {
    // GOLDEN: structural ordering matters for agent comprehension. Capo reads
    // its own definition top-to-bottom. The PLAN_ARTIFACT section describes
    // what to emit at the START of output; Turn-end Protocol covers bookkeeping
    // at the END of a turn. Reversing them would suggest to Capo that it should
    // complete all bookkeeping before emitting the plan — the opposite of the
    // intended two-phase flow.
    //
    // If either string is absent this test fails with a clear indexOf === -1
    // result, which is intentional: both must be present for the ordering to
    // be meaningful. (The boundary tests above catch absence individually.)
    const content = readFile("agents/capo.md");
    const planArtifactIdx = content.indexOf("PLAN_ARTIFACT");
    const turnEndIdx = content.indexOf("Turn-end Protocol");

    // Both must be present
    expect(planArtifactIdx).toBeGreaterThan(-1);
    expect(turnEndIdx).toBeGreaterThan(-1);

    // PLAN_ARTIFACT section must precede Turn-end Protocol
    expect(planArtifactIdx).toBeLessThan(turnEndIdx);
  });
});
