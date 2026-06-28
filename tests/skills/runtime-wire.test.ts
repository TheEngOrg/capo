import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// runtime-wire.test.ts — specs for WS-RUNTIME-WIRE (GREEN post-implementation)
//
// Dev added `teo-run.js evaluate-gate` calls to teo-build/SKILL.md and updated
// capo.md — all tests are now green. Implementation complete.
// DO NOT add implementation here.
//
// What changes (dev will do this):
//   src/plugin/skills/teo-build/SKILL.md:
//     - Add `teo-run.js evaluate-gate` calls at each gate step with appropriate
//       gate_type values (dev / qa-spec / staff-review)
//     - Add SESSION_ID generation at Step 0: SESSION_ID = ws-<workstream_id>-<unix_ts>
//     - Document FAIL = GATE_BLOCKED behavior (CLI exits code 1 → surface GATE_BLOCKED)
//     - Preserve the existing PLAN_ARTIFACT B2 gate call unchanged
//   src/plugin/agents/capo.md:
//     - Update CAD pipeline description (Constitution item 3) to reference
//       `teo-run.js evaluate-gate` and state FAIL blocks pipeline
//     - Remove stale "when the engine is wired (WS-04)" hedge language
//
// Gate type mapping:
//   MECHANICAL track Bash Gate   → gate_type: "dev"
//   ARCHITECTURAL Step 1 (QA)    → gate_type: "qa-spec"
//   ARCHITECTURAL Step 2 (Dev)   → gate_type: "dev"
//   ARCHITECTURAL Step 3 (Staff) → gate_type: "staff-review"
//
// AC-10 (scope constraint) — documented here, asserted by staff-engineer at
// review time via `git diff --name-only`. This test file does NOT attempt to
// assert it programmatically because the worktree diff is only meaningful after
// dev commits changes. Staff-engineer: run `git diff --name-only` and confirm
// only SKILL.md and/or capo.md appear; no TypeScript files are present.
//
// Ordering: misuse → boundary → golden path (adversarial-first policy)
//
// =============================================================================

// ---------------------------------------------------------------------------
// Path helpers — two levels up from tests/skills/ → repo root
// ---------------------------------------------------------------------------

function root(...segments: string[]): string {
  return path.resolve(__dirname, "..", "..", ...segments);
}

function readFile(relPath: string): string {
  return fs.readFileSync(root(relPath), "utf8");
}

// ---------------------------------------------------------------------------
// File handles (read once per describe block to avoid per-test I/O noise)
// ---------------------------------------------------------------------------

function skillMd(): string {
  return readFile("src/plugin/skills/teo-build/SKILL.md");
}

function capoMd(): string {
  return readFile("src/plugin/agents/capo.md");
}

// =============================================================================
// MISUSE — assertions about content that MUST be present after dev's changes.
// Ordered first because these are the scenarios that burn you when LLM agents
// produce partial implementations: they add the happy-path gate call but omit
// the FAIL semantics, skip one of the four gate_type variants, or forget the
// SESSION_ID anchor variable.
//
// Misuse under test: "what if dev adds evaluate-gate to some steps but not all?"
// =============================================================================

