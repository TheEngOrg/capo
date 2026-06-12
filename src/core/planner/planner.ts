/**
 * planner — turns a user request into a signed TEO-EXECUTION-PLAN.
 *
 * This is the PLAN phase from the diagram: Sage classifies and decomposes the
 * request (never solves it), preferring SCRIPT tasks over agents. The LLM emits
 * a plan *body* (description + tasks); the planner deterministically fills the
 * identity-bearing fields it must own — project_id, plan_id, created_by, the
 * task_actor agent ids — then validates and signs. The one LLM call goes through
 * the same agent-spawn runner, so this is testable with a fake. See TEO-5.md §5a.
 */
import { spawnAgent, type RunnerSelection } from "../agent-spawn/agent-spawn.js";
import type { ProjectPaths, TeoHome } from "../home/home.js";
import { issueAgent, type AgentType } from "../identity/identity.js";
import {
  signPlan,
  validatePlan,
  type ExecutionPlan,
  type PlanTask,
} from "../plan/plan.js";
import { appendEvent } from "../telemetry/telemetry.js";

/** The shape the LLM is asked to emit — body only, no identity fields. */
export interface PlanBody {
  description: string;
  tasks: PlanTask[];
}

export interface PlanRequestOptions extends RunnerSelection {
  project_id: string;
  plan_id: string;
  /** ISO-8601 UTC; the CLI passes a real clock. */
  created_at: string;
}

const AGENT_ACTOR_TYPES = new Set<AgentType>(["ENGINEER", "QA", "CREATE", "COORD"]);

/** Build the Sage planning prompt embedding the §5a contract + JSON output shape. */
export function buildPlanPrompt(request: string): string {
  return `You are Sage, the planner for the TEO orchestration engine.

Your job is to CLASSIFY and DECOMPOSE the request into an execution plan.
You do NOT solve the request and you do NOT write the code yourself — never solve.
Any research a task needs is done later by that task's own agent.

CORE BIAS — prefer a SCRIPT task over an agent task.
For each unit of work apply this litmus test: "Could a human do this by running a
fixed command?" If YES, it is a SCRIPT task. An agent is only justified when the
answer is NO (the work needs generation or judgment: writing code, design, prose,
evaluation). Mechanical work — deploy, build, migrate, test, provision, move files
— is always a SCRIPT task. If a needed script does not exist yet, emit a generation
task whose OUTPUT is the script, followed by a SCRIPT task that runs it.

Emit ONLY a single JSON object (optionally inside a \`\`\`json fenced block) with:
{
  "description": "<one line: what the work stream is for>",
  "tasks": [
    {
      "task_id": "<short slug>",
      "task_order": <int, ascending>,
      "task_actor_type": "SCRIPT" | "ENGINEER" | "QA" | "CREATE" | "COORD",
      "description": "<what this task does>",
      "expected_output": "<the verifiable expectation>",
      "script": { "path": "scripts/x.sh", "args": [], "expect_exit": 0 },   // SCRIPT tasks only
      "verifications": [ { "kind": "script", "cmd": "<shell cmd>", "expect_exit": 0 } ],
      "max_retries": 0,                                                       // optional: re-run N times if a flaky task/verification fails
      "is_gate": true, "gate_owner": "QA", "gate_constraints": [ ... ]       // gate tasks only
    }
  ]
}

Do NOT include plan_id, project_id, created_by, task_actor, or signatures — those
are assigned by the engine. Reference agent ROLES (task_actor_type), not ids.

REQUEST:
${request}`;
}

/** Extract and parse the plan-body JSON from raw LLM output (handles fenced blocks). */
export function parsePlanResponse(raw: string): PlanBody {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : sliceFirstJsonObject(raw);
  if (!candidate) {
    throw new Error("planner produced no JSON object");
  }
  return JSON.parse(candidate) as PlanBody;
}

/** Find the first balanced {...} object in a string, or null. */
function sliceFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Produce a signed plan from a request: invoke the planner LLM, parse the body,
 * register the sage planner + any agents the AGENT tasks need, wire task_actor
 * ids, then validate and sign. Throws on planner failure or invalid output.
 */
export async function planFromRequest(
  home: TeoHome,
  paths: ProjectPaths,
  request: string,
  opts: PlanRequestOptions,
): Promise<ExecutionPlan> {
  // Register the planner identity (it becomes created_by).
  const sage = issueAgent(home, { agent_type: "SAGE", issued_at: opts.created_at });

  const spawn = await spawnAgent(
    {
      agent_id: sage.agent_id,
      agent_type: "SAGE",
      task_id: "plan",
      prompt: buildPlanPrompt(request),
    },
    opts,
  );
  if (!spawn.ok) {
    throw new Error(`planner LLM call failed: ${spawn.error ?? "unknown error"}`);
  }

  const body = parsePlanResponse(spawn.output);

  // Wire identity-bearing fields the engine owns. AGENT tasks get a task_actor;
  // gates get a registered gate_owner. The LLM references roles; we issue ids.
  const tasks: PlanTask[] = body.tasks.map((task) => {
    if (task.is_gate) {
      const role = (task.gate_owner ?? "QA") as AgentType;
      const ownerType = AGENT_ACTOR_TYPES.has(role) ? role : ("QA" as AgentType);
      const owner = issueAgent(home, { agent_type: ownerType, issued_at: opts.created_at });
      return { ...task, gate_owner: owner.agent_id };
    }
    if (task.task_actor_type && AGENT_ACTOR_TYPES.has(task.task_actor_type as AgentType)) {
      const agent = issueAgent(home, {
        agent_type: task.task_actor_type as AgentType,
        issued_at: opts.created_at,
      });
      return { ...task, task_actor: agent.agent_id };
    }
    return task;
  });

  const draft: ExecutionPlan = {
    plan_id: opts.plan_id,
    project_id: opts.project_id,
    description: body.description,
    created_by: sage.agent_id,
    created_at: opts.created_at,
    schema_version: "5.0",
    tasks,
  };

  const validation = validatePlan(home, draft);
  if (!validation.ok) {
    throw new Error(`planner produced an invalid plan: ${validation.errors.join("; ")}`);
  }

  // PLAN telemetry — records the planning cost against the sage actor, so the
  // finance rollup captures planning tokens, not just task execution.
  appendEvent(paths, {
    plan_id: opts.plan_id,
    task_id: null,
    ts: opts.created_at,
    phase: "PLAN",
    actor_id: sage.agent_id,
    actor_type: "SAGE",
    verdict: "n/a",
    tokens_in: spawn.tokens_in,
    tokens_out: spawn.tokens_out,
    model: spawn.model,
    cost_usd: spawn.cost_usd,
    duration_ms: spawn.duration_ms,
    detail: { task_count: tasks.length },
    signature: null,
  });

  return signPlan(home, draft);
}
