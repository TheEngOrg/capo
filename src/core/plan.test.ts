import { describe, it, expect } from "vitest";
import { PlanSchema, TEOTaskSchema, GateRefSchema } from "./plan.js";

// =============================================================================
// plan.test.ts — exhaustive tests for src/core/plan.ts
//
// Ordering: misuse → boundary → golden path (per ADR-064 critical-path policy)
// =============================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validGate = { name: "security", on_fail: "block" as const };

const validScriptTask = {
  id: "task-1",
  type: "SCRIPT" as const,
  command: "npm run lint",
  needs: [],
  gates: [validGate],
};

const validAgentTask = {
  id: "task-2",
  type: "AGENT" as const,
  agent_id: "eng",
  prompt: "Review and fix the failing lint errors",
  needs: [],
  gates: [],
};

const minimalValidPlan = {
  plan_id: "plan-abc",
  project_id: "proj-1",
  created_at: "2026-06-18T00:00:00Z",
  version: "1" as const,
  tasks: [validScriptTask],
};

// ---------------------------------------------------------------------------
// GateRef
// ---------------------------------------------------------------------------
describe("GateRefSchema", () => {
  it("rejects missing name", () => {
    expect(() =>
      GateRefSchema.parse({ on_fail: "block" })
    ).toThrow();
  });

  it("rejects invalid on_fail value", () => {
    expect(() =>
      GateRefSchema.parse({ name: "sec", on_fail: "ignore" })
    ).toThrow();
  });

  it("parses a valid block gate ref", () => {
    const result = GateRefSchema.parse({ name: "security", on_fail: "block" });
    expect(result.on_fail).toBe("block");
  });

  it("parses a valid warn gate ref", () => {
    const result = GateRefSchema.parse({ name: "lint", on_fail: "warn" });
    expect(result.on_fail).toBe("warn");
  });
});

