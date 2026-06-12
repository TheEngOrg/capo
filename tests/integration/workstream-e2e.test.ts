/**
 * End-to-end: drive the real `teo` binary through a parallel-workstream run.
 * Acquires an isolated sandbox tree, runs a SCRIPT plan inside it, and asserts
 * the work landed in the sandbox and NOT in the live project tree — the core
 * isolation guarantee. Then lists, diffs, and closes the workstream.
 *
 * Exercises the CLI surface as a subprocess (not the core in-process).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureTeoHome, resolveTeoHome } from "../../src/core/home/home.js";
import { issueAgent } from "../../src/core/identity/identity.js";
import { savePlan, signPlan, type ExecutionPlan } from "../../src/core/plan/plan.js";

let projectRoot: string;
let teoHome: string;

function teo(args: string[]) {
  return spawnSync("npx", ["tsx", join(process.cwd(), "src/index.ts"), ...args], {
    cwd: projectRoot,
    env: { ...process.env, TEO_HOME: teoHome },
    encoding: "utf8",
  });
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "teo-ws-e2e-"));
  projectRoot = join(root, "proj");
  teoHome = join(root, ".teo");
  mkdirSync(join(projectRoot, "scripts"), { recursive: true });
  writeFileSync(join(projectRoot, "a.txt"), "live\n");

  // A script that creates a file in its cwd — the isolation probe.
  const script = join(projectRoot, "scripts", "work.sh");
  writeFileSync(script, '#!/usr/bin/env bash\ntouch did-work.txt\n', { mode: 0o755 });
  chmodSync(script, 0o755);

  const home = resolveTeoHome({ TEO_HOME: teoHome });
  ensureTeoHome(home);
  const sage = issueAgent(home, { agent_type: "SAGE", issued_at: "2026-06-12T00:00:00Z" });
  const plan: ExecutionPlan = signPlan(home, {
    plan_id: "ws-e2e-plan",
    project_id: "ws-e2e-proj",
    description: "isolated workstream run",
    created_by: sage.agent_id,
    created_at: "2026-06-12T00:00:00Z",
    schema_version: "5.0",
    tasks: [
      {
        task_id: "work",
        task_order: 1,
        task_actor_type: "SCRIPT",
        description: "do work",
        expected_output: "did-work.txt",
        script: { path: "scripts/work.sh", expect_exit: 0 },
        verifications: [],
      },
    ],
  });
  savePlan(home, plan);
  writeFileSync(join(projectRoot, "plan.json"), JSON.stringify(plan, null, 2));
});

afterEach(() => {
  rmSync(join(projectRoot, ".."), { recursive: true, force: true });
});

describe("teo run --workstream (sandbox isolation)", () => {
  it("runs the plan in an isolated sandbox, leaving the live tree untouched", () => {
    const run = teo(["run", "plan.json", "--workstream", "ws-a", "--isolation", "sandbox"]);
    expect(run.stdout).toContain("pending-human");
    expect(run.stdout).toMatch(/workstream ws-a → sandbox/);

    // The work landed in the sandbox, NOT the live tree.
    expect(existsSync(join(projectRoot, "did-work.txt"))).toBe(false);
    expect(existsSync(join(teoHome, "worktrees", "ws-e2e-proj", "ws-a", "did-work.txt"))).toBe(true);
  });

  it("lists the running workstream, diffs the change, and closes it", () => {
    teo(["run", "plan.json", "--workstream", "ws-a", "--isolation", "sandbox"]);

    const list = teo(["workstream", "list", "plan.json"]);
    expect(list.stdout).toContain("ws-a");
    expect(list.stdout).toContain("running");

    const diff = teo(["workstream", "diff", "plan.json", "ws-a"]);
    expect(diff.stdout).toContain("did-work.txt");

    const close = teo(["workstream", "close", "plan.json", "ws-a"]);
    expect(close.stdout).toContain("ws-a");
    // The sandbox tree is gone after close.
    expect(existsSync(join(teoHome, "worktrees", "ws-e2e-proj", "ws-a"))).toBe(false);
  });
});
