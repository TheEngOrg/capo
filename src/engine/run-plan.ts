// =============================================================================
// run-plan.ts — TEO runPlan() engine entrypoint (WS-P1-07)
//
// Wires TEOAdapter + TopologicalRunner into a single callable function.
//
// SCRIPT task behavior: SCRIPT execution is deferred — real shell exec is a
// separate security-reviewed workstream. SCRIPT tasks return a FAILED StepResult
// with a deterministic detail message. See WS-P1-07 for the rationale.
//
// LEDGER + SIGNER (WS-GO-01): when opts.sessionId is provided, each step result
// is signed via HmacSigner and appended to an AppendOnlyLedger JSONL file at
// <ledgerBaseDir>/ledger/<sessionId>.jsonl. Errors in ledger/signer operations
// are swallowed — they never propagate to the RunResult. When sessionId is absent,
// behavior is identical to pre-WS-GO-01 (zero-footprint, no filesystem writes).
// =============================================================================

import type { Plan, TEOTask } from "../core/plan.js";
import type { RunResult, StepResult, RunContext } from "../core/runner.js";
import { TopologicalRunner } from "../core/runner.js";
import type { TEOAdapter } from "../adapters/types.js";
import { validatePlan } from "../core/validate.js";
import { AppendOnlyLedger } from "../core/ledger.js";
import type { LedgerVerdict } from "../core/ledger.js";
import { HmacSigner } from "../core/sign.js";

export interface RunPlanOptions {
  stepTimeoutMs?: number;
  maxParallel?: number;
  /**
   * Session identifier for the signed run path.
   * When provided, each step result is signed and appended to a JSONL ledger
   * at <ledgerBaseDir>/ledger/<sessionId>.jsonl.
   * When absent, unsigned path — no filesystem writes (zero-footprint).
   */
  sessionId?: string;
  /**
   * Base directory for the ledger and keyring.
   * Defaults to os.homedir()/.teo/ when omitted (production default).
   * Tests MUST inject a temp dir here to maintain zero-footprint.
   */
  ledgerBaseDir?: string;
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

  // Set up ledger + signer if sessionId is provided (signed run path).
  // Constructor may throw (e.g. LedgerPathError for invalid or empty sessionId) — let it propagate.
  // Use !== undefined check (not truthiness) so an empty string reaches the constructor
  // and throws LedgerPathError, rather than silently falling through to the unsigned path.
  let ledger: AppendOnlyLedger | undefined;
  let signer: HmacSigner | undefined;
  if (opts?.sessionId !== undefined) {
    ledger = new AppendOnlyLedger({
      session_id: opts.sessionId,
      // c8 ignore next — production-only path: omitting baseDir resolves to os.homedir()/.teo/
      ...(opts.ledgerBaseDir !== undefined ? { baseDir: opts.ledgerBaseDir } : {}),
    });
    signer = new HmacSigner(
      // c8 ignore next — production-only path: omitting baseDir resolves to os.homedir()/.teo/
      opts.ledgerBaseDir !== undefined ? { baseDir: opts.ledgerBaseDir } : {}
    );
  }

  const executor = async (task: TEOTask, runContext: RunContext): Promise<StepResult> => {
    let stepResult: StepResult;

    if (task.type === "AGENT") {
      stepResult = await adapter.spawnAgent(task, {
        planId: runContext.planId,
        projectId: runContext.projectId,
        stepTimeoutMs: runContext.stepTimeoutMs,
      });
    } else {
      // SCRIPT tasks: deferred — security-reviewed workstream pending
      stepResult = {
        taskId: task.id,
        status: "FAILED",
        detail:
          "SCRIPT execution deferred — real shell exec is a separate security-reviewed workstream",
      };
    }

    // Signed run path: append to ledger and sign the verdict.
    if (ledger !== undefined && signer !== undefined) {
      try {
        // Map StepResult.status to LedgerVerdict
        const verdictMap: Record<StepResult["status"], LedgerVerdict> = {
          PASS: "PASS",
          FAILED: "FAIL",
          SKIPPED: "SKIPPED",
        };
        const mappedVerdict = verdictMap[stepResult.status];

        const actorId = task.type === "AGENT" ? task.agent_id : "SYSTEM";
        const actorType = task.type === "AGENT" ? ("AGENT" as const) : ("SCRIPT" as const);

        const { seq, ts } = ledger.append({
          session_id: opts!.sessionId!,
          workflow_id: plan.plan_id,
          task_id: task.id,
          turn_id: null,
          actor_id: actorId,
          actor_type: actorType,
          phase: "EXECUTE",
          verdict: mappedVerdict,
          detail: stepResult.detail ? { detail: stepResult.detail } : null,
        });

        const signature = signer.sign({
          plan_id: plan.plan_id,
          task_id: task.id,
          actor_id: actorId,
          verdict: mappedVerdict,
          ts,
          seq,
        });

        stepResult.signature = signature;
      } catch {
        // Swallow ledger/signer errors — never propagate to RunResult.
        // stepResult.signature remains undefined.
      }
    }

    return stepResult;
  };

  const runnerOptions: ConstructorParameters<typeof TopologicalRunner>[0] = {
    executor,
    ...(opts?.stepTimeoutMs !== undefined ? { defaultStepTimeoutMs: opts.stepTimeoutMs } : {}),
    ...(opts?.maxParallel !== undefined ? { maxParallel: opts.maxParallel } : {}),
  };

  const runner = new TopologicalRunner(runnerOptions);
  const result = await runner.run(plan);

  // After all steps complete, close the ledger with the workflow summary.
  if (ledger !== undefined) {
    try {
      const pass = result.steps.filter((s) => s.status === "PASS").length;
      const fail = result.steps.filter((s) => s.status === "FAILED").length;
      const skipped = result.steps.filter((s) => s.status === "SKIPPED").length;
      const task_count = result.steps.length;
      ledger.close({ task_count, pass, fail, skipped, tokens: 0, cost_usd: 0 });
    } catch {
      // Swallow close errors — never propagate to RunResult.
    }
  }

  return result;
}
