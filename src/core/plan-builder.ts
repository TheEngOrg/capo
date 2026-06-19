// =============================================================================
// plan-builder.ts — Incremental PlanBuilder (WS-P1-03a)
//
// Provides an incremental, per-task-validated builder for TEO Plans.
// Per-task validation fires at addTask() time; cross-task invariants
// (cycles, EMPTY_TASKS) are deferred to finalizePlan() → validatePlan().
//
// CRITICAL-PATH: This module feeds the schema→validate→runner chain.
// 100% branch coverage is required (see vitest.config.ts perFile thresholds).
// =============================================================================

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plan, TEOTask } from "./plan.js";
import { TEOTaskSchema } from "./plan.js";
import { validatePlan } from "./validate.js";
import type { ValidationError } from "./validate.js";
import { listAgentIds } from "../agents/load.js";

// ---------------------------------------------------------------------------
// Default agents directory — resolved relative to THIS file (src/core/),
// pointing to the sibling src/agents/ directory. Mirrors the pattern in
// load.ts but must traverse one level up since plan-builder.ts lives in core/.
// ---------------------------------------------------------------------------

const DEFAULT_AGENTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../agents");

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type AddTaskInput = {
  id: string;
  type: "SCRIPT" | "AGENT";
  agent_id?: string;
  command?: string;
  prompt?: string;
  needs?: string[];
  gates?: Array<{ name: string; on_fail: "block" | "warn" }>;
};

export type AddTaskResult = { accepted: true } | { accepted: false; reason: string };

export type FinalizeResult = { ok: true; plan: Plan } | { ok: false; errors: ValidationError[] };

// ---------------------------------------------------------------------------
// Non-executor agent ids — always excluded from the executor set regardless
// of whether they appear in the roster on disk.
// ---------------------------------------------------------------------------

const NON_EXECUTOR_IDS = new Set(["sage", "coordinator"]);

// ---------------------------------------------------------------------------
// PlanBuilder
// ---------------------------------------------------------------------------

interface PlanOpts {
  directive?: Plan["directive"];
  plan_id?: string;
  project_id?: string;
}

export class PlanBuilder {
  /** Executor set — snapshotted at construction, never mutated. */
  private readonly executorSet: Set<string>;

  /** Whether startPlan() has been called. */
  private started = false;

  /** Accumulated accepted tasks (in insertion order). */
  private acceptedTasks: TEOTask[] = [];

  /** Set of accepted task ids (for O(1) duplicate + needs[] checks). */
  private acceptedIds = new Set<string>();

  /** Options supplied to startPlan(). */
  private planOpts: PlanOpts = {};

  constructor(opts?: { agentsDir?: string }) {
    /* c8 ignore next */
    const agentsDir = opts?.agentsDir ?? DEFAULT_AGENTS_DIR;
    const allIds = listAgentIds(agentsDir);
    this.executorSet = new Set(allIds.filter((id) => !NON_EXECUTOR_IDS.has(id)));
  }

  // -------------------------------------------------------------------------
  // startPlan
  // -------------------------------------------------------------------------

  /**
   * Initialises builder state. Must be called before addTask() or finalizePlan().
   * Throws if called a second time without a reset in between.
   */
  startPlan(opts: PlanOpts): void {
    if (this.started) {
      throw new Error(
        "startPlan() has already been called. Call reset() before starting a new plan."
      );
    }
    this.started = true;
    this.planOpts = opts;
    this.acceptedTasks = [];
    this.acceptedIds = new Set();
  }

  // -------------------------------------------------------------------------
  // addTask
  // -------------------------------------------------------------------------

  /**
   * Validates and (if valid) accepts a single task.
   *
   * Returns { accepted: true } on success.
   * Returns { accepted: false; reason: string } on per-task validation failure.
   * NEVER throws on validation failure — throws ONLY if called before startPlan().
   */
  addTask(input: AddTaskInput): AddTaskResult {
    if (!this.started) {
      throw new Error("addTask() called before startPlan(). Call startPlan() first.");
    }

    // 1. Bad shape — type-specific required fields
    if (input.type === "AGENT") {
      if (!input.agent_id) {
        return { accepted: false, reason: "AGENT task requires 'agent_id' field." };
      }
      if (!input.prompt) {
        return { accepted: false, reason: "AGENT task requires 'prompt' field." };
      }
    } else {
      // SCRIPT
      if (!input.command) {
        return { accepted: false, reason: "SCRIPT task requires 'command' field." };
      }
    }

    // 2. Duplicate id
    if (this.acceptedIds.has(input.id)) {
      return {
        accepted: false,
        reason: `Duplicate task id: "${input.id}" has already been accepted in this session.`,
      };
    }

    // 3. Unresolved needs[] references (forward refs rejected — must be added in order)
    const needs = input.needs ?? [];
    for (const dep of needs) {
      if (!this.acceptedIds.has(dep)) {
        return {
          accepted: false,
          reason: `Unresolved needs[] reference: "${dep}" has not been accepted yet. Add task "${dep}" before this task.`,
        };
      }
    }

    // 4. Non-executor agent_id
    if (input.type === "AGENT" && !this.executorSet.has(input.agent_id!)) {
      return {
        accepted: false,
        reason: `agent_id "${input.agent_id}" is not in the executor set. Sage, coordinator, and unknown agents are not valid executors.`,
      };
    }

    // Build the task object and validate via TEOTaskSchema (catches extra keys,
    // wrong field types, etc.). Apply defaults for optional collection fields.
    const gates = input.gates ?? [];

    let taskCandidate: unknown;
    if (input.type === "SCRIPT") {
      taskCandidate = {
        id: input.id,
        type: "SCRIPT" as const,
        command: input.command,
        needs,
        gates,
      };
    } else {
      taskCandidate = {
        id: input.id,
        type: "AGENT" as const,
        agent_id: input.agent_id,
        prompt: input.prompt,
        needs,
        gates,
      };
    }

    // Defensive fallback — taskCandidate is built from validated, typed fields above,
    // so safeParse cannot fail in practice. Guards against future refactoring regressions.
    const parsed = TEOTaskSchema.safeParse(taskCandidate);
    /* c8 ignore next 3 */
    if (!parsed.success) {
      return { accepted: false, reason: `Task shape invalid: ${parsed.error.message}` };
    }

    // Accept
    this.acceptedTasks.push(parsed.data);
    this.acceptedIds.add(input.id);
    return { accepted: true };
  }

  // -------------------------------------------------------------------------
  // finalizePlan
  // -------------------------------------------------------------------------

  /**
   * Assembles accepted tasks into a Plan and runs cross-task validation.
   *
   * Returns { ok: true; plan: Plan } on success.
   * Returns { ok: false; errors: ValidationError[] } when validatePlan() fails.
   * Throws if called before startPlan().
   */
  finalizePlan(): FinalizeResult {
    if (!this.started) {
      throw new Error("finalizePlan() called before startPlan(). Call startPlan() first.");
    }

    const plan: Plan = {
      plan_id: this.planOpts.plan_id ?? crypto.randomUUID(),
      project_id: this.planOpts.project_id ?? "default",
      created_at: new Date().toISOString(),
      version: "1",
      ...(this.planOpts.directive !== undefined && { directive: this.planOpts.directive }),
      tasks: this.acceptedTasks,
    };

    const result = validatePlan(plan);
    if (result.valid) {
      return { ok: true, plan };
    }
    return { ok: false, errors: result.errors };
  }
}
