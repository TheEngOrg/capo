// =============================================================================
// types.ts — TEOAdapter seam contract (WS-P1-03b)
//
// Pure interface definitions — no runtime code, no logic.
// Defines the adapter contract that all concrete adapters (StubAdapter, etc.)
// must satisfy. The interface decouples the orchestration layer from any
// specific implementation (LLM-backed, stub, mock, etc.).
//
// ADAPTER SEAM CONTRACT:
//   - sagePlan(): takes a PlanningContext and returns a validated Plan.
//     Production adapters call an LLM; StubAdapter drives PlanBuilder directly.
//   - spawnAgent(): takes a TEOTask and returns a StepResult.
//     Production adapters spawn real Claude agents; StubAdapter returns PASS.
// =============================================================================

import type { Plan, TEOTask } from "../core/plan.js";
import type { StepResult } from "../core/runner.js";

/**
 * Context supplied to sagePlan() for generating a new execution plan.
 * Mirrors the top-level Plan fields that the adapter is responsible for setting.
 */
export interface PlanningContext {
  /** Optional directive — BUILD | FIX | REVIEW | PLAN | ARCHITECTURAL. */
  directive?: Plan["directive"];
  /** Project identifier. Propagates directly into the returned Plan.project_id. */
  project_id: string;
  /** Human-readable description of the work to be planned. */
  description: string;
}

/**
 * Context passed to spawnAgent() per task execution.
 * Mirrors RunContext from runner.ts — provides plan/project identity and timeout.
 */
export interface AgentContext {
  /** ID of the plan this task belongs to. */
  planId: string;
  /** Project identifier for the running plan. */
  projectId: string;
  /** Per-step timeout in milliseconds. Propagated to the spawned agent if applicable. */
  stepTimeoutMs: number;
  /** Optional working directory for this task, provided by WorkstreamTree. */
  cwd?: string;
}

/**
 * TEOAdapter — the adapter seam between the orchestration layer and
 * plan-generation / agent-execution backends.
 *
 * All implementations must be structurally assignable to this interface
 * without a cast (enforced by compile-time type checks in stub.test.ts).
 */
export interface TEOAdapter {
  /**
   * Generate a validated execution Plan from a planning context.
   * Must return a Plan that passes PlanSchema.parse() and validatePlan().
   */
  sagePlan(request: PlanningContext, context: Record<string, unknown>): Promise<Plan>;

  /**
   * Execute a single task step and return its result.
   * Must echo task.id as taskId in the returned StepResult.
   */
  spawnAgent(task: TEOTask, context: AgentContext): Promise<StepResult>;
}