// ---------------------------------------------------------------------------
// TEOTaskSchema — MISUSE: wrong discriminant fields
// ---------------------------------------------------------------------------
describe("TEOTaskSchema — discriminated union misuse", () => {
  it("rejects a SCRIPT task that includes agent_id", () => {
    // SCRIPT tasks do not have agent_id — the discriminated union must reject this
    expect(() =>
      TEOTaskSchema.parse({
        ...validScriptTask,
        agent_id: "eng",
      })
    ).toThrow();
  });

  it("rejects an AGENT task that includes command", () => {
    // AGENT tasks do not have command — the discriminated union must reject this
    expect(() =>
      TEOTaskSchema.parse({
        ...validAgentTask,
        command: "npm run build",
      })
    ).toThrow();
  });

  it("rejects a SCRIPT task missing command", () => {
    const { command: _, ...noCommand } = validScriptTask;
    expect(() => TEOTaskSchema.parse(noCommand)).toThrow();
  });

  it("rejects an AGENT task missing agent_id", () => {
    const { agent_id: _, ...noAgentId } = validAgentTask;
    expect(() => TEOTaskSchema.parse(noAgentId)).toThrow();
  });

  it("rejects an AGENT task missing prompt", () => {
    const { prompt: _, ...noPrompt } = validAgentTask;
    expect(() => TEOTaskSchema.parse(noPrompt)).toThrow();
  });

  it("rejects an AGENT task with an empty prompt", () => {
    expect(() =>
      TEOTaskSchema.parse({ ...validAgentTask, prompt: "" })
    ).toThrow();
  });

  it("rejects a task with unknown type", () => {
    expect(() =>
      TEOTaskSchema.parse({ ...validScriptTask, type: "UNKNOWN" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TEOTaskSchema — BOUNDARY: empty strings
// ---------------------------------------------------------------------------
describe("TEOTaskSchema — empty string boundaries", () => {
  it("rejects a SCRIPT task with empty id", () => {
    expect(() =>
      TEOTaskSchema.parse({ ...validScriptTask, id: "" })
    ).toThrow();
  });

  it("rejects a SCRIPT task with empty command", () => {
    expect(() =>
      TEOTaskSchema.parse({ ...validScriptTask, command: "" })
    ).toThrow();
  });

  it("rejects an AGENT task with empty id", () => {
    expect(() =>
      TEOTaskSchema.parse({ ...validAgentTask, id: "" })
    ).toThrow();
  });

  it("rejects an AGENT task with empty agent_id", () => {
    expect(() =>
      TEOTaskSchema.parse({ ...validAgentTask, agent_id: "" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TEOTaskSchema — BOUNDARY: referential integrity deferred to validatePlan
// ---------------------------------------------------------------------------
describe("TEOTaskSchema — referential integrity is NOT schema's job", () => {
  it("parses a task whose needs[] references a nonexistent task ID (schema allows it)", () => {
    // The schema validates shape only. Cross-task reference checking
    // (does the referenced ID exist?) is validatePlan()'s responsibility (WS-CORE-02).
    const task = { ...validScriptTask, needs: ["nonexistent-task-id"] };
    const result = TEOTaskSchema.parse(task);
    expect(result.needs).toEqual(["nonexistent-task-id"]);
  });
});

// ---------------------------------------------------------------------------
// TEOTaskSchema — BOUNDARY: disallowedTools on SCRIPT task is a no-op
// ---------------------------------------------------------------------------
describe("TEOTaskSchema — disallowedTools on SCRIPT task", () => {
  it("parses OK when disallowedTools is present on a SCRIPT task (no-op)", () => {
    // SCRIPT tasks spawn no agent so disallowedTools has no effect at runtime.
    // The schema allows it to avoid forcing callers to strip the field.
    const task = { ...validScriptTask, disallowedTools: ["Bash", "Write"] };
    const result = TEOTaskSchema.parse(task);
    expect(result.disallowedTools).toEqual(["Bash", "Write"]);
  });

  it("parses OK when disallowedTools is omitted on a SCRIPT task", () => {
    const result = TEOTaskSchema.parse(validScriptTask);
    expect(result.disallowedTools).toBeUndefined();
  });

  it("parses OK when disallowedTools is present on an AGENT task", () => {
    const task = { ...validAgentTask, disallowedTools: ["Bash"] };
    const result = TEOTaskSchema.parse(task);
    expect(result.disallowedTools).toEqual(["Bash"]);
  });
});

// ---------------------------------------------------------------------------
// TEOTaskSchema — GOLDEN PATH
// ---------------------------------------------------------------------------
describe("TEOTaskSchema — golden path", () => {
  it("parses a minimal valid SCRIPT task", () => {
    const result = TEOTaskSchema.parse(validScriptTask);
    expect(result.type).toBe("SCRIPT");
    expect(result.id).toBe("task-1");
  });

  it("parses a minimal valid AGENT task", () => {
    const result = TEOTaskSchema.parse(validAgentTask);
    expect(result.type).toBe("AGENT");
    expect(result.agent_id).toBe("eng");
  });

  it("parses a SCRIPT task with multiple gates", () => {
    const task = {
      ...validScriptTask,
      gates: [
        { name: "security", on_fail: "block" as const },
        { name: "lint", on_fail: "warn" as const },
      ],
    };
    const result = TEOTaskSchema.parse(task);
    expect(result.gates).toHaveLength(2);
  });

  it("parses a SCRIPT task with non-empty needs[]", () => {
    const task = { ...validScriptTask, needs: ["some-prior-task"] };
    const result = TEOTaskSchema.parse(task);
    expect(result.needs).toEqual(["some-prior-task"]);
  });
});

// ---------------------------------------------------------------------------
// PlanSchema — MISUSE
// ---------------------------------------------------------------------------
describe("PlanSchema — misuse", () => {
  it("rejects a plan with empty plan_id", () => {
    expect(() =>
      PlanSchema.parse({ ...minimalValidPlan, plan_id: "" })
    ).toThrow();
  });

  it("rejects a plan with empty project_id", () => {
    expect(() =>
      PlanSchema.parse({ ...minimalValidPlan, project_id: "" })
    ).toThrow();
  });

  it("rejects a plan with an empty tasks array", () => {
    // A plan with no tasks is invalid — there's nothing to run.
    expect(() =>
      PlanSchema.parse({ ...minimalValidPlan, tasks: [] })
    ).toThrow();
  });

  it("rejects a plan with a wrong version string", () => {
    expect(() =>
      // @ts-expect-error — intentional wrong type for misuse test
      PlanSchema.parse({ ...minimalValidPlan, version: "2" })
    ).toThrow();
  });

  it("rejects a plan with a numeric version", () => {
    expect(() =>
      // @ts-expect-error — intentional wrong type for misuse test
      PlanSchema.parse({ ...minimalValidPlan, version: 1 })
    ).toThrow();
  });

  it("rejects a plan with a missing created_at", () => {
    const { created_at: _, ...noDates } = minimalValidPlan;
    expect(() => PlanSchema.parse(noDates)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PlanSchema — BOUNDARY: duplicate IDs are deferred to validatePlan
// ---------------------------------------------------------------------------
describe("PlanSchema — duplicate task IDs are NOT schema's job", () => {
  it("parses OK when two tasks share the same ID (schema allows it)", () => {
    // Uniqueness of task IDs is a cross-task constraint — it belongs in
    // validatePlan() (WS-CORE-02), not in the schema. The schema validates
    // the shape of individual tasks, not inter-task invariants.
    const plan = {
      ...minimalValidPlan,
      tasks: [
        validScriptTask,
        { ...validAgentTask, id: "task-1" }, // duplicate of validScriptTask
      ],
    };
    const result = PlanSchema.parse(plan);
    const ids = result.tasks.map((t) => t.id);
    expect(ids.filter((id) => id === "task-1")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// PlanSchema — GOLDEN PATH
// ---------------------------------------------------------------------------
describe("PlanSchema — golden path", () => {
  it("parses a minimal valid plan with a SCRIPT task", () => {
    const result = PlanSchema.parse(minimalValidPlan);
    expect(result.plan_id).toBe("plan-abc");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.type).toBe("SCRIPT");
  });

  it("parses a valid plan with an AGENT task", () => {
    const plan = { ...minimalValidPlan, tasks: [validAgentTask] };
    const result = PlanSchema.parse(plan);
    expect(result.tasks[0]?.type).toBe("AGENT");
  });

  it("parses a plan with mixed SCRIPT and AGENT tasks", () => {
    const plan = {
      ...minimalValidPlan,
      tasks: [validScriptTask, validAgentTask],
    };
    const result = PlanSchema.parse(plan);
    expect(result.tasks).toHaveLength(2);
  });

  it("preserves created_at as a string (ISO-8601 passthrough)", () => {
    const result = PlanSchema.parse(minimalValidPlan);
    expect(result.created_at).toBe("2026-06-18T00:00:00Z");
  });

  it("plan_id is a non-empty string", () => {
    const result = PlanSchema.parse(minimalValidPlan);
    expect(result.plan_id.length).toBeGreaterThan(0);
  });
});
