import { describe, it, expect } from "vitest";
import { validatePlan } from "./validate.js";
import type { Plan, TEOTask } from "./plan.js";

// =============================================================================
// validate.test.ts — exhaustive tests for src/core/validate.ts (WS-CORE-02)
//
// Ordering: misuse → boundary → golden path (per ADR-064 critical-path policy)
//
// validate.ts owns cross-task integrity checks that the Zod schema deliberately
// defers: unique IDs, needs-ref resolution, cycle detection, plan-quality gate.
// =============================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScriptTask(
  id: string,
  needs: string[] = [],
  overrides: Partial<TEOTask> = {}
): TEOTask {
  return {
    id,
    type: "SCRIPT",
    command: `run-${id}`,
    needs,
    gates: [],
    ...overrides,
  } as TEOTask;
}

function makeAgentTask(
  id: string,
  agentId: string,
  needs: string[] = [],
  overrides: Partial<TEOTask> = {}
): TEOTask {
  return {
    id,
    type: "AGENT",
    agent_id: agentId,
    prompt: `Do work for ${id}`,
    needs,
    gates: [],
    ...overrides,
  } as TEOTask;
}

function minimalValidPlan(tasks: TEOTask[]): Plan {
  return {
    plan_id: "plan-test",
    project_id: "proj-test",
    created_at: "2026-06-18T00:00:00Z",
    version: "1",
    tasks,
  };
}

// ---------------------------------------------------------------------------
// MISUSE — empty / degenerate inputs
// ---------------------------------------------------------------------------

