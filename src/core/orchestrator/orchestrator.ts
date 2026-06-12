/**
 * orchestrator — the deterministic step-runner. The heart of TEO 5.
 *
 * Intake a signed TEO-EXECUTION-PLAN, run its tasks in task_order, branching on
 * task_actor_type: SCRIPT -> script-runner (zero tokens), AGENT -> agent-spawn
 * (the one LLM call). Each task is mechanically verified; gates are signed by
 * their gate_owner. Every step appends a telemetry event. The run completes at
 * `pending-human` (goods delivered, awaiting the async human gate) or `error`
 * (a task or verification failed). No LLM drives sequencing, gates, or telemetry.
 * See TEO-5.md §1, §6.
 */
import { spawnAgent, type RunnerSelection } from "../agent-spawn/agent-spawn.js";
import type { TeoHome } from "../home/home.js";
import type { ProjectPaths } from "../home/home.js";
import { runVerifications } from "../mechanical-verify/mechanical-verify.js";
import { verifyPlan, type ExecutionPlan, type PlanTask } from "../plan/plan.js";
import { runScript } from "../script-runner/script-runner.js";
import { sign } from "../signing/signing.js";
import { appendEvent, nextSeq, type ActorType, type Phase, type Verdict } from "../telemetry/telemetry.js";

export interface TaskOutcome {
  task_id: string;
  verdict: Verdict;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  /** Gate-only: who signed and the signature. */
  signed_by?: string;
  signature?: string;
  detail?: Record<string, unknown>;
}

export type RunStatus = "pending-human" | "error";

export interface RunResult {
  plan_id: string;
  status: RunStatus;
  tasks: TaskOutcome[];
}

export interface RunOptions extends RunnerSelection {
  cwd?: string;
}

const ACTOR_TYPE_MAP: Record<string, ActorType> = {
  SCRIPT: "SYSTEM",
  ENGINEER: "ENGINEER",
  QA: "QA",
  CREATE: "CREATE",
  COORD: "COORD",
};

/** Emit one telemetry event for a plan step. Thin wrapper over appendEvent. */
function emit(
  paths: ProjectPaths,
  planId: string,
  fields: {
    task_id: string | null;
    phase: Phase;
    actor_id: string;
    actor_type: ActorType;
    verdict: Verdict;
    ts: string;
    tokens_in?: number;
    tokens_out?: number;
    model?: string;
    cost_usd?: number;
    duration_ms?: number;
    detail?: Record<string, unknown>;
    signature?: string | null;
  },
): void {
  appendEvent(paths, {
    plan_id: planId,
    task_id: fields.task_id,
    ts: fields.ts,
    phase: fields.phase,
    actor_id: fields.actor_id,
    actor_type: fields.actor_type,
    verdict: fields.verdict,
    tokens_in: fields.tokens_in,
    tokens_out: fields.tokens_out,
    model: fields.model,
    cost_usd: fields.cost_usd,
    duration_ms: fields.duration_ms,
    detail: fields.detail ?? {},
    signature: fields.signature ?? null,
  });
}

/**
 * Run a signed execution plan to completion. Resolves with the run result;
 * throws only if the plan fails signature verification (a tampered plan must
 * never execute).
 */
export async function runPlan(
  home: TeoHome,
  paths: ProjectPaths,
  plan: ExecutionPlan,
  opts: RunOptions,
): Promise<RunResult> {
  if (!verifyPlan(home, plan)) {
    throw new Error(`refusing to run: plan signature failed to verify (${plan.plan_id})`);
  }

  const ts = plan.created_at; // deterministic clock from the plan (no Date.now in core)

  // RUN intake — marks the orchestrator beginning execution of this plan.
  emit(paths, plan.plan_id, {
    task_id: null,
    phase: "RUN",
    actor_id: "system",
    actor_type: "SYSTEM",
    verdict: "n/a",
    ts,
    detail: { tasks: plan.tasks.length },
  });

  const ordered = [...plan.tasks].sort((a, b) => a.task_order - b.task_order);
  const outcomes: TaskOutcome[] = [];

  for (const task of ordered) {
    if (task.is_gate) {
      const outcome = runGate(home, paths, plan.plan_id, task, ts);
      outcomes.push(outcome);
      continue;
    }

    const outcome = await runTask(paths, plan.plan_id, task, ts, opts);
    outcomes.push(outcome);
    if (outcome.verdict === "fail") {
      emit(paths, plan.plan_id, {
        task_id: null,
        phase: "ERROR",
        actor_id: "system",
        actor_type: "SYSTEM",
        verdict: "fail",
        ts,
        detail: { failed_task: task.task_id },
      });
      return { plan_id: plan.plan_id, status: "error", tasks: outcomes };
    }
  }

  // Goods delivered — park awaiting the async human gate.
  emit(paths, plan.plan_id, {
    task_id: null,
    phase: "DELIVER",
    actor_id: "system",
    actor_type: "SYSTEM",
    verdict: "n/a",
    ts,
    detail: { status: "pending-human" },
  });

  return { plan_id: plan.plan_id, status: "pending-human", tasks: outcomes };
}