describe("misuse(AC-1): MECHANICAL Bash Gate missing evaluate-gate with gate_type dev", () => {
  it("SKILL.md MECHANICAL Bash Gate section contains `teo-run.js evaluate-gate`", () => {
    // MISUSE: if the Bash Gate section has no evaluate-gate call at all, the
    // MECHANICAL track bypasses the engine entirely. AC-1 requires the call is
    // present in the Bash Gate section, not just anywhere in the file.
    //
    // Strategy: find the Bash Gate section header and assert the string
    // `teo-run.js evaluate-gate` appears within 40 lines of it — close enough
    // to be "in the section" without tightly coupling to whitespace layout.
    const content = skillMd();
    const lines = content.split("\n");
    const bashGateIdx = lines.findIndex(
      (l) => l.includes("Bash Gate") && !l.includes("PLAN_ARTIFACT") && !l.includes("B2")
    );
    expect(bashGateIdx).toBeGreaterThanOrEqual(0); // section must exist
    const sectionWindow = lines.slice(bashGateIdx, bashGateIdx + 40).join("\n");
    expect(sectionWindow).toContain("teo-run.js evaluate-gate");
  });

  it("SKILL.md MECHANICAL Bash Gate section contains gate_type value `dev`", () => {
    // MISUSE: evaluate-gate present but wrong gate_type is a silent misconfiguration
    // that routes MECHANICAL gates through the wrong gate profile (e.g. staff-review).
    // Assert gate_type: "dev" appears in the Bash Gate section window.
    const content = skillMd();
    const lines = content.split("\n");
    const bashGateIdx = lines.findIndex(
      (l) => l.includes("Bash Gate") && !l.includes("PLAN_ARTIFACT") && !l.includes("B2")
    );
    expect(bashGateIdx).toBeGreaterThanOrEqual(0);
    const sectionWindow = lines.slice(bashGateIdx, bashGateIdx + 40).join("\n");
    expect(sectionWindow).toContain('"dev"');
  });
});

describe("misuse(AC-2): ARCHITECTURAL Step 1 missing evaluate-gate with gate_type qa-spec", () => {
  it("SKILL.md Step 1 (QA spec) section contains `teo-run.js evaluate-gate`", () => {
    // MISUSE: if Step 1 has no evaluate-gate call, the QA spec phase is un-gated —
    // the pipeline can advance to dev even when QA has produced nothing.
    // Step 1 in ARCHITECTURAL track is the QA Test Specification step.
    const content = skillMd();
    const lines = content.split("\n");
    // Find the Step 1 header in the ARCHITECTURAL section
    const step1Idx = lines.findIndex(
      (l) =>
        (l.includes("Step 1") || l.includes("Step 1:")) &&
        (l.includes("QA") || l.includes("Test Specification") || l.includes("Test Spec"))
    );
    expect(step1Idx).toBeGreaterThanOrEqual(0); // Step 1 must exist
    const sectionWindow = lines.slice(step1Idx, step1Idx + 40).join("\n");
    expect(sectionWindow).toContain("teo-run.js evaluate-gate");
  });

  it("SKILL.md Step 1 section contains gate_type value `qa-spec`", () => {
    // MISUSE: evaluate-gate present in Step 1 but typed as 'dev' instead of
    // 'qa-spec' silently routes the QA gate through the dev profile. The gate
    // would fire the wrong checks — e.g. coverage thresholds instead of spec
    // completeness signals.
    const content = skillMd();
    const lines = content.split("\n");
    const step1Idx = lines.findIndex(
      (l) =>
        (l.includes("Step 1") || l.includes("Step 1:")) &&
        (l.includes("QA") || l.includes("Test Specification") || l.includes("Test Spec"))
    );
    expect(step1Idx).toBeGreaterThanOrEqual(0);
    const sectionWindow = lines.slice(step1Idx, step1Idx + 40).join("\n");
    expect(sectionWindow).toContain('"qa-spec"');
  });
});

describe("misuse(AC-3): ARCHITECTURAL Step 2 missing evaluate-gate with gate_type dev", () => {
  it("SKILL.md Step 2 (Dev implementation) section contains `teo-run.js evaluate-gate`", () => {
    // MISUSE: if Step 2 has no evaluate-gate call, the Dev implementation phase is
    // un-gated — the pipeline can advance to Staff Engineer review even when dev
    // deliverables fail validation.
    const content = skillMd();
    const lines = content.split("\n");
    // Find the Step 2 header in the ARCHITECTURAL section (avoid Step 2.5 / 2.8)
    const step2Idx = lines.findIndex(
      (l) =>
        /Step 2[^.58]/.test(l) &&
        (l.includes("Dev") || l.includes("Implementation") || l.includes("Implement"))
    );
    expect(step2Idx).toBeGreaterThanOrEqual(0);
    const sectionWindow = lines.slice(step2Idx, step2Idx + 40).join("\n");
    expect(sectionWindow).toContain("teo-run.js evaluate-gate");
  });

  it("SKILL.md Step 2 section contains gate_type value `dev`", () => {
    // MISUSE: wrong gate_type on Step 2 (e.g. 'qa-spec') routes the dev-complete
    // signal through the QA profile — QA profile checks for test specs, not
    // coverage/implementation completeness.
    const content = skillMd();
    const lines = content.split("\n");
    const step2Idx = lines.findIndex(
      (l) =>
        /Step 2[^.58]/.test(l) &&
        (l.includes("Dev") || l.includes("Implementation") || l.includes("Implement"))
    );
    expect(step2Idx).toBeGreaterThanOrEqual(0);
    const sectionWindow = lines.slice(step2Idx, step2Idx + 40).join("\n");
    expect(sectionWindow).toContain('"dev"');
  });
});

