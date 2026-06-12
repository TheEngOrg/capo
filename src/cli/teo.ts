/**
 * cli — the human-facing surface. Thin glue over the deterministic core.
 *
 * Verbs:
 *   teo run <plan.json>        run a signed plan to pending-human|error
 *   teo gate <plan> <accept|reject> [--reason r] [--as handle]   async human gate
 *   teo audit <plan>           print the telemetry ledger + finance rollup
 *   teo close <plan>           accept shorthand (close the stream)
 *   teo status <plan>          derived stream state
 *   teo run-script <path> [args...]   run a library script through the same runner
 *
 * Plan files carry project_id; the CLI resolves ~/.teo and the project paths
 * from there. This module is exercised by integration tests, not the unit gate.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { ensureTeoHome, projectId, projectPaths, resolveTeoHome } from "../core/home/home.js";
import { humanGate } from "../core/human-gate/human-gate.js";
import { runPlan } from "../core/orchestrator/orchestrator.js";
import { planFromRequest } from "../core/planner/planner.js";
import { loadPlan, savePlan, type ExecutionPlan } from "../core/plan/plan.js";
import { runScript } from "../core/script-runner/script-runner.js";
import { deriveStreamState } from "../core/stream/stream.js";
import { financeRollup, readEvents } from "../core/telemetry/telemetry.js";

/** ISO-8601 UTC now. The CLI is the system boundary, so a real clock is fine here. */
function nowIso(): string {
  return new Date().toISOString();
}

function resolveProject(plan: ExecutionPlan) {
  const home = resolveTeoHome();
  ensureTeoHome(home);
  const paths = projectPaths(home, plan.project_id);
  paths.ensure();
  return { home, paths };
}

export function buildProgram(): Command {
  const program = new Command();
  program.name("teo").description("TEO 5 — deterministic orchestration").version("5.0.0");

  program
    .command("plan")
    .argument("<request>", "what you want the team to do")
    .option("--out <path>", "where to write the signed plan", "plan.json")
    .option("--runner <kind>", "claude-cli | anthropic-api", "claude-cli")
    .description("Sage classifies + decomposes the request into a signed plan")
    .action(async (request: string, opts: { out: string; runner: string }) => {
      const home = resolveTeoHome();
      ensureTeoHome(home);
      const project_id = projectId({ absPath: process.cwd() });
      const paths = projectPaths(home, project_id);
      paths.ensure();
      const plan = await planFromRequest(home, paths, request, {
        project_id,
        plan_id: randomUUID(),
        created_at: nowIso(),
        kind: opts.runner === "anthropic-api" ? "anthropic-api" : "claude-cli",
      });
      savePlan(home, plan);
      writeFileSync(opts.out, `${JSON.stringify(plan, null, 2)}\n`);
      process.stdout.write(`plan ${plan.plan_id} written to ${opts.out} (${plan.tasks.length} tasks)\n`);
    });

  program
    .command("run")
    .argument("<plan>", "path to a signed TEO-EXECUTION-PLAN json file")
    .description("run a plan to pending-human or error")
    .action(async (planPath: string) => {
      const homeForLoad = resolveTeoHome();
      ensureTeoHome(homeForLoad);
      const plan = loadPlan(homeForLoad, planPath);
      const { home, paths } = resolveProject(plan);
      const result = await runPlan(home, paths, plan, { cwd: process.cwd() });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.status === "error") process.exitCode = 1;
    });

  program
    .command("gate")
    .argument("<plan>", "path to the plan json")
    .argument("<decision>", "accept | reject")
    .option("--reason <reason>", "rejection reason / accept note", "")
    .option("--as <handle>", "human handle", "operator")
    .description("async human final gate")
    .action((planPath: string, decision: string, opts: { reason: string; as: string }) => {
      const home = resolveTeoHome();
      ensureTeoHome(home);
      const plan = JSON.parse(readFileSync(planPath, "utf8")) as ExecutionPlan;
      const paths = projectPaths(home, plan.project_id);
      paths.ensure();
      const result = humanGate(home, paths, {
        plan_id: plan.plan_id,
        decision: decision === "accept" ? "accept" : "reject",
        human: `human:${opts.as}`,
        ts: nowIso(),
        reason: opts.reason,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  program
    .command("close")
    .argument("<plan>", "path to the plan json")
    .option("--as <handle>", "human handle", "operator")
    .description("accept + close the stream (shorthand for gate accept)")
    .action((planPath: string, opts: { as: string }) => {
      const home = resolveTeoHome();
      ensureTeoHome(home);
      const plan = JSON.parse(readFileSync(planPath, "utf8")) as ExecutionPlan;
      const paths = projectPaths(home, plan.project_id);
      paths.ensure();
      const result = humanGate(home, paths, {
        plan_id: plan.plan_id,
        decision: "accept",
        human: `human:${opts.as}`,
        ts: nowIso(),
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  program
    .command("status")
    .argument("<plan>", "path to the plan json")
    .description("derived stream state")
    .action((planPath: string) => {
      const home = resolveTeoHome();
      ensureTeoHome(home);
      const plan = JSON.parse(readFileSync(planPath, "utf8")) as ExecutionPlan;
      const paths = projectPaths(home, plan.project_id);
      const state = deriveStreamState(paths, plan.plan_id);
      process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    });

  program
    .command("audit")
    .argument("<plan>", "path to the plan json")
    .description("print the telemetry ledger + finance rollup")
    .action((planPath: string) => {
      const home = resolveTeoHome();
      ensureTeoHome(home);
      const plan = JSON.parse(readFileSync(planPath, "utf8")) as ExecutionPlan;
      const paths = projectPaths(home, plan.project_id);
      const events = readEvents(paths, plan.plan_id);
      const finance = financeRollup(paths, plan.plan_id);
      process.stdout.write(`${JSON.stringify({ events, finance }, null, 2)}\n`);
    });

  program
    .command("run-script")
    .argument("<path>", "path to a library script")
    .argument("[args...]", "script arguments")
    .description("run a library script through the same runner the orchestrator uses")
    .action((path: string, args: string[]) => {
      const result = runScript({ path, args, expect_exit: 0 }, { cwd: process.cwd() });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.ok ? 0 : result.exit_code || 1;
    });

  return program;
}
