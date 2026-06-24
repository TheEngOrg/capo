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
import * as fs from "node:fs";
import * as path from "node:path";
import type { TEOAdapter, PlanningContext } from "../adapters/types.js";
import type { RunResult } from "../core/runner.js";
import type { ProvisionErrorKind } from "../bootstrap/provision.js";
import type { Plan } from "../core/plan.js";
import type { CheckRevocationOptions } from "../bootstrap/revocation.js";
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
  /** Override the ledger base directory. When unset, resolves via TEO_LEDGER_DIR or os.homedir()/.teo/. */
  ledgerBaseDir?: string;
}

export type SkillResult =
  | { status: "ok"; result: RunResult }
  | { status: "provision_error"; kind: ProvisionErrorKind; reason: string }
  | { status: "planning_error"; message: string }
  | { status: "ledger_error"; reason: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective ledger base directory for pre-flight checks and runPlan wiring.
 * Mirrors the logic in resolveDefaultLedgerBase() in core/ledger.ts — duplicated here
 * so skill.ts can function correctly even when ledger.ts is mocked in tests.
 * Honors TEO_LEDGER_DIR env var first, then HOME env var (not os.homedir() directly,
 * to surface misconfiguration when HOME is empty or unset).
 */
function resolveEffectiveLedgerBase(override?: string): string {
  if (override !== undefined) return override;
  const envDir = process.env["TEO_LEDGER_DIR"];
  if (envDir && envDir.length > 0) return envDir;
  const homeDir = process.env["HOME"];
  if (homeDir && homeDir.length > 0) return path.join(homeDir, ".teo");
  return path.join(".teo-unresolved");
}

/**
 * Check whether a directory is writable by attempting to create it (if absent)
 * and write + delete a probe file. Returns an error string if not writable,
 * or null if writable.
 */
function probeWritable(dir: string): string | null {
  try {
    // Reject relative paths — a non-absolute path means HOME or TEO_LEDGER_DIR
    // resolved to something unusable (e.g. HOME="").
    if (!path.isAbsolute(dir)) {
      return `TEO ledger dir "${dir}" is not an absolute path; set TEO_LEDGER_DIR to a writable absolute directory path`;
    }

    // Check if path exists and is actually a directory (not /dev/null etc.)
    if (fs.existsSync(dir)) {
      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) {
        return `TEO ledger dir "${dir}" is not a directory; set TEO_LEDGER_DIR to a writable directory path`;
      }
      // Dir exists — use accessSync to check writability without modifying mtime.
      fs.accessSync(dir, fs.constants.W_OK);
    } else {
      // Dir doesn't exist — try to create it (this is the real probe).
      fs.mkdirSync(dir, { recursive: true });
      // After creating the dir, verify it's actually writable.
      fs.accessSync(dir, fs.constants.W_OK);
    }
    return null;
  } catch (err) {
    // c8 ignore next — Node always throws Error instances; String(err) is a defensive fallback.
    const msg = err instanceof Error ? err.message : String(err);
    return `TEO ledger dir "${dir}" is not writable; set TEO_LEDGER_DIR to a writable path. (${msg})`;
  }
}

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
  // Pre-flight write-check (Step 1.5) — only when sessionId is explicitly
  // provided by the caller (signed path). If the ledger dir is not writable,
  // abort before sagePlan or runPlan start.
  // -------------------------------------------------------------------------
  const sessionId = opts.sessionId ?? randomUUID();
  const effectiveLedgerBase = resolveEffectiveLedgerBase(opts.ledgerBaseDir);
  if (opts.sessionId !== undefined) {
    const writeError = probeWritable(effectiveLedgerBase);
    if (writeError !== null) {
      return { status: "ledger_error", reason: writeError };
    }
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
  const result = await runPlan(plan, opts.adapter, {
    sessionId,
    ...(opts.sessionId !== undefined ? { ledgerBaseDir: effectiveLedgerBase } : {}),
  });

  // If signingErrors > 0 on a signed run, the audit trail was partially dropped.
  // Emit a console.warn — never silent.
  if (result.signingErrors !== undefined && result.signingErrors > 0) {
    console.warn(
      `[TEO] WARNING: ${result.signingErrors} ledger signing error(s) detected. ` +
        `Ledger dir: "${effectiveLedgerBase}". ` +
        `Set TEO_LEDGER_DIR to a writable path to ensure a complete audit trail.`
    );
  }

  return { status: "ok", result };
}
