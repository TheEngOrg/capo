// =============================================================================
// plans.ts — Plan fixtures for the 12 golden harness demo scenarios
//
// All plans are SCRIPT-only (zero live-model calls).
// No AGENT tasks that spawn a model.
// =============================================================================

import type { Plan, TEOTask } from "../../../src/core/plan.js";

function scriptTask(id: string, needs: string[] = [], command?: string): TEOTask {
  return {
    id,
    type: "SCRIPT",
    command: command ?? `run-${id}`,
    needs,
    gates: [],
  };
}

// ---------------------------------------------------------------------------
// Demo 01: Single-task PASS
// (PQ-01 warning: single task — intentional for this scenario)
// ---------------------------------------------------------------------------
export const DEMO_01_SINGLE_TASK_PASS: Plan = {
  plan_id: "demo-01-single-pass",
  project_id: "golden-harness",
  created_at: "2026-06-18T00:00:00.000Z",
  version: "1",
  tasks: [scriptTask("task-a")],
};

// ---------------------------------------------------------------------------
// Demo 02: Multi-task serial PASS (A → B → C)
// ---------------------------------------------------------------------------
export const DEMO_02_SERIAL_PASS: Plan = {
  plan_id: "demo-02-serial-pass",
  project_id: "golden-harness",
  created_at: "2026-06-18T00:00:00.000Z",
  version: "1",
  tasks: [scriptTask("a"), scriptTask("b", ["a"]), scriptTask("c", ["b"])],
};

// ---------------------------------------------------------------------------
// Demo 03: Diamond DAG (A → B, A → C, B → D, C → D)
// ---------------------------------------------------------------------------
export const DEMO_03_DIAMOND_DAG: Plan = {
  plan_id: "demo-03-diamond-dag",
  project_id: "golden-harness",
  created_at: "2026-06-18T00:00:00.000Z",
  version: "1",
  tasks: [
    scriptTask("a"),
    scriptTask("b", ["a"]),
    scriptTask("c", ["a"]),
    scriptTask("d", ["b", "c"]),
  ],
};

// ---------------------------------------------------------------------------
// Demo 04: Fan-out with maxParallel (5 independent tasks)
// The runner is configured with maxParallel=2 for this scenario.
// ---------------------------------------------------------------------------
export const DEMO_04_FANOUT_PARALLEL: Plan = {
  plan_id: "demo-04-fanout-parallel",
  project_id: "golden-harness",
  created_at: "2026-06-18T00:00:00.000Z",
  version: "1",
  tasks: [scriptTask("p1"), scriptTask("p2"), scriptTask("p3"), scriptTask("p4"), scriptTask("p5")],
};

// ---------------------------------------------------------------------------
// Demo 05: RED-halt propagation (task-b fails → task-c and task-d SKIPPED)
// A → B (FAIL) → C (SKIP)
//             → D (SKIP)
// ---------------------------------------------------------------------------
export const DEMO_05_RED_HALT: Plan = {
  plan_id: "demo-05-red-halt",
  project_id: "golden-harness",
  created_at: "2026-06-18T00:00:00.000Z",
  version: "1",
  tasks: [
    scriptTask("setup"),
    scriptTask("build", ["setup"]),
    scriptTask("test", ["build"]),
    scriptTask("deploy", ["build"]),
  ],
};

// ---------------------------------------------------------------------------
// Demo 06: Gate PASS (single task, gate evaluates PASS)
// ---------------------------------------------------------------------------
export const DEMO_06_GATE_PASS: Plan = {
  plan_id: "demo-06-gate-pass",
  project_id: "golden-harness",
  created_at: "2026-06-18T00:00:00.000Z",
  version: "1",
  tasks: [
    {
      id: "verify-task",
      type: "SCRIPT",
      command: "run-verify-task",
      needs: [],
      gates: [{ name: "lint-gate", on_fail: "block" }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Demo 07: Gate FAIL (command exits non-zero)
// ---------------------------------------------------------------------------
export const DEMO_07_GATE_FAIL: Plan = {
  plan_id: "demo-07-gate-fail",
  project_id: "golden-harness",
  created_at: "2026-06-18T00:00:00.000Z",
  version: "1",
  tasks: [
    {
      id: "failing-verify",
      type: "SCRIPT",
      command: "run-failing-verify",
      needs: [],
      gates: [{ name: "test-gate", on_fail: "block" }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Demo 08: Gate BLOCKED (null exit code — command did not exit cleanly)
// ---------------------------------------------------------------------------
export const DEMO_08_GATE_BLOCKED: Plan = {
  plan_id: "demo-08-gate-blocked",
  project_id: "golden-harness",
  created_at: "2026-06-18T00:00:00.000Z",
  version: "1",
  tasks: [
    {
      id: "blocked-verify",
      type: "SCRIPT",
      command: "run-blocked-verify",
      needs: [],
      gates: [{ name: "security-gate", on_fail: "block" }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Demo 09: validatePlan rejects a cycle (A → B → A)
// This never reaches the runner — returned as VALIDATION_REJECTED.
// ---------------------------------------------------------------------------
export const DEMO_09_CYCLE_REJECTION: unknown = {
  plan_id: "demo-09-cycle-rejection",
  project_id: "golden-harness",
  created_at: "2026-06-18T00:00:00.000Z",
  version: "1",
  tasks: [
    { id: "a", type: "SCRIPT", command: "run-a", needs: ["b"], gates: [] },
    { id: "b", type: "SCRIPT", command: "run-b", needs: ["a"], gates: [] },
  ],
};

// ---------------------------------------------------------------------------
// Demo 10: PQ-01 warning — single task plan (valid but triggers PQ_01_SINGLE_TASK)
// Unlike demo-01, this scenario explicitly asserts the warning is present.
// ---------------------------------------------------------------------------
export const DEMO_10_PQ_WARNING: Plan = {
  plan_id: "demo-10-pq-warning",
  project_id: "golden-harness",
  created_at: "2026-06-18T00:00:00.000Z",
  version: "1",
  tasks: [scriptTask("only-task")],
};

// ---------------------------------------------------------------------------
// Demo 11: PQ-03 hard fail — agent_id "capo" as executor (VALIDATION_REJECTED)
// validatePlan returns errors for this plan; pipeline never runs.
// ---------------------------------------------------------------------------
export const DEMO_11_PQ03_CAPO_REJECTION: unknown = {
  plan_id: "demo-11-pq03-capo",
  project_id: "golden-harness",
  created_at: "2026-06-18T00:00:00.000Z",
  version: "1",
  tasks: [
    {
      id: "capo-task",
      type: "AGENT",
      agent_id: "capo",
      prompt: "do something",
      needs: [],
      gates: [],
    },
  ],
};