describe("misuse(AC-4): ARCHITECTURAL Step 3 missing evaluate-gate with gate_type staff-review", () => {
  it("SKILL.md Step 3 (Staff Engineer review) section contains `teo-run.js evaluate-gate`", () => {
    // MISUSE: if Step 3 has no evaluate-gate call, the Staff Engineer review
    // phase is un-gated — work can advance to merge without the engine recording
    // the staff-review verdict in the signed ledger.
    const content = skillMd();
    const lines = content.split("\n");
    const step3Idx = lines.findIndex(
      (l) =>
        (l.includes("Step 3") || l.includes("Step 3:")) &&
        (l.includes("Staff") || l.includes("Engineer Review") || l.includes("Review"))
    );
    expect(step3Idx).toBeGreaterThanOrEqual(0);
    const sectionWindow = lines.slice(step3Idx, step3Idx + 40).join("\n");
    expect(sectionWindow).toContain("teo-run.js evaluate-gate");
  });

  it("SKILL.md Step 3 section contains gate_type value `staff-review`", () => {
    // MISUSE: 'dev' gate_type on Step 3 bypasses the staff-review profile entirely
    // — the engine would not enforce the review checklist signals for this gate.
    const content = skillMd();
    const lines = content.split("\n");
    const step3Idx = lines.findIndex(
      (l) =>
        (l.includes("Step 3") || l.includes("Step 3:")) &&
        (l.includes("Staff") || l.includes("Engineer Review") || l.includes("Review"))
    );
    expect(step3Idx).toBeGreaterThanOrEqual(0);
    const sectionWindow = lines.slice(step3Idx, step3Idx + 40).join("\n");
    expect(sectionWindow).toContain('"staff-review"');
  });
});

describe("misuse(AC-9): capo.md still contains stale (WS-04) hedge language", () => {
  it('capo.md does not contain the string "(WS-04)"', () => {
    // MISUSE: the hedge "when the engine is wired (WS-04)" signals to all readers
    // (agents and humans) that the evaluate-gate wiring is FUTURE work. After this
    // workstream, evaluate-gate IS wired. The hedge must be removed so agents
    // don't silently skip gate calls expecting them to be no-ops.
    const content = capoMd();
    expect(content).not.toContain("(WS-04)");
  });

  it('capo.md does not contain the phrase "when the engine is wired (WS-04)"', () => {
    // Double-check the full phrase in case only the WS-04 token is removed but
    // the surrounding hedge sentence survives with a different workstream ID.
    // Test both the full phrase and the partial token (previous test) for defense.
    const content = capoMd();
    expect(content).not.toContain("when the engine is wired (WS-04)");
  });
});

// =============================================================================
// BOUNDARY — edge conditions and precision checks
//
// These tests guard against partial or malformed implementations:
//   - SESSION_ID present but not anchored to workstream (wrong variable name)
//   - GATE_BLOCKED documented only in the PLAN_ARTIFACT section (not standalone gates)
//   - capo.md Constitution item 3 updated but omitting the FAIL-blocks-pipeline clause
//   - B2 PLAN_ARTIFACT call accidentally removed during the edit
// =============================================================================

