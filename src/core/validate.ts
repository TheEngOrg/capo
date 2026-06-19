// =============================================================================
// validate.ts — TEO Plan Validator (WS-CORE-02)
//
// BOUNDARY: The Zod schema (plan.ts) validates the SHAPE of individual tasks.
// This module owns all cross-task integrity invariants the schema deliberately
// defers:
//   - Unique task IDs (duplicate detection)
//   - needs[] resolution (all referenced IDs exist in the plan)
//   - gates[] referential integrity (non-empty gate names)
//   - Dependency cycle detection (DFS color-marking — no silent deadlocks)
//   - Plan-quality gate (PQ-01 through PQ-04) — pure TypeScript, no I/O, 0 tokens
//
// This function is SYNCHRONOUS. It never returns a Promise, never touches I/O,
// and never calls an LLM. All errors are collected before returning — there is
// no short-circuit on first failure.
//
// PLAN-QUALITY GATE RULES (PQ-xx):
// These thresholds are named constants below. They are PLACEHOLDERS pending
// staff-engineer ratification. Make tuning changes only here.
//
// Conceptually, PQ rules are Taskless ast-grep rules that would live at:
//   ~/.teo/taskless/rules/
// For Phase 0 (WS-CORE-02), these rules run as pure TypeScript inside
// validatePlan(). Binary integration with the taskless CLI comes in a later WS.
// =============================================================================

import type { Plan, TEOTask } from "./plan.js";

// ---------------------------------------------------------------------------
// Plan-quality gate thresholds (PENDING staff-engineer ratification)
// ---------------------------------------------------------------------------

/** PQ-01: Warn when a plan has fewer than this many tasks. */
const PQ_MIN_TASK_COUNT = 2;

/** PQ-02: Warn when a plan exceeds this many tasks. */
const PQ_MAX_TASK_COUNT = 25;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ValidationError {
  /** Machine-readable error code — stable for programmatic consumers. */
  code: string;
  /** Human-readable description, may include offending IDs. */
  message: string;
  /** The task ID at fault, if applicable. */
  taskId?: string;
}

export interface ValidationWarning {
  /** Machine-readable warning code — stable for programmatic consumers. */
  code: string;
  /** Human-readable description. */
  message: string;
}

export interface ValidationResult {
  /** False if any error was recorded; true if only warnings (or nothing). */
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// ---------------------------------------------------------------------------
// DFS color constants for cycle detection
// ---------------------------------------------------------------------------

const WHITE = 0; // unvisited
const GRAY = 1; // in the current DFS path (ancestor)
const BLACK = 2; // fully explored

type Color = typeof WHITE | typeof GRAY | typeof BLACK;

// ---------------------------------------------------------------------------
// validatePlan — main entry point
// ---------------------------------------------------------------------------

/**
 * Validates a fully-parsed Plan for cross-task integrity and plan quality.
 *
 * Collects ALL errors before returning — never short-circuits on first failure.
 * Returns synchronously; no I/O or async work is performed.
 */
export function validatePlan(plan: Plan): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // -------------------------------------------------------------------------
  // 1. Non-empty tasks[]
  // -------------------------------------------------------------------------

  if (plan.tasks.length === 0) {
    errors.push({
      code: "EMPTY_TASKS",
      message: "Plan must contain at least one task.",
    });
    // Nothing further to check — every other check requires at least one task.
    return { valid: false, errors, warnings };
  }

  // -------------------------------------------------------------------------
  // 2. Unique task IDs (duplicate detection)
  // -------------------------------------------------------------------------

  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();

  for (const task of plan.tasks) {
    if (seenIds.has(task.id)) {
      duplicateIds.add(task.id);
    }
    seenIds.add(task.id);
  }

  for (const dupId of duplicateIds) {
    errors.push({
      code: "DUPLICATE_TASK_ID",
      message: `Duplicate task ID detected: "${dupId}". Task IDs must be unique within a plan.`,
      taskId: dupId,
    });
  }

  // Build a lookup map using unique IDs only (for referential integrity checks).
  // Duplicate tasks are still checked for their own integrity issues above.
  const taskById = new Map<string, TEOTask>();
  for (const task of plan.tasks) {
    if (!taskById.has(task.id)) {
      taskById.set(task.id, task);
    }
  }

  // -------------------------------------------------------------------------
  // 3. needs[] referential integrity — all refs must resolve to real task IDs
  // -------------------------------------------------------------------------

