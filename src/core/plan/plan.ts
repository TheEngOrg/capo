/**
 * plan — the TEO-EXECUTION-PLAN contract: schema, validate, sign, load.
 *
 * The only artifact that crosses PLAN -> RUN. Produced by Sage, consumed by the
 * orchestrator. Signed at creation; the orchestrator refuses an unsigned or
 * tampered plan, or one referencing an unregistered agent. See TEO-5.md §3.
 *
 * Task variants:
 *   SCRIPT  — default, mechanical, no agent (task_actor_type: "SCRIPT", script block)
 *   AGENT   — generation/judgment only (ENGINEER|QA|CREATE|COORD, needs task_actor)
 *   Gate    — is_gate:true, gate_owner signs, gate_constraints assert prior work
 */
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureSigningKey } from "../signing/signing.js";
import { lookupAgent } from "../identity/identity.js";
import type { TeoHome } from "../home/home.js";

export const PLAN_SCHEMA_VERSION = "5.0";

export type ScriptActorType = "SCRIPT";
export type AgentActorType = "ENGINEER" | "QA" | "CREATE" | "COORD";

export interface Verification {
  kind: "script";
  cmd: string;
  expect_exit: number;
}

export interface ScriptBlock {
  path: string;
  args?: string[];
  expect_exit: number;
}

export interface GateConstraint {
  kind: "verification-ref" | "document";
  task_id?: string;
  path?: string;
}

export interface PlanTask {
  task_id: string;
  task_order: number;
  description?: string;
  expected_output?: string;

  // SCRIPT | AGENT discriminant. Absent on a gate.
  task_actor_type?: ScriptActorType | AgentActorType;
  task_actor?: string; // agent_id — required for AGENT tasks
  script?: ScriptBlock; // required for SCRIPT tasks
  verifications?: Verification[];
  /**
   * How many times to re-run this task if its work or mechanical verification
   * fails, before the run goes to error. Default 0 (no retry — first failure
   * is terminal). Useful for flaky checks; SCRIPT/AGENT both honored.
   */
  max_retries?: number;

  // Gate fields.
  is_gate?: boolean;
  gate_owner?: string; // agent_id
  gate_constraints?: GateConstraint[];
}

export interface ExecutionPlan {
  plan_id: string;
  project_id: string;
  description: string;
  created_by: string;
  created_at: string;
  schema_version: string;
  tasks: PlanTask[];
  plan_signature?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const AGENT_ACTOR_TYPES: AgentActorType[] = ["ENGINEER", "QA", "CREATE", "COORD"];

/** Validate a plan's structure and that every referenced agent is registered. */
export function validatePlan(home: TeoHome, plan: ExecutionPlan): ValidationResult {
  const errors: string[] = [];

  if (plan.schema_version !== PLAN_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${PLAN_SCHEMA_VERSION}, got ${plan.schema_version}`);
  }
  if (!plan.tasks || plan.tasks.length === 0) {
    errors.push("plan must have at least one task");
    return { ok: false, errors };
  }

  const orders = new Set<number>();
  const taskIds = new Set(plan.tasks.map((t) => t.task_id));

  for (const task of plan.tasks) {
    if (orders.has(task.task_order)) {
      errors.push(`duplicate task_order ${task.task_order}`);
    }
    orders.add(task.task_order);

    if (task.max_retries !== undefined && (!Number.isInteger(task.max_retries) || task.max_retries < 0)) {
      errors.push(`task ${task.task_id}: max_retries must be a non-negative integer`);
    }

    if (task.is_gate) {
      if (!task.gate_owner || lookupAgent(home, task.gate_owner) === null) {
        errors.push(`gate ${task.task_id}: gate_owner "${task.gate_owner}" is not a registered agent`);
      }
      for (const c of task.gate_constraints ?? []) {
        if (c.kind === "verification-ref" && c.task_id && !taskIds.has(c.task_id)) {
          errors.push(`gate ${task.task_id}: constraint references missing task "${c.task_id}"`);
        }
      }
      continue;
    }

    if (task.task_actor_type === "SCRIPT") {
      if (!task.script || !task.script.path) {
        errors.push(`task ${task.task_id}: SCRIPT task requires a script block`);
      }
      continue;
    }

    if (task.task_actor_type && AGENT_ACTOR_TYPES.includes(task.task_actor_type as AgentActorType)) {
      if (!task.task_actor) {
        errors.push(`task ${task.task_id}: AGENT task requires task_actor`);
      } else if (lookupAgent(home, task.task_actor) === null) {
        errors.push(`task ${task.task_id}: task_actor "${task.task_actor}" is not a registered agent`);
      }
      continue;
    }

    errors.push(`task ${task.task_id}: unknown or missing task_actor_type`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Deterministic JSON serialization with sorted keys — so the signature is
 * stable regardless of property insertion order. Excludes plan_signature.
 */
function canonicalPlanJson(plan: ExecutionPlan): string {
  const { plan_signature: _omit, ...body } = plan;
  return stableStringify(body);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

/** Sign a plan over its canonical body. Returns a new plan with plan_signature. */
export function signPlan(home: TeoHome, plan: ExecutionPlan): ExecutionPlan {
  const key = ensureSigningKey(home);
  const sig = createHmac("sha256", key).update(canonicalPlanJson(plan)).digest("hex");
  return { ...plan, plan_signature: sig };
}

/** Verify a plan's signature. False if unsigned or tampered. */
export function verifyPlan(home: TeoHome, plan: ExecutionPlan): boolean {
  if (!plan.plan_signature) return false;
  const key = ensureSigningKey(home);
  const expected = createHmac("sha256", key).update(canonicalPlanJson(plan)).digest("hex");
  return expected === plan.plan_signature;
}

/** Write a signed plan to plans/<plan_id>.json. Returns the path. */
export function savePlan(home: TeoHome, plan: ExecutionPlan): string {
  const dir = join(home.memoryDir, plan.project_id, "plans");
  // The caller is expected to have ensured the project paths; mkdir defensively.
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${plan.plan_id}.json`);
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
  return path;
}

/** Load a plan from disk and verify its signature. Throws on mismatch/missing. */
export function loadPlan(home: TeoHome, path: string): ExecutionPlan {
  if (!existsSync(path)) {
    throw new Error(`plan file not found: ${path}`);
  }
  const plan = JSON.parse(readFileSync(path, "utf8")) as ExecutionPlan;
  if (!verifyPlan(home, plan)) {
    throw new Error(`plan signature failed to verify: ${path}`);
  }
  return plan;
}