describe("boundary(AC-5): SESSION_ID variable defined in SKILL.md", () => {
  it("SKILL.md contains the string SESSION_ID", () => {
    // BOUNDARY: SESSION_ID is the workstream-scoped identifier passed into every
    // evaluate-gate call's session_id field. Without it, gate calls lack a stable
    // anchor and the ledger cannot correlate events across steps within the same
    // workstream session.
    //
    // We assert presence of the string SESSION_ID rather than the exact assignment
    // syntax to remain robust to formatting choices (e.g. backtick vs. plain text,
    // bash variable vs. prose definition).
    const content = skillMd();
    expect(content).toContain("SESSION_ID");
  });

  it("SKILL.md SESSION_ID definition references workstream context (ws- prefix or workstream_id)", () => {
    // BOUNDARY: SESSION_ID must be workstream-scoped — `ws-<workstream_id>-<unix_ts>`
    // per the spec. A bare `SESSION_ID = $(date +%s)` with no workstream anchor
    // would silently produce non-unique IDs across concurrent workstreams.
    // Assert that SESSION_ID appears near a reference to workstream_id or ws- prefix.
    const content = skillMd();
    const lines = content.split("\n");
    const sessionLineIdx = lines.findIndex((l) => l.includes("SESSION_ID"));
    expect(sessionLineIdx).toBeGreaterThanOrEqual(0);
    // Check the 5-line window around SESSION_ID for workstream anchor vocabulary
    const window = lines.slice(Math.max(0, sessionLineIdx - 2), sessionLineIdx + 5).join("\n");
    const hasWorkstreamAnchor =
      window.includes("workstream_id") ||
      window.includes("ws-") ||
      window.includes("workstream-id") ||
      window.includes("{id}");
    expect(hasWorkstreamAnchor).toBe(true);
  });
});

describe("boundary(AC-6): GATE_BLOCKED behavior documented adjacent to new standalone evaluate-gate calls", () => {
  it("SKILL.md MECHANICAL Bash Gate section documents GATE_BLOCKED (or do not advance) near the evaluate-gate call", () => {
    // BOUNDARY: the FAIL behavior description must appear in proximity to the NEW
    // standalone evaluate-gate call in the Bash Gate section — not inherited from
    // the PLAN_ARTIFACT B2 block or the Step 2.8 Validation Gate section.
    // Dev must explicitly document: FAIL → GATE_BLOCKED → do not advance.
    // A partial implementation that adds the CLI call but omits FAIL semantics
    // leaves agents with no signal about what to do when the gate returns FAIL.
    const content = skillMd();
    const lines = content.split("\n");
    const bashGateIdx = lines.findIndex(
      (l) => l.includes("Bash Gate") && !l.includes("PLAN_ARTIFACT") && !l.includes("B2")
    );
    expect(bashGateIdx).toBeGreaterThanOrEqual(0);
    // Look for GATE_BLOCKED or "do not advance" within 50 lines of the Bash Gate header
    const sectionWindow = lines.slice(bashGateIdx, bashGateIdx + 50).join("\n");
    const hasBlockSemantics =
      sectionWindow.includes("GATE_BLOCKED") ||
      sectionWindow.toLowerCase().includes("do not advance") ||
      sectionWindow.toLowerCase().includes("halt") ||
      sectionWindow.toLowerCase().includes("blocks pipeline");
    // This section must also contain evaluate-gate (from AC-1) — without it,
    // there's no gate call to document FAIL behavior for, so GATE_BLOCKED here
    // would be vacuous
    const hasEvaluateGate = sectionWindow.includes("teo-run.js evaluate-gate");
    // Both must be true: evaluate-gate call AND FAIL/GATE_BLOCKED semantics
    expect(hasEvaluateGate && hasBlockSemantics).toBe(true);
  });

  it("SKILL.md ARCHITECTURAL Step sections document GATE_BLOCKED near the evaluate-gate calls", () => {
    // BOUNDARY: at least one of the ARCHITECTURAL step sections (Step 1/2/3) must
    // document GATE_BLOCKED in proximity to an evaluate-gate call. This guards
    // against a dev who adds the CLI call verbatim but omits failure semantics.
    // We can't assert all three individually without knowing dev's exact layout,
    // but at least one ARCHITECTURAL step with both evaluate-gate + GATE_BLOCKED
    // must exist.
    const content = skillMd();
    // Strip the PLAN_ARTIFACT section entirely — GATE_BLOCKED there doesn't count
    const withoutPlanArtifact = content.replace(/PLAN_ARTIFACT[\s\S]*?END_PLAN_ARTIFACT/g, "");
    // Also strip the Step 2.8 Validation Gate section (existing GATE_BLOCKED,
    // not from evaluate-gate) — narrow window approach handles this naturally
    const lines = withoutPlanArtifact.split("\n");

    // Find each ARCHITECTURAL step and check for co-occurrence of both tokens
    const stepIndices: number[] = [];
    lines.forEach((l, i) => {
      if (
        (/Step [123][^.58]/.test(l) || /Step [123]:/.test(l)) &&
        (l.includes("QA") ||
          l.includes("Dev") ||
          l.includes("Staff") ||
          l.includes("Implementation") ||
          l.includes("Implement") ||
          l.includes("Test Spec") ||
          l.includes("Review"))
      ) {
        stepIndices.push(i);
      }
    });

    // At least one step index must exist (they come from ARCHITECTURAL section)
    expect(stepIndices.length).toBeGreaterThan(0);

    // Check at least one step window contains BOTH evaluate-gate AND block semantics
    const atLeastOneStepHasBoth = stepIndices.some((idx) => {
      const window = lines.slice(idx, idx + 50).join("\n");
      const hasEvaluateGate = window.includes("teo-run.js evaluate-gate");
      const hasBlockSemantics =
        window.includes("GATE_BLOCKED") ||
        window.toLowerCase().includes("do not advance") ||
        window.toLowerCase().includes("blocks pipeline");
      return hasEvaluateGate && hasBlockSemantics;
    });
    expect(atLeastOneStepHasBoth).toBe(true);
  });
});

