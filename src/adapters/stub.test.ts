// =============================================================================
// stub.test.ts — Contract spec for TEOAdapter interface + StubAdapter (WS-P1-03b)
//
// This file specifies the adapter seam contract; the implementation lives in
// ./types.ts (TEOAdapter interface) and ./stub.ts (StubAdapter).
//
// --- ADAPTER SEAM CONTRACT (what ./types.ts must export) ----------------------
//
//   interface PlanningContext {
//     directive?: Plan["directive"];   // BUILD | FIX | REVIEW | PLAN | ARCHITECTURAL
//     project_id: string;
//     description: string;
//   }
//
//   interface AgentContext {
//     planId: string;
//     projectId: string;
//     stepTimeoutMs: number;
//   }
//
//   interface TEOAdapter {
//     sagePlan(request: PlanningContext, context: Record<string, unknown>): Promise<Plan>;
//     spawnAgent(task: TEOTask, context: AgentContext): Promise<StepResult>;
//   }
//
// --- StubAdapter CONTRACT (what ./stub.ts must export) -----------------------
//
//   class StubAdapter implements TEOAdapter {
//     constructor(opts?: { agentsDir?: string })
//       - agentsDir is injected so tests can point at a custom roster directory,
//         mirroring the PlanBuilder constructor contract.
//
//     sagePlan(request: PlanningContext, context: Record<string, unknown>): Promise<Plan>
//       - MUST drive PlanBuilder (not hand-roll a Plan literal).
//       - Calls: new PlanBuilder({agentsDir?}), startPlan({directive, project_id}),
//         addTask(...) at least one valid SCRIPT task, finalizePlan().
//       - Returns the Plan from finalizePlan().ok result.
//       - Deterministic: same request → same Plan shape (modulo plan_id/created_at).
//       - request.project_id propagates directly into the returned Plan.project_id.
//       - No LLM, no network. Pure in-process.
//       - Empty project_id: must either return a valid Plan (builder defaulting to
//         "default") OR throw/reject with a descriptive error — never silently corrupt.
//       - Missing directive: returns a valid Plan (directive is optional).
//
//     spawnAgent(task: TEOTask, context: AgentContext): Promise<StepResult>
//       - Returns a stub StepResult echoing task.id: { taskId: task.id, status: "PASS" }.
//       - detail field is optional; taskId and status are required.
//       - Never spawns a real agent.
//       - Accepts any TEOTask type (SCRIPT and AGENT) — stub does not discriminate.
//       - Empty task.id: must echo the empty string as taskId (not throw).
//   }
//
// --- TEST ORDER: misuse → boundary → golden (ADR-064 critical-path policy) ---
//
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PlanSchema } from "../core/plan.js";
import { validatePlan } from "../core/validate.js";
import type { Plan, TEOTask } from "../core/plan.js";
import type { StepResult } from "../core/runner.js";

// NOTE (gate-2 state): These imports reference modules implemented in gate-2.
// ./types.ts exports TEOAdapter, PlanningContext, AgentContext interfaces.
// ./stub.ts exports StubAdapter (implements TEOAdapter, drives PlanBuilder).
import type { TEOAdapter, PlanningContext, AgentContext } from "./types.js";
import { StubAdapter } from "./stub.js";

// ---------------------------------------------------------------------------
// Temp-roster helpers
//
// Several tests inject a minimal agentsDir to control exactly which agent IDs
// exist in the executor set. This lets us verify builder-coupling (the stub
// can only produce tasks whose agent_ids the builder accepted from that roster)
// and avoids relying on the production src/agents/ directory in boundary tests.
// ---------------------------------------------------------------------------

/** Creates a temp directory containing minimal .md roster files and returns the path. */
function makeTempRoster(agentIds: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-adapter-test-"));
  for (const id of agentIds) {
    // Minimal valid frontmatter — mirrors the format parseMd expects.
    const content = [
      "---",
      `agent_id: ${id}`,
      `name: ${id} agent`,
      `role: Test agent for ${id}`,
      "disallowedTools_default:",
      "---",
      "",
      `# ${id}`,
    ].join("\n");
    fs.writeFileSync(path.join(dir, `${id}.md`), content, "utf8");
  }
  return dir;
}

