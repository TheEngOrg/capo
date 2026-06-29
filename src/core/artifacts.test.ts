// =============================================================================
// artifacts.test.ts — WS-00: artifact schema layer + repairJson() helper
//
// STATUS: PASSING — src/core/artifacts.ts implemented (WS-00) + evidence/artifact fields added.

//
// Ordering: misuse → boundary → golden path (ADR-064 adversarial-first policy)
//
// Tested surface:
//   - repairJson(raw: string) → string  (fault-tolerant JSON repair)
//   - validateArtifact({ type, payload, strict? }) → { valid: boolean, errors?: string[] }
//   - GATE_RESULT_ARTIFACT schema
//   - STEP_RESULT_ARTIFACT schema
//   - PLAN_ARTIFACT schema (wraps existing PlanSchema)
// =============================================================================

import { describe, it, expect } from "vitest";
import { repairJson, validateArtifact } from "./artifacts.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const VALID_PLAN_PAYLOAD = {
  plan_id: "test-plan-1",
  project_id: "test-project",
  created_at: "2026-06-20T00:00:00.000Z",
  version: "1",
  tasks: [
    {
      id: "task-1",
      type: "SCRIPT",
      command: "echo hello",
      needs: [],
      gates: [],
    },
  ],
};

const VALID_GATE_RESULT = {
  task_id: "task-1",
  gate_name: "coverage",
  verdict: "PASS" as const,
  timestamp: "2026-06-20T00:00:00.000Z",
};

const VALID_STEP_RESULT = {
  task_id: "task-1",
  status: "COMPLETED" as const,
  agent_id: "eng",
  timestamp: "2026-06-20T00:00:00.000Z",
};

// =============================================================================
// MISUSE: repairJson() — wrong / unexpected raw strings
// =============================================================================

describe("repairJson() — misuse", () => {
  // M-R1: completely non-JSON input that repair cannot salvage → throws or returns
  // a string that JSON.parse will reject. The contract is that repairJson() must
  // NOT silently return a valid-looking value for garbage that is not repairable.
  it("M-R1. completely unparseable garbage → repairJson throws or result fails JSON.parse", () => {
    let result: unknown;
    let threw = false;
    try {
      result = repairJson("%%%not json at all%%%");
    } catch {
      threw = true;
    }
    if (!threw) {
      // If it didn't throw, the returned string must not parse as valid JSON
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      expect(() => JSON.parse(result as string)).toThrow();
    }
    // Either path satisfies the fail-closed contract
    expect(threw || true).toBe(true);
  });

  // M-R2: empty string → must not silently produce a valid JSON value
  it("M-R2. empty string input → repairJson throws or returns unparseable result", () => {
    let threw = false;
    let result: unknown;
    try {
      result = repairJson("");
    } catch {
      threw = true;
    }
    if (!threw) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      expect(() => JSON.parse(result as string)).toThrow();
    }
    expect(threw || true).toBe(true);
  });

  // M-R3: numeric-only string is valid JSON — repair must return it faithfully
  it("M-R3. numeric string '42' → repairJson returns string that JSON.parse treats as 42", () => {
    const result = repairJson("42");
    expect(JSON.parse(result as string)).toBe(42);
  });
});

// =============================================================================
// MISUSE: validateArtifact() — misuse paths
// =============================================================================