describe("boundary(AC-7): B2 PLAN_ARTIFACT gate call preserved", () => {
  it("SKILL.md still contains the B2 gate evaluation block with teo-run.js evaluate-gate", () => {
    // BOUNDARY: dev must NOT remove or refactor the existing B2 gate call while
    // adding the new standalone gate calls. Both patterns co-exist — B2 is the
    // PLAN_ARTIFACT execution loop gate; the new calls are for the legacy track.
    // If B2 is removed, the PLAN_ARTIFACT flow loses its gate enforcement.
    const content = skillMd();
    // B2 is identified by: teo-run.js evaluate-gate appearing inside a PLAN_ARTIFACT
    // context (the B2 section specifically mentions plan-level gate logic)
    expect(content).toContain("teo-run.js evaluate-gate");

    // More specifically — the B2 section with task.gates and session_id must survive
    const hasPlanGateContext =
      content.includes("task.gates") ||
      content.includes("plan_id") ||
      content.includes("PLAN_ARTIFACT");
    expect(hasPlanGateContext).toBe(true);
  });

  it("SKILL.md B2 section still contains PLAN_ARTIFACT gate call with task_id and session_id fields", () => {
    // BOUNDARY: the specific CLI call shape `evaluate-gate '{"gate_id":...,
    // "task_id":...,"session_id":...,"gate_type":...}'` must survive in the B2
    // block. A partial removal that strips only some JSON fields would corrupt
    // the PLAN_ARTIFACT loop without removing evaluate-gate entirely.
    const content = skillMd();
    // Find the B2 section and assert the key fields appear near each other
    const lines = content.split("\n");
    const b2Idx = lines.findIndex((l) => l.includes("B2") && l.includes("Gate"));
    expect(b2Idx).toBeGreaterThanOrEqual(0);
    const b2Window = lines.slice(b2Idx, b2Idx + 20).join("\n");
    expect(b2Window).toContain("session_id");
    expect(b2Window).toContain("gate_type");
  });
});

