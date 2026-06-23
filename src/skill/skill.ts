// =============================================================================
// skill.ts — TEO invokeSkill() orchestration seam (WS-P1-08)
//
// CONTRACT:
//   invokeSkill(opts: SkillOptions): Promise<SkillResult>
//
// Wires three components in linear sequence:
//   1. provision(opts) → on error → { status:'provision_error', kind, reason }
//   2. adapter.sagePlan(planningContext, {}) → on throw → { status:'planning_error', message }
//   3. runPlan(plan, adapter) → always { status:'ok', result }
//
// IMPORTANT: runPlan returning overallStatus:'FAILED' does NOT produce a
// non-ok SkillResult. FAILED propagates inside the 'ok' wrapper — callers
// inspect result.overallStatus. Only provision errors and sagePlan throws
// produce non-ok discriminants.
//
// No import-time side effects — all logic is inside invokeSkill().
// =============================================================================

import { randomUUID } from "node:crypto";
import type { TEOAdapter, PlanningContext } from "../adapters/types.js";
import type { RunResult } from "../core/runner.js";
import type { ProvisionErrorKind } from "../bootstrap/provision.js";
import type { Plan } from "../core/plan.js";
import type { CheckRevocationOptions } from "../bootstrap/revocation.js";
import type { Backend } from "../core/workstream-tree.js";
import { provision } from "../bootstrap/provision.js";
import { runPlan } from "../engine/run-plan.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SkillOptions {
  adapter: TEOAdapter;
  description: string;
  project_id: string;
  directive?: Plan["directive"];
  bundleDir: string;
  homeDir?: string;
  revocationOpts: Omit<CheckRevocationOptions, "data">;
  /** Override the auto-generated UUID session identifier passed to runPlan(). */
  sessionId?: string;
  /** Override the auto-detected WorkstreamTree backend passed to runPlan(). */
  backend?: Backend;
}

export type SkillResult =
  | { status: "ok"; result: RunResult }
  | { status: "provision_error"; kind: ProvisionErrorKind; reason: string }
  | { status: "planning_error"; message: string };

// ---------------------------------------------------------------------------
// invokeSkill()
// ---------------------------------------------------------------------------

/**
 * Orchestrates a full TEO skill invocation: provision → sagePlan → runPlan.
 *
 * Returns a discriminated SkillResult — never throws for anticipated errors.
 */
export async function invokeSkill(opts: SkillOptions): Promise<SkillResult> {
  // -------------------------------------------------------------------------
  // Step 1 — Provision agent bundle.
  // -------------------------------------------------------------------------
  const provResult = await provision({
    bundleDir: opts.bundleDir,
    // exactOptionalPropertyTypes: homeDir must be omitted (not set to undefined)
    // when the caller does not supply it — spread the field only when present.
    ...(opts.homeDir !== undefined ? { homeDir: opts.homeDir } : {}),
    revocationOpts: opts.revocationOpts,
  });

  if (provResult.status === "error") {
    return {
      status: "provision_error",
      kind: provResult.kind,
      reason: provResult.reason,
    };
  }

  // -------------------------------------------------------------------------
  // Step 2 — Build planning context and call sagePlan.
  // directive is only set if provided — absence vs. undefined are distinct
  // (exactOptionalPropertyTypes compliance).
  // -------------------------------------------------------------------------
  const planningContext: PlanningContext = {
    description: opts.description,
    project_id: opts.project_id,
  };

  if (opts.directive !== undefined) {
    planningContext.directive = opts.directive;
  }

  let plan: Plan;
  try {
    plan = await opts.adapter.sagePlan(planningContext, {});
  } catch (err) {
    return {
      status: "planning_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // -------------------------------------------------------------------------
  // Step 3 — Execute plan via runPlan.
  // FAILED overallStatus propagates inside the 'ok' wrapper — not a separate
  // discriminant on SkillResult.
  // -------------------------------------------------------------------------
  const sessionId = opts.sessionId ?? randomUUID();
  const hasTargetDir = plan.tasks.some((t) => t.type === "AGENT" && t.target_dir !== undefined);
  const backend: Backend = opts.backend ?? (hasTargetDir ? "sandbox" : "none");
  const result = await runPlan(plan, opts.adapter, { sessionId, backend });
  return { status: "ok", result };
}