  for (const task of plan.tasks) {
    for (const needsId of task.needs) {
      if (!seenIds.has(needsId)) {
        errors.push({
          code: "UNRESOLVED_NEEDS_REF",
          message: `Task "${task.id}" has needs[] entry "${needsId}" that does not match any task ID in this plan.`,
          taskId: task.id,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. gates[] referential integrity — gate names must be non-empty
  //    (Full gate engine resolution comes in WS-CORE-04; here we guard the
  //    structural minimum: a gate with an empty name is a misconfiguration.)
  // -------------------------------------------------------------------------

  for (const task of plan.tasks) {
    for (const gate of task.gates) {
      if (!gate.name || gate.name.trim() === "") {
        errors.push({
          code: "INVALID_GATE_REF",
          message: `Task "${task.id}" has a gate ref with an empty name. Gate names must be non-empty strings.`,
          taskId: task.id,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Dependency cycle detection — DFS color-marking
  //    On a cycle, the error includes the full cycle path (e.g. "A→B→C→A").
  // -------------------------------------------------------------------------

  const color = new Map<string, Color>();
  // We only run DFS on tasks with unique IDs; duplicate-ID tasks are already
  // flagged above and would corrupt the adjacency structure.
  for (const id of seenIds) {
    color.set(id, WHITE);
  }

  const reportedCycles = new Set<string>();

  function dfs(id: string, path: string[]): void {
    color.set(id, GRAY);
    const task = taskById.get(id);
    // taskById is keyed from seenIds (same set DFS iterates), so every id in
    // seenIds has an entry. This guard is a defensive fallback — unreachable
    // in practice, but protects against future refactoring regressions.
    /* c8 ignore next */
    if (!task) return;

    for (const needsId of task.needs) {
      // Skip edges into nonexistent tasks (already flagged as UNRESOLVED_NEEDS_REF)
      if (!seenIds.has(needsId)) continue;

      const neighborColor = color.get(needsId);

      if (neighborColor === GRAY) {
        // Found a back-edge — reconstruct the cycle path from the current DFS stack
        const cycleStart = path.indexOf(needsId);
        const cyclePath = [...path.slice(cycleStart), id, needsId];
        // Normalize to a canonical form to avoid duplicate reports for the same cycle
        const cycleKey = cyclePath.join("→");
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          errors.push({
            code: "DEPENDENCY_CYCLE",
            message: `Dependency cycle detected: ${cyclePath.join("→")}`,
          });
        }
      } else if (neighborColor === WHITE) {
        dfs(needsId, [...path, id]);
      }
      // BLACK = already fully explored, no cycle through this node
    }

    color.set(id, BLACK);
  }

  for (const id of seenIds) {
    if (color.get(id) === WHITE) {
      dfs(id, []);
    }
  }

  // -------------------------------------------------------------------------
  // 6. PQ-03: Sage must never be a task executor (ERROR — hard fail)
  //    Sage is the planner; it does not run as a task agent.
  // -------------------------------------------------------------------------

  for (const task of plan.tasks) {
    if (task.type === "AGENT" && task.agent_id === "sage") {
      errors.push({
        code: "PQ_03_SAGE_AS_EXECUTOR",
        message: `Task "${task.id}" specifies agent_id "sage". Sage is the planner and must never appear as a task executor. Use a specialist agent (e.g. "eng", "qa").`,
        taskId: task.id,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 7. PQ-01: Warn if plan has fewer than PQ_MIN_TASK_COUNT tasks
  // -------------------------------------------------------------------------

  if (plan.tasks.length < PQ_MIN_TASK_COUNT) {
    warnings.push({
      code: "PQ_01_SINGLE_TASK",
      message: `Plan has only ${plan.tasks.length} task(s). Plans typically require at least ${PQ_MIN_TASK_COUNT} tasks to be meaningful. (Threshold: PQ_MIN_TASK_COUNT=${PQ_MIN_TASK_COUNT}, pending staff-engineer ratification.)`,
    });
  }

  // -------------------------------------------------------------------------
  // 8. PQ-02: Warn if plan exceeds PQ_MAX_TASK_COUNT tasks
  // -------------------------------------------------------------------------

  if (plan.tasks.length > PQ_MAX_TASK_COUNT) {
    warnings.push({
      code: "PQ_02_TOO_MANY_TASKS",
      message: `Plan has ${plan.tasks.length} tasks, which exceeds the recommended maximum of ${PQ_MAX_TASK_COUNT}. Consider splitting into smaller plans. (Threshold: PQ_MAX_TASK_COUNT=${PQ_MAX_TASK_COUNT}, pending staff-engineer ratification.)`,
    });
  }

  // -------------------------------------------------------------------------
  // 9. PQ-04: ARCHITECTURAL plan detection
  //
  // TODO: PQ-04 cannot be implemented yet.
  //
  // The Plan schema (plan.ts, WS-CORE-01) does not include a `directive` or
  // `scope` field that would identify a plan as ARCHITECTURAL. Implementing
  // this check would require inventing a schema field that does not exist,
  // which this module must not do.
  //
  // GAP for staff-engineer ratification:
  //   - What field distinguishes ARCHITECTURAL plans? Proposed:
  //       directive: z.enum(["ARCHITECTURAL","BUILD","FIX","REVIEW","PLAN"])
  //     added to PlanSchema in plan.ts.
  //   - Once the field is added, PQ-04 implementation here is:
  //       if ((plan as PlanWithDirective).directive === "ARCHITECTURAL") {
  //         warnings.push({ code: "PQ_04_ARCHITECTURAL_SCOPE", message: "..." });
  //       }
  //   - The conceptual taskless rule would live at:
  //       ~/.teo/taskless/rules/pq-04-architectural-scope.yaml
  // -------------------------------------------------------------------------

  // PQ-04 is intentionally omitted — see TODO above. The guard below
  // ensures we never false-positive on the current schema.

  if ("directive" in plan && (plan as Record<string, unknown>)["directive"] === "ARCHITECTURAL") {
    warnings.push({
      code: "PQ_04_ARCHITECTURAL_SCOPE",
      message:
        "Plan has directive 'ARCHITECTURAL'. Architectural plans warrant extra staff-engineer review before execution.",
    });
  }

  // -------------------------------------------------------------------------
  // Result
  // -------------------------------------------------------------------------

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