describe("boundary(AC-8): capo.md Constitution item 3 update precision", () => {
  it("capo.md Constitution item 3 still contains the do-not-skip-gates rule", () => {
    // BOUNDARY: the update to Constitution item 3 must preserve the existing
    // "do not skip gates" / "Surface GATE_BLOCKED" semantics while ADDING the
    // teo-run.js evaluate-gate reference. A rewrite that only mentions the CLI
    // but drops the skip-gates mandate would weaken the rule for agents.
    const content = capoMd();
    // Constitution item 3 must still say something about not skipping gates
    const hasSkipGateRule =
      content.includes("Do not skip gates") ||
      content.includes("do not skip gates") ||
      content.includes("non-negotiable") ||
      content.includes("GATE_BLOCKED");
    expect(hasSkipGateRule).toBe(true);
  });

  it("capo.md Constitution section still contains item 3", () => {
    // BOUNDARY: the Constitution block must survive the edit intact — the update
    // should modify item 3's text, not delete the item or the section.
    const content = capoMd();
    expect(content).toContain("## Constitution");
    // Item 3 is identified by the numbered prefix pattern
    const hasItem3 = content.includes("3. **CAD") || /^\s*3\./m.test(content);
    expect(hasItem3).toBe(true);
  });
});

// =============================================================================
// GOLDEN PATH — all acceptance criteria met simultaneously
//
// These tests define "done" for WS-RUNTIME-WIRE. All must pass green before
// the workstream can advance to Staff Engineer review.
// =============================================================================

describe("golden(AC-1): MECHANICAL Bash Gate has evaluate-gate with gate_type dev", () => {
  it("SKILL.md Bash Gate section has teo-run.js evaluate-gate AND gate_type dev together", () => {
    // GOLDEN: both the CLI call and the correct gate_type must co-appear in the
    // Bash Gate section. A section that has the string 'dev' in an unrelated
    // context (e.g. the dev-haiku spawn block) does not satisfy AC-1.
    const content = skillMd();
    const lines = content.split("\n");
    const bashGateIdx = lines.findIndex(
      (l) => l.includes("Bash Gate") && !l.includes("PLAN_ARTIFACT") && !l.includes("B2")
    );
    expect(bashGateIdx).toBeGreaterThanOrEqual(0);
    const sectionWindow = lines.slice(bashGateIdx, bashGateIdx + 40).join("\n");
    expect(sectionWindow).toContain("teo-run.js evaluate-gate");
    expect(sectionWindow).toContain('"dev"');
  });
});

describe("golden(AC-2): ARCHITECTURAL Step 1 has evaluate-gate with gate_type qa-spec", () => {
  it("SKILL.md Step 1 section has teo-run.js evaluate-gate AND gate_type qa-spec together", () => {
    const content = skillMd();
    const lines = content.split("\n");
    const step1Idx = lines.findIndex(
      (l) =>
        (l.includes("Step 1") || l.includes("Step 1:")) &&
        (l.includes("QA") || l.includes("Test Specification") || l.includes("Test Spec"))
    );
    expect(step1Idx).toBeGreaterThanOrEqual(0);
    const sectionWindow = lines.slice(step1Idx, step1Idx + 40).join("\n");
    expect(sectionWindow).toContain("teo-run.js evaluate-gate");
    expect(sectionWindow).toContain('"qa-spec"');
  });
});

describe("golden(AC-3): ARCHITECTURAL Step 2 has evaluate-gate with gate_type dev", () => {
  it("SKILL.md Step 2 section has teo-run.js evaluate-gate AND gate_type dev together", () => {
    const content = skillMd();
    const lines = content.split("\n");
    const step2Idx = lines.findIndex(
      (l) =>
        /Step 2[^.58]/.test(l) &&
        (l.includes("Dev") || l.includes("Implementation") || l.includes("Implement"))
    );
    expect(step2Idx).toBeGreaterThanOrEqual(0);
    const sectionWindow = lines.slice(step2Idx, step2Idx + 40).join("\n");
    expect(sectionWindow).toContain("teo-run.js evaluate-gate");
    expect(sectionWindow).toContain('"dev"');
  });
});

