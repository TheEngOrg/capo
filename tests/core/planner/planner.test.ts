import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureTeoHome,
  projectPaths,
  resolveTeoHome,
  type ProjectPaths,
  type TeoHome,
} from "../../../src/core/home/home.js";
import { listAgents } from "../../../src/core/identity/identity.js";
import { verifyPlan } from "../../../src/core/plan/plan.js";
import { readEvents } from "../../../src/core/telemetry/telemetry.js";
import type { SpawnRunner } from "../../../src/core/agent-spawn/agent-spawn.js";
import {
  buildPlanPrompt,
  parsePlanResponse,
  planFromRequest,
} from "../../../src/core/planner/planner.js";

let sandbox: string;
let home: TeoHome;
let paths: ProjectPaths;
const PROJECT = "proj-1";

/** A runner that returns a canned plan body (what the LLM would emit). */
function plannerRunner(planBody: unknown): SpawnRunner {
  return {
    name: "fake-planner",
    run: async () => ({
      output: JSON.stringify(planBody),
      tokens_in: 500,
      tokens_out: 300,
      model: "claude-opus-4-8",
      cost_usd: 0.05,
      duration_ms: 10,
      ok: true,
    }),
  };
}

const SAMPLE_BODY = {
  description: "deploy the marketing site",
  tasks: [
    {
      task_id: "t1",
      task_order: 1,
      task_actor_type: "SCRIPT",
      description: "deploy to prod",
      expected_output: "site is live",
      script: { path: "scripts/deploy.sh", args: ["--prod"], expect_exit: 0 },
      verifications: [{ kind: "script", cmd: "scripts/smoke.sh", expect_exit: 0 }],
    },
    {
      task_id: "t2",
      task_order: 2,
      task_actor_type: "ENGINEER",
      task_actor_type_hint: "ENGINEER",
      description: "write a changelog entry",
      expected_output: "CHANGELOG updated",
      verifications: [],
    },
  ],
};

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-planner-test-"));
  home = resolveTeoHome({ TEO_HOME: join(sandbox, "teohome") });
  ensureTeoHome(home);
  paths = projectPaths(home, PROJECT);
  paths.ensure();
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("buildPlanPrompt", () => {
  it("embeds the user request", () => {
    const prompt = buildPlanPrompt("deploy the site");
    expect(prompt).toContain("deploy the site");
  });

  it("states the prefer-SCRIPT-over-agent bias and the litmus test", () => {
    const prompt = buildPlanPrompt("x");
    expect(prompt).toMatch(/SCRIPT/);
    expect(prompt).toMatch(/fixed command/i);
  });

  it("instructs Sage to classify and decompose, never solve", () => {
    const prompt = buildPlanPrompt("x");
    expect(prompt).toMatch(/never solve|do not solve|don't solve/i);
  });

  it("specifies the JSON output contract", () => {
    const prompt = buildPlanPrompt("x");
    expect(prompt).toMatch(/task_actor_type/);
    expect(prompt).toMatch(/json/i);
  });
});

describe("parsePlanResponse", () => {
  it("parses a bare JSON object", () => {
    const body = parsePlanResponse(JSON.stringify(SAMPLE_BODY));
    expect(body.description).toBe("deploy the marketing site");
    expect(body.tasks).toHaveLength(2);
  });

  it("extracts JSON from a fenced code block", () => {
    const wrapped = "Here is the plan:\n```json\n" + JSON.stringify(SAMPLE_BODY) + "\n```\n";
    const body = parsePlanResponse(wrapped);
    expect(body.tasks).toHaveLength(2);
  });

  it("throws on output with no JSON", () => {
    expect(() => parsePlanResponse("I could not make a plan.")).toThrow(/no json|parse/i);
  });

  it("throws on malformed JSON", () => {
    expect(() => parsePlanResponse("{ not valid")).toThrow();
  });
});

describe("planFromRequest", () => {
  it("produces a signed, valid plan from a request", async () => {
    const plan = await planFromRequest(home, paths, "deploy the site", {
      project_id: PROJECT,
      plan_id: "plan-1",
      created_at: "2026-06-11T00:00:00Z",
      runner: plannerRunner(SAMPLE_BODY),
    });
    expect(plan.plan_id).toBe("plan-1");
    expect(plan.project_id).toBe(PROJECT);
    expect(verifyPlan(home, plan)).toBe(true);
    expect(plan.tasks).toHaveLength(2);
  });

  it("auto-registers agents referenced by AGENT tasks", async () => {
    await planFromRequest(home, paths, "x", {
      project_id: PROJECT,
      plan_id: "plan-1",
      created_at: "2026-06-11T00:00:00Z",
      runner: plannerRunner(SAMPLE_BODY),
    });
    // The ENGINEER task should have caused an eng-### agent to be issued,
    // plus the sage planner itself.
    const ids = listAgents(home).map((a) => a.agent_type);
    expect(ids).toContain("ENGINEER");
    expect(ids).toContain("SAGE");
  });

  it("wires task_actor onto AGENT tasks from the issued agent id", async () => {
    const plan = await planFromRequest(home, paths, "x", {
      project_id: PROJECT,
      plan_id: "plan-1",
      created_at: "2026-06-11T00:00:00Z",
      runner: plannerRunner(SAMPLE_BODY),
    });
    const agentTask = plan.tasks.find((t) => t.task_actor_type === "ENGINEER");
    expect(agentTask?.task_actor).toMatch(/^eng-\d{3}$/);
  });

  it("emits a PLAN telemetry event carrying the planning cost", async () => {
    const plan = await planFromRequest(home, paths, "x", {
      project_id: PROJECT,
      plan_id: "plan-1",
      created_at: "2026-06-11T00:00:00Z",
      runner: plannerRunner(SAMPLE_BODY),
    });
    const planEvent = readEvents(paths, plan.plan_id).find((e) => e.phase === "PLAN");
    expect(planEvent?.actor_type).toBe("SAGE");
    expect(planEvent?.tokens_in).toBe(500);
    expect(planEvent?.cost_usd).toBeCloseTo(0.05);
  });

  it("sets created_by to the sage planner id", async () => {
    const plan = await planFromRequest(home, paths, "x", {
      project_id: PROJECT,
      plan_id: "plan-1",
      created_at: "2026-06-11T00:00:00Z",
      runner: plannerRunner(SAMPLE_BODY),
    });
    expect(plan.created_by).toMatch(/^sage-\d{3}$/);
  });

  it("wires a registered gate_owner id onto gate tasks from the role", async () => {
    const bodyWithGate = {
      description: "build + gate",
      tasks: [
        {
          task_id: "t1",
          task_order: 1,
          task_actor_type: "SCRIPT",
          description: "build",
          expected_output: "built",
          script: { path: "scripts/build.sh", expect_exit: 0 },
          verifications: [],
        },
        {
          task_id: "g1",
          task_order: 2,
          is_gate: true,
          gate_owner: "QA",
          gate_constraints: [{ kind: "verification-ref", task_id: "t1" }],
        },
      ],
    };
    const plan = await planFromRequest(home, paths, "x", {
      project_id: PROJECT,
      plan_id: "plan-1",
      created_at: "2026-06-11T00:00:00Z",
      runner: plannerRunner(bodyWithGate),
    });
    const gate = plan.tasks.find((t) => t.is_gate);
    expect(gate?.gate_owner).toMatch(/^qa-\d{3}$/);
    expect(verifyPlan(home, plan)).toBe(true);
  });

  it("defaults an unspecified or non-agent gate role to QA", async () => {
    const bodyWithBareGate = {
      description: "gate only after a script",
      tasks: [
        {
          task_id: "t1",
          task_order: 1,
          task_actor_type: "SCRIPT",
          description: "x",
          expected_output: "y",
          script: { path: "scripts/x.sh", expect_exit: 0 },
          verifications: [],
        },
        // gate_owner omitted entirely, and a bogus role on a second gate
        { task_id: "g1", task_order: 2, is_gate: true, gate_constraints: [] },
        { task_id: "g2", task_order: 3, is_gate: true, gate_owner: "WIZARD", gate_constraints: [] },
      ],
    };
    const plan = await planFromRequest(home, paths, "x", {
      project_id: PROJECT,
      plan_id: "plan-1",
      created_at: "2026-06-11T00:00:00Z",
      runner: plannerRunner(bodyWithBareGate),
    });
    const gates = plan.tasks.filter((t) => t.is_gate);
    for (const g of gates) {
      expect(g.gate_owner).toMatch(/^qa-\d{3}$/);
    }
  });

  it("throws if the planner LLM call fails", async () => {
    const failing: SpawnRunner = {
      name: "boom",
      run: async () => ({
        output: "",
        tokens_in: 0,
        tokens_out: 0,
        model: "m",
        cost_usd: 0,
        duration_ms: 0,
        ok: false,
        error: "model down",
      }),
    };
    await expect(
      planFromRequest(home, paths, "x", {
        project_id: PROJECT,
        plan_id: "plan-1",
        created_at: "2026-06-11T00:00:00Z",
        runner: failing,
      }),
    ).rejects.toThrow(/planner|model down/i);
  });

  it("throws with a fallback message when the planner fails with no error string", async () => {
    const failing: SpawnRunner = {
      name: "silent-fail",
      run: async () => ({
        output: "",
        tokens_in: 0,
        tokens_out: 0,
        model: "m",
        cost_usd: 0,
        duration_ms: 0,
        ok: false,
      }),
    };
    await expect(
      planFromRequest(home, paths, "x", {
        project_id: PROJECT,
        plan_id: "plan-1",
        created_at: "2026-06-11T00:00:00Z",
        runner: failing,
      }),
    ).rejects.toThrow(/unknown error/i);
  });

  it("throws if the produced plan fails validation", async () => {
    const badBody = { description: "x", tasks: [] }; // empty tasks -> invalid
    await expect(
      planFromRequest(home, paths, "x", {
        project_id: PROJECT,
        plan_id: "plan-1",
        created_at: "2026-06-11T00:00:00Z",
        runner: plannerRunner(badBody),
      }),
    ).rejects.toThrow(/invalid|at least one task/i);
  });
});