function cleanupTempRoster(dir: string): void {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    fs.unlinkSync(path.join(dir, f));
  }
  fs.rmdirSync(dir);
}

// ---------------------------------------------------------------------------
// Minimal valid task fixtures
// ---------------------------------------------------------------------------

function makeScriptTask(id: string, overrides: Partial<TEOTask> = {}): TEOTask {
  return {
    id,
    type: "SCRIPT",
    command: `run-${id}`,
    needs: [],
    gates: [],
    ...overrides,
  } as TEOTask;
}

function makeAgentTask(id: string, agentId: string, prompt: string): TEOTask {
  return {
    id,
    type: "AGENT",
    agent_id: agentId,
    prompt,
    needs: [],
    gates: [],
  };
}

const VALID_PLANNING_CONTEXT: PlanningContext = {
  directive: "BUILD",
  project_id: "test-project",
  description: "Stub adapter test plan",
};

const VALID_AGENT_CONTEXT: AgentContext = {
  planId: "plan-001",
  projectId: "test-project",
  stepTimeoutMs: 5_000,
};

// =============================================================================
// MISUSE TESTS — things callers should not do; the adapter must handle gracefully
// =============================================================================

describe("StubAdapter — misuse", () => {
  // -------------------------------------------------------------------------
  // spawnAgent: empty task.id
  // -------------------------------------------------------------------------
  it("spawnAgent echoes an empty task.id without throwing", async () => {
    // Callers SHOULD NOT pass empty ids (PlanBuilder rejects them).
    // The stub must not throw — it echoes whatever taskId it receives.
    const stub = new StubAdapter();
    const emptyIdTask = makeScriptTask("");

    const result: StepResult = await stub.spawnAgent(emptyIdTask, VALID_AGENT_CONTEXT);

    // Must echo the empty string as taskId — no throw, no undefined
    expect(result.taskId).toBe("");
    expect(result.status).toBe("PASS");
  });

  // -------------------------------------------------------------------------
  // sagePlan: misuse of the adapter as a class (not assignable via cast) is a
  // compile-time concern. Runtime misuse: calling sagePlan without awaiting
  // must still return a Promise (no sync throw on call).
  // -------------------------------------------------------------------------
  it("sagePlan returns a Promise synchronously without throwing", () => {
    const stub = new StubAdapter();
    // The synchronous call must not throw — the work is async
    const p = stub.sagePlan(VALID_PLANNING_CONTEXT, {});
    expect(p).toBeInstanceOf(Promise);
  });

  // -------------------------------------------------------------------------
  // sagePlan: passing extra unknown fields in context Record must not throw
  // -------------------------------------------------------------------------
  it("sagePlan tolerates arbitrary extra keys in context without throwing", async () => {
    const stub = new StubAdapter();
    const weirdContext = {
      unexpected: 42,
      nested: { deep: true },
      nullish: null,
    };

    await expect(stub.sagePlan(VALID_PLANNING_CONTEXT, weirdContext)).resolves.toBeDefined();
  });
});

// =============================================================================
// BOUNDARY TESTS — edge conditions at the contract boundary
// =============================================================================

