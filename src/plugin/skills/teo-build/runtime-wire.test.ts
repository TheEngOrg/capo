// =============================================================================
// runtime-wire.test.ts — WS-RUNTIME-WIRE — QA spec (gate-1, misuse-first)
//
// Tests that the CAPO plugin's non-PLAN_ARTIFACT tracks (MECHANICAL + ARCHITECTURAL)
// call `teo-run.js evaluate-gate` after each specialist step, producing HMAC-signed
// gate telemetry on the real runtime path.
//
// The fix is purely to SKILL.md documents (teo-build + capo.md). Tests are
// document-content assertions — they read the file as a string and check for the
// required text patterns.
//
// TEST ORDERING: misuse → boundary → golden path (ADR-064 policy)
//
// ALL TESTS PASSING (WS-RUNTIME-WIRE implemented — fix applied to SKILL.md + capo.md):
//   1. MECHANICAL Bash Gate section references evaluate-gate with gate_type "dev"
//   2. ARCHITECTURAL Steps 1, 2, 3 reference teo-run.js evaluate-gate (fix confirmed)
//   3. MECHANICAL Bash Gate section references evaluate-gate with gate_type "dev"
//   4. ARCHITECTURAL Step 1 (QA) references evaluate-gate with gate_type "qa-spec"
//   5. ARCHITECTURAL Step 2 (Dev) references evaluate-gate with gate_type "dev"
//   6. ARCHITECTURAL Step 3 (Staff Engineer) references evaluate-gate with gate_type "staff-review"
//   7. A FAIL gate verdict blocks the pipeline (SKILL.md states this)
//   8. capo.md constitution references evaluate-gate signing in the CAD pipeline
//   9. B2 gate evaluation section still references teo-run.js evaluate-gate
//  10. gate_type values used are only from the known allowed set
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const SKILL_MD_PATH = path.resolve(
  __dirname,
  "SKILL.md"
);
const CAPO_MD_PATH = path.resolve(
  __dirname,
  "../../agents/capo.md"
);

// Known gate_types from teo-run-entry.ts handleEvaluateGate()
const KNOWN_GATE_TYPES = ["acceptance-criteria", "qa-spec", "dev", "staff-review"] as const;

// ---------------------------------------------------------------------------
// File content — loaded once before all tests
// ---------------------------------------------------------------------------

let skillMd: string;
let capoMd: string;

