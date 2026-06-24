// =============================================================================
// zero-footprint-ci.test.ts — WS-P1-09 Phase 1 gate
//
// Zero-footprint end-to-end CI test: proves a Plan runs end-to-end through
// runPlan() + StubAdapter with zero network and zero homedir mutation.
//
// Test order: misuse → boundary → golden path (ADR-064 policy)
// Network blocked globally by tests/acceptance/support/no-network.ts (vitest setupFiles)
// =============================================================================

import { describe, it, expect, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type { Plan, TEOTask } from "../../src/core/plan.js";
import { runPlan } from "../../src/engine/run-plan.js";
import { StubAdapter } from "../../src/adapters/stub.js";
import { getNetworkCallCount } from "./support/no-network.js";

// ---------------------------------------------------------------------------
// Helpers — inline helpers matching run-plan.test.ts style, NOT from golden harness
// ---------------------------------------------------------------------------

/** Build a minimal valid Plan with the given tasks. */
function makePlan(tasks: TEOTask[], overrides?: Partial<Plan>): Plan {
  return {
    plan_id: "p1-09-test",
    project_id: "proj-ws-p1-09",
    created_at: "2026-06-19T00:00:00Z",
    version: "1",
    ...overrides,
    tasks,
  };
}

/** Build a minimal valid AGENT task. */
function makeAgentTask(id: string, needs: string[] = []): TEOTask {
  return {
    id,
    type: "AGENT",
    agent_id: "eng",
    prompt: `Execute task ${id}`,
    needs,
    gates: [],
  };
}

/** Build a minimal valid SCRIPT task. */
function makeScriptTask(id: string, needs: string[] = []): TEOTask {
  return {
    id,
    type: "SCRIPT",
    command: `run-${id}`,
    needs,
    gates: [],
  };
}

// ---------------------------------------------------------------------------
// MISUSE + BOUNDARY — run first, before happy-path tests
// ---------------------------------------------------------------------------

describe("WS-P1-09 zero-footprint CI — misuse + boundary", () => {
  it("1. no-network enforcement — running a minimal AGENT plan through runPlan + StubAdapter makes zero network calls", async () => {
    // If StubAdapter ever tried to call fetch, the global no-network setup file
    // would throw, causing the test to error. Asserting count === 0 confirms
    // the real StubAdapter path is entirely in-process.
    const countBefore = getNetworkCallCount();

    const plan = makePlan([makeAgentTask("net-check-task")]);
    const adapter = new StubAdapter();
    const result = await runPlan(plan, adapter);

    // The plan should run successfully
    expect(result.overallStatus).toBe("PASS");
    // Count must not have increased — zero fetch calls made
    expect(getNetworkCallCount()).toBe(countBefore);
    expect(getNetworkCallCount()).toBe(0);
  });

  it("2. invalid plan rejected — empty tasks array yields FAILED + empty steps; spawnAgent never called", async () => {
    // Plan schema requires min(1) task. We cast through unknown to bypass TypeScript
    // and exercise the validatePlan() call inside runPlan().
    const plan = makePlan([] as unknown as TEOTask[]);
    const adapter = new StubAdapter();
    // Spy on the real method to verify it is never invoked
    const spawnSpy = vi.spyOn(adapter, "spawnAgent");

    const result = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("FAILED");
    expect(result.steps).toEqual([]);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("3. SCRIPT task deferred — SCRIPT plan yields FAILED + deferred detail; spawnAgent never called", async () => {
    // SCRIPT execution is deferred per WS-P1-07 Option B. runPlan() intercepts
    // SCRIPT tasks before ever reaching the adapter. The StubAdapter.spawnAgent
    // must NOT be called for any SCRIPT task.
    const plan = makePlan([makeScriptTask("deferred-script-1")]);
    const adapter = new StubAdapter();
    const spawnSpy = vi.spyOn(adapter, "spawnAgent");

    const result = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("FAILED");
    expect(result.steps).toHaveLength(1);

    const step = result.steps[0];
    expect(step!.taskId).toBe("deferred-script-1");
    expect(step!.status).toBe("FAILED");
    // Exact deferred message from run-plan.ts line 44-46
    expect(step!.detail).toContain("SCRIPT execution deferred");
    // Adapter never reached for SCRIPT tasks
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("4. homedir untouched — running a minimal AGENT plan does NOT create or mutate ~/.teo", async () => {
    const homedirTeoPath = path.join(os.homedir(), ".teo");

    // Capture pre-run state
    const existedBefore = fs.existsSync(homedirTeoPath);
    const mtimeBefore = existedBefore ? fs.statSync(homedirTeoPath).mtimeMs : null;

    const plan = makePlan([makeAgentTask("homedir-check-task")]);
    const adapter = new StubAdapter();
    const result = await runPlan(plan, adapter);

    // Plan runs successfully in-process
    expect(result.overallStatus).toBe("PASS");

    // Post-run homedir state must be identical
    const existsAfter = fs.existsSync(homedirTeoPath);
    if (!existedBefore) {
      // Must not have been created
      expect(existsAfter).toBe(false);
    } else {
      // Must not have been mutated
      expect(existsAfter).toBe(true);
      const mtimeAfter = fs.statSync(homedirTeoPath).mtimeMs;
      expect(mtimeAfter).toBe(mtimeBefore);
    }
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — single task, DAG, post-suite network check
// ---------------------------------------------------------------------------

describe("WS-P1-09 zero-footprint CI — golden path", () => {
  it("5. single AGENT task end-to-end PASS — runPlan + StubAdapter returns PASS result", async () => {
    // Capture homedir state BEFORE runPlan so the mtime comparison is
    // deterministic — no wall-clock dependency.
    const homedirTeoPath = path.join(os.homedir(), ".teo");
    const existedBefore = fs.existsSync(homedirTeoPath);
    const mtimeBefore = existedBefore ? fs.statSync(homedirTeoPath).mtimeMs : null;

    const plan = makePlan([makeAgentTask("p1-09-single-agent")], { plan_id: "p1-09-single-agent" });
    const adapter = new StubAdapter();

    const result = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.taskId).toBe("p1-09-single-agent");
    expect(result.steps[0]!.status).toBe("PASS");

    // Zero network calls — StubAdapter is fully in-process
    expect(getNetworkCallCount()).toBe(0);

    // Homedir untouched — if ~/.teo existed before the run, its mtime must be
    // bit-for-bit identical after. A write would advance the mtime; an unchanged
    // directory keeps the same value. This is deterministic, no wall-clock delta.
    const existsAfter = fs.existsSync(homedirTeoPath);
    if (existedBefore) {
      expect(existsAfter).toBe(true);
      const mtimeAfter = fs.statSync(homedirTeoPath).mtimeMs;
      expect(mtimeAfter).toBe(mtimeBefore);
    }
  });

  it("6. multi-task AGENT DAG end-to-end PASS — 3-task plan A, B(needs A), C(needs A) all PASS", async () => {
    // DAG shape: A has no deps; B and C both depend on A (fan-out from A)
    const taskA = makeAgentTask("dag-task-a");
    const taskB = makeAgentTask("dag-task-b", ["dag-task-a"]);
    const taskC = makeAgentTask("dag-task-c", ["dag-task-a"]);
    const plan = makePlan([taskA, taskB, taskC], { plan_id: "p1-09-multi-agent-dag" });
    const adapter = new StubAdapter();

    const result = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(3);

    // All three steps must be PASS
    expect(result.steps.every((s) => s.status === "PASS")).toBe(true);

    // Each step echoes the correct task ID (StubAdapter contract: taskId === task.id)
    const stepIds = result.steps.map((s) => s.taskId);
    expect(stepIds).toContain("dag-task-a");
    expect(stepIds).toContain("dag-task-b");
    expect(stepIds).toContain("dag-task-c");

    // Zero network calls — full chain is in-process
    expect(getNetworkCallCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST-SUITE: authoritative zero-network assertion
// Mirrors the pattern in golden-harness.test.ts — this is the authoritative check.
// ---------------------------------------------------------------------------

describe("WS-P1-09 post-suite zero-network assertion", () => {
  it("7. zero outbound HTTP/HTTPS/fetch calls were made across the entire WS-P1-09 suite", () => {
    // The no-network setup file increments networkCallCount on every blocked
    // fetch attempt and throws. Count === 0 means no fetch was ever attempted.
    expect(getNetworkCallCount()).toBe(0);
  });
});