describe("golden(AC-4): ARCHITECTURAL Step 3 has evaluate-gate with gate_type staff-review", () => {
  it("SKILL.md Step 3 section has teo-run.js evaluate-gate AND gate_type staff-review together", () => {
    const content = skillMd();
    const lines = content.split("\n");
    const step3Idx = lines.findIndex(
      (l) =>
        (l.includes("Step 3") || l.includes("Step 3:")) &&
        (l.includes("Staff") || l.includes("Engineer Review") || l.includes("Review"))
    );
    expect(step3Idx).toBeGreaterThanOrEqual(0);
    const sectionWindow = lines.slice(step3Idx, step3Idx + 40).join("\n");
    expect(sectionWindow).toContain("teo-run.js evaluate-gate");
    expect(sectionWindow).toContain('"staff-review"');
  });
});

describe("golden(AC-5): SKILL.md SESSION_ID definition is workstream-scoped", () => {
  it("SKILL.md contains SESSION_ID anchored to workstream context", () => {
    const content = skillMd();
    expect(content).toContain("SESSION_ID");
    const lines = content.split("\n");
    const sessionLineIdx = lines.findIndex((l) => l.includes("SESSION_ID"));
    const window = lines.slice(Math.max(0, sessionLineIdx - 2), sessionLineIdx + 5).join("\n");
    const hasWorkstreamAnchor =
      window.includes("workstream_id") || window.includes("ws-") || window.includes("{id}");
    expect(hasWorkstreamAnchor).toBe(true);
  });
});

describe("golden(AC-6): SKILL.md documents GATE_BLOCKED adjacent to standalone evaluate-gate calls", () => {
  it("SKILL.md Bash Gate section contains both teo-run.js evaluate-gate and GATE_BLOCKED/block semantics", () => {
    const content = skillMd();
    const lines = content.split("\n");
    const bashGateIdx = lines.findIndex(
      (l) => l.includes("Bash Gate") && !l.includes("PLAN_ARTIFACT") && !l.includes("B2")
    );
    expect(bashGateIdx).toBeGreaterThanOrEqual(0);
    const sectionWindow = lines.slice(bashGateIdx, bashGateIdx + 50).join("\n");
    const hasEvaluateGate = sectionWindow.includes("teo-run.js evaluate-gate");
    const hasBlockSemantics =
      sectionWindow.includes("GATE_BLOCKED") ||
      sectionWindow.toLowerCase().includes("do not advance") ||
      sectionWindow.toLowerCase().includes("halt") ||
      sectionWindow.toLowerCase().includes("blocks pipeline");
    expect(hasEvaluateGate && hasBlockSemantics).toBe(true);
  });

  it("SKILL.md at least one ARCHITECTURAL step section contains both evaluate-gate and GATE_BLOCKED semantics", () => {
    const content = skillMd();
    const withoutPlanArtifact = content.replace(/PLAN_ARTIFACT[\s\S]*?END_PLAN_ARTIFACT/g, "");
    const lines = withoutPlanArtifact.split("\n");
    const stepIndices: number[] = [];
    lines.forEach((l, i) => {
      if (
        (/Step [123][^.58]/.test(l) || /Step [123]:/.test(l)) &&
        (l.includes("QA") ||
          l.includes("Dev") ||
          l.includes("Staff") ||
          l.includes("Implementation") ||
          l.includes("Implement") ||
          l.includes("Test Spec") ||
          l.includes("Review"))
      ) {
        stepIndices.push(i);
      }
    });
    expect(stepIndices.length).toBeGreaterThan(0);
    const atLeastOneStepHasBoth = stepIndices.some((idx) => {
      const window = lines.slice(idx, idx + 50).join("\n");
      const hasEvaluateGate = window.includes("teo-run.js evaluate-gate");
      const hasBlockSemantics =
        window.includes("GATE_BLOCKED") ||
        window.toLowerCase().includes("do not advance") ||
        window.toLowerCase().includes("blocks pipeline");
      return hasEvaluateGate && hasBlockSemantics;
    });
    expect(atLeastOneStepHasBoth).toBe(true);
  });
});

