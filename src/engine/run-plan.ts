// =============================================================================
// run-plan.ts — TEO runPlan() engine entrypoint (WS-P1-07)
//
// Wires TEOAdapter + TopologicalRunner into a single callable function.
//
// SCRIPT task behavior: SCRIPT execution is deferred — real shell exec is a
// separate security-reviewed workstream. SCRIPT tasks return a FAILED StepResult
// with a deterministic detail message. See WS-P1-07 for the rationale.
// =============================================================================

import type { Plan, TEOTask } from "../core/plan.js";
import type { RunResult, StepResult, RunContext } from "../core/runner.js";
import { TopologicalRunner } from "../core/runner.js";
import type { TEOAdapter } from "../adapters/types.js";
import { validatePlan } from "../core/validate.js";

export interface RunPlanOptions {
  stepTimeoutMs?: number;
  maxParallel?: number;
}

export async function runPlan(
  plan: Plan,
  adapter: TEOAdapter,
  opts?: RunPlanOptions
): Promise<RunResult> {
  const validation = validatePlan(plan);
  if (!validation.valid) {
    return { steps: [], overallStatus: "FAILED" };
  }

  const executor = async (task: TEOTask, runContext: RunContext): Promise<StepResult> => {
    if (task.type === "AGENT") {
      return adapter.spawnAgent(task, {
        planId: runContext.planId,
        projectId: runContext.projectId,
        stepTimeoutMs: runContext.stepTimeoutMs,
      });
    }
    // SCRIPT tasks: deferred — security-reviewed workstream pending
    return {
      taskId: task.id,
      status: "FAILED",
      detail:
        "SCRIPT execution deferred — real shell exec is a separate security-reviewed workstream",
    };
  };

  const runnerOptions: ConstructorParameters<typeof TopologicalRunner>[0] = {
    executor,
    ...(opts?.stepTimeoutMs !== undefined ? { defaultStepTimeoutMs: opts.stepTimeoutMs } : {}),
    ...(opts?.maxParallel !== undefined ? { maxParallel: opts.maxParallel } : {}),
  };

  const runner = new TopologicalRunner(runnerOptions);
  return runner.run(plan);
}