describe("validatePlan — misuse: structural errors", () => {
  it("returns an error and does not crash when tasks[] is empty", () => {
    // The Zod schema rejects empty tasks[], but validatePlan receives Plan objects
    // that have already been parsed. Construct one directly to test defensive behavior.
    const plan = minimalValidPlan([]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.code).toBe("EMPTY_TASKS");
  });

  it("returns an error for duplicate task IDs, naming the duplicate", () => {
    const plan = minimalValidPlan([
      makeScriptTask("task-A"),
      makeAgentTask("task-A", "eng"), // duplicate ID
    ]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const dupError = result.errors.find((e) => e.code === "DUPLICATE_TASK_ID");
    expect(dupError).toBeDefined();
    expect(dupError?.message).toContain("task-A");
  });

  it("returns an error when needs[] references a nonexistent task ID", () => {
    const plan = minimalValidPlan([makeScriptTask("task-A", ["does-not-exist"])]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const refError = result.errors.find((e) => e.code === "UNRESOLVED_NEEDS_REF");
    expect(refError).toBeDefined();
    expect(refError?.message).toContain("does-not-exist");
  });

  it("returns a cycle error for a 3-node cycle A→B→C→A, including all three IDs in the path", () => {
    const plan = minimalValidPlan([
      makeScriptTask("A", ["C"]),
      makeScriptTask("B", ["A"]),
      makeScriptTask("C", ["B"]),
    ]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const cycleError = result.errors.find((e) => e.code === "DEPENDENCY_CYCLE");
    expect(cycleError).toBeDefined();
    // All three IDs must appear in the cycle path
    expect(cycleError?.message).toContain("A");
    expect(cycleError?.message).toContain("B");
    expect(cycleError?.message).toContain("C");
  });

  it("returns a cycle error for a 2-node mutual dependency A↔B", () => {
    const plan = minimalValidPlan([makeScriptTask("A", ["B"]), makeScriptTask("B", ["A"])]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const cycleError = result.errors.find((e) => e.code === "DEPENDENCY_CYCLE");
    expect(cycleError).toBeDefined();
    expect(cycleError?.message).toContain("A");
    expect(cycleError?.message).toContain("B");
  });

  it("returns a cycle error when a task depends on itself (self-loop)", () => {
    const plan = minimalValidPlan([makeScriptTask("solo", ["solo"])]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const cycleError = result.errors.find((e) => e.code === "DEPENDENCY_CYCLE");
    expect(cycleError).toBeDefined();
    expect(cycleError?.message).toContain("solo");
  });

  it("PQ-03: returns an error (not just a warning) when agent_id is 'sage'", () => {
    const plan = minimalValidPlan([makeAgentTask("task-sage", "sage")]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const pq03Error = result.errors.find((e) => e.code === "PQ_03_SAGE_AS_EXECUTOR");
    expect(pq03Error).toBeDefined();
    expect(pq03Error?.message).toContain("sage");
  });
});

// ---------------------------------------------------------------------------
// MISUSE — gates[] referential integrity
// ---------------------------------------------------------------------------

describe("validatePlan — misuse: gates[] resolution", () => {
  it("returns an error when a gate name is empty", () => {
    // Gates with empty names are structurally invalid
    const taskWithEmptyGateName = {
      ...makeScriptTask("task-A"),
      gates: [{ name: "", on_fail: "block" as const }],
    };
    const plan = minimalValidPlan([taskWithEmptyGateName]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const gateError = result.errors.find((e) => e.code === "INVALID_GATE_REF");
    expect(gateError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — error accumulation (no short-circuit)
// ---------------------------------------------------------------------------

describe("validatePlan — boundary: error accumulation", () => {
  it("collects BOTH a cycle error AND a duplicate ID error — no short-circuit", () => {
    // task-X and task-Y are duplicates; task-A→B→A is a cycle
    const plan = minimalValidPlan([
      makeScriptTask("task-X"),
      makeScriptTask("task-X"), // duplicate
      makeScriptTask("task-A", ["task-B"]),
      makeScriptTask("task-B", ["task-A"]), // cycle
    ]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("DUPLICATE_TASK_ID");
    expect(codes).toContain("DEPENDENCY_CYCLE");
  });

  it("collects multiple distinct unresolved needs refs across different tasks", () => {
    const plan = minimalValidPlan([
      makeScriptTask("real-task"),
      makeScriptTask("task-A", ["ghost-1"]),
      makeScriptTask("task-B", ["ghost-2"]),
    ]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const refErrors = result.errors.filter((e) => e.code === "UNRESOLVED_NEEDS_REF");
    expect(refErrors.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — plan-quality gate warnings (PQ-01, PQ-02)
// ---------------------------------------------------------------------------

describe("validatePlan — boundary: plan-quality gate", () => {
  it("PQ-01: emits a warning (not an error) for a single-task plan — valid:true", () => {
    const plan = minimalValidPlan([makeScriptTask("only-task")]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    const pq01 = result.warnings.find((w) => w.code === "PQ_01_SINGLE_TASK");
    expect(pq01).toBeDefined();
  });

  it("PQ-02: emits a warning for a plan with 26 tasks — valid:true", () => {
    const tasks = Array.from({ length: 26 }, (_, i) => makeScriptTask(`task-${i}`));
    const plan = minimalValidPlan(tasks);
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    const pq02 = result.warnings.find((w) => w.code === "PQ_02_TOO_MANY_TASKS");
    expect(pq02).toBeDefined();
  });

  it("PQ-02: does NOT warn at exactly 25 tasks", () => {
    const tasks = Array.from({ length: 25 }, (_, i) => makeScriptTask(`task-${i}`));
    const plan = minimalValidPlan(tasks);
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    const pq02 = result.warnings.find((w) => w.code === "PQ_02_TOO_MANY_TASKS");
    expect(pq02).toBeUndefined();
  });

  it("PQ-01: does NOT warn for a 2-task plan (boundary at < 2)", () => {
    const plan = minimalValidPlan([makeScriptTask("task-A"), makeScriptTask("task-B", ["task-A"])]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    const pq01 = result.warnings.find((w) => w.code === "PQ_01_SINGLE_TASK");
    expect(pq01).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — valid plans
// ---------------------------------------------------------------------------

describe("validatePlan — golden path", () => {
  it("returns valid:true, no errors, no warnings for a clean multi-task DAG", () => {
    //  task-A → task-B → task-C
    const plan = minimalValidPlan([
      makeScriptTask("task-A"),
      makeScriptTask("task-B", ["task-A"]),
      makeAgentTask("task-C", "eng", ["task-B"]),
    ]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns valid:true for a diamond DAG (task-D depends on B and C, both depend on A)", () => {
    const plan = minimalValidPlan([
      makeScriptTask("task-A"),
      makeScriptTask("task-B", ["task-A"]),
      makeScriptTask("task-C", ["task-A"]),
      makeAgentTask("task-D", "qa", ["task-B", "task-C"]),
    ]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid:true for a plan with valid gates on tasks", () => {
    const taskWithGate = {
      ...makeScriptTask("task-A"),
      gates: [{ name: "security", on_fail: "block" as const }],
    };
    const plan = minimalValidPlan([taskWithGate, makeScriptTask("task-B", ["task-A"])]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns a ValidationResult object with the correct shape", () => {
    const plan = minimalValidPlan([makeScriptTask("task-A"), makeScriptTask("task-B")]);
    const result = validatePlan(plan);
    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("errors");
    expect(result).toHaveProperty("warnings");
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("validatePlan is synchronous — return value is not a Promise", () => {
    const plan = minimalValidPlan([makeScriptTask("task-A"), makeScriptTask("task-B")]);
    const result = validatePlan(plan);
    // If it were a Promise, it would not have a `valid` property directly.
    expect(typeof result.valid).toBe("boolean");
    expect(result).not.toBeInstanceOf(Promise);
  });
});

// ---------------------------------------------------------------------------
// WS-P1-01: PQ-04 — ARCHITECTURAL plan detection (INTENTIONALLY FAILING until
// dev implements:
//   1. directive: z.enum([...]).optional() on PlanSchema in plan.ts
//   2. Real PQ-04 check in validate.ts that keys off plan.directive === "ARCHITECTURAL"
//      AND checks that at least one task has agent_id "qa" or "staff-engineer"
// ---------------------------------------------------------------------------

describe("validatePlan — PQ-04: ARCHITECTURAL directive misuse (WS-P1-01)", () => {
  it("PQ-04 misuse: directive:'ARCHITECTURAL' + sage task → BOTH PQ_03_SAGE_AS_EXECUTOR error AND PQ_04_ARCHITECTURAL_SCOPE warning", () => {
    // Sage-as-executor is always an ERROR (PQ-03). When the plan is also
    // ARCHITECTURAL, PQ-04 must fire as a WARNING on top of that — the
    // two rules are independent and must both accumulate.
    //
    // FAILS NOW because:
    //   - plan.directive is not a recognised schema field — validate.ts cannot
    //     read it as a typed property, so PQ-04 never fires via the schema path.
    //   - The existing defensive runtime guard DOES fire (it checks "directive" in plan),
    //     but it does NOT check for the qa/staff-engineer gate condition, so the
    //     new implementation must change the guard's semantics. See validate.ts TODO.
    const plan = {
      ...minimalValidPlan([makeAgentTask("sage-task", "sage")]),
      directive: "ARCHITECTURAL",
    } as unknown as Plan;

    const result = validatePlan(plan);

    // PQ-03 must be an ERROR (plan is invalid)
    expect(result.valid).toBe(false);
    const pq03 = result.errors.find((e) => e.code === "PQ_03_SAGE_AS_EXECUTOR");
    expect(pq03).toBeDefined();
    expect(pq03?.message).toContain("sage");

    // PQ-04 must ALSO be present as a WARNING (no qa/staff-engineer task)
    const pq04 = result.warnings.find((w) => w.code === "PQ_04_ARCHITECTURAL_SCOPE");
    expect(pq04).toBeDefined();
  });
});

describe("validatePlan — PQ-04: ARCHITECTURAL directive boundary (WS-P1-01)", () => {
  it("PQ-04 boundary: no directive field → PQ-04 warning must NOT fire", () => {
    // A plain plan with no directive must never emit PQ_04_ARCHITECTURAL_SCOPE.
    // This guards against regressions where the check fires unconditionally.
    // PASSES NOW (existing defensive check requires "directive" in plan), but
    // we assert it explicitly so dev cannot accidentally break this invariant.
    const plan = minimalValidPlan([makeScriptTask("task-A"), makeScriptTask("task-B")]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    const pq04 = result.warnings.find((w) => w.code === "PQ_04_ARCHITECTURAL_SCOPE");
    expect(pq04).toBeUndefined();
  });

  it("PQ-04 boundary: directive:'ARCHITECTURAL' WITH a qa task → NO PQ-04 warning", () => {
    // The qa agent satisfies the review requirement — PQ-04 must not fire.
    // FAILS NOW: the current defensive runtime guard fires unconditionally when
    // directive === "ARCHITECTURAL", regardless of task composition.
    const plan = {
      ...minimalValidPlan([makeScriptTask("task-A"), makeAgentTask("qa-task", "qa", ["task-A"])]),
      directive: "ARCHITECTURAL",
    } as unknown as Plan;

    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    const pq04 = result.warnings.find((w) => w.code === "PQ_04_ARCHITECTURAL_SCOPE");
    expect(pq04).toBeUndefined();
  });

  it("PQ-04 boundary: directive:'ARCHITECTURAL' WITH a staff-engineer task → NO PQ-04 warning", () => {
    // The staff-engineer agent satisfies the review requirement — PQ-04 must not fire.
    // FAILS NOW: same reason as the qa-task boundary above.
    const plan = {
      ...minimalValidPlan([
        makeScriptTask("task-A"),
        makeAgentTask("review-task", "staff-engineer", ["task-A"]),
      ]),
      directive: "ARCHITECTURAL",
    } as unknown as Plan;

    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    const pq04 = result.warnings.find((w) => w.code === "PQ_04_ARCHITECTURAL_SCOPE");
    expect(pq04).toBeUndefined();
  });
});

describe("validatePlan — PQ-04: ARCHITECTURAL directive golden path (WS-P1-01)", () => {
  it("PQ-04 golden: directive:'ARCHITECTURAL' with no qa/staff-engineer task → exactly one PQ_04_ARCHITECTURAL_SCOPE warning, valid:true", () => {
    // This is the core PQ-04 contract:
    //   - ARCHITECTURAL plan + no qa or staff-engineer executor = WARNING
    //   - Warning is non-blocking — valid:true
    //   - Exactly ONE warning with the exact code "PQ_04_ARCHITECTURAL_SCOPE"
    //
    // FAILS NOW: the current defensive runtime guard in validate.ts fires here
    // (correct code, correct valid:true), BUT it does not enforce the
    // qa/staff-engineer condition — so the boundary tests above also incorrectly
    // pass through. Dev must rewrite the guard to check task composition.
    const plan = {
      ...minimalValidPlan([makeScriptTask("task-A"), makeAgentTask("eng-task", "eng", ["task-A"])]),
      directive: "ARCHITECTURAL",
    } as unknown as Plan;

    const result = validatePlan(plan);

    // Must be valid — PQ-04 is a warning, not an error
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);

    // Exactly the right warning code — dev must use this exact string
    const pq04Warnings = result.warnings.filter((w) => w.code === "PQ_04_ARCHITECTURAL_SCOPE");
    expect(pq04Warnings).toHaveLength(1);
    expect(pq04Warnings[0]?.code).toBe("PQ_04_ARCHITECTURAL_SCOPE");
  });

  it("PQ-04 golden: directive:'BUILD' → PQ-04 does NOT fire regardless of task composition", () => {
    // PQ-04 is exclusive to ARCHITECTURAL — no other directive value triggers it.
    // FAILS NOW for the same reason the directive round-trip tests fail:
    // the field isn't typed on Plan, but the runtime guard only checks === "ARCHITECTURAL",
    // so this case happens to pass currently. We assert it explicitly to lock the contract.
    const plan = {
      ...minimalValidPlan([makeScriptTask("task-A"), makeAgentTask("eng-task", "eng")]),
      directive: "BUILD",
    } as unknown as Plan;

    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    const pq04 = result.warnings.find((w) => w.code === "PQ_04_ARCHITECTURAL_SCOPE");
    expect(pq04).toBeUndefined();
  });
});