describe("golden(AC-7): B2 PLAN_ARTIFACT gate call fully preserved", () => {
  it("SKILL.md B2 section retains evaluate-gate with session_id and gate_type fields", () => {
    const content = skillMd();
    expect(content).toContain("teo-run.js evaluate-gate");
    const lines = content.split("\n");
    const b2Idx = lines.findIndex((l) => l.includes("B2") && l.includes("Gate"));
    expect(b2Idx).toBeGreaterThanOrEqual(0);
    const b2Window = lines.slice(b2Idx, b2Idx + 20).join("\n");
    expect(b2Window).toContain("session_id");
    expect(b2Window).toContain("gate_type");
  });
});

describe("golden(AC-8): capo.md Constitution item 3 references teo-run.js evaluate-gate and FAIL blocks pipeline", () => {
  it("capo.md Constitution item 3 contains `teo-run.js evaluate-gate`", () => {
    // GOLDEN: Constitution item 3 must explicitly reference the CLI tool so agents
    // reading capo.md know WHICH mechanism enforces the CAD gates.
    const content = capoMd();
    const lines = content.split("\n");
    // Find item 3 in the Constitution block
    const constitutionIdx = lines.findIndex((l) => l.includes("## Constitution"));
    expect(constitutionIdx).toBeGreaterThanOrEqual(0);
    // Item 3 should be within 20 lines of the Constitution header
    const constitutionBlock = lines.slice(constitutionIdx, constitutionIdx + 30).join("\n");
    expect(constitutionBlock).toContain("teo-run.js evaluate-gate");
  });

  it("capo.md Constitution item 3 states FAIL blocks the pipeline", () => {
    // GOLDEN: the evaluate-gate reference must come with the FAIL consequence —
    // without it, agents might read the reference as informational and not halt
    // the pipeline on a FAIL verdict.
    const content = capoMd();
    const lines = content.split("\n");
    const constitutionIdx = lines.findIndex((l) => l.includes("## Constitution"));
    expect(constitutionIdx).toBeGreaterThanOrEqual(0);
    const constitutionBlock = lines.slice(constitutionIdx, constitutionIdx + 30).join("\n");
    // "FAIL blocks pipeline" or "FAIL = GATE_BLOCKED" or "blocks pipeline"
    const hasFailBlocksLanguage =
      constitutionBlock.toLowerCase().includes("fail blocks") ||
      constitutionBlock.toLowerCase().includes("blocks pipeline") ||
      constitutionBlock.includes("GATE_BLOCKED") ||
      (constitutionBlock.toLowerCase().includes("fail") &&
        constitutionBlock.toLowerCase().includes("block"));
    expect(hasFailBlocksLanguage).toBe(true);
  });
});

describe("golden(AC-9): capo.md stale WS-04 hedge language removed", () => {
  it('capo.md does not contain "(WS-04)"', () => {
    expect(capoMd()).not.toContain("(WS-04)");
  });

  it('capo.md does not contain "when the engine is wired"', () => {
    // GOLDEN: the full hedge phrase must be gone. After WS-RUNTIME-WIRE, the
    // engine IS wired — this conditional hedge is incorrect and misleads agents.
    expect(capoMd()).not.toContain("when the engine is wired");
  });
});

// =============================================================================
// AC-10 NOTE (no automated assertion — enforced by staff-engineer at review)
//
// Per the acceptance criteria, AC-10 requires that `git diff --name-only`
// in the worktree shows ONLY changes to:
//   src/plugin/skills/teo-build/SKILL.md
//   src/plugin/agents/capo.md
//
// No TypeScript files (.ts) may be modified.
//
// Staff-engineer: run this command in the worktree and confirm the output
// lists only the two markdown files above. If any .ts file appears, the
// workstream scope boundary has been breached and the commit must be rejected.
//
//   $ git diff --name-only
//
// =============================================================================