beforeAll(() => {
  skillMd = fs.readFileSync(SKILL_MD_PATH, "utf-8");
  capoMd = fs.readFileSync(CAPO_MD_PATH, "utf-8");
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the text of a named section from a markdown file.
 * Section starts at the heading line and ends at the next same-or-higher-level heading.
 */
function extractSection(content: string, heading: string): string {
  const lines = content.split("\n");
  const headingLevel = (heading.match(/^#+/) ?? [""])[0]!.length;
  const headingPattern = new RegExp(`^#{${headingLevel}}\\s`);

  const startIdx = lines.findIndex((l) => l.trim() === heading.trim());
  if (startIdx === -1) return "";

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (headingPattern.test(line)) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

// =============================================================================
// MISUSE / ABSENCE TESTS — confirm the gap exists (should PASS before the fix)
// These tests invert after the fix is applied.
// =============================================================================

describe("WS-RUNTIME-WIRE — misuse: confirm evaluate-gate wiring exists in SKILL.md (post-fix state)", () => {
  // Test 1: MECHANICAL Bash Gate section DOES call evaluate-gate (gap closed by fix)
  //
  // The gap is closed: the Bash Gate now emits a signed gate result via the CLI.
  // This test was inverted from the pre-fix "not.toContain" to confirm the fix landed.
  it("1. MECHANICAL Bash Gate section references teo-run.js evaluate-gate (fix confirmed)", () => {
    const bashGateSection = extractSection(skillMd, "### Bash Gate (no spawn)");
    expect(bashGateSection.length).toBeGreaterThan(0); // section must exist
    expect(bashGateSection).toContain("evaluate-gate");
  });

  // Test 2: ARCHITECTURAL Steps 1, 2, 3 DO call evaluate-gate (gap closed by fix)
  //
  // Steps 1 (QA), 2 (Dev), 3 (Staff Engineer) now have CLI gate calls.
  // This test was inverted from the pre-fix "not.toContain" to confirm the fix landed.
  it("2. ARCHITECTURAL Steps 1, 2, 3 reference teo-run.js evaluate-gate (fix confirmed)", () => {
    const step1 = extractSection(skillMd, "### Step 1: QA Test Specification");
    const step2 = extractSection(skillMd, "### Step 2: Dev Implementation");
    const step3 = extractSection(skillMd, "### Step 3: Staff Engineer Review");

    expect(step1.length).toBeGreaterThan(0); // sections must exist
    expect(step2.length).toBeGreaterThan(0);
    expect(step3.length).toBeGreaterThan(0);

    expect(step1).toContain("evaluate-gate");
    expect(step2).toContain("evaluate-gate");
    expect(step3).toContain("evaluate-gate");
  });
});

// =============================================================================
// AFTER-FIX ASSERTIONS — these FAIL before the fix, PASS after
// =============================================================================

describe("WS-RUNTIME-WIRE — after-fix: MECHANICAL track calls evaluate-gate", () => {
  // Test 3: MECHANICAL Bash Gate calls evaluate-gate with gate_type "dev"
  //
  // After the Bash Gate checks pass, the SKILL.md must instruct teo-build to call:
  //   teo-run.js evaluate-gate '{"gate_id":"...","task_id":"...","session_id":"...","gate_type":"dev"}'
  // This ensures MECHANICAL builds emit a signed gate record in the telemetry ledger.
  it('3. MECHANICAL Bash Gate section references teo-run.js evaluate-gate with gate_type "dev"', () => {
    const bashGateSection = extractSection(skillMd, "### Bash Gate (no spawn)");
    expect(bashGateSection).toContain("teo-run.js evaluate-gate");
    expect(bashGateSection).toContain('"dev"');
  });
});

describe("WS-RUNTIME-WIRE — after-fix: ARCHITECTURAL track calls evaluate-gate at each step", () => {
  // Test 4: ARCHITECTURAL Step 1 (QA) calls evaluate-gate with gate_type "qa-spec"
  //
  // After the QA specialist completes, teo-build must call evaluate-gate so the
  // signed ledger records that the QA gate passed before dev starts.
  it('4. ARCHITECTURAL Step 1 (QA) references teo-run.js evaluate-gate with gate_type "qa-spec"', () => {
    const step1 = extractSection(skillMd, "### Step 1: QA Test Specification");
    expect(step1).toContain("teo-run.js evaluate-gate");
    expect(step1).toContain('"qa-spec"');
  });

  // Test 5: ARCHITECTURAL Step 2 (Dev) calls evaluate-gate with gate_type "dev"
  //
  // After the Dev specialist completes, teo-build must call evaluate-gate so
  // the "all tests pass" gate is signed in the ledger before Staff Engineer review.
  it('5. ARCHITECTURAL Step 2 (Dev) references teo-run.js evaluate-gate with gate_type "dev"', () => {
    const step2 = extractSection(skillMd, "### Step 2: Dev Implementation");
    expect(step2).toContain("teo-run.js evaluate-gate");
    expect(step2).toContain('"dev"');
  });

  // Test 6: ARCHITECTURAL Step 3 (Staff Engineer) calls evaluate-gate with gate_type "staff-review"
  //
  // After the Staff Engineer completes review, teo-build must call evaluate-gate
  // so the "staff approval" gate is signed before the pipeline advances to merge.
  it('6. ARCHITECTURAL Step 3 (Staff Engineer) references teo-run.js evaluate-gate with gate_type "staff-review"', () => {
    const step3 = extractSection(skillMd, "### Step 3: Staff Engineer Review");
    expect(step3).toContain("teo-run.js evaluate-gate");
    expect(step3).toContain('"staff-review"');
  });

  // Test 7: A FAIL gate verdict blocks the pipeline
  //
  // The SKILL.md must explicitly state that a FAIL verdict from evaluate-gate
  // halts the pipeline (GATE_BLOCKED). Without this, the skill might silently
  // advance past a failed gate.
  it("7. SKILL.md states that a FAIL gate verdict blocks / halts the pipeline", () => {
    // The FAIL→GATE_BLOCKED semantics must appear somewhere in the non-PLAN_ARTIFACT
    // tracks — either in the Bash Gate or a shared gate policy block.
    // We check the whole document since the fix may add a shared policy note or
    // inline it per-step.
    const bashGateSection = extractSection(skillMd, "### Bash Gate (no spawn)");
    const step1 = extractSection(skillMd, "### Step 1: QA Test Specification");
    const step2 = extractSection(skillMd, "### Step 2: Dev Implementation");
    const step3 = extractSection(skillMd, "### Step 3: Staff Engineer Review");
    const combined = [bashGateSection, step1, step2, step3].join("\n");

    // Must mention FAIL blocking the pipeline, surfacing GATE_BLOCKED, or halting
    const mentionsFail =
      /FAIL.*block|GATE_BLOCKED|halt.*pipeline|block.*pipeline|fail.*halt/i.test(combined);
    expect(mentionsFail).toBe(true);
  });
});

describe("WS-RUNTIME-WIRE — after-fix: capo.md references evaluate-gate in CAD pipeline", () => {
  // Test 8: capo.md's "CAD is non-negotiable" rule references evaluate-gate signing
  //
  // Capo's constitution must make it clear that the signed CLI gate path is part
  // of the CAD pipeline, not just an optional runtime detail. This ensures future
  // Capo sessions don't skip the signing step when orchestrating builds.
  it("8. capo.md CAD constitution references evaluate-gate or signed gate in the pipeline", () => {
    // The relevant text is in the Constitution section. We check both the
    // "CAD is non-negotiable" rule text and the Standard Dispatch Flow section.
    const cadRuleIdx = capoMd.indexOf("CAD is non-negotiable");
    expect(cadRuleIdx).toBeGreaterThan(-1); // rule must exist

    // Look for evaluate-gate anywhere in capo.md — the fix may add it to
    // the Constitution bullet, Standard Dispatch Flow, or Turn-end Protocol.
    const mentionsEvaluateGate = capoMd.includes("evaluate-gate");
    expect(mentionsEvaluateGate).toBe(true);
  });
});

// =============================================================================
// ADDITIONAL BOUNDARY TESTS — SESSION_ID format + WS-04 hedge removal
// =============================================================================

describe("WS-RUNTIME-WIRE — boundary: SESSION_ID variable defined at Step 0", () => {
  // Test 11: SESSION_ID must be defined as ws-<workstream_id>-<unix_ts> in SKILL.md
  //
  // The evaluate-gate calls in MECHANICAL and ARCHITECTURAL tracks must pass a
  // session_id value. The workstream spec defines:
  //   SESSION_ID = ws-<workstream_id>-<unix_ts>  (defined at Step 0)
  // Without this definition in the SKILL.md, teo-build agents will either omit
  // session_id or fabricate an inconsistent format that breaks ledger correlation.
  it("11. SKILL.md defines SESSION_ID as ws-<workstream_id>-<unix_ts> or equivalent", () => {
    // Accept common formulations: the spec may write this as a bash export, an
    // inline variable assignment, or a descriptive prose pattern.
    // The stable assertion is that all three components appear near each other:
    //   "SESSION_ID", "workstream", and a unix timestamp signal ("unix_ts" or "$(date")
    const mentionsSessionId = skillMd.includes("SESSION_ID");
    const mentionsWorkstreamInContext =
      /SESSION_ID.*workstream|workstream.*SESSION_ID/is.test(skillMd);
    const mentionsUnixTs =
      skillMd.includes("unix_ts") ||
      skillMd.includes("$(date") ||
      skillMd.includes("Date.now") ||
      skillMd.includes("unix");

    expect(mentionsSessionId).toBe(true);
    // The format must tie SESSION_ID to the workstream identifier
    expect(mentionsWorkstreamInContext).toBe(true);
    // And to a timestamp component (unix_ts or a shell date invocation)
    expect(mentionsUnixTs).toBe(true);
  });
});

describe("WS-RUNTIME-WIRE — boundary: stale WS-04 hedge removed from capo.md", () => {
  // Test 12: capo.md must NOT contain the stale "engine is wired (WS-04)" hedge
  //
  // Before this workstream, capo.md line ~158 said:
  //   "These identifiers flow into gate results and ledger entries when the engine
  //    is wired (WS-04)."
  // This workstream DOES wire the engine for the non-PLAN_ARTIFACT tracks. Leaving
  // the hedge tells Capo the wiring is aspirational when it is now real. It must
  // be removed (or reworded to remove the deferral signal "when the engine is wired").
  it("12. capo.md does NOT contain the stale 'when the engine is wired (WS-04)' hedge", () => {
    // Match the exact deferral phrase; case-insensitive to survive minor rewording.
    const staleHedge = /when the engine is wired\s*\(WS-04\)/i;
    expect(staleHedge.test(capoMd)).toBe(false);
  });
});

// =============================================================================
// BOUNDARY / REGRESSION GUARDS — pre-existing correct content must not break
// =============================================================================

describe("WS-RUNTIME-WIRE — boundary: pre-existing correct content must survive the fix", () => {
  // Test 9: B2 gate evaluation section (PLAN_ARTIFACT flow) still calls evaluate-gate
  //
  // The PLAN_ARTIFACT flow's B2 section already calls teo-run.js evaluate-gate.
  // The fix must NOT touch or remove this — it's the reference implementation.
  it("9. B2 Gate evaluation section (PLAN_ARTIFACT flow) still references teo-run.js evaluate-gate", () => {
    const b2Section = extractSection(skillMd, "**B2. Gate evaluation (only when `task.gates` is non-empty):**");
    // extractSection uses heading-level matching; B2 is a bold paragraph not a heading.
    // Fall back to searching the PLAN_ARTIFACT flow block directly.
    const planArtifactFlowIdx = skillMd.indexOf("## PLAN_ARTIFACT Flow");
    const step0Idx = skillMd.indexOf("## Step 0: Classify at Intake");
    const planArtifactSection =
      planArtifactFlowIdx !== -1 && step0Idx !== -1
        ? skillMd.slice(planArtifactFlowIdx, step0Idx)
        : skillMd;

    expect(planArtifactSection).toContain("teo-run.js evaluate-gate");
    expect(planArtifactSection).toContain("gate_id");
    expect(planArtifactSection).toContain("task_id");
    expect(planArtifactSection).toContain("session_id");
    expect(planArtifactSection).toContain("gate_type");
  });

  // Test 10: gate_type values used in SKILL.md are only from the known allowed set
  //
  // teo-run-entry.ts rejects unknown gate_types with exit code 1. Any concrete
  // gate_type literal in SKILL.md must be one of: "acceptance-criteria", "qa-spec",
  // "dev", "staff-review". Template placeholders like "<gate.name>" are excluded —
  // those are expanded at runtime, not literals. This test guards against future
  // edits that introduce a typo (e.g. "staff_review") that the CLI would silently
  // reject at runtime.
  it("10. all concrete gate_type literals in SKILL.md are from the known allowed set", () => {
    // Extract every quoted "gate_type":"<value>" pair. Exclude template placeholder
    // values that start with '<' (e.g. "<gate.name>") — those are runtime-expanded.
    const quotedPattern = /"gate_type"\s*:\s*"([^"]+)"/g;
    const usedTypes = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = quotedPattern.exec(skillMd)) !== null) {
      const value = match[1]!;
      // Skip template placeholders — they are expanded at Task() spawn time
      if (!value.startsWith("<")) {
        usedTypes.add(value);
      }
    }

    // After the fix, the MECHANICAL and ARCHITECTURAL sections will add concrete
    // gate_type literals ("dev", "qa-spec", "staff-review"). Before the fix this
    // set may be empty (B2 only uses the placeholder "<gate.name>").
    // Only assert on the KNOWN constraint when concrete literals are present.
    if (usedTypes.size > 0) {
      for (const used of usedTypes) {
        expect(KNOWN_GATE_TYPES as readonly string[]).toContain(used);
      }
    }

    // The B2 template placeholder must still exist (regression: B2 not accidentally
    // replaced with a hard-coded value that breaks the PLAN_ARTIFACT dynamic flow)
    expect(skillMd).toContain('"gate_type":"<gate.name>"');
  });
});