describe("StubAdapter.sagePlan — boundary", () => {
  // -------------------------------------------------------------------------
  // Boundary: directive is optional (undefined)
  // The PlanningContext.directive is Plan["directive"] | undefined.
  // StubAdapter must not require it — plan is valid without directive.
  // -------------------------------------------------------------------------
  it("returns a valid Plan when directive is omitted", async () => {
    const stub = new StubAdapter();
    const requestWithoutDirective: PlanningContext = {
      project_id: "no-directive-project",
      description: "Plan with no directive",
    };

    const plan: Plan = await stub.sagePlan(requestWithoutDirective, {});

    // Schema-valid even without directive
    expect(() => PlanSchema.parse(plan)).not.toThrow();
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    // directive must be absent (not set to undefined, which would violate exactOptionalPropertyTypes)
    expect(plan.directive).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Boundary: empty project_id
  //
  // PlanSchema requires project_id to be a non-empty string (z.string().min(1)).
  // If the stub passes the empty string to PlanBuilder, finalizePlan() will
  // produce a plan whose project_id is the builder's fallback "default" (since
  // the builder applies `project_id ?? "default"`).
  //
  // CONTRACT DECISION: empty project_id in PlanningContext → StubAdapter must
  // NOT crash. It must either:
  //   (a) return a schema-valid Plan (builder fallback to "default"), OR
  //   (b) reject with a descriptive Error.
  // Silently returning an invalid Plan (empty project_id in output) is forbidden.
  // This test asserts option (a) — the natural builder behavior.
  // -------------------------------------------------------------------------
  it("returns a valid Plan or rejects cleanly when project_id is empty", async () => {
    const stub = new StubAdapter();
    const emptyProjectRequest: PlanningContext = {
      project_id: "",
      description: "Empty project_id boundary case",
    };

    let plan: Plan | undefined;
    let threw = false;
    try {
      plan = await stub.sagePlan(emptyProjectRequest, {});
    } catch {
      threw = true;
    }

    if (threw) {
      // Path (b): rejection — acceptable; test is done.
      expect(threw).toBe(true);
    } else {
      // Path (a): returned a Plan — must be schema-valid (not corrupt)
      expect(plan).toBeDefined();
      expect(() => PlanSchema.parse(plan!)).not.toThrow();
      const result = validatePlan(plan!);
      expect(result.valid).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Boundary: all valid directive values round-trip
  // -------------------------------------------------------------------------
  it.each(["BUILD", "FIX", "REVIEW", "PLAN", "ARCHITECTURAL"] as const)(
    "preserves directive '%s' in the returned Plan",
    async (directive) => {
      const stub = new StubAdapter();
      const plan: Plan = await stub.sagePlan(
        { directive, project_id: "directive-test", description: "directive boundary" },
        {}
      );

      expect(plan.directive).toBe(directive);
      // Plan must still be schema-valid regardless of directive value
      expect(() => PlanSchema.parse(plan)).not.toThrow();
    }
  );
});

describe("StubAdapter.spawnAgent — boundary", () => {
  // -------------------------------------------------------------------------
  // Boundary: SCRIPT task (not AGENT) — stub must not discriminate on type
  // -------------------------------------------------------------------------
  it("returns PASS for a SCRIPT task", async () => {
    const stub = new StubAdapter();
    const scriptTask = makeScriptTask("script-task-1");

    const result: StepResult = await stub.spawnAgent(scriptTask, VALID_AGENT_CONTEXT);

    expect(result.taskId).toBe("script-task-1");
    expect(result.status).toBe("PASS");
  });

  // -------------------------------------------------------------------------
  // Boundary: AGENT task — stub must not discriminate on type
  // -------------------------------------------------------------------------
  it("returns PASS for an AGENT task", async () => {
    // Use a temp roster so we have a valid agent_id without depending on prod roster
    const rosterDir = makeTempRoster(["software-engineer"]);
    try {
      const stub = new StubAdapter({ agentsDir: rosterDir });
      const agentTask = makeAgentTask("agent-task-1", "software-engineer", "do the thing");

      const result: StepResult = await stub.spawnAgent(agentTask, VALID_AGENT_CONTEXT);

      expect(result.taskId).toBe("agent-task-1");
      expect(result.status).toBe("PASS");
    } finally {
      cleanupTempRoster(rosterDir);
    }
  });

  // -------------------------------------------------------------------------
  // Boundary: different AgentContext values do not affect PASS status
  // -------------------------------------------------------------------------
  it("returns PASS regardless of stepTimeoutMs value", async () => {
    const stub = new StubAdapter();
    const task = makeScriptTask("timeout-boundary");
    const ctx: AgentContext = { planId: "p1", projectId: "proj", stepTimeoutMs: 1 };

    const result: StepResult = await stub.spawnAgent(task, ctx);

    expect(result.taskId).toBe("timeout-boundary");
    expect(result.status).toBe("PASS");
  });
});

// =============================================================================
// GOLDEN PATH TESTS — expected happy-path behavior
// =============================================================================

describe("StubAdapter.sagePlan — golden path", () => {
  // -------------------------------------------------------------------------
  // Golden: returns a Plan that passes schema + validator
  // -------------------------------------------------------------------------
  it("returns a Plan that passes PlanSchema.parse() and validatePlan()", async () => {
    const stub = new StubAdapter();
    const plan: Plan = await stub.sagePlan(VALID_PLANNING_CONTEXT, {});

    // Schema validation (Zod)
    expect(() => PlanSchema.parse(plan)).not.toThrow();

    // Cross-task invariant validation
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Golden: returned Plan has required structural fields
  // -------------------------------------------------------------------------
  it("returns a Plan with required top-level fields in correct shape", async () => {
    const stub = new StubAdapter();
    const plan: Plan = await stub.sagePlan(VALID_PLANNING_CONTEXT, {});

    expect(plan.plan_id).toBeTruthy(); // non-empty UUID-ish
    expect(plan.project_id).toBe("test-project"); // echoes request.project_id
    expect(plan.version).toBe("1");
    expect(plan.created_at).toBeTruthy(); // non-empty ISO-8601 string
    expect(Array.isArray(plan.tasks)).toBe(true);
    expect(plan.tasks.length).toBeGreaterThanOrEqual(1); // at least one task
  });

  // -------------------------------------------------------------------------
  // Golden: directive propagates from request to Plan
  // -------------------------------------------------------------------------
  it("propagates request.directive to the returned Plan", async () => {
    const stub = new StubAdapter();
    const plan: Plan = await stub.sagePlan(
      { directive: "FIX", project_id: "fix-project", description: "Fix something" },
      {}
    );

    expect(plan.directive).toBe("FIX");
  });

  // -------------------------------------------------------------------------
  // Golden: project_id propagates from request to Plan
  // -------------------------------------------------------------------------
  it("propagates request.project_id to the returned Plan", async () => {
    const stub = new StubAdapter();
    const uniqueProjectId = `project-${Date.now()}`;
    const plan: Plan = await stub.sagePlan(
      { project_id: uniqueProjectId, description: "id propagation" },
      {}
    );

    expect(plan.project_id).toBe(uniqueProjectId);
  });

  // -------------------------------------------------------------------------
  // Golden: plan_id is unique per call (not a static constant)
  // -------------------------------------------------------------------------
  it("generates a distinct plan_id on each sagePlan() call", async () => {
    const stub = new StubAdapter();
    const [plan1, plan2] = await Promise.all([
      stub.sagePlan(VALID_PLANNING_CONTEXT, {}),
      stub.sagePlan(VALID_PLANNING_CONTEXT, {}),
    ]);

    expect(plan1.plan_id).not.toBe(plan2.plan_id);
  });

  // -------------------------------------------------------------------------
  // Golden: type-level assignability check
  //
  // `const a: TEOAdapter = new StubAdapter()` must compile without a cast.
  // This test is a type-level assertion expressed as a runtime assignment so
  // tsc enforces structural conformance. If TEOAdapter is not satisfied, the
  // file will fail to compile — the test body never needs to assert anything
  // beyond the assignment itself not being rejected by the type checker.
  // -------------------------------------------------------------------------
  it("StubAdapter is structurally assignable to TEOAdapter without a cast", () => {
    // tsc enforces this at compile time. A runtime cast would hide contract drift.
    const adapter: TEOAdapter = new StubAdapter();

    // Verify the methods exist at runtime too (belt-and-suspenders)
    expect(typeof adapter.sagePlan).toBe("function");
    expect(typeof adapter.spawnAgent).toBe("function");
  });
});

describe("StubAdapter.spawnAgent — golden path", () => {
  // -------------------------------------------------------------------------
  // Golden: taskId echoes task.id; status is PASS
  // -------------------------------------------------------------------------
  it("returns StepResult with taskId === task.id and status === 'PASS'", async () => {
    const stub = new StubAdapter();
    const task = makeScriptTask("golden-task-abc");

    const result: StepResult = await stub.spawnAgent(task, VALID_AGENT_CONTEXT);

    expect(result.taskId).toBe("golden-task-abc");
    expect(result.status).toBe("PASS");
  });

  // -------------------------------------------------------------------------
  // Golden: taskId tracks the specific task passed (not a static value)
  // -------------------------------------------------------------------------
  it("echoes the correct taskId for each distinct task", async () => {
    const stub = new StubAdapter();
    const tasks = ["task-alpha", "task-beta", "task-gamma"].map((id) => makeScriptTask(id));

    const results = await Promise.all(tasks.map((t) => stub.spawnAgent(t, VALID_AGENT_CONTEXT)));

    for (let i = 0; i < tasks.length; i++) {
      expect(results[i]!.taskId).toBe(tasks[i]!.id);
      expect(results[i]!.status).toBe("PASS");
    }
  });

  // -------------------------------------------------------------------------
  // Golden: StepResult is Promise-wrapped (async method)
  // -------------------------------------------------------------------------
  it("spawnAgent returns a Promise<StepResult>", async () => {
    const stub = new StubAdapter();
    const task = makeScriptTask("async-check");
    const p = stub.spawnAgent(task, VALID_AGENT_CONTEXT);
    expect(p).toBeInstanceOf(Promise);
    const result = await p;
    expect(result).toHaveProperty("taskId");
    expect(result).toHaveProperty("status");
  });
});

// =============================================================================
// BUILDER-COUPLING TEST
//
// PURPOSE: Prove that StubAdapter actually DRIVES PlanBuilder, not hand-rolls
// a Plan literal. A hardcoded implementation that returns a static Plan bypasses
// PlanBuilder's executor-set check and project_id propagation, and will FAIL
// this test block.
//
// APPROACH: We inject a custom agentsDir (temp roster) containing exactly the
// agents we specify. PlanBuilder's addTask() rejects any AGENT task whose
// agent_id is not in that roster. The resulting Plan can only contain tasks
// the builder accepted.
//
// FAILURE MODE for hardcoded implementations:
//   (a) project_id coupling: if stub returns a Plan with a fixed project_id
//       constant, passing distinct values fails the equality check.
//   (b) Roster coupling: if stub hardcodes an AGENT task with an agent_id
//       not in the injected roster, finalizePlan() would have rejected it —
//       meaning the stub either threw (no Plan returned) or used a task the
//       builder would not have accepted. The test verifies the Plan is still
//       schema-valid with the injected roster, which only the builder can do
//       deterministically (it reads the roster at construction time).
//   (c) version/created_at: builder always sets version:"1" and a real ISO
//       timestamp; a static Plan might use a different version or fixed string.
// =============================================================================

describe("StubAdapter — builder coupling", () => {
  let rosterDir: string;

  // Create a minimal roster: only "software-engineer" is an executor.
  // "capo" and "coordinator" are intentionally omitted because PlanBuilder
  // filters them out as NON_EXECUTOR_IDS even if present.
  beforeEach(() => {
    rosterDir = makeTempRoster(["software-engineer", "qa"]);
  });

  afterEach(() => {
    cleanupTempRoster(rosterDir);
  });

  // -------------------------------------------------------------------------
  // Coupling test 1: project_id propagation
  //
  // A hardcoded Plan with a static project_id constant will fail when we pass
  // distinct values and assert each one propagates to the output.
  // -------------------------------------------------------------------------
  it("project_id from each PlanningContext appears in the corresponding Plan", async () => {
    const stub = new StubAdapter({ agentsDir: rosterDir });

    const ids = ["project-alpha-111", "project-beta-222", "project-gamma-333"];
    const plans = await Promise.all(
      ids.map((pid) => stub.sagePlan({ project_id: pid, description: "coupling test" }, {}))
    );

    for (let i = 0; i < ids.length; i++) {
      expect(plans[i]!.project_id).toBe(ids[i]);
    }
  });

  // -------------------------------------------------------------------------
  // Coupling test 2: schema validity with injected roster
  //
  // A hardcoded Plan that embeds an agent_id from the production roster (but
  // not in our minimal temp roster) is not caught at this layer — but if the
  // stub properly drives the builder with the injected agentsDir, the builder
  // will only produce tasks whose agent_ids are in the temp roster.
  //
  // We verify: the returned Plan passes PlanSchema.parse() and validatePlan()
  // when the stub was constructed with a minimal custom roster. This would fail
  // if the stub returned a corrupt plan_id, wrong version, or empty tasks[].
  // -------------------------------------------------------------------------
  it("returns a schema-valid Plan when constructed with a minimal custom roster", async () => {
    const stub = new StubAdapter({ agentsDir: rosterDir });
    const plan: Plan = await stub.sagePlan(
      { project_id: "coupling-roster-test", description: "custom roster" },
      {}
    );

    expect(() => PlanSchema.parse(plan)).not.toThrow();
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Coupling test 3: version is always "1" (builder-produced, not hardcoded differently)
  //
  // PlanBuilder always sets version: "1". A stub that hardcodes a different
  // version, or forgets the field, will fail PlanSchema.parse() — caught above.
  // This explicit check documents the expectation clearly for the implementer.
  // -------------------------------------------------------------------------
  it("returned Plan always has version '1' regardless of PlanningContext", async () => {
    const stub = new StubAdapter({ agentsDir: rosterDir });

    const plans = await Promise.all([
      stub.sagePlan({ project_id: "v-check-1", description: "a" }, {}),
      stub.sagePlan({ directive: "FIX", project_id: "v-check-2", description: "b" }, {}),
    ]);

    for (const plan of plans) {
      expect(plan.version).toBe("1");
    }
  });

  // -------------------------------------------------------------------------
  // Coupling test 4: created_at is a fresh ISO-8601 timestamp (not a static string)
  //
  // PlanBuilder calls `new Date().toISOString()` at finalizePlan() time.
  // A hardcoded static timestamp like "2024-01-01T00:00:00.000Z" would be
  // suspicious — and would fail the uniqueness check across two sequential calls.
  // We also verify the string is parseable as a date.
  // -------------------------------------------------------------------------
  it("created_at is a parseable ISO-8601 timestamp generated at call time", async () => {
    const before = new Date();
    const stub = new StubAdapter({ agentsDir: rosterDir });
    const plan: Plan = await stub.sagePlan(
      { project_id: "ts-check", description: "timestamp coupling" },
      {}
    );
    const after = new Date();

    const ts = new Date(plan.created_at);
    expect(isNaN(ts.getTime())).toBe(false); // parseable
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000); // within window
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  // -------------------------------------------------------------------------
  // Coupling test 5: tasks[] is non-empty and each task passes TEOTask shape
  //
  // PlanBuilder.addTask() validates each task via TEOTaskSchema.safeParse().
  // A hardcoded stub that inserts a malformed task (missing required fields,
  // extra keys, wrong type literal) would produce a plan that fails this check.
  // -------------------------------------------------------------------------
  it("tasks in the returned Plan all satisfy the TEOTask discriminated union shape", async () => {
    const stub = new StubAdapter({ agentsDir: rosterDir });
    const plan: Plan = await stub.sagePlan(
      { project_id: "task-shape-test", description: "task shape coupling" },
      {}
    );

    expect(plan.tasks.length).toBeGreaterThanOrEqual(1);
    for (const task of plan.tasks) {
      // Each task must be a valid TEOTask — the discriminated union enforces
      // strict shapes (no extra keys, correct type-specific fields).
      expect(() => PlanSchema.shape.tasks.parse([task])).not.toThrow();
    }
  });
});

// =============================================================================
// Import-level notes (post gate-2 implementation)
//
// ./types.ts and ./stub.ts are implemented. tsc resolves both modules cleanly.
// Run:
//
//   npx vitest run src/adapters/stub.test.ts
//
// to confirm all 27 tests pass.
// =============================================================================
