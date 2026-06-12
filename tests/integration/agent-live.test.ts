/**
 * Live agent task: runs a real AGENT task through the claude-cli runner and
 * confirms real token/cost telemetry lands in the ledger. Skips cleanly when
 * `claude` is not on PATH (CI without the binary stays green).
 *
 * This is the proof that the one LLM call site works against the live binary,
 * not just the fake runner used by the orchestrator unit tests.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureTeoHome,
  projectPaths,
  resolveTeoHome,
  type ProjectPaths,
  type TeoHome,
} from "../../src/core/home/home.js";
import { issueAgent } from "../../src/core/identity/identity.js";
import { signPlan, type ExecutionPlan } from "../../src/core/plan/plan.js";
import { runPlan } from "../../src/core/orchestrator/orchestrator.js";
import { readEvents } from "../../src/core/telemetry/telemetry.js";

function claudeAvailable(): boolean {
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  return which.status === 0 && which.stdout.trim().length > 0;
}

const HAS_CLAUDE = claudeAvailable();
const describeLive = HAS_CLAUDE ? describe : describe.skip;

let sandbox: string;
let home: TeoHome;
let paths: ProjectPaths;
const PROJECT = "live-proj";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-live-"));
  home = resolveTeoHome({ TEO_HOME: join(sandbox, ".teo") });
  ensureTeoHome(home);
  paths = projectPaths(home, PROJECT);
  paths.ensure();
  issueAgent(home, { agent_type: "SAGE", issued_at: "2026-06-11T00:00:00Z" }); // sage-001
  issueAgent(home, { agent_type: "ENGINEER", issued_at: "2026-06-11T00:00:00Z" }); // eng-001
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describeLive("live agent task via claude CLI", () => {
  it("runs an AGENT task through the real claude binary and records token cost", async () => {
    const plan: ExecutionPlan = signPlan(home, {
      plan_id: "live-plan",
      project_id: PROJECT,
      description: "answer a trivial question",
      created_by: "sage-001",
      created_at: "2026-06-11T00:00:00Z",
      schema_version: "5.0",
      tasks: [
        {
          task_id: "ask",
          task_order: 1,
          task_actor_type: "ENGINEER",
          task_actor: "eng-001",
          description: "Reply with exactly the single word: acknowledged",
          expected_output: "the word acknowledged",
          verifications: [],
        },
      ],
    });

    const result = await runPlan(home, paths, plan, { kind: "claude-cli", cwd: sandbox });

    expect(result.status).toBe("pending-human");
    expect(result.tasks[0].verdict).toBe("pass");
    // Real call -> real token usage recorded on the task outcome.
    expect(result.tasks[0].tokens_in ?? 0).toBeGreaterThan(0);
    expect(result.tasks[0].tokens_out ?? 0).toBeGreaterThan(0);

    // And it lands in the append-only ledger on the TASK_OUTPUT event.
    const taskOutput = readEvents(paths, "live-plan").find((e) => e.phase === "TASK_OUTPUT");
    expect(taskOutput?.tokens_in ?? 0).toBeGreaterThan(0);
    expect(taskOutput?.cost_usd ?? 0).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
