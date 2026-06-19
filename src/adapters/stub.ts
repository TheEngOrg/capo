// =============================================================================
// stub.ts — StubAdapter: model-free CI adapter (WS-P1-03b)
//
// StubAdapter implements TEOAdapter without any LLM, network, or real agent
// execution. It is the canonical CI/test adapter: deterministic, fast, and
// fully in-process.
//
// IMPLEMENTATION CONTRACT:
//   - sagePlan() DRIVES PlanBuilder — never hand-rolls a Plan literal.
//     This is verified by builder-coupling tests that inject custom rosters.
//   - spawnAgent() returns a stub PASS result echoing the task ID.
//     Never spawns a real Claude agent.
//
// See stub.test.ts for the full contract spec and builder-coupling rationale.
// =============================================================================

import { PlanBuilder } from "../core/plan-builder.js";
import type { Plan, TEOTask } from "../core/plan.js";
import type { StepResult } from "../core/runner.js";
import type { TEOAdapter, PlanningContext, AgentContext } from "./types.js";

export class StubAdapter implements TEOAdapter {
  private readonly agentsDir: string | undefined;

  /**
   * @param opts.agentsDir - Optional path to a custom agent roster directory.
   *   When provided, it is passed through to PlanBuilder so tests can inject
   *   a minimal temp roster without depending on the production src/agents/ dir.
   *   Mirrors the PlanBuilder constructor contract exactly.
   */
  constructor(opts?: { agentsDir?: string }) {
    this.agentsDir = opts?.agentsDir;
  }

  /**
   * Generate a Plan by driving PlanBuilder through its full lifecycle:
   * startPlan → addTask (at least one SCRIPT task) → finalizePlan.
   *
   * The agentsDir injected at construction is forwarded to PlanBuilder so that
   * builder-coupling tests can control the executor roster precisely.
   *
   * Throws if PlanBuilder.finalizePlan() returns !ok (validation errors).
   * Never calls an LLM or makes network requests.
   */
  sagePlan(request: PlanningContext, _context: Record<string, unknown>): Promise<Plan> {
    const builder = new PlanBuilder(
      this.agentsDir !== undefined ? { agentsDir: this.agentsDir } : undefined
    );

    // Pass directive only when defined — exactOptionalPropertyTypes compliance.
    // Pass project_id only when non-empty: the builder's finalizePlan() uses
    // `project_id ?? "default"` (nullish coalesce), so we must omit rather than
    // pass "" to get the fallback. An empty string is falsy but not nullish.
    const planOpts: { directive?: Plan["directive"]; project_id?: string } = {};
    if (request.project_id !== "") {
      planOpts.project_id = request.project_id;
    }
    if (request.directive !== undefined) {
      planOpts.directive = request.directive;
    }

    builder.startPlan(planOpts);

    // Add the minimal stub task — a SCRIPT task requires only id and command.
    // Using "true" as the command: universally available no-op on all platforms.
    builder.addTask({
      id: "stub-task-1",
      type: "SCRIPT",
      command: "true",
    });

    const result = builder.finalizePlan();
    /* c8 ignore next 4 */
    if (!result.ok) {
      const messages = result.errors.map((e) => e.message).join("; ");
      return Promise.reject(
        new Error(`StubAdapter.sagePlan: plan validation failed — ${messages}`)
      );
    }

    return Promise.resolve(result.plan);
  }

  /**
   * Stub executor — returns PASS for any TEOTask without spawning a real agent.
   * Echoes task.id as taskId (including empty string — never throws on empty id).
   * Accepts SCRIPT and AGENT task types without discrimination.
   */
  spawnAgent(task: TEOTask, _context: AgentContext): Promise<StepResult> {
    return Promise.resolve({ taskId: task.id, status: "PASS" });
  }
}
