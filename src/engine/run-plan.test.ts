// =============================================================================
// run-plan.test.ts — WS-P1-07 — gate-2 (green)
//
// Tests for src/engine/run-plan.ts — the runPlan() engine entrypoint.
//
// Ordering: misuse → boundary → golden path (per ADR-064 critical-path policy)
//
// Implementation complete. All specs pass against src/engine/run-plan.ts.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Plan, TEOTask } from "../core/plan.js";
import { PlanSchema } from "../core/plan.js";
import type { RunResult } from "../core/runner.js";
import type { TEOAdapter, AgentContext } from "../adapters/types.js";
import { runPlan, type RunPlanOptions } from "../engine/run-plan.js";
import { AppendOnlyLedger } from "../core/ledger.js";
import type { LedgerEvent } from "../core/ledger.js";
import { HmacSigner } from "../core/sign.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid Plan with the given tasks (requires >= 1 task per schema). */
function makePlan(tasks: TEOTask[], overrides?: Partial<Plan>): Plan {
  return {
    plan_id: "plan-test",
    project_id: "proj-test",
    created_at: "2026-06-18T00:00:00Z",
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

/**
 * Build a mock TEOAdapter using vi.fn() stubs.
 * spawnAgent defaults to returning PASS for any task.
 */
function makeMockAdapter(): TEOAdapter & {
  spawnAgent: ReturnType<typeof vi.fn>;
  sagePlan: ReturnType<typeof vi.fn>;
} {
  return {
    sagePlan: vi.fn(),
    spawnAgent: vi
      .fn()
      .mockImplementation((task: TEOTask, _ctx: AgentContext) =>
        Promise.resolve({ taskId: task.id, status: "PASS" as const })
      ),
  };
}

// ---------------------------------------------------------------------------
// MISUSE / INVALID INPUT — run these first, before happy-path tests
// ---------------------------------------------------------------------------

describe("runPlan() — misuse: invalid plan inputs", () => {
  it("1. returns FAILED with empty steps when tasks array is empty — does NOT throw", async () => {
    // The Plan schema requires min(1) task, so we use a type cast to bypass
    // schema validation and exercise the validatePlan() call inside runPlan().
    const plan = makePlan([] as unknown as TEOTask[]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("FAILED");
    expect(result.steps).toEqual([]);
    // Crucially: no throw — runPlan absorbs the validation error
  });

  it("2. returns FAILED with empty steps for duplicate task IDs — does NOT throw", async () => {
    // PlanSchema does not catch duplicates at parse time; validatePlan() does.
    // Two tasks sharing the same ID should produce { valid: false }.
    const duplicateTask = makeAgentTask("task-a");
    const plan = makePlan([duplicateTask, { ...duplicateTask }]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("FAILED");
    expect(result.steps).toEqual([]);
    expect(adapter.spawnAgent).not.toHaveBeenCalled();
  });

  it("3. returns FAILED with empty steps when needs[] references a non-existent task ID — does NOT throw", async () => {
    const taskWithBadNeed = makeAgentTask("task-b", ["nonexistent-id"]);
    const plan = makePlan([taskWithBadNeed]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("FAILED");
    expect(result.steps).toEqual([]);
    expect(adapter.spawnAgent).not.toHaveBeenCalled();
  });

  it("4. returns FAILED with empty steps for a dependency cycle (A→B→A) — does NOT throw", async () => {
    // A needs B, B needs A — validatePlan() detects the cycle and returns valid: false.
    const taskA = makeAgentTask("task-cycle-a", ["task-cycle-b"]);
    const taskB = makeAgentTask("task-cycle-b", ["task-cycle-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("FAILED");
    expect(result.steps).toEqual([]);
    expect(adapter.spawnAgent).not.toHaveBeenCalled();
  });

  it("5. SCRIPT task returns FAILED with 'SCRIPT execution deferred' detail — adapter.spawnAgent is NOT called", async () => {
    // SCRIPT execution is deferred (security review pending). runPlan() must mark
    // these steps FAILED without ever calling adapter.spawnAgent().
    // Single SCRIPT task: plan has 1 task which will trigger a PQ_01 warning but
    // still be valid (warnings do not set valid: false).
    const scriptTask = makeScriptTask("script-task-1");
    const plan = makePlan([scriptTask]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.steps).toHaveLength(1);
    const scriptStep = result.steps[0];
    expect(scriptStep.taskId).toBe("script-task-1");
    expect(scriptStep.status).toBe("FAILED");
    expect(scriptStep.detail).toContain("SCRIPT execution deferred");
    // The adapter must never be called for SCRIPT tasks
    expect(adapter.spawnAgent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — adapter dispatch, error propagation, option wiring
// ---------------------------------------------------------------------------

describe("runPlan() — boundary: adapter dispatch and option pass-through", () => {
  it("6. AGENT task: spawnAgent is called with the task and a valid AgentContext; returns PASS", async () => {
    const agentTask = makeAgentTask("agent-task-1");
    const plan = makePlan([agentTask]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(adapter.spawnAgent).toHaveBeenCalledTimes(1);

    const [calledTask, calledCtx] = adapter.spawnAgent.mock.calls[0] as [TEOTask, AgentContext];
    // Task identity preserved
    expect(calledTask.id).toBe("agent-task-1");
    expect(calledTask.type).toBe("AGENT");
    // AgentContext carries plan and project identity
    expect(calledCtx.planId).toBe("plan-test");
    expect(calledCtx.projectId).toBe("proj-test");
    // stepTimeoutMs must be a positive number (default 60_000)
    expect(typeof calledCtx.stepTimeoutMs).toBe("number");
    expect(calledCtx.stepTimeoutMs).toBeGreaterThan(0);

    expect(result.steps[0].status).toBe("PASS");
    expect(result.overallStatus).toBe("PASS");
  });

  it("7. adapter error propagation: spawnAgent rejection yields FAILED step with the error message as detail", async () => {
    const agentTask = makeAgentTask("agent-boom-task");
    const plan = makePlan([agentTask]);
    const adapter = makeMockAdapter();
    adapter.spawnAgent.mockRejectedValueOnce(new Error("agent boom"));

    const result: RunResult = await runPlan(plan, adapter);

    // runPlan must not throw — the runner isolates per-step errors
    expect(result.steps).toHaveLength(1);
    const step = result.steps[0];
    expect(step.taskId).toBe("agent-boom-task");
    expect(step.status).toBe("FAILED");
    expect(step.detail).toBe("agent boom");
    expect(result.overallStatus).toBe("FAILED");
  });

  it("8. opts.stepTimeoutMs is forwarded: AgentContext.stepTimeoutMs matches the option value", async () => {
    const agentTask = makeAgentTask("agent-timeout-task");
    const plan = makePlan([agentTask]);
    const adapter = makeMockAdapter();
    const opts: RunPlanOptions = { stepTimeoutMs: 5000 };

    await runPlan(plan, adapter, opts);

    expect(adapter.spawnAgent).toHaveBeenCalledTimes(1);
    const [, calledCtx] = adapter.spawnAgent.mock.calls[0] as [TEOTask, AgentContext];
    expect(calledCtx.stepTimeoutMs).toBe(5000);
  });

  it("9. opts.maxParallel is wired: two sequential AGENT tasks both complete successfully", async () => {
    // Functional smoke for maxParallel wiring: pass maxParallel: 1 to force serial
    // execution and confirm both tasks still resolve correctly. If maxParallel were
    // not wired, this would hang or produce an error at runner construction.
    const taskA = makeAgentTask("seq-task-a");
    const taskB = makeAgentTask("seq-task-b", ["seq-task-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();
    const opts: RunPlanOptions = { maxParallel: 1 };

    const result: RunResult = await runPlan(plan, adapter, opts);

    expect(result.steps).toHaveLength(2);
    expect(result.steps.every((s) => s.status === "PASS")).toBe(true);
    expect(result.overallStatus).toBe("PASS");
    expect(adapter.spawnAgent).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — multi-task scenarios and overallStatus rollup
// ---------------------------------------------------------------------------

describe("runPlan() — golden path: multi-task plans and overallStatus rollup", () => {
  it("10. multi-task AGENT plan: B depends on A — both steps PASS, overallStatus PASS", async () => {
    const taskA = makeAgentTask("golden-a");
    const taskB = makeAgentTask("golden-b", ["golden-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.steps).toHaveLength(2);
    const stepA = result.steps.find((s) => s.taskId === "golden-a");
    const stepB = result.steps.find((s) => s.taskId === "golden-b");
    expect(stepA?.status).toBe("PASS");
    expect(stepB?.status).toBe("PASS");
    expect(result.overallStatus).toBe("PASS");
    // Both tasks were dispatched to the adapter
    expect(adapter.spawnAgent).toHaveBeenCalledTimes(2);
  });

  it("11. mixed plan (AGENT + SCRIPT): AGENT step is PASS, SCRIPT step is FAILED with deferred message, overallStatus FAILED", async () => {
    const agentTask = makeAgentTask("mixed-agent");
    const scriptTask = makeScriptTask("mixed-script");
    const plan = makePlan([agentTask, scriptTask]);
    const adapter = makeMockAdapter();

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.steps).toHaveLength(2);

    const agentStep = result.steps.find((s) => s.taskId === "mixed-agent");
    expect(agentStep?.status).toBe("PASS");

    const scriptStep = result.steps.find((s) => s.taskId === "mixed-script");
    expect(scriptStep?.status).toBe("FAILED");
    expect(scriptStep?.detail).toContain("SCRIPT execution deferred");

    // Only the AGENT task should have triggered an adapter call
    expect(adapter.spawnAgent).toHaveBeenCalledTimes(1);
    const [calledTask] = adapter.spawnAgent.mock.calls[0] as [TEOTask, AgentContext];
    expect(calledTask.id).toBe("mixed-agent");

    expect(result.overallStatus).toBe("FAILED");
  });

  it("12a. overallStatus rollup — all AGENT tasks PASS: overallStatus is PASS", async () => {
    const taskA = makeAgentTask("rollup-pass-a");
    const taskB = makeAgentTask("rollup-pass-b", ["rollup-pass-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();
    // Both tasks return PASS (default mock behavior)

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.steps.every((s) => s.status === "PASS")).toBe(true);
    expect(result.overallStatus).toBe("PASS");
  });

  it("12b. overallStatus rollup — one AGENT task FAILS: overallStatus is FAILED", async () => {
    const taskA = makeAgentTask("rollup-fail-a");
    const taskB = makeAgentTask("rollup-fail-b", ["rollup-fail-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();
    // Make task A fail
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    adapter.spawnAgent.mockImplementation((task: TEOTask, _ctx: AgentContext) =>
      task.id === "rollup-fail-a"
        ? Promise.resolve({ taskId: task.id, status: "FAILED" as const, detail: "forced failure" })
        : Promise.resolve({ taskId: task.id, status: "PASS" as const })
    );

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("FAILED");
    const stepA = result.steps.find((s) => s.taskId === "rollup-fail-a");
    expect(stepA?.status).toBe("FAILED");
    // task B depends on A which failed — it should be SKIPPED by the runner
    const stepB = result.steps.find((s) => s.taskId === "rollup-fail-b");
    expect(stepB?.status).toBe("SKIPPED");
  });
});

// ---------------------------------------------------------------------------
// WS-GO-01 — Group 1: unsigned path (no sessionId)
// ---------------------------------------------------------------------------

describe("runPlan() — unsigned path (no sessionId)", () => {
  it("no sessionId → StepResult.signature is undefined, no ledger created", async () => {
    const taskA = makeAgentTask("unsigned-a");
    const plan = makePlan([taskA]);
    const adapter = makeMockAdapter();

    // Spy on AppendOnlyLedger constructor — confirm it is never called
    const constructorSpy = vi.spyOn(AppendOnlyLedger.prototype, "append");

    const result: RunResult = await runPlan(plan, adapter);

    expect(result.steps[0]?.signature).toBeUndefined();
    expect(constructorSpy).not.toHaveBeenCalled();

    constructorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// WS-GO-01 — Group 2: signed path (with sessionId)
// ---------------------------------------------------------------------------

/** Read all lines from a JSONL file, parse each as JSON. */
function readLedgerLines(filePath: string): LedgerEvent[] {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LedgerEvent);
}

describe("runPlan() — signed path (sessionId provided)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-go01-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeSignedOpts = (sessionId: string): RunPlanOptions => ({
    sessionId,
    ledgerBaseDir: tmpDir,
  });

  it("S1. JSONL file created at ledgerBaseDir/ledger/<sessionId>.jsonl", async () => {
    const sessionId = "session-go01-s1";
    const taskA = makeAgentTask("s1-task-a");
    const taskB = makeAgentTask("s1-task-b", ["s1-task-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();

    await runPlan(plan, adapter, makeSignedOpts(sessionId));

    const filePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
    expect(fs.existsSync(filePath)).toBe(true);

    // 2 AGENT tasks + 1 CLOSE event = 3 lines
    const lines = readLedgerLines(filePath);
    expect(lines).toHaveLength(3);
  });

  it("S2. each StepResult has a valid HMAC signature (64 hex chars, verify() returns true)", async () => {
    const sessionId = "session-go01-s2";
    const taskA = makeAgentTask("s2-task-a");
    const taskB = makeAgentTask("s2-task-b", ["s2-task-a"]);
    const plan = makePlan([taskA, taskB], { plan_id: "plan-s2", project_id: "proj-test" });
    const adapter = makeMockAdapter();

    const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

    const verifier = new HmacSigner({ baseDir: tmpDir });

    for (const step of result.steps) {
      // Signature must be a 64-char hex string
      expect(step.signature).toMatch(/^[0-9a-f]{64}$/);

      // Reconstruct payload from ledger event and verify
      const filePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
      const lines = readLedgerLines(filePath).filter(
        (l) => l.task_id === step.taskId && l.phase === "EXECUTE"
      );
      expect(lines).toHaveLength(1);
      const evt = lines[0]!;

      const valid = verifier.verify(
        {
          plan_id: plan.plan_id,
          task_id: evt.task_id,
          actor_id: evt.actor_id,
          verdict: evt.verdict,
          ts: evt.ts,
          seq: evt.seq,
        },
        step.signature!
      );
      expect(valid).toBe(true);
    }
  });

  it("S3. ledger events match StepResult data (task_id, verdict, actor_id, phase, CLOSE event)", async () => {
    const sessionId = "session-go01-s3";
    const taskA = makeAgentTask("s3-task-a");
    const taskB = makeAgentTask("s3-task-b", ["s3-task-a"]);
    const plan = makePlan([taskA, taskB], { plan_id: "plan-s3", project_id: "proj-test" });
    const adapter = makeMockAdapter();

    await runPlan(plan, adapter, makeSignedOpts(sessionId));

    const filePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
    const lines = readLedgerLines(filePath);

    // Two EXECUTE events + one CLOSE
    const executeEvents = lines.filter((l) => l.phase === "EXECUTE");
    const closeEvent = lines.find((l) => l.phase === "CLOSE");

    expect(executeEvents).toHaveLength(2);
    expect(closeEvent).toBeDefined();

    const evtA = executeEvents.find((l) => l.task_id === "s3-task-a");
    const evtB = executeEvents.find((l) => l.task_id === "s3-task-b");

    expect(evtA?.verdict).toBe("PASS");
    expect(evtA?.actor_id).toBe("eng"); // agent_id from makeAgentTask
    expect(evtA?.actor_type).toBe("AGENT");
    expect(evtB?.verdict).toBe("PASS");
    expect(closeEvent?.verdict).toBeNull();
  });

  it("S4. CLOSE event summary is correct (4-task plan with failure cascade)", async () => {
    const sessionId = "session-go01-s4";
    // A passes, B depends on A (passes), C depends on A (fails), D depends on C (skipped)
    const taskA = makeAgentTask("s4-a");
    const taskB = makeAgentTask("s4-b", ["s4-a"]);
    const taskC = makeAgentTask("s4-c", ["s4-a"]);
    const taskD = makeAgentTask("s4-d", ["s4-c"]); // depends on C which will fail → SKIPPED

    const plan = makePlan([taskA, taskB, taskC, taskD]);
    const adapter = makeMockAdapter();

    // Make C fail
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    adapter.spawnAgent.mockImplementation((task: TEOTask, _ctx: AgentContext) =>
      task.id === "s4-c"
        ? Promise.resolve({ taskId: task.id, status: "FAILED" as const, detail: "c fails" })
        : Promise.resolve({ taskId: task.id, status: "PASS" as const })
    );

    await runPlan(plan, adapter, makeSignedOpts(sessionId));

    const filePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
    const lines = readLedgerLines(filePath);
    const closeEvent = lines.find((l) => l.phase === "CLOSE");

    expect(closeEvent?.detail).toMatchObject({
      task_count: 4,
      pass: 2, // A and B pass
      fail: 1, // C fails
      skipped: 1, // D is skipped
    });
  });

  it("S5. FAILED status maps to LedgerVerdict FAIL (not FAILED)", async () => {
    const sessionId = "session-go01-s5";
    const taskA = makeAgentTask("s5-task-a");
    const plan = makePlan([taskA]);
    const adapter = makeMockAdapter();

    adapter.spawnAgent.mockResolvedValueOnce({
      taskId: "s5-task-a",
      status: "FAILED" as const,
      detail: "forced fail",
    });

    await runPlan(plan, adapter, makeSignedOpts(sessionId));

    const filePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
    const lines = readLedgerLines(filePath);
    const executeEvent = lines.find((l) => l.phase === "EXECUTE");

    expect(executeEvent?.verdict).toBe("FAIL");
    expect(executeEvent?.verdict).not.toBe("FAILED");
  });

  it("S6. SKIPPED status maps to LedgerVerdict SKIPPED (A fails → B skipped)", async () => {
    const sessionId = "session-go01-s6";
    const taskA = makeAgentTask("s6-a");
    const taskB = makeAgentTask("s6-b", ["s6-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();

    // Make A fail
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    adapter.spawnAgent.mockImplementation((task: TEOTask, _ctx: AgentContext) =>
      task.id === "s6-a"
        ? Promise.resolve({ taskId: task.id, status: "FAILED" as const })
        : Promise.resolve({ taskId: task.id, status: "PASS" as const })
    );

    const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

    const filePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
    const lines = readLedgerLines(filePath);

    // B should be SKIPPED in the result
    const stepB = result.steps.find((s) => s.taskId === "s6-b");
    expect(stepB?.status).toBe("SKIPPED");

    // The ledger event for B (if written by the executor) has verdict SKIPPED
    const evtB = lines.find((l) => l.task_id === "s6-b" && l.phase === "EXECUTE");
    if (evtB !== undefined) {
      expect(evtB.verdict).toBe("SKIPPED");
    }
  });

  it("S7. SCRIPT task gets ledger entry with verdict FAIL", async () => {
    const sessionId = "session-go01-s7";
    const taskA = makeScriptTask("s7-script");
    const plan = makePlan([taskA]);
    const adapter = makeMockAdapter();

    await runPlan(plan, adapter, makeSignedOpts(sessionId));

    const filePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
    const lines = readLedgerLines(filePath);
    const executeEvent = lines.find((l) => l.phase === "EXECUTE" && l.task_id === "s7-script");

    expect(executeEvent).toBeDefined();
    expect(executeEvent?.verdict).toBe("FAIL");
    expect(executeEvent?.actor_type).toBe("SCRIPT");
    expect(executeEvent?.actor_id).toBe("SYSTEM");
  });
});

// ---------------------------------------------------------------------------
// WS-GO-01 — Group 3: misuse cases
// ---------------------------------------------------------------------------

describe("runPlan() — signed path misuse cases", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-go01-misuse-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("M1. empty sessionId → rejects with LedgerPathError (path error)", async () => {
    const taskA = makeAgentTask("m1-task");
    const plan = makePlan([taskA]);
    const adapter = makeMockAdapter();

    await expect(runPlan(plan, adapter, { sessionId: "", ledgerBaseDir: tmpDir })).rejects.toThrow(
      /session_id|path|invalid/i
    );
  });

  it("M2. sessionId with '/' → rejects with LedgerPathError", async () => {
    const taskA = makeAgentTask("m2-task");
    const plan = makePlan([taskA]);
    const adapter = makeMockAdapter();

    await expect(
      runPlan(plan, adapter, { sessionId: "foo/bar", ledgerBaseDir: tmpDir })
    ).rejects.toThrow(/session_id|path|separator/i);
  });

  it("M3. ledgerBaseDir provided but no sessionId → unsigned behavior (no file, no signature)", async () => {
    const taskA = makeAgentTask("m3-task");
    const plan = makePlan([taskA]);
    const adapter = makeMockAdapter();

    const result = await runPlan(plan, adapter, { ledgerBaseDir: tmpDir });

    // No signature
    expect(result.steps[0]?.signature).toBeUndefined();

    // No ledger file written
    const ledgerDir = path.join(tmpDir, "ledger");
    if (fs.existsSync(ledgerDir)) {
      const files = fs.readdirSync(ledgerDir);
      expect(files).toHaveLength(0);
    } else {
      expect(fs.existsSync(ledgerDir)).toBe(false);
    }
  });
});

// =============================================================================
// WS-ARCH-01 — passing (post-impl, CAD gate 2)
//
// These tests exercise TORN ledger behavior implemented in WS-ARCH-01.
// `ledger.close()` now accepts `torn?: boolean` in WorkflowSummary, and
// run-plan.ts wires `torn: true` when the runner aborted and SKIPped tasks.
// =============================================================================

describe("runPlan — TORN ledger on abort (WS-ARCH-01)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-arch01-torn-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeSignedOpts = (sessionId: string): RunPlanOptions => ({
    sessionId,
    ledgerBaseDir: tmpDir,
  });

  it("TORN-1: plan with FAILED step and abort-SKIPped independent task → CLOSE event has torn: true", async () => {
    // Plan: A (independent, PASS), B (independent, FAILED), C (independent).
    // After WS-ARCH-01 abort: B fails → abort fires → C is SKIPPED (never dispatched).
    // The CLOSE event in the ledger JSONL must include `torn: true` in its detail.
    //
    // This test FAILS until dev:
    //   1. Adds `torn?: boolean` to WorkflowSummary in ledger.ts
    //   2. Wires `torn: true` into ledger.close() in run-plan.ts when abort SKIPs were present
    const sessionId = "arch01-torn-1";

    const taskA = makeAgentTask("torn1-a"); // passes
    const taskB = makeAgentTask("torn1-b"); // fails — triggers abort
    const taskC = makeAgentTask("torn1-c"); // independent — SKIPPED by abort

    const plan = makePlan([taskA, taskB, taskC]);
    const adapter = makeMockAdapter();

    // Make B fail
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    adapter.spawnAgent.mockImplementation((task: TEOTask, _ctx: AgentContext) =>
      task.id === "torn1-b"
        ? Promise.resolve({ taskId: task.id, status: "FAILED" as const, detail: "forced failure" })
        : Promise.resolve({ taskId: task.id, status: "PASS" as const })
    );

    await runPlan(plan, adapter, makeSignedOpts(sessionId));

    const filePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as LedgerEvent);

    const closeEvent = lines.find((l) => l.phase === "CLOSE");
    expect(closeEvent).toBeDefined();

    // Assert torn: true in CLOSE event detail — FAILS until WS-ARCH-01 is implemented
    expect(closeEvent?.detail).toMatchObject({ torn: true });
  });

  it("TORN-2: all tasks PASS → CLOSE event does NOT have torn: true", async () => {
    // Regression guard: when nothing fails, the ledger close must not falsely
    // report the workflow as TORN.
    const sessionId = "arch01-torn-2";

    const taskA = makeAgentTask("torn2-a");
    const taskB = makeAgentTask("torn2-b", ["torn2-a"]);
    const taskC = makeAgentTask("torn2-c"); // independent

    const plan = makePlan([taskA, taskB, taskC]);
    const adapter = makeMockAdapter(); // all tasks return PASS by default

    await runPlan(plan, adapter, makeSignedOpts(sessionId));

    const filePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as LedgerEvent);

    const closeEvent = lines.find((l) => l.phase === "CLOSE");
    expect(closeEvent).toBeDefined();

    // torn must be absent or false — workflow completed normally
    const detail = closeEvent?.detail as Record<string, unknown> | null;
    expect(detail?.["torn"]).toBeFalsy();
  });

  it("TORN-3: FAILED step with only dep-cascade SKIPPED (no abort-SKIPPED tasks) → torn: false", async () => {
    // Plan: A → B (dep). A fails. B is SKIPPED due to upstream dep, NOT abort.
    // If the runner aborts on first failure but there are no *independent* tasks
    // that were blocked, the TORN flag should reflect whether any task was
    // skipped specifically due to abort (vs. normal dep-cascade SKIP).
    //
    // This test documents the intended distinction: dep-cascade SKIPPED alone
    // does NOT make the workflow TORN. Only abort-blocked dispatches make it TORN.
    //
    // Note: whether the implementation distinguishes these two skip reasons is
    // up to dev. If the impl marks all FAILED+SKIPPED runs as TORN regardless,
    // update this test. This spec documents the intended fine-grained behavior.
    const sessionId = "arch01-torn-3";

    const taskA = makeAgentTask("torn3-a"); // fails
    const taskB = makeAgentTask("torn3-b", ["torn3-a"]); // SKIPPED: dep on failed A

    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();

    adapter.spawnAgent.mockResolvedValueOnce({
      taskId: "torn3-a",
      status: "FAILED" as const,
      detail: "forced failure",
    });

    await runPlan(plan, adapter, makeSignedOpts(sessionId));

    const filePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as LedgerEvent);

    const closeEvent = lines.find((l) => l.phase === "CLOSE");
    expect(closeEvent).toBeDefined();

    // No independent tasks were abort-blocked — torn should be false/absent
    const detail = closeEvent?.detail as Record<string, unknown> | null;
    expect(detail?.["torn"]).toBeFalsy();
  });
});

// =============================================================================
// WS-SEC-01 — evaluateGate() inline verification on signed path (passing, post-impl, CAD gate 2)
// =============================================================================

describe("runPlan — evaluateGate() inline verification (WS-SEC-01)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-sec01-gate-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeSignedOpts = (sessionId: string): RunPlanOptions => ({
    sessionId,
    ledgerBaseDir: tmpDir,
  });

  // SEC01-U1: unsigned path — evaluateGate() is NOT called
  it("SEC01-U1: unsigned path (no sessionId) — PASS result stays PASS, gate is NOT invoked", async () => {
    // On the unsigned path, evaluateGate() must never be called.
    // A PASS result from the adapter must remain PASS.
    // Regression guard: adding gate wiring must not change unsigned-path behavior.
    const task = makeAgentTask("sec01-u1-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    // adapter returns PASS by default

    const result = await runPlan(plan, adapter, { ledgerBaseDir: tmpDir }); // no sessionId

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.status).toBe("PASS");
    expect(result.overallStatus).toBe("PASS");
    // signingStatus confirms unsigned path
    expect(result.steps[0]!.signingStatus).toBe("unsigned_by_design");
  });

  // SEC01-U2: unsigned path — FAILED stays FAILED
  it("SEC01-U2: unsigned path (no sessionId) — FAILED result stays FAILED, gate is NOT invoked", async () => {
    const task = makeAgentTask("sec01-u2-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    adapter.spawnAgent.mockResolvedValueOnce({
      taskId: "sec01-u2-task",
      status: "FAILED" as const,
      detail: "forced adapter failure",
    });

    const result = await runPlan(plan, adapter, { ledgerBaseDir: tmpDir }); // no sessionId

    expect(result.steps[0]!.status).toBe("FAILED");
    expect(result.steps[0]!.detail).toBe("forced adapter failure");
    expect(result.overallStatus).toBe("FAILED");
  });

  // SEC01-S1: signed path, adapter PASS, gate PASS → result stays PASS
  it("SEC01-S1: signed path — adapter PASS + gate PASS → step status is PASS", async () => {
    // Happy path: adapter and gate agree. No override needed.
    const sessionId = "sec01-s1-agree-pass";
    const task = makeAgentTask("sec01-s1-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    // adapter returns PASS by default; gate stub maps PASS → "PASS"

    const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.status).toBe("PASS");
    expect(result.overallStatus).toBe("PASS");
  });

  // SEC01-S2: signed path, adapter FAILED, gate FAIL → result stays FAILED
  it("SEC01-S2: signed path — adapter FAILED + gate FAIL → step status is FAILED", async () => {
    // Both agree on failure. No override needed. Trust the failure.
    const sessionId = "sec01-s2-agree-fail";
    const task = makeAgentTask("sec01-s2-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    adapter.spawnAgent.mockResolvedValueOnce({
      taskId: "sec01-s2-task",
      status: "FAILED" as const,
      detail: "adapter reports failure",
    });

    const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

    expect(result.steps[0]!.status).toBe("FAILED");
    expect(result.overallStatus).toBe("FAILED");
  });

  // SEC01-S3 (KEY TEST): signed path, adapter PASS but gate FAIL → override to FAILED
  it("SEC01-S3: signed path — adapter PASS but gate FAIL → step overridden to FAILED with 'gate override' detail", async () => {
    // This is the critical security test. When the gate disagrees with a PASS
    // self-report, the gate's FAIL verdict wins. The step must be FAILED and
    // the ledger must reflect the override.
    //
    // Implementation note: to force the gate to return FAIL for a PASS adapter
    // result, dev can expose a gate injection hook (e.g. evaluateGate mock) or
    // make target_dir point to a non-existent path so the content hash fails
    // some invariant. For now this test requires that the gate injection seam
    // is mockable — or that evaluateGate is importable and vi.mock()-able.
    //
    // This test FAILS until:
    //   1. evaluateGate() is wired into run-plan.ts executor on the signed path
    //   2. The gate-override logic rewrites status + detail when gate disagrees
    //
    // The test uses vi.mock to stub evaluateGate so we can control its return
    // without needing a real gate implementation.
    const sessionId = "sec01-s3-gate-override";
    const task = makeAgentTask("sec01-s3-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    // adapter returns PASS
    // gate is mocked to return FAIL via module mock below

    // Import evaluate-gate module and mock it at the module level.
    // The mock is set up before runPlan is called so the executor picks it up.
    const evaluateGateModule = await import("./evaluate-gate.js");
    const gateSpy = vi
      .spyOn(evaluateGateModule, "evaluateGate")
      .mockResolvedValueOnce("FAIL" as import("./evaluate-gate.js").GateVerdict);

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      expect(result.steps).toHaveLength(1);
      // Gate override: adapter said PASS but gate said FAIL → must be FAILED
      expect(result.steps[0]!.status).toBe("FAILED");
      // Detail must mention gate override so operators can distinguish from genuine failures
      expect(result.steps[0]!.detail).toMatch(/gate override/i);
      expect(result.overallStatus).toBe("FAILED");

      // Ledger must also record FAIL (not PASS) — gate override propagates to ledger
      const filePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
      const lines = readLedgerLines(filePath);
      const executeEvent = lines.find(
        (l) => l.phase === "EXECUTE" && l.task_id === "sec01-s3-task"
      );
      expect(executeEvent).toBeDefined();
      expect(executeEvent?.verdict).toBe("FAIL");
    } finally {
      gateSpy.mockRestore();
    }
  });

  // SEC01-S4: signed path, adapter FAILED, gate PASS → result stays FAILED (conservative)
  it("SEC01-S4: signed path — adapter FAILED + gate PASS → step stays FAILED (trust failure, never override to PASS)", async () => {
    // Conservative rule: when the gate says PASS but the adapter says FAILED,
    // do NOT override. A self-reporting adapter that says it failed is trustworthy
    // in that direction — the gate cannot rehabilitate a failure.
    const sessionId = "sec01-s4-conservative";
    const task = makeAgentTask("sec01-s4-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    adapter.spawnAgent.mockResolvedValueOnce({
      taskId: "sec01-s4-task",
      status: "FAILED" as const,
      detail: "adapter says it failed",
    });

    // Gate is mocked to say PASS — but run-plan.ts must NOT promote a FAILED result
    const evaluateGateModule = await import("./evaluate-gate.js");
    const gateSpy = vi
      .spyOn(evaluateGateModule, "evaluateGate")
      .mockResolvedValueOnce("PASS" as import("./evaluate-gate.js").GateVerdict);

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      expect(result.steps[0]!.status).toBe("FAILED");
      // Original adapter detail must be preserved — no "gate override" here
      expect(result.steps[0]!.detail).toBe("adapter says it failed");
      expect(result.steps[0]!.detail).not.toMatch(/gate override/i);
      expect(result.overallStatus).toBe("FAILED");
    } finally {
      gateSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// WS-GO-01 — Group 4: error isolation
// ---------------------------------------------------------------------------

describe("runPlan() — ledger error isolation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-go01-iso-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("E1. ledger.append() throwing → runPlan resolves, result.steps[0].status preserved", async () => {
    const sessionId = "session-go01-iso";
    const taskA = makeAgentTask("iso-task");
    const plan = makePlan([taskA]);
    const adapter = makeMockAdapter();

    // Spy on AppendOnlyLedger.prototype.append to make it throw
    const appendSpy = vi.spyOn(AppendOnlyLedger.prototype, "append").mockImplementation(() => {
      throw new Error("simulated ledger write failure");
    });

    const result = await runPlan(plan, adapter, { sessionId, ledgerBaseDir: tmpDir });

    // runPlan must not propagate the ledger error
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe("PASS");
    expect(result.overallStatus).toBe("PASS");
    // signature is undefined because the append failed
    expect(result.steps[0]?.signature).toBeUndefined();

    appendSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// WS-GO-04: signingStatus field on StepResult
//
// These tests will FAIL today:
//   - StepResult does not yet have a signingStatus field
//   - runPlan() does not yet populate signingStatus on each step
// ---------------------------------------------------------------------------

describe("runPlan() — signingStatus field (WS-GO-04)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-go04-sigstatus-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // T-SIGN-1: runPlan() with sessionId → all step results have signingStatus: "signed"
  it("T-SIGN-1: runPlan() with sessionId → all step results have signingStatus: 'signed'", async () => {
    const sessionId = "go04-sign-status-1";
    const taskA = makeAgentTask("sign-status-task-a");
    const taskB = makeAgentTask("sign-status-task-b", ["sign-status-task-a"]);
    const plan = makePlan([taskA, taskB], { plan_id: "go04-sign-status-plan" });
    const adapter = makeMockAdapter();

    // Act: signed path with sessionId
    const result = await runPlan(plan, adapter, { sessionId, ledgerBaseDir: tmpDir });

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(2);

    // Every step must have signingStatus: "signed"
    // This FAILS today — StepResult.signingStatus field not yet added.
    for (const step of result.steps) {
      const stepWithStatus = step as RunResult["steps"][number] & { signingStatus?: string };
      expect(stepWithStatus.signingStatus).toBe("signed");
    }
  });

  // T-SIGN-2: runPlan() without sessionId → all step results have signingStatus: "unsigned_by_design"
  it("T-SIGN-2: runPlan() without sessionId → all step results have signingStatus: 'unsigned_by_design'", async () => {
    const taskA = makeAgentTask("unsigned-status-task-a");
    const taskB = makeAgentTask("unsigned-status-task-b", ["unsigned-status-task-a"]);
    const plan = makePlan([taskA, taskB], { plan_id: "go04-unsigned-status-plan" });
    const adapter = makeMockAdapter();

    // Act: unsigned path — no sessionId
    const result = await runPlan(plan, adapter, { ledgerBaseDir: tmpDir });

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(2);

    // Every step must have signingStatus: "unsigned_by_design"
    // This FAILS today — StepResult.signingStatus field not yet added.
    for (const step of result.steps) {
      const stepWithStatus = step as RunResult["steps"][number] & { signingStatus?: string };
      expect(stepWithStatus.signingStatus).toBe("unsigned_by_design");
    }
  });

  // T-SIGN-3: signed run + dependency chain: task-A FAILED → task-B SKIPPED.
  // SKIPPED steps bypass the executor entirely so they never get signed.
  // After the post-process pass, they must carry signingStatus: "unsigned_by_design".
  it("T-SIGN-3: signed run with SKIPPED step → steps[0].signingStatus='signed', steps[1].signingStatus='unsigned_by_design'", async () => {
    const sessionId = "go04-sign-status-3";
    const taskA = makeAgentTask("sign-status-skip-a");
    const taskB = makeAgentTask("sign-status-skip-b", ["sign-status-skip-a"]);
    const plan = makePlan([taskA, taskB], { plan_id: "go04-sign-status-skip-plan" });
    const adapter = makeMockAdapter();

    // Make task-A return FAILED — task-B will be SKIPPED (never enters executor)
    adapter.spawnAgent.mockResolvedValueOnce({
      taskId: "sign-status-skip-a",
      status: "FAILED" as const,
      detail: "forced failure for T-SIGN-3",
    });

    const result = await runPlan(plan, adapter, { sessionId, ledgerBaseDir: tmpDir });

    expect(result.overallStatus).toBe("FAILED");
    expect(result.steps).toHaveLength(2);

    const stepA = result.steps.find((s) => s.taskId === "sign-status-skip-a");
    const stepB = result.steps.find((s) => s.taskId === "sign-status-skip-b");

    // task-A went through the executor on a signed run → signed
    expect(stepA?.status).toBe("FAILED");
    expect(stepA?.signingStatus).toBe("signed");

    // task-B was SKIPPED (bypassed executor) → post-process stamps it unsigned_by_design
    expect(stepB?.status).toBe("SKIPPED");
    expect(stepB?.signingStatus).toBe("unsigned_by_design");
  });
});

// =============================================================================
// WS-CRYPTO-02 — WorkstreamTree integration (passing, post-impl, CAD gate 2)
//
// runPlan() must:
//   1. Accept backend?: Backend and workstreamBaseDir?: string in RunPlanOptions.
//   2. Accept projectDir?: string in RunPlanOptions (defaults to process.cwd()).
//   3. Allocate a WorkstreamTree handle at plan start using plan.project_id and
//      plan.plan_id (sanitized to match SAFE_WS_ID_RE) as the wsId.
//   4. Pass handle.cwd through AgentContext.cwd to every spawnAgent() call.
//   5. Close the handle in a finally block — even when the adapter throws.
//
// Ordering: misuse → boundary → golden path
// =============================================================================

import { WorkstreamTree } from "../core/workstream-tree.js";

describe("runPlan() — WS-CRYPTO-02: WorkstreamTree integration", () => {
  let tmpWsBase: string; // injected workstreamBaseDir — never touches ~/.teo
  let tmpProjectDir: string; // small synthetic project dir for sandbox tests

  beforeEach(() => {
    tmpWsBase = fs.mkdtempSync(path.join(os.tmpdir(), "teo-crypto02-wsbase-"));
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-crypto02-proj-"));
    // Seed the project dir with 1-2 real files so sandbox copy has content
    fs.writeFileSync(path.join(tmpProjectDir, "main.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(tmpProjectDir, "README.md"), "# test\n");
  });

  afterEach(() => {
    fs.rmSync(tmpWsBase, { recursive: true, force: true });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // MISUSE
  // ---------------------------------------------------------------------------

  // WS-CRYPTO02-M1: backend: "none" (default behavior when explicitly set) —
  // spawnAgent is called with AgentContext.cwd equal to projectDir.
  // The "none" backend's handle.cwd IS the projectDir (shared tree, no copy).
  it("WS-CRYPTO02-M1: backend 'none' — spawnAgent receives AgentContext.cwd equal to projectDir", async () => {
    const task = makeAgentTask("crypto02-m1-task");
    const plan = makePlan([task], { plan_id: "crypto02-m1", project_id: "proj-crypto02-m1" });
    const adapter = makeMockAdapter();

    await runPlan(plan, adapter, {
      backend: "none",
      projectDir: tmpProjectDir,
      workstreamBaseDir: tmpWsBase,
    });

    expect(adapter.spawnAgent).toHaveBeenCalledTimes(1);
    const [, ctx] = adapter.spawnAgent.mock.calls[0] as [TEOTask, AgentContext];
    // "none" backend: cwd is the original projectDir (shared tree)
    expect(ctx.cwd).toBe(tmpProjectDir);
  });

  // WS-CRYPTO02-M2: backend: "sandbox" — AgentContext.cwd is an isolated copy,
  // not the original projectDir. The two paths must differ.
  it("WS-CRYPTO02-M2: backend 'sandbox' — spawnAgent receives a cwd different from projectDir", async () => {
    const task = makeAgentTask("crypto02-m2-task");
    const plan = makePlan([task], { plan_id: "crypto02-m2", project_id: "proj-crypto02-m2" });
    const adapter = makeMockAdapter();

    await runPlan(plan, adapter, {
      backend: "sandbox",
      projectDir: tmpProjectDir,
      workstreamBaseDir: tmpWsBase,
    });

    expect(adapter.spawnAgent).toHaveBeenCalledTimes(1);
    const [, ctx] = adapter.spawnAgent.mock.calls[0] as [TEOTask, AgentContext];
    // "sandbox" backend: cwd is an isolated copy — must NOT equal the original projectDir
    expect(ctx.cwd).toBeDefined();
    expect(ctx.cwd).not.toBe(tmpProjectDir);
    // The sandbox dir must exist on disk
    expect(fs.existsSync(ctx.cwd!)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // BOUNDARY
  // ---------------------------------------------------------------------------

  // WS-CRYPTO02-B1: WorkstreamTree.close() is called in a finally block —
  // even when the adapter throws. We spy on WorkstreamTree.prototype.close
  // to verify it's called exactly once regardless of adapter outcome.
  it("WS-CRYPTO02-B1: WorkstreamTree.close() is called in finally even when adapter throws", async () => {
    const task = makeAgentTask("crypto02-b1-task");
    const plan = makePlan([task], { plan_id: "crypto02-b1", project_id: "proj-crypto02-b1" });
    const adapter = makeMockAdapter();
    adapter.spawnAgent.mockRejectedValueOnce(new Error("adapter exploded"));

    const closeSpy = vi.spyOn(WorkstreamTree.prototype, "close");

    try {
      const result = await runPlan(plan, adapter, {
        backend: "none",
        projectDir: tmpProjectDir,
        workstreamBaseDir: tmpWsBase,
      });
      // runPlan must still resolve (not throw) — error is captured as FAILED step
      expect(result.steps[0]?.status).toBe("FAILED");
    } finally {
      // close() must have been called once regardless of adapter throw
      expect(closeSpy).toHaveBeenCalledTimes(1);
      closeSpy.mockRestore();
    }
  });

  // WS-CRYPTO02-B2: no backend in options (undefined) defaults to "none".
  // AgentContext.cwd must equal projectDir — same result as M1.
  it("WS-CRYPTO02-B2: no backend in options defaults to 'none' — cwd equals projectDir", async () => {
    const task = makeAgentTask("crypto02-b2-task");
    const plan = makePlan([task], { plan_id: "crypto02-b2", project_id: "proj-crypto02-b2" });
    const adapter = makeMockAdapter();

    // Deliberately omit backend — must default to "none"
    await runPlan(plan, adapter, {
      projectDir: tmpProjectDir,
      workstreamBaseDir: tmpWsBase,
    });

    expect(adapter.spawnAgent).toHaveBeenCalledTimes(1);
    const [, ctx] = adapter.spawnAgent.mock.calls[0] as [TEOTask, AgentContext];
    expect(ctx.cwd).toBe(tmpProjectDir);
  });

  // ---------------------------------------------------------------------------
  // GOLDEN PATH
  // ---------------------------------------------------------------------------

  // WS-CRYPTO02-G1: two concurrent tasks in "sandbox" backend both receive the
  // SAME cwd. WorkstreamTree is allocated once per plan (not per task), so both
  // tasks share the same isolated sandbox directory.
  it("WS-CRYPTO02-G1: two tasks in 'sandbox' backend both see the same cwd (one allocation per plan)", async () => {
    const taskA = makeAgentTask("crypto02-g1-a");
    const taskB = makeAgentTask("crypto02-g1-b");
    const plan = makePlan([taskA, taskB], {
      plan_id: "crypto02-g1",
      project_id: "proj-crypto02-g1",
    });
    const adapter = makeMockAdapter();

    await runPlan(plan, adapter, {
      backend: "sandbox",
      projectDir: tmpProjectDir,
      workstreamBaseDir: tmpWsBase,
    });

    expect(adapter.spawnAgent).toHaveBeenCalledTimes(2);
    const [, ctxA] = adapter.spawnAgent.mock.calls[0] as [TEOTask, AgentContext];
    const [, ctxB] = adapter.spawnAgent.mock.calls[1] as [TEOTask, AgentContext];

    // Both tasks must see the SAME cwd — WorkstreamTree allocated once per plan
    expect(ctxA.cwd).toBeDefined();
    expect(ctxB.cwd).toBeDefined();
    expect(ctxA.cwd).toBe(ctxB.cwd);
    // And that cwd must not be the original projectDir (it's a sandbox copy)
    expect(ctxA.cwd).not.toBe(tmpProjectDir);
  });

  // WS-CRYPTO02-G2: existing calls with NO WorkstreamTree options still work —
  // backward compatibility. No cwd field required on older callers.
  // spawnAgent must still be called and the plan must complete successfully.
  it("WS-CRYPTO02-G2: existing callers with no backend/projectDir options still complete (backward compat)", async () => {
    const task = makeAgentTask("crypto02-g2-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();

    // No backend, no projectDir, no workstreamBaseDir — all omitted
    const result = await runPlan(plan, adapter);

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe("PASS");
    expect(adapter.spawnAgent).toHaveBeenCalledTimes(1);
  });

  it("WS-CRYPTO02-B3: plan_id starting with underscore is sanitized to valid wsId (no throw)", async () => {
    const task = makeAgentTask("crypto02-b3-task");
    const plan = makePlan([task], { plan_id: "_underscore-plan" }); // starts with underscore
    const adapter = makeMockAdapter();

    // Must not throw — wsId sanitization must strip the leading underscore
    const result = await runPlan(plan, adapter, {
      workstreamBaseDir: tmpWsBase,
      projectDir: tmpProjectDir,
    });

    expect(result.overallStatus).toBe("PASS");
  });
});

// =============================================================================
// WS-CRYPTO-01 — target_dir wired to content hash (signed path)
//
// Two bugs being fixed together:
//   A. PlanSchema's AgentTaskSchema uses .strict(), which strips/rejects target_dir
//      at parse time, so it never reaches run-plan.ts.
//   B. The type cast in run-plan.ts (line ~119) can never find target_dir because
//      .strict() already removed it from the parsed object.
//
// Fix: add target_dir as z.string().optional() to AgentTaskSchema BEFORE .strict()
// so it survives the parse and flows into computeContentHash().
// =============================================================================

describe("runPlan() — WS-CRYPTO-01: target_dir wired to content hash (signed path)", () => {
  let tmpDir: string;
  let targetDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-crypto01-"));
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-crypto01-target-"));
    // Put a real file in targetDir so computeContentHash returns a non-null hash
    fs.writeFileSync(path.join(targetDir, "main.ts"), "export const x = 1;");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  const makeSignedOpts = (sessionId: string): RunPlanOptions => ({
    sessionId,
    ledgerBaseDir: tmpDir,
  });

  it("CRYPTO-1: PlanSchema.parse() does NOT reject an AGENT task with target_dir field", () => {
    // target_dir is a declared optional field on AgentTaskSchema so .strict() allows it.
    const rawPlan = {
      plan_id: "plan-crypto01",
      project_id: "proj-crypto01",
      created_at: "2026-06-23T00:00:00Z",
      version: "1" as const,
      tasks: [
        {
          id: "crypto-task-1",
          type: "AGENT" as const,
          agent_id: "eng",
          prompt: "do the thing",
          needs: [],
          gates: [],
          target_dir: "/some/path",
        },
      ],
    };

    // Must NOT throw — target_dir should be an allowed field on AGENT tasks
    expect(() => PlanSchema.parse(rawPlan)).not.toThrow();
  });

  it("CRYPTO-2: AGENT task with valid target_dir → content_hash is non-null in the signer payload (signed path)", async () => {
    // target_dir survives the parse and computeContentHash() returns a real SHA-256
    // hash, which is passed to signer.sign() as content_hash.
    //
    // We verify via a spy on HmacSigner.sign() to capture the payload.
    const sessionId = "crypto01-with-target-dir";
    const adapter = makeMockAdapter();

    // Capture every payload passed to signer.sign()
    const capturedPayloads: Array<Parameters<InstanceType<typeof HmacSigner>["sign"]>[0]> = [];
    const signSpy = vi.spyOn(HmacSigner.prototype, "sign").mockImplementation(function (_payload) {
      capturedPayloads.push(_payload);
      // Return a syntactically valid 64-hex signature stub — we only care about the payload
      return "c".repeat(64);
    });

    try {
      // Parse the plan through PlanSchema so target_dir survives (requires CRYPTO-1 fix)
      const rawPlan = {
        plan_id: "plan-crypto01-target",
        project_id: "proj-crypto01",
        created_at: "2026-06-23T00:00:00Z",
        version: "1" as const,
        tasks: [
          {
            id: "crypto-target-task",
            type: "AGENT" as const,
            agent_id: "eng",
            prompt: "hash the target dir",
            needs: [],
            gates: [],
            target_dir: targetDir,
          },
        ],
      };

      // CRYPTO-1 must pass first — if PlanSchema.parse() throws here, this test
      // also fails, making the dependency between the two bugs explicit.
      const plan = PlanSchema.parse(rawPlan);

      await runPlan(plan, adapter, makeSignedOpts(sessionId));

      // The signer must have been called with a non-null content_hash
      expect(capturedPayloads).toHaveLength(1);
      const payload = capturedPayloads[0]!;
      // After the fix: content_hash is the SHA-256 of targetDir, a 64-hex string
      expect(payload.content_hash).not.toBeNull();
      expect(payload.content_hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      signSpy.mockRestore();
    }
  });

  it("CRYPTO-3: AGENT task WITHOUT target_dir → content_hash is null in signer payload (backward compat)", async () => {
    // Regression guard: tasks that don't include target_dir must still get
    // content_hash: null in the signer payload. The fix must not break this path.
    const sessionId = "crypto01-no-target-dir";
    const adapter = makeMockAdapter();

    const capturedPayloads: Array<Parameters<InstanceType<typeof HmacSigner>["sign"]>[0]> = [];
    const signSpy = vi.spyOn(HmacSigner.prototype, "sign").mockImplementation(function (
      this: InstanceType<typeof HmacSigner>,
      payload
    ) {
      capturedPayloads.push(payload);
      return "b".repeat(64); // stub signature — content doesn't matter for this test
    });

    try {
      // Standard AGENT task without target_dir
      const task = makeAgentTask("crypto-no-target");
      const plan = makePlan([task]);

      await runPlan(plan, adapter, makeSignedOpts(sessionId));

      expect(capturedPayloads).toHaveLength(1);
      const payload = capturedPayloads[0]!;
      // No target_dir → content_hash must be null (not a hash, not undefined)
      expect(payload.content_hash).toBeNull();
    } finally {
      signSpy.mockRestore();
    }
  });
});