/** Run one non-gate task: do the work (SCRIPT or AGENT), then mechanically verify. */
async function runTask(
  paths: ProjectPaths,
  planId: string,
  task: PlanTask,
  ts: string,
  opts: RunOptions,
): Promise<TaskOutcome> {
  // A validated non-gate task always carries a known task_actor_type.
  const taskType = task.task_actor_type as string;
  const actorType = ACTOR_TYPE_MAP[taskType];
  const actorId = task.task_actor ?? "system";

  emit(paths, planId, {
    task_id: task.task_id,
    phase: "TASK_START",
    actor_id: actorId,
    actor_type: actorType,
    verdict: "n/a",
    ts,
  });

  let tokens_in: number | undefined;
  let tokens_out: number | undefined;
  let cost_usd: number | undefined;
  let workOk: boolean;
  let workDetail: Record<string, unknown>;

  if (task.task_actor_type === "SCRIPT") {
    // SCRIPT task — zero LLM tokens.
    const r = runScript(
      { path: task.script!.path, args: task.script!.args, expect_exit: task.script!.expect_exit },
      { cwd: opts.cwd },
    );
    workOk = r.ok;
    workDetail = { exit_code: r.exit_code, kind: "script" };
  } else {
    // AGENT task — the one LLM call.
    const r = await spawnAgent(
      {
        agent_id: actorId,
        agent_type: taskType,
        task_id: task.task_id,
        prompt: task.description ?? "",
        cwd: opts.cwd,
      },
      opts,
    );
    workOk = r.ok;
    tokens_in = r.tokens_in;
    tokens_out = r.tokens_out;
    cost_usd = r.cost_usd;
    workDetail = { kind: "agent", model: r.model };
  }

  emit(paths, planId, {
    task_id: task.task_id,
    phase: "TASK_OUTPUT",
    actor_id: actorId,
    actor_type: actorType,
    verdict: workOk ? "pass" : "fail",
    ts,
    tokens_in,
    tokens_out,
    cost_usd,
    detail: workDetail,
  });

  if (!workOk) {
    return { task_id: task.task_id, verdict: "fail", tokens_in, tokens_out, cost_usd, detail: workDetail };
  }

  // Mechanical verification of the task's expectation.
  const report = runVerifications(task.verifications ?? [], { cwd: opts.cwd });
  emit(paths, planId, {
    task_id: task.task_id,
    phase: "MECH_VERIFY",
    actor_id: "system",
    actor_type: "SYSTEM",
    verdict: report.verdict,
    ts,
    detail: { checks: report.results.length },
  });

  return {
    task_id: task.task_id,
    verdict: report.verdict,
    tokens_in,
    tokens_out,
    cost_usd,
    detail: workDetail,
  };
}

/** Run a gate: sign a pass verdict from its gate_owner over the canonical message. */
function runGate(
  home: TeoHome,
  paths: ProjectPaths,
  planId: string,
  task: PlanTask,
  ts: string,
): TaskOutcome {
  // A validated plan guarantees a gate has a registered gate_owner.
  const owner = task.gate_owner as string;
  // Compute seq, sign over it, then append the event carrying its signature.
  const seq = nextSeq(paths, planId);
  const signature = sign(home, {
    plan_id: planId,
    task_id: task.task_id,
    actor_id: owner,
    verdict: "pass",
    ts,
    seq,
  });

  appendEvent(paths, {
    plan_id: planId,
    task_id: task.task_id,
    ts,
    phase: "GATE",
    actor_id: owner,
    actor_type: "QA",
    verdict: "pass",
    detail: { constraints: (task.gate_constraints ?? []).length },
    signature,
  });

  return { task_id: task.task_id, verdict: "pass", signed_by: owner, signature };
}
