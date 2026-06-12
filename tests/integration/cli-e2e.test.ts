/**
 * End-to-end: drive the real `teo` binary through the full pipeline against an
 * isolated ~/.teo (TEO_HOME). Registers agents, signs a plan with a SCRIPT task,
 * runs it, checks status, accepts the human gate, and audits the ledger.
 *
 * This is the acceptance test for the CLI surface — it exercises the binary as a
 * subprocess, not the core in-process.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureTeoHome, projectPaths, resolveTeoHome } from "../../src/core/home/home.js";
import { issueAgent } from "../../src/core/identity/identity.js";
import { savePlan, signPlan, type ExecutionPlan } from "../../src/core/plan/plan.js";

let sandbox: string;
let teoHome: string;
let planPath: string;

function teo(args: string[]) {
  return spawnSync("npx", ["tsx", join(process.cwd(), "src/index.ts"), ...args], {
    cwd: sandbox,
    env: { ...process.env, TEO_HOME: teoHome },
    encoding: "utf8",
  });
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-e2e-"));
  teoHome = join(sandbox, ".teo");
  const home = resolveTeoHome({ TEO_HOME: teoHome });
  ensureTeoHome(home);

  // Register the agents the plan references.
  issueAgent(home, { agent_type: "QA", issued_at: "2026-06-11T00:00:00Z" }); // qa-001

  // A real deploy script the plan will run.
  const script = join(sandbox, "deploy.sh");
  writeFileSync(script, '#!/usr/bin/env bash\necho "deployed to prod"\n', { mode: 0o755 });
  chmodSync(script, 0o755);

  const plan: ExecutionPlan = signPlan(home, {
    plan_id: "e2e-plan",
    project_id: "e2e-proj",
    description: "deploy the site",
    created_by: "qa-001",
    created_at: "2026-06-11T00:00:00Z",
    schema_version: "5.0",
    tasks: [
      {
        task_id: "deploy",
        task_order: 1,
        task_actor_type: "SCRIPT",
        description: "deploy to prod",
        expected_output: "deployed",
        script: { path: script, expect_exit: 0 },
        verifications: [{ kind: "script", cmd: "true", expect_exit: 0 }],
      },
      {
        task_id: "gate",
        task_order: 2,
        is_gate: true,
        gate_owner: "qa-001",
        gate_constraints: [{ kind: "verification-ref", task_id: "deploy" }],
      },
    ],
  });
  // Persist where the project paths expect it, and also at a path the CLI reads.
  const paths = projectPaths(home, plan.project_id);
  paths.ensure();
  savePlan(home, plan);
  planPath = join(sandbox, "plan.json");
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
}, 30_000);

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("teo CLI end-to-end", () => {
  it("runs a plan to pending-human", () => {
    const res = teo(["run", planPath]);
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.status).toBe("pending-human");
    expect(out.tasks.find((t: { task_id: string }) => t.task_id === "gate").signature).toMatch(
      /^[0-9a-f]{64}$/,
    );
  }, 30_000);

  it("status reflects pending-human after a run", () => {
    teo(["run", planPath]);
    const res = teo(["status", planPath]);
    expect(JSON.parse(res.stdout).status).toBe("pending-human");
  }, 30_000);

  it("accepting the human gate closes the stream", () => {
    teo(["run", planPath]);
    const gateRes = teo(["gate", planPath, "accept", "--as", "byazaki"]);
    expect(JSON.parse(gateRes.stdout).status).toBe("closed");
    const statusRes = teo(["status", planPath]);
    expect(JSON.parse(statusRes.stdout).status).toBe("closed");
  }, 30_000);

  it("audit shows the ledger and a finance rollup", () => {
    teo(["run", planPath]);
    const res = teo(["audit", planPath]);
    const out = JSON.parse(res.stdout);
    expect(Array.isArray(out.events)).toBe(true);
    expect(out.events.length).toBeGreaterThan(0);
    // SCRIPT-only run: no LLM cost.
    expect(out.finance.total.cost_usd).toBe(0);
  }, 30_000);

  it("run-script runs a library script directly", () => {
    const res = teo(["run-script", join(sandbox, "deploy.sh")]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("deployed to prod");
  }, 30_000);

  it("refuses to run a tampered plan", () => {
    const tampered = JSON.parse(require("node:fs").readFileSync(planPath, "utf8"));
    tampered.description = "malicious";
    const tamperedPath = join(sandbox, "tampered.json");
    writeFileSync(tamperedPath, JSON.stringify(tampered));
    const res = teo(["run", tamperedPath]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/signature|verify/i);
  }, 30_000);
});
