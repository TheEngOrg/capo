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
// <ledgerBaseDir>/ledger/<sessionId>.jsonl. Gate exceptions fail-closed (step
// forced to FAILED). Errors in ledger/signer operations are swallowed — they
// never propagate to the RunResult. However, signing failures are counted and
// surfaced as RunResult.signingErrors. When sessionId is absent, behavior is
// identical to pre-WS-GO-01 (zero-footprint, no filesystem writes).
// =============================================================================

import type { Plan, TEOTask } from "../core/plan.js";
import type { RunResult, StepResult, RunContext } from "../core/runner.js";
import { TopologicalRunner } from "../core/runner.js";
import type { TEOAdapter } from "../adapters/types.js";
import { validatePlan } from "../core/validate.js";
import { AppendOnlyLedger } from "../core/ledger.js";
import type { LedgerVerdict } from "../core/ledger.js";
import { HmacSigner } from "../core/sign.js";
import * as evaluateGateModule from "./evaluate-gate.js";
import { computeContentHash } from "./content-hash.js";

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
      // Gate evaluation runs in its OWN try/catch — exceptions fail-closed.
      // This block must NOT be inside the ledger try/catch.
      // Gate can override adapter PASS → FAIL; never promotes FAILED → PASS.
      try {
        const gateVerdict = await evaluateGateModule.evaluateGate(task, stepResult, runContext);
        if (gateVerdict === "FAIL" && stepResult.status !== "FAILED") {
          stepResult = {
            ...stepResult,
            status: "FAILED",
            detail: `gate override: gate returned FAIL; original adapter status: ${stepResult.status}${stepResult.detail ? "; " + stepResult.detail : ""}`,
          };
        }
      } catch (gateErr) {
        // Gate threw — fail-closed: force FAILED status.
        stepResult = {
          ...stepResult,
          status: "FAILED",
          detail: `gate exception: ${gateErr instanceof Error ? gateErr.message : String(gateErr)}`,
        };
      }

      // Ledger/signer in their own try/catch — swallowed per design (audit trail is best-effort).
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

        // Compute content hash for target_dir (if present on task).
        const target_dir = task.type === "AGENT" ? task.target_dir : undefined;
        const hashResult = target_dir !== undefined ? await computeContentHash(target_dir) : null;
        const content_hash = hashResult?.hash ?? null;

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
          content_hash,
        });

        stepResult.signature = signature;
        stepResult.signingStatus = "signed";
      } catch {
        // Swallow ledger/signer errors — never propagate to RunResult.
        // stepResult.signature remains undefined.
        stepResult.signingStatus = "signing_failed";
      }
    } else {
      // Unsigned path: no sessionId provided — unsigned by design.
      stepResult.signingStatus = "unsigned_by_design";
    }

    return stepResult;
  };

  const runnerOptions: ConstructorParameters<typeof TopologicalRunner>[0] = {
    executor,
    ...(opts?.stepTimeoutMs !== undefined ? { defaultStepTimeoutMs: opts.stepTimeoutMs } : {}),
    ...(opts?.maxParallel !== undefined ? { maxParallel: opts.maxParallel } : {}),
  };

  let result: RunResult;
  try {
    const runner = new TopologicalRunner(runnerOptions);
    result = await runner.run(plan);

    // Post-process: SKIPPED steps (and any other path that bypasses the executor)
    // never go through the executor and therefore have signingStatus undefined.
    // Stamp them with "unsigned_by_design" to ensure sentinel completeness.
    for (const step of result.steps) {
      if (step.signingStatus === undefined) {
        step.signingStatus = "unsigned_by_design";
      }
    }

    // Count steps where signing failed — surfaces audit trail gaps without halting.
    result.signingErrors = result.steps.filter((s) => s.signingStatus === "signing_failed").length;

    // After all steps complete, close the ledger with the workflow summary.
    if (ledger !== undefined) {
      try {
        const pass = result.steps.filter((s) => s.status === "PASS").length;
        const fail = result.steps.filter((s) => s.status === "FAILED").length;
        const skipped = result.steps.filter((s) => s.status === "SKIPPED").length;
        const task_count = result.steps.length;
        // Determine if the run was "torn" — a task failed and one or more independent
        // tasks were abort-SKIPped (not just dep-cascade SKIPped).
        const wasTorn =
          result.overallStatus === "FAILED" &&
          result.steps.some((s) => s.status === "SKIPPED" && s.detail?.includes("plan abort"));
        const { seq: closeSeq, ts: closeTs } = ledger.close({
          task_count,
          pass,
          fail,
          skipped,
          tokens: 0,
          cost_usd: 0,
          torn: wasTorn,
        });
        // Sign the CLOSE event (signer is always defined when ledger is defined).
        result.closeSignature = signer!.sign({
          plan_id: plan.plan_id,
          task_id: null,
          actor_id: "SYSTEM",
          verdict: null,
          ts: closeTs,
          seq: closeSeq,
          content_hash: null,
        });
      } catch {
        // Surface close/signing failures as a signing error: audit trail is incomplete.
        // result.signingErrors is always set at line 235 before this catch runs.
        result.signingErrors = result.signingErrors + 1;
      }
    }
  } finally {
    // no WorkstreamTree to close
  }

  return result!;
}