describe("validateArtifact() — misuse", () => {
  // M-VA1: unknown artifact type → { valid: false } with descriptive error, no throw
  it("M-VA1. unknown type 'BOGUS_ARTIFACT' → { valid: false, errors: [mentions 'unknown artifact type'] }", () => {
    const result = validateArtifact({ type: "BOGUS_ARTIFACT", payload: {} });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors!.some((e) => /unknown artifact type/i.test(e))).toBe(true);
  });

  // M-VA2: unknown type error must contain the bad type name
  it("M-VA2. unknown type error message contains the offending type string", () => {
    const result = validateArtifact({ type: "TOTALLY_MADE_UP", payload: {} });

    expect(result.valid).toBe(false);
    expect(result.errors!.some((e) => e.includes("TOTALLY_MADE_UP"))).toBe(true);
  });

  // M-VA3: null payload → { valid: false }, must NOT throw
  it("M-VA3. null payload for GATE_RESULT_ARTIFACT → { valid: false }, no throw", () => {
    expect(() => {
      const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload: null });
      expect(result.valid).toBe(false);
    }).not.toThrow();
  });

  // M-VA4: GATE_RESULT_ARTIFACT missing task_id → { valid: false }
  it("M-VA4. GATE_RESULT_ARTIFACT missing task_id → { valid: false, errors: [...] }", () => {
    const payload = {
      gate_name: "coverage",
      verdict: "PASS",
      timestamp: "2026-06-20T00:00:00.000Z",
    };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  // M-VA5: GATE_RESULT_ARTIFACT with verdict "UNENFORCED_MOCK" → VALID (legal verdict)
  // CRITICAL anti-regression: dev must NOT treat UNENFORCED_MOCK as an error.
  it("M-VA5. GATE_RESULT_ARTIFACT with verdict 'UNENFORCED_MOCK' → { valid: true } (legal verdict)", () => {
    const payload = {
      task_id: "task-1",
      gate_name: "coverage",
      verdict: "UNENFORCED_MOCK",
      timestamp: "2026-06-20T00:00:00.000Z",
    };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(true);
  });

  // M-VA6: GATE_RESULT_ARTIFACT with invalid verdict string → { valid: false }
  it("M-VA6. GATE_RESULT_ARTIFACT with verdict 'INVALID_VERDICT' → { valid: false }", () => {
    const payload = {
      task_id: "task-1",
      gate_name: "coverage",
      verdict: "INVALID_VERDICT",
      timestamp: "2026-06-20T00:00:00.000Z",
    };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(false);
  });

  // M-VA7: GATE_RESULT_ARTIFACT missing gate_name → { valid: false }
  it("M-VA7. GATE_RESULT_ARTIFACT missing gate_name → { valid: false }", () => {
    const payload = { task_id: "task-1", verdict: "PASS", timestamp: "2026-06-20T00:00:00.000Z" };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(false);
  });

  // M-VA8: STEP_RESULT_ARTIFACT with status "RUNNING" (not in enum) → { valid: false }
  it("M-VA8. STEP_RESULT_ARTIFACT with status 'RUNNING' (illegal) → { valid: false }", () => {
    const payload = { task_id: "task-1", status: "RUNNING", timestamp: "2026-06-20T00:00:00.000Z" };
    const result = validateArtifact({ type: "STEP_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(false);
  });

  // M-VA9: PLAN_ARTIFACT missing plan_id → { valid: false }
  it("M-VA9. PLAN_ARTIFACT missing plan_id → { valid: false, errors: [...] }", () => {
    const payload = {
      project_id: "proj",
      created_at: "2026-06-20T00:00:00.000Z",
      version: "1",
      tasks: [{ id: "t1", type: "SCRIPT", command: "echo", needs: [], gates: [] }],
    };
    const result = validateArtifact({ type: "PLAN_ARTIFACT", payload });

    expect(result.valid).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  // M-VA10: strict: true with extra field → { valid: false }
  it("M-VA10. strict: true + GATE_RESULT_ARTIFACT with extra field 'extra_field' → { valid: false }", () => {
    const payload = {
      ...VALID_GATE_RESULT,
      extra_field: "should not be here",
    };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload, strict: true });

    expect(result.valid).toBe(false);
  });
});

// =============================================================================
// BOUNDARY: repairJson() — specific repair transformations
// =============================================================================

describe("repairJson() — boundary: specific repair transformations", () => {
  // B-R1: trailing comma in object → repaired result parses as expected object
  it("B-R1. trailing comma in object: '{\"a\": 1,}' → parses as { a: 1 }", () => {
    const result = repairJson('{"a": 1,}');
    expect(JSON.parse(result as string)).toEqual({ a: 1 });
  });

  // B-R2: trailing comma in array → repaired result parses as expected array
  it("B-R2. trailing comma in array: '[1, 2, 3,]' → parses as [1, 2, 3]", () => {
    const result = repairJson("[1, 2, 3,]");
    expect(JSON.parse(result as string)).toEqual([1, 2, 3]);
  });

  // B-R3: single-quoted strings → repaired result parses with double-quoted values
  it("B-R3. single-quoted strings: \"{'a': 'b'}\" → parses as { a: 'b' }", () => {
    const result = repairJson("{'a': 'b'}");
    expect(JSON.parse(result as string)).toEqual({ a: "b" });
  });

  // B-R4: unclosed object → best-effort close, result is parseable
  it("B-R4. unclosed object brace: '{\"a\": 1' → result is parseable JSON (best-effort close)", () => {
    const result = repairJson('{"a": 1');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    expect(() => JSON.parse(result as string)).not.toThrow();
    expect(JSON.parse(result as string)).toMatchObject({ a: 1 });
  });

  // B-R5: unclosed array → best-effort close, result is parseable
  it("B-R5. unclosed array bracket: '[1, 2' → result is parseable JSON (best-effort close)", () => {
    const result = repairJson("[1, 2");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    expect(() => JSON.parse(result as string)).not.toThrow();
    const parsed = JSON.parse(result as string) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain(1);
    expect(parsed).toContain(2);
  });

  // B-R6: already-valid JSON → passes through unchanged
  it("B-R6. already-valid JSON passes through: result parses as original value", () => {
    const input = JSON.stringify({ x: 42, y: [1, 2, 3] });
    const result = repairJson(input);
    expect(JSON.parse(result as string)).toEqual({ x: 42, y: [1, 2, 3] });
  });

  // B-R7: trailing comma + single-quoted combo
  it("B-R7. combined: single-quoted key with trailing comma: \"{'key': 'val',}\" → parses as { key: 'val' }", () => {
    const result = repairJson("{'key': 'val',}");
    expect(JSON.parse(result as string)).toEqual({ key: "val" });
  });
});

// =============================================================================
// BOUNDARY: validateArtifact() — edge cases
// =============================================================================

describe("validateArtifact() — boundary", () => {
  // B-VA1: PLAN_ARTIFACT with valid plan → { valid: true }
  it("B-VA1. PLAN_ARTIFACT wrapping a valid plan → { valid: true }", () => {
    const result = validateArtifact({ type: "PLAN_ARTIFACT", payload: VALID_PLAN_PAYLOAD });

    expect(result.valid).toBe(true);
  });

  // B-VA2: PLAN_ARTIFACT with invalid plan (missing tasks) → { valid: false, errors: [...] }
  it("B-VA2. PLAN_ARTIFACT with plan missing tasks → { valid: false, errors: [...] }", () => {
    const badPlan = {
      plan_id: "p1",
      project_id: "proj",
      created_at: "2026-06-20T00:00:00.000Z",
      version: "1",
      // tasks: omitted intentionally — required, min 1
    };
    const result = validateArtifact({ type: "PLAN_ARTIFACT", payload: badPlan });

    expect(result.valid).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  // B-VA3: GATE_RESULT_ARTIFACT — all legal verdicts are valid
  it("B-VA3a. GATE_RESULT_ARTIFACT — PASS verdict → { valid: true }", () => {
    const result = validateArtifact({
      type: "GATE_RESULT_ARTIFACT",
      payload: { ...VALID_GATE_RESULT, verdict: "PASS" },
    });
    expect(result.valid).toBe(true);
  });

  it("B-VA3b. GATE_RESULT_ARTIFACT — FAIL verdict → { valid: true }", () => {
    const result = validateArtifact({
      type: "GATE_RESULT_ARTIFACT",
      payload: { ...VALID_GATE_RESULT, verdict: "FAIL" },
    });
    expect(result.valid).toBe(true);
  });

  it("B-VA3c. GATE_RESULT_ARTIFACT — WARN verdict → { valid: true }", () => {
    const result = validateArtifact({
      type: "GATE_RESULT_ARTIFACT",
      payload: { ...VALID_GATE_RESULT, verdict: "WARN" },
    });
    expect(result.valid).toBe(true);
  });

  it("B-VA3d. GATE_RESULT_ARTIFACT — UNENFORCED_MOCK verdict → { valid: true }", () => {
    const result = validateArtifact({
      type: "GATE_RESULT_ARTIFACT",
      payload: { ...VALID_GATE_RESULT, verdict: "UNENFORCED_MOCK" },
    });
    expect(result.valid).toBe(true);
  });

  // B-VA4: STEP_RESULT_ARTIFACT without optional agent_id → { valid: true }
  it("B-VA4. STEP_RESULT_ARTIFACT without optional agent_id → { valid: true }", () => {
    const payload = {
      task_id: "task-1",
      status: "COMPLETED",
      timestamp: "2026-06-20T00:00:00.000Z",
    };
    const result = validateArtifact({ type: "STEP_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(true);
  });

  // B-VA5: STEP_RESULT_ARTIFACT with all three valid status values
  it("B-VA5a. STEP_RESULT_ARTIFACT — COMPLETED → { valid: true }", () => {
    const result = validateArtifact({
      type: "STEP_RESULT_ARTIFACT",
      payload: { ...VALID_STEP_RESULT, status: "COMPLETED" },
    });
    expect(result.valid).toBe(true);
  });

  it("B-VA5b. STEP_RESULT_ARTIFACT — FAILED → { valid: true }", () => {
    const result = validateArtifact({
      type: "STEP_RESULT_ARTIFACT",
      payload: { ...VALID_STEP_RESULT, status: "FAILED" },
    });
    expect(result.valid).toBe(true);
  });

  it("B-VA5c. STEP_RESULT_ARTIFACT — SKIPPED → { valid: true }", () => {
    const result = validateArtifact({
      type: "STEP_RESULT_ARTIFACT",
      payload: { ...VALID_STEP_RESULT, status: "SKIPPED" },
    });
    expect(result.valid).toBe(true);
  });

  // B-VA6: strict: false (default) with extra fields → { valid: true } (non-strict allows extras)
  it("B-VA6. strict: false (default) + GATE_RESULT_ARTIFACT with extra field → { valid: true }", () => {
    const payload = { ...VALID_GATE_RESULT, extra_field: "ignored" };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload, strict: false });

    expect(result.valid).toBe(true);
  });

  // B-VA7: strict: true with no extra fields → { valid: true }
  it("B-VA7. strict: true + GATE_RESULT_ARTIFACT with no extra fields → { valid: true }", () => {
    const result = validateArtifact({
      type: "GATE_RESULT_ARTIFACT",
      payload: VALID_GATE_RESULT,
      strict: true,
    });

    expect(result.valid).toBe(true);
  });

  // B-VA8: errors field absent or empty when valid: true
  it("B-VA8. successful validation → errors field absent or empty array", () => {
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload: VALID_GATE_RESULT });

    expect(result.valid).toBe(true);
    if (result.errors !== undefined) {
      expect(result.errors).toHaveLength(0);
    }
  });

  // B-VA9: strict: true with STEP_RESULT_ARTIFACT + extra field → { valid: false }
  it("B-VA9. strict: true + STEP_RESULT_ARTIFACT with extra field → { valid: false }", () => {
    const payload = { ...VALID_STEP_RESULT, extra_field: "should not be here" };
    const result = validateArtifact({ type: "STEP_RESULT_ARTIFACT", payload, strict: true });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  // B-VA10: strict: true with PLAN_ARTIFACT + extra field → { valid: false }
  it("B-VA10. strict: true + PLAN_ARTIFACT with extra field → { valid: false }", () => {
    const payload = { ...VALID_PLAN_PAYLOAD, extra_field: "should not be here" };
    const result = validateArtifact({ type: "PLAN_ARTIFACT", payload, strict: true });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });
});

// =============================================================================
// GOLDEN PATH: full round-trip
// =============================================================================

describe("repairJson() + validateArtifact() — golden path round-trip", () => {
  // G1: raw JSON with trailing comma → repair → validate GATE_RESULT → { valid: true }
  it("G1. trailing-comma gate-result JSON → repair → validateArtifact → { valid: true }", () => {
    const rawJson =
      '{"task_id": "task-1", "gate_name": "coverage", "verdict": "PASS", "timestamp": "2026-06-20T00:00:00.000Z",}';

    const repairedStr = repairJson(rawJson);
    const payload = JSON.parse(repairedStr as string) as unknown;
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(true);
  });

  // G2: raw JSON with single-quoted strings → repair → validate STEP_RESULT → { valid: true }
  it("G2. single-quoted step-result JSON → repair → validateArtifact → { valid: true }", () => {
    const rawJson =
      "{'task_id': 'task-1', 'status': 'COMPLETED', 'timestamp': '2026-06-20T00:00:00.000Z'}";

    const repairedStr = repairJson(rawJson);
    const payload = JSON.parse(repairedStr as string) as unknown;
    const result = validateArtifact({ type: "STEP_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(true);
  });

  // G3: valid PLAN_ARTIFACT full round-trip — no repair needed, just schema validation
  it("G3. valid PLAN_ARTIFACT → validateArtifact → { valid: true }", () => {
    const result = validateArtifact({ type: "PLAN_ARTIFACT", payload: VALID_PLAN_PAYLOAD });
    expect(result.valid).toBe(true);
  });

  // G4: UNENFORCED_MOCK validates successfully end-to-end (golden path confirmation)
  it("G4. GATE_RESULT_ARTIFACT with UNENFORCED_MOCK verdict validates successfully end-to-end", () => {
    const raw = JSON.stringify({
      task_id: "task-unenforced",
      gate_name: "coverage-mock",
      verdict: "UNENFORCED_MOCK",
      timestamp: "2026-06-20T00:00:00.000Z",
    });
    const repairedStr = repairJson(raw);
    const payload = JSON.parse(repairedStr as string) as unknown;
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// AC_ARTIFACT schema — WS-06: added to artifacts.ts; coverage gate requires tests
// =============================================================================

describe("validateArtifact() — AC_ARTIFACT (WS-06)", () => {
  // M: misuse — missing required field
  it("M-AC1. AC_ARTIFACT missing workstream → { valid: false }", () => {
    const result = validateArtifact({
      type: "AC_ARTIFACT",
      payload: { acs: [{ id: "AC-1", description: "test" }] },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("M-AC2. AC_ARTIFACT missing acs → { valid: false }", () => {
    const result = validateArtifact({
      type: "AC_ARTIFACT",
      payload: { workstream: "ws-06" },
    });
    expect(result.valid).toBe(false);
  });

  it("M-AC3. AC_ARTIFACT ac item missing description → { valid: false }", () => {
    const result = validateArtifact({
      type: "AC_ARTIFACT",
      payload: { workstream: "ws-06", acs: [{ id: "AC-1" }] },
    });
    expect(result.valid).toBe(false);
  });

  // B: boundary — strict mode rejects extra fields
  it("B-AC1. AC_ARTIFACT strict=true with extra top-level field → { valid: false }", () => {
    const result = validateArtifact({
      type: "AC_ARTIFACT",
      payload: { workstream: "ws-06", acs: [], extra_field: "should-be-rejected" },
      strict: true,
    });
    expect(result.valid).toBe(false);
  });

  // G: golden path
  it("G-AC1. AC_ARTIFACT valid payload → { valid: true }", () => {
    const result = validateArtifact({
      type: "AC_ARTIFACT",
      payload: {
        workstream: "ws-06",
        acs: [
          { id: "AC-1", description: "Gate returns ENFORCED status" },
          { id: "AC-2", description: "Unknown gate_type returns exit 1 error" },
        ],
      },
    });
    expect(result.valid).toBe(true);
  });

  it("G-AC2. AC_ARTIFACT empty acs array → { valid: true }", () => {
    const result = validateArtifact({
      type: "AC_ARTIFACT",
      payload: { workstream: "ws-06", acs: [] },
    });
    expect(result.valid).toBe(true);
  });
});

// === EVIDENCE + ARTIFACT FIELDS (new) ===
// Tests for the two new optional fields added to GateResultArtifactSchema:
//   evidence: z.string().optional()
//   artifact: z.string().optional()
//
// Ordering: misuse → boundary → golden path (ADR-064)
// These tests are ADDITIVE — do not modify any existing test above this line.

// =============================================================================
// MISUSE: evidence and artifact type violations
// =============================================================================

describe("validateArtifact() — misuse: evidence + artifact fields", () => {
  // M-EV1: evidence is a number (not a string) → { valid: false }
  it("M-EV1. GATE_RESULT_ARTIFACT with evidence as number → { valid: false }", () => {
    const payload = {
      ...VALID_GATE_RESULT,
      evidence: 42,
    };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  // M-EV2: artifact is a number (not a string) → { valid: false }
  it("M-EV2. GATE_RESULT_ARTIFACT with artifact as number → { valid: false }", () => {
    const payload = {
      ...VALID_GATE_RESULT,
      artifact: 99,
    };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// BOUNDARY: evidence + artifact optional field edge cases
// =============================================================================

describe("validateArtifact() — boundary: evidence + artifact fields", () => {
  // B-EV1: evidence present as string → { valid: true }
  it("B-EV1. GATE_RESULT_ARTIFACT with evidence string → { valid: true }", () => {
    const payload = {
      ...VALID_GATE_RESULT,
      evidence: "coverage check failed, 3 files uncovered",
    };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(true);
  });

  // B-EV2: artifact present as string → { valid: true }
  it("B-EV2. GATE_RESULT_ARTIFACT with artifact string → { valid: true }", () => {
    const payload = {
      ...VALID_GATE_RESULT,
      artifact: "/tmp/gate-run-2026-06-29.json",
    };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(true);
  });

  // B-EV3: both evidence and artifact present → { valid: true }
  it("B-EV3. GATE_RESULT_ARTIFACT with both evidence and artifact → { valid: true }", () => {
    const payload = {
      ...VALID_GATE_RESULT,
      evidence: "coverage check failed, 3 files uncovered",
      artifact: "/tmp/gate-run-2026-06-29.json",
    };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(true);
  });

  // B-EV4: strict: true with evidence + artifact present (no unknown fields) → { valid: true }
  // evidence and artifact are now schema-registered fields — strict must accept them.
  it("B-EV4. strict: true + GATE_RESULT_ARTIFACT with evidence + artifact (no unknowns) → { valid: true }", () => {
    const payload = {
      ...VALID_GATE_RESULT,
      evidence: "coverage check failed, 3 files uncovered",
      artifact: "/tmp/gate-run-2026-06-29.json",
    };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload, strict: true });

    expect(result.valid).toBe(true);
  });

  // B-EV5: strict: true with evidence, artifact, AND an unknown extra_field → { valid: false }
  // Strict mode must still reject true unknowns even when the two new fields are present.
  it("B-EV5. strict: true + GATE_RESULT_ARTIFACT with evidence + artifact + extra_field → { valid: false }", () => {
    const payload = {
      ...VALID_GATE_RESULT,
      evidence: "coverage check failed, 3 files uncovered",
      artifact: "/tmp/gate-run-2026-06-29.json",
      extra_field: "should not be here",
    };
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload, strict: true });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });
});

// =============================================================================
// GOLDEN PATH: evidence + artifact round-trip
// =============================================================================

describe("repairJson() + validateArtifact() — golden path: evidence + artifact", () => {
  // G-EV1: raw JSON string with evidence + artifact → repairJson → validateArtifact → { valid: true }
  it("G-EV1. raw JSON with evidence + artifact → repair → validateArtifact → { valid: true }", () => {
    const rawJson = JSON.stringify({
      task_id: "task-1",
      gate_name: "coverage",
      verdict: "PASS",
      timestamp: "2026-06-20T00:00:00.000Z",
      evidence: "all 142 lines covered",
      artifact: "/tmp/coverage-report-2026-06-29.json",
    });

    const repairedStr = repairJson(rawJson);
    const payload = JSON.parse(repairedStr as string) as unknown;
    const result = validateArtifact({ type: "GATE_RESULT_ARTIFACT", payload });

    expect(result.valid).toBe(true);
  });
});
