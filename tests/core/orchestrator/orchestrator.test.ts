import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureTeoHome,
  projectId,
  projectPaths,
  resolveTeoHome,
  type ProjectPaths,
  type TeoHome,
} from "../../../src/core/home/home.js";
import { issueAgent } from "../../../src/core/identity/identity.js";
import { signPlan, type ExecutionPlan, type PlanTask } from "../../../src/core/plan/plan.js";
import { readEvents } from "../../../src/core/telemetry/telemetry.js";
import type { SpawnRunner } from "../../../src/core/agent-spawn/agent-spawn.js";
import { runPlan, type RunResult } from "../../../src/core/orchestrator/orchestrator.js";

let sandbox: string;
let home: TeoHome;
let paths: ProjectPaths;
const PROJECT = "proj-1";

function writeScript(name: string, body: string): string {
  const path = join(sandbox, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

function okRunner(): SpawnRunner {
  return {
    name: "fake",
    run: async () => ({
      output: "agent did the work",
      tokens_in: 200,
      tokens_out: 80,
      model: "claude-opus-4-8",
      cost_usd: 0.02,
      duration_ms: 5,
      ok: true,
    }),
  };
}

function plan(tasks: PlanTask[]): ExecutionPlan {
  const p: ExecutionPlan = {
    plan_id: "plan-1",
    project_id: PROJECT,
    description: "do work",
    created_by: "sage-001",
    created_at: "2026-06-11T00:00:00Z",
    schema_version: "5.0",
    tasks,
  };
  return signPlan(home, p);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-orch-test-"));
  home = resolveTeoHome({ TEO_HOME: join(sandbox, "teohome") });
  ensureTeoHome(home);
  paths = projectPaths(home, PROJECT);
  paths.ensure();
  issueAgent(home, { agent_type: "SAGE", issued_at: "2026-06-11T00:00:00Z" }); // sage-001
  issueAgent(home, { agent_type: "ENGINEER", issued_at: "2026-06-11T00:00:00Z" }); // eng-001
  issueAgent(home, { agent_type: "QA", issued_at: "2026-06-11T00:00:00Z" }); // qa-001
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("runPlan — happy path", () => {
  it("runs a SCRIPT task with zero LLM tokens and reaches pending-human", async () => {
    const path = writeScript("deploy.sh", 'echo "deployed"');
    const p = plan([
      {
        task_id: "t1",
        task_order: 1,
        task_actor_type: "SCRIPT",
        description: "deploy",
        expected_output: "deployed",
        script: { path, expect_exit: 0 },
        verifications: [],
      },
    ]);
    const res: RunResult = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    expect(res.status).toBe("pending-human");
    expect(res.tasks[0].verdict).toBe("pass");
    // No tokens spent on a SCRIPT task.
    expect(res.tasks[0].tokens_in ?? 0).toBe(0);
  });

  it("runs an AGENT task through the spawn runner and records token cost", async () => {
    const p = plan([
      {
        task_id: "t1",
        task_order: 1,
        task_actor_type: "ENGINEER",
        task_actor: "eng-001",
        description: "write code",
        expected_output: "code written",
        verifications: [],
      },
    ]);
    const res = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    expect(res.status).toBe("pending-human");
    expect(res.tasks[0].verdict).toBe("pass");
    expect(res.tasks[0].tokens_in).toBe(200);
  });

  it("runs tasks in ascending task_order", async () => {
    const a = writeScript("a.sh", "true");
    const b = writeScript("b.sh", "true");
    const p = plan([
      { task_id: "t2", task_order: 2, task_actor_type: "SCRIPT", script: { path: b, expect_exit: 0 }, verifications: [] },
      { task_id: "t1", task_order: 1, task_actor_type: "SCRIPT", script: { path: a, expect_exit: 0 }, verifications: [] },
    ]);
    const res = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    expect(res.tasks.map((t) => t.task_id)).toEqual(["t1", "t2"]);
  });
});

describe("runPlan — verification", () => {
  it("marks a task failed when its mechanical verification fails", async () => {
    const path = writeScript("build.sh", "true");
    const p = plan([
      {
        task_id: "t1",
        task_order: 1,
        task_actor_type: "SCRIPT",
        script: { path, expect_exit: 0 },
        verifications: [{ kind: "script", cmd: "false", expect_exit: 0 }],
      },
    ]);
    const res = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    expect(res.tasks[0].verdict).toBe("fail");
    expect(res.status).toBe("error");
  });

  it("marks a task failed when its SCRIPT exits non-zero", async () => {
    const path = writeScript("fail.sh", "exit 1");
    const p = plan([
      { task_id: "t1", task_order: 1, task_actor_type: "SCRIPT", script: { path, expect_exit: 0 }, verifications: [] },
    ]);
    const res = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    expect(res.tasks[0].verdict).toBe("fail");
    expect(res.status).toBe("error");
  });

  it("stops at the first failing task and does not run later tasks", async () => {
    const a = writeScript("a.sh", "exit 1");
    const b = writeScript("b.sh", "true");
    const p = plan([
      { task_id: "t1", task_order: 1, task_actor_type: "SCRIPT", script: { path: a, expect_exit: 0 }, verifications: [] },
      { task_id: "t2", task_order: 2, task_actor_type: "SCRIPT", script: { path: b, expect_exit: 0 }, verifications: [] },
    ]);
    const res = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    expect(res.tasks).toHaveLength(1);
    expect(res.status).toBe("error");
  });
});

describe("runPlan — defensive defaults", () => {
  it("handles an AGENT task with no description (empty prompt)", async () => {
    const p = plan([
      {
        task_id: "t1",
        task_order: 1,
        task_actor_type: "ENGINEER",
        task_actor: "eng-001",
        expected_output: "done",
        verifications: [],
      },
    ]);
    const res = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    expect(res.tasks[0].verdict).toBe("pass");
  });

  it("handles a task with no verifications block (passes vacuously)", async () => {
    const path = writeScript("w.sh", "true");
    const p = plan([
      // No `verifications` key at all.
      { task_id: "t1", task_order: 1, task_actor_type: "SCRIPT", script: { path, expect_exit: 0 } } as PlanTask,
    ]);
    const res = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    expect(res.tasks[0].verdict).toBe("pass");
  });

  it("handles a gate with no constraints block", async () => {
    const path = writeScript("w.sh", "true");
    const p = plan([
      { task_id: "t1", task_order: 1, task_actor_type: "SCRIPT", script: { path, expect_exit: 0 }, verifications: [] },
      { task_id: "g1", task_order: 2, is_gate: true, gate_owner: "qa-001" } as PlanTask,
    ]);
    const res = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    const gate = res.tasks.find((t) => t.task_id === "g1");
    expect(gate?.verdict).toBe("pass");
    expect(gate?.signature).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("runPlan — retries", () => {
  it("retries a failing task and succeeds within max_retries", async () => {
    // A script that fails the first 2 runs, then passes — driven by a counter file.
    const counter = join(sandbox, "count");
    const path = writeScript(
      "flaky.sh",
      `n=$(cat "${counter}" 2>/dev/null || echo 0)\nn=$((n+1))\necho "$n" > "${counter}"\n[ "$n" -ge 3 ]`,
    );
    const p = plan([
      {
        task_id: "t1",
        task_order: 1,
        task_actor_type: "SCRIPT",
        script: { path, expect_exit: 0 },
        verifications: [],
        max_retries: 3,
      },
    ]);
    const res = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    expect(res.status).toBe("pending-human");
    expect(res.tasks[0].verdict).toBe("pass");
    // RETRY events recorded for the two failed attempts.
    const retries = readEvents(paths, "plan-1").filter((e) => e.phase === "RETRY");
    expect(retries).toHaveLength(2);
  });

  it("goes to error when retries are exhausted", async () => {
    const path = writeScript("always-fail.sh", "exit 1");
    const p = plan([
      {
        task_id: "t1",
        task_order: 1,
        task_actor_type: "SCRIPT",
        script: { path, expect_exit: 0 },
        verifications: [],
        max_retries: 2,
      },
    ]);
    const res = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    expect(res.status).toBe("error");
    const retries = readEvents(paths, "plan-1").filter((e) => e.phase === "RETRY");
    expect(retries).toHaveLength(2); // 2 re-attempts after the first failure
  });

  it("max_retries=0 (default) fails on the first failure with no RETRY events", async () => {
    const path = writeScript("fail.sh", "exit 1");
    const p = plan([
      { task_id: "t1", task_order: 1, task_actor_type: "SCRIPT", script: { path, expect_exit: 0 }, verifications: [] },
    ]);
    const res = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    expect(res.status).toBe("error");
    expect(readEvents(paths, "plan-1").filter((e) => e.phase === "RETRY")).toHaveLength(0);
  });
});

describe("runPlan — gates", () => {
  it("a gate produces a signed signoff from its gate_owner", async () => {
    const path = writeScript("work.sh", "true");
    const p = plan([
      { task_id: "t1", task_order: 1, task_actor_type: "SCRIPT", script: { path, expect_exit: 0 }, verifications: [] },
      {
        task_id: "g1",
        task_order: 2,
        is_gate: true,
        gate_owner: "qa-001",
        gate_constraints: [{ kind: "verification-ref", task_id: "t1" }],
      } as PlanTask,
    ]);
    const res = await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    expect(res.status).toBe("pending-human");
    const gate = res.tasks.find((t) => t.task_id === "g1");
    expect(gate?.verdict).toBe("pass");
    expect(gate?.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(gate?.signed_by).toBe("qa-001");
  });
});

describe("runPlan — telemetry", () => {
  it("emits an append-only event for every step with monotonic seq", async () => {
    const path = writeScript("x.sh", "true");
    const p = plan([
      { task_id: "t1", task_order: 1, task_actor_type: "SCRIPT", script: { path, expect_exit: 0 }, verifications: [] },
    ]);
    await runPlan(home, paths, p, { runner: okRunner(), cwd: sandbox });
    const events = readEvents(paths, "plan-1");
    expect(events.length).toBeGreaterThan(0);
    // seqs are strictly increasing
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    // first event is PLAN-phase, a DELIVER event marks the park
    expect(events[0].phase).toBe("RUN");
    expect(events.some((e) => e.phase === "DELIVER")).toBe(true);
  });

  it("refuses to run an unsigned/tampered plan", async () => {
    const path = writeScript("x.sh", "true");
    const p = plan([
      { task_id: "t1", task_order: 1, task_actor_type: "SCRIPT", script: { path, expect_exit: 0 }, verifications: [] },
    ]);
    const tampered = { ...p, description: "evil" };
    await expect(runPlan(home, paths, tampered, { runner: okRunner(), cwd: sandbox })).rejects.toThrow(
      /signature|verify/i,
    );
  });
});
