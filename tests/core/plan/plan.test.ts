import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureTeoHome, resolveTeoHome, type TeoHome } from "../../../src/core/home/home.js";
import { issueAgent } from "../../../src/core/identity/identity.js";
import {
  validatePlan,
  signPlan,
  verifyPlan,
  loadPlan,
  savePlan,
  type ExecutionPlan,
  type PlanTask,
} from "../../../src/core/plan/plan.js";

let sandbox: string;
let home: TeoHome;

function scriptTask(over: Partial<PlanTask> = {}): PlanTask {
  return {
    task_id: "t-script",
    task_order: 1,
    task_actor_type: "SCRIPT",
    description: "deploy",
    expected_output: "deployed",
    script: { path: "scripts/deploy.sh", args: ["--prod"], expect_exit: 0 },
    verifications: [],
    ...over,
  };
}

function agentTask(over: Partial<PlanTask> = {}): PlanTask {
  return {
    task_id: "t-agent",
    task_order: 2,
    task_actor_type: "ENGINEER",
    task_actor: "eng-001",
    description: "write code",
    expected_output: "module exists",
    verifications: [{ kind: "script", cmd: "npx tsc --noEmit", expect_exit: 0 }],
    ...over,
  };
}

function gateTask(over: Partial<PlanTask> = {}): PlanTask {
  return {
    task_id: "t-gate",
    task_order: 10,
    is_gate: true,
    gate_owner: "qa-001",
    gate_constraints: [{ kind: "verification-ref", task_id: "t-agent" }],
    ...over,
  } as PlanTask;
}

function basePlan(tasks: PlanTask[]): ExecutionPlan {
  return {
    plan_id: "plan-1",
    project_id: "abc123",
    description: "do work",
    created_by: "sage-001",
    created_at: "2026-06-11T00:00:00Z",
    schema_version: "5.0",
    tasks,
  };
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-plan-test-"));
  home = resolveTeoHome({ TEO_HOME: sandbox });
  ensureTeoHome(home);
  // Register the agents the sample plans reference.
  issueAgent(home, { agent_type: "SAGE", issued_at: "2026-06-11T00:00:00Z" }); // sage-001
  issueAgent(home, { agent_type: "ENGINEER", issued_at: "2026-06-11T00:00:00Z" }); // eng-001
  issueAgent(home, { agent_type: "QA", issued_at: "2026-06-11T00:00:00Z" }); // qa-001
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("validatePlan — structure", () => {
  it("accepts a well-formed SCRIPT + AGENT + Gate plan", () => {
    const res = validatePlan(home, basePlan([scriptTask(), agentTask(), gateTask()]));
    expect(res.ok).toBe(true);
  });

  it("rejects an empty task list", () => {
    const res = validatePlan(home, basePlan([]));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/at least one task/i);
  });

  it("rejects duplicate task_order", () => {
    const res = validatePlan(home, basePlan([scriptTask({ task_order: 5 }), agentTask({ task_order: 5 })]));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/task_order/i);
  });

  it("rejects a wrong schema_version", () => {
    const plan = { ...basePlan([scriptTask()]), schema_version: "4.0" } as ExecutionPlan;
    const res = validatePlan(home, plan);
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/schema_version/i);
  });

  it("rejects a non-gate task with neither SCRIPT nor a valid AGENT type", () => {
    const orphan = { task_id: "t-orphan", task_order: 3 } as PlanTask;
    const res = validatePlan(home, basePlan([orphan]));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/unknown or missing task_actor_type/i);
  });
});

describe("validatePlan — SCRIPT tasks", () => {
  it("rejects a SCRIPT task with no script block", () => {
    const res = validatePlan(home, basePlan([scriptTask({ script: undefined })]));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/script/i);
  });

  it("does not require task_actor on a SCRIPT task", () => {
    const res = validatePlan(home, basePlan([scriptTask({ task_actor: undefined })]));
    expect(res.ok).toBe(true);
  });
});

describe("validatePlan — AGENT tasks", () => {
  it("rejects an AGENT task with no task_actor", () => {
    const res = validatePlan(home, basePlan([agentTask({ task_actor: undefined })]));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/task_actor/i);
  });

  it("rejects an AGENT task whose actor is not registered", () => {
    const res = validatePlan(home, basePlan([agentTask({ task_actor: "eng-999" })]));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/registered|unknown/i);
  });
});

describe("validatePlan — Gate tasks", () => {
  it("rejects a Gate with an unregistered gate_owner", () => {
    const res = validatePlan(home, basePlan([agentTask(), gateTask({ gate_owner: "qa-999" } as Partial<PlanTask>)]));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/registered|unknown|gate_owner/i);
  });

  it("accepts a Gate with no constraints block", () => {
    const gate = gateTask({ gate_constraints: undefined } as Partial<PlanTask>);
    const res = validatePlan(home, basePlan([agentTask(), gate]));
    expect(res.ok).toBe(true);
  });

  it("rejects a Gate referencing a non-existent task in constraints", () => {
    const gate = gateTask({ gate_constraints: [{ kind: "verification-ref", task_id: "missing" }] } as Partial<PlanTask>);
    const res = validatePlan(home, basePlan([agentTask(), gate]));
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/constraint|missing/i);
  });
});

describe("signPlan / verifyPlan", () => {
  it("a signed plan verifies", () => {
    const signed = signPlan(home, basePlan([scriptTask()]));
    expect(signed.plan_signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPlan(home, signed)).toBe(true);
  });

  it("a tampered plan does not verify", () => {
    const signed = signPlan(home, basePlan([scriptTask()]));
    const tampered = { ...signed, description: "malicious change" };
    expect(verifyPlan(home, tampered)).toBe(false);
  });

  it("an unsigned plan does not verify", () => {
    const plan = basePlan([scriptTask()]);
    expect(verifyPlan(home, plan)).toBe(false);
  });

  it("signature is independent of task ordering in the array but binds task content", () => {
    const signed = signPlan(home, basePlan([scriptTask()]));
    const swapped = { ...signed, tasks: [scriptTask({ description: "changed" })] };
    expect(verifyPlan(home, swapped)).toBe(false);
  });
});

describe("savePlan / loadPlan", () => {
  it("round-trips a signed plan through disk", () => {
    const signed = signPlan(home, basePlan([scriptTask()]));
    const path = savePlan(home, signed);
    const loaded = loadPlan(home, path);
    expect(loaded.plan_id).toBe("plan-1");
    expect(verifyPlan(home, loaded)).toBe(true);
  });

  it("loadPlan throws on a tampered file (signature mismatch)", () => {
    const signed = signPlan(home, basePlan([scriptTask()]));
    const path = savePlan(home, signed);
    const tampered = JSON.stringify({ ...signed, description: "evil" });
    writeFileSync(path, tampered);
    expect(() => loadPlan(home, path)).toThrow(/signature|verify/i);
  });

  it("loadPlan throws when the file is missing", () => {
    expect(() => loadPlan(home, join(sandbox, "nope.json"))).toThrow();
  });
});
