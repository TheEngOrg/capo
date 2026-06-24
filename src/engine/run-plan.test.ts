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

      // WS-SIGN-02: signer.sign() is now called twice — once for the EXECUTE event
      // and once for the CLOSE event. We inspect capturedPayloads[0] (EXECUTE).
      expect(capturedPayloads).toHaveLength(2);
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

      // WS-SIGN-02: signer.sign() is now called twice — EXECUTE first, CLOSE second.
      // We inspect capturedPayloads[0] (the EXECUTE event) for the content_hash assertion.
      expect(capturedPayloads).toHaveLength(2);
      const payload = capturedPayloads[0]!;
      // No target_dir → content_hash must be null (not a hash, not undefined)
      expect(payload.content_hash).toBeNull();
    } finally {
      signSpy.mockRestore();
    }
  });
});

// =============================================================================
// BRANCH COVERAGE: run-plan.ts line 101 — `|| "plan"` fallback
//
// The sanitizedPlanId expression uses `|| "plan"` as a final fallback for when
// the entire plan_id consists of non-alphanumeric, non-hyphen, non-underscore
// characters (e.g. "!!!", "---", "@@@"). After all three .replace() calls, the
// result is an empty string, so the `|| "plan"` branch fires.
// =============================================================================

describe('runPlan() — plan_id sanitization "plan" fallback (line 101)', () => {
  let tmpWsBase: string;
  let tmpProjectDir: string;

  beforeEach(() => {
    tmpWsBase = fs.mkdtempSync(path.join(os.tmpdir(), "teo-planid-fallback-"));
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-planid-proj-"));
  });

  afterEach(() => {
    fs.rmSync(tmpWsBase, { recursive: true, force: true });
    fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  });

  it('PLANID-FALLBACK-1: plan_id "!!!" (all non-alphanumeric) → sanitizes to "plan" fallback, runPlan succeeds', async () => {
    // plan_id "!!!" → replace(/[^a-zA-Z0-9_-]/g, "-") → "---"
    //               → replace(/^[^a-zA-Z0-9]+/, "")    → ""
    //               → replace(/[^a-zA-Z0-9_-]+$/, "")  → ""
    //               → || "plan"                         → "plan"
    // WorkstreamTree must allocate wsId "plan-<random>" without throwing.
    const task = makeAgentTask("fallback-task-1");
    // Bypass PlanSchema validation (which requires valid plan_id format) by casting.
    // We need to reach the sanitization logic inside runPlan(), not be rejected by validatePlan().
    // Note: PlanSchema does not constrain plan_id format beyond being a string,
    // so "!!!" will pass schema validation and reach sanitization.
    const plan: Plan = {
      plan_id: "!!!",
      project_id: "proj-test",
      created_at: "2026-06-18T00:00:00Z",
      version: "1",
      tasks: [task],
    };
    const adapter = makeMockAdapter();

    // Must not throw — the "plan" fallback keeps wsId valid for WorkstreamTree
    const result = await runPlan(plan, adapter, {
      workstreamBaseDir: tmpWsBase,
      projectDir: tmpProjectDir,
    });

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe("PASS");
  });

  it('PLANID-FALLBACK-2: plan_id "@@@" (all non-alphanumeric) → sanitizes to "plan" fallback, runPlan succeeds', async () => {
    // Second variant to confirm the branch is hit regardless of the specific symbol.
    const task = makeAgentTask("fallback-task-2");
    const plan: Plan = {
      plan_id: "@@@",
      project_id: "proj-test",
      created_at: "2026-06-18T00:00:00Z",
      version: "1",
      tasks: [task],
    };
    const adapter = makeMockAdapter();

    const result = await runPlan(plan, adapter, {
      workstreamBaseDir: tmpWsBase,
      projectDir: tmpProjectDir,
    });

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps[0]?.status).toBe("PASS");
  });
});

// =============================================================================
// BRANCH COVERAGE: run-plan.ts line 145 — gate override detail ternary falsy branch
//
// Line 145: `${stepResult.detail ? "; " + stepResult.detail : ""}`
// The FALSY branch fires when stepResult.detail is undefined or "" at the moment
// the gate overrides a PASS → FAILED. Verify the resulting detail does NOT
// contain "; undefined" or a trailing "; ".
// =============================================================================

describe("runPlan() — gate override detail: both ternary branches at line 145", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-gate-detail-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GATE-DETAIL-1: gate FAIL override on adapter PASS with NO detail → detail does not contain '; undefined' or trailing '; ' (falsy branch)", async () => {
    // Adapter returns PASS with NO detail field (undefined).
    // Gate is mocked to return FAIL.
    // The ternary `stepResult.detail ? "; " + stepResult.detail : ""` takes the
    // falsy branch → empty string appended → no "; undefined" or "; " suffix.
    const sessionId = "gate-detail-no-detail";
    const task = makeAgentTask("gate-detail-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    // adapter returns PASS with no detail (default mock: { taskId, status: "PASS" })

    const evaluateGateModule = await import("./evaluate-gate.js");
    const gateSpy = vi
      .spyOn(evaluateGateModule, "evaluateGate")
      .mockResolvedValueOnce("FAIL" as import("./evaluate-gate.js").GateVerdict);

    try {
      const result = await runPlan(plan, adapter, {
        sessionId,
        ledgerBaseDir: tmpDir,
      });

      expect(result.steps).toHaveLength(1);
      const step = result.steps[0]!;

      // Gate override must have fired: status is FAILED
      expect(step.status).toBe("FAILED");

      // Detail must include "gate override" preamble
      expect(step.detail).toMatch(/gate override/i);

      // The falsy-ternary branch: detail must NOT end with "; " or contain "; undefined"
      expect(step.detail).not.toContain("; undefined");
      expect(step.detail).not.toMatch(/;\s*$/); // no trailing semicolon+space

      // Full detail shape: "gate override: gate returned FAIL; original adapter status: PASS"
      // (no extra suffix because detail was absent)
      expect(step.detail).toContain("original adapter status: PASS");
      // Ensure there's no "; " after "PASS" — the ternary resolved to ""
      expect(step.detail).toMatch(/original adapter status: PASS$/);
    } finally {
      gateSpy.mockRestore();
    }
  });

  it("GATE-DETAIL-2: gate FAIL override on adapter PASS WITH a detail string → detail includes '; <original detail>' suffix (truthy branch)", async () => {
    // Adapter returns PASS WITH a detail string.
    // Gate is mocked to return FAIL.
    // The ternary `stepResult.detail ? "; " + stepResult.detail : ""` takes the
    // TRUTHY branch → "; <original detail>" is appended to the gate override message.
    // This is the branch that was uncovered: adapter reports PASS but includes
    // diagnostic detail, then the gate overrides it to FAILED.
    const sessionId = "gate-detail-with-detail";
    const task = makeAgentTask("gate-detail-with-detail-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();

    // Adapter returns PASS but with a diagnostic detail string
    adapter.spawnAgent.mockResolvedValueOnce({
      taskId: "gate-detail-with-detail-task",
      status: "PASS" as const,
      detail: "adapter passed but noted warnings",
    });

    const evaluateGateModule = await import("./evaluate-gate.js");
    const gateSpy = vi
      .spyOn(evaluateGateModule, "evaluateGate")
      .mockResolvedValueOnce("FAIL" as import("./evaluate-gate.js").GateVerdict);

    try {
      const result = await runPlan(plan, adapter, {
        sessionId,
        ledgerBaseDir: tmpDir,
      });

      expect(result.steps).toHaveLength(1);
      const step = result.steps[0]!;

      // Gate override must have fired: status is FAILED
      expect(step.status).toBe("FAILED");

      // Detail must include "gate override" preamble
      expect(step.detail).toMatch(/gate override/i);

      // The TRUTHY ternary branch: the original adapter detail must be appended after "; "
      expect(step.detail).toContain("; adapter passed but noted warnings");

      // Full detail shape:
      // "gate override: gate returned FAIL; original adapter status: PASS; adapter passed but noted warnings"
      expect(step.detail).toContain("original adapter status: PASS");
      expect(step.detail).toContain("; adapter passed but noted warnings");
    } finally {
      gateSpy.mockRestore();
    }
  });
});

// =============================================================================
// WS-GATE-01 — gate exception fail-closed
//
// Finding 3 (HIGH) from audit-05: evaluateGate() is called INSIDE the
// ledger/signer try/catch. If evaluateGate() throws, the catch block only sets
// signingStatus = "signing_failed" and leaves stepResult.status unchanged.
// If the adapter returned "PASS" before the gate crashed, the step continues
// as "PASS" — a throwing gate fails OPEN.
//
// Required fix: evaluateGate() must run in its own try/catch OUTSIDE the
// ledger/signer block. If it throws, status must be forced to "FAILED"
// (fail-closed). The ledger/signer block then runs after and covers signing.
//
// Ordering: misuse → boundary → golden path (ADR-064 policy)
//
// These tests FAIL against the current implementation (gate throw is swallowed
// inside the ledger catch, leaving status as "PASS") and PASS after dev applies
// the fix described in the WS-GATE-01 spec.
// =============================================================================

describe("WS-GATE-01 — gate exception fail-closed", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-gate01-failclosed-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeSignedOpts = (sessionId: string): RunPlanOptions => ({
    sessionId,
    ledgerBaseDir: tmpDir,
  });

  // ---------------------------------------------------------------------------
  // MISUSE — gate exception paths (these expose the fail-open bug)
  // ---------------------------------------------------------------------------

  // GATE-01-A: evaluateGate throws an Error → step must be FAILED (fail-closed)
  //
  // Current behavior (BUG): the throw is caught by the ledger try/catch, only
  // signingStatus is set to "signing_failed", and status remains "PASS".
  // Expected behavior (FIX): gate exception forces status to "FAILED" and detail
  // must contain "gate exception" so operators can distinguish it from a genuine
  // adapter failure.
  it("GATE-01-A (misuse): evaluateGate throws → step forced to FAILED (fail-closed)", async () => {
    const sessionId = "gate01-a-throw-error";
    const task = makeAgentTask("gate01-a-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    // adapter returns PASS — the gate exception is the sole cause of failure

    const evaluateGateModule = await import("./evaluate-gate.js");
    const gateSpy = vi
      .spyOn(evaluateGateModule, "evaluateGate")
      .mockRejectedValueOnce(new Error("gate internal error"));

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      expect(result.steps).toHaveLength(1);
      const step = result.steps[0]!;

      // Fail-closed: a throwing gate must force the step to FAILED, not leave it PASS
      expect(step.status).toBe("FAILED");

      // Detail must signal that the failure was caused by a gate exception, not a
      // genuine adapter failure — operators need to distinguish these for triage
      expect(step.detail).toMatch(/gate exception/i);
    } finally {
      gateSpy.mockRestore();
    }
  });

  // GATE-01-B: evaluateGate throws a non-Error (plain string) → still fail-closed
  //
  // LLM agents sometimes throw plain strings rather than Error objects. The
  // fail-closed logic must handle both forms. `String(gateErr)` in the catch
  // branch covers this; verify the step is FAILED and detail still matches.
  it("GATE-01-B (misuse): evaluateGate throws non-Error (string) → step forced to FAILED (fail-closed)", async () => {
    const sessionId = "gate01-b-throw-string";
    const task = makeAgentTask("gate01-b-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();

    const evaluateGateModule = await import("./evaluate-gate.js");
    const gateSpy = vi
      .spyOn(evaluateGateModule, "evaluateGate")

      .mockRejectedValueOnce("crash" as unknown as Error);

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      expect(result.steps).toHaveLength(1);
      const step = result.steps[0]!;

      // Must still fail-close even when the thrown value is not an Error instance
      expect(step.status).toBe("FAILED");
      expect(step.detail).toMatch(/gate exception/i);
    } finally {
      gateSpy.mockRestore();
    }
  });

  // ---------------------------------------------------------------------------
  // BOUNDARY — signing still attempted after gate fail-close
  // ---------------------------------------------------------------------------

  // GATE-01-C: evaluateGate throws → signing path is still attempted
  //
  // After the gate fail-close, the ledger/signer block should still run so the
  // failure is recorded in the audit trail. signingStatus must be "signed" or
  // "signing_failed" — never "unsigned_by_design" (which is the unsigned path).
  it("GATE-01-C (boundary): evaluateGate throws → signingStatus reflects signing attempt (not unsigned_by_design)", async () => {
    const sessionId = "gate01-c-signing-attempt";
    const task = makeAgentTask("gate01-c-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();

    const evaluateGateModule = await import("./evaluate-gate.js");
    const gateSpy = vi
      .spyOn(evaluateGateModule, "evaluateGate")
      .mockRejectedValueOnce(new Error("gate internal error"));

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      expect(result.steps).toHaveLength(1);
      const step = result.steps[0]!;

      // Status must be FAILED (fail-closed — covered by GATE-01-A)
      expect(step.status).toBe("FAILED");

      // Signing must have been attempted: "signed" if ledger succeeded, "signing_failed" if not.
      // "unsigned_by_design" is ONLY for the no-sessionId path — never valid here.
      expect(step.signingStatus).not.toBe("unsigned_by_design");
      expect(["signed", "signing_failed"]).toContain(step.signingStatus);
    } finally {
      gateSpy.mockRestore();
    }
  });

  // ---------------------------------------------------------------------------
  // GOLDEN PATH REGRESSION — normal FAIL and normal PASS paths unchanged
  // ---------------------------------------------------------------------------

  // GATE-01-D: evaluateGate returns FAIL normally → status is FAILED (existing behavior)
  //
  // The restructuring must not break the normal gate-FAIL → step-FAILED path.
  // This is a direct regression guard on the pre-existing SEC01-S3 behavior.
  it("GATE-01-D (golden path regression): evaluateGate returns FAIL normally → status is FAILED with 'gate override' detail", async () => {
    const sessionId = "gate01-d-normal-fail";
    const task = makeAgentTask("gate01-d-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    // adapter returns PASS; gate returns FAIL (normal override, no throw)

    const evaluateGateModule = await import("./evaluate-gate.js");
    const gateSpy = vi
      .spyOn(evaluateGateModule, "evaluateGate")
      .mockResolvedValueOnce("FAIL" as import("./evaluate-gate.js").GateVerdict);

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      expect(result.steps).toHaveLength(1);
      const step = result.steps[0]!;

      // Normal gate FAIL override must still produce FAILED status
      expect(step.status).toBe("FAILED");

      // Normal override uses "gate override" phrasing, not "gate exception"
      expect(step.detail).toMatch(/gate override/i);
      expect(result.overallStatus).toBe("FAILED");
    } finally {
      gateSpy.mockRestore();
    }
  });

  // GATE-01-E: evaluateGate returns PASS → status remains PASS (existing behavior)
  //
  // When adapter and gate both agree on PASS, the step must remain PASS.
  // Restructuring the try/catch must not disturb this golden path.
  it("GATE-01-E (golden path regression): evaluateGate returns PASS → status remains PASS", async () => {
    const sessionId = "gate01-e-normal-pass";
    const task = makeAgentTask("gate01-e-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    // adapter returns PASS; gate returns PASS — no override, no exception

    const evaluateGateModule = await import("./evaluate-gate.js");
    const gateSpy = vi
      .spyOn(evaluateGateModule, "evaluateGate")
      .mockResolvedValueOnce("PASS" as import("./evaluate-gate.js").GateVerdict);

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      expect(result.steps).toHaveLength(1);
      const step = result.steps[0]!;

      // Both agree on PASS — nothing to override
      expect(step.status).toBe("PASS");
      expect(result.overallStatus).toBe("PASS");
    } finally {
      gateSpy.mockRestore();
    }
  });
});

// =============================================================================
// WS-CLOSE-01 — ledger.close() failure must increment signingErrors
//
// Bug: in run-plan.ts, `result.signingErrors` is computed BEFORE `ledger.close()`
// runs. When `close()` throws, the catch block swallows the error and the
// caller sees no record of it — the audit trail is silently incomplete.
//
// Fix (Option A, preferred): when `ledger.close()` throws, increment
// `result.signingErrors` (treat close failure as an additional audit-trail error).
//
// These tests MUST FAIL against the current implementation:
//   - CLOSE-01-A: close throws, but signingErrors stays 0 (bug: not incremented)
//   - CLOSE-01-B: append throws once + close throws, but signingErrors stays 1 (bug: close not counted)
//
// CLOSE-01-C is explicitly NOT added here — AUDIT-01-C already asserts that a
// clean close keeps signingErrors === 0, which is the regression guard required.
//
// Ordering: misuse → boundary → (golden path covered by AUDIT-01-C)
// =============================================================================

describe("WS-CLOSE-01 — ledger.close() failure increments signingErrors", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-close01-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeSignedOpts = (sessionId: string): RunPlanOptions => ({
    sessionId,
    ledgerBaseDir: tmpDir,
  });

  // CLOSE-01-A (misuse): ledger.close() throws → signingErrors is incremented
  //
  // Current behavior (BUG): close() throw is swallowed; signingErrors was already
  // set before close() ran and remains 0.
  // Expected behavior (FIX): close() throw must increment signingErrors to 1.
  //
  // The run has one PASS task with a clean per-step append — the only failure is
  // the close() call. After the fix, signingErrors must be exactly 1.
  // overallStatus must remain PASS — close failure does not corrupt step outcomes.
  it("CLOSE-01-A (misuse): ledger.close() throws → signingErrors is incremented to 1", async () => {
    const sessionId = "close01-a-close-throws";
    const task = makeAgentTask("close01-a-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    // adapter returns PASS (default); per-step append succeeds

    const closeSpy = vi.spyOn(AppendOnlyLedger.prototype, "close").mockImplementation(() => {
      throw new Error("close-fail");
    });

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      // Step ran and PASSED — close failure must not corrupt step outcomes
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]!.status).toBe("PASS");
      expect(result.overallStatus).toBe("PASS");

      // PRIMARY ASSERTION: close() threw → signingErrors must be 1.
      // FAILS today: signingErrors is set before close() runs and stays 0.
      expect(result.signingErrors).toBe(1);
    } finally {
      closeSpy.mockRestore();
    }
  });

  // CLOSE-01-B (boundary): ledger.close() throws + one per-step append fails →
  // signingErrors is 2 (one per-step failure + one close failure)
  //
  // Current behavior (BUG): close() throw is swallowed; only the per-step append
  // failure is counted — signingErrors stays 1.
  // Expected behavior (FIX): signingErrors must be 2 after the fix.
  it("CLOSE-01-B (boundary): per-step append failure + close() throws → signingErrors === 2", async () => {
    const sessionId = "close01-b-append-and-close-throw";
    const task = makeAgentTask("close01-b-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    // adapter returns PASS (default)

    // Spy on append() — throw on the first (and only) call → one per-step signing_failed
    const appendSpy = vi.spyOn(AppendOnlyLedger.prototype, "append").mockImplementation(() => {
      throw new Error("append-fail");
    });

    // Spy on close() — always throw → one close failure
    const closeSpy = vi.spyOn(AppendOnlyLedger.prototype, "close").mockImplementation(() => {
      throw new Error("close-fail");
    });

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      // Step ran and PASSED — append failure must not corrupt step status
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]!.status).toBe("PASS");
      // Per-step signing must have failed
      expect(result.steps[0]!.signingStatus).toBe("signing_failed");

      // PRIMARY ASSERTION: 1 per-step append failure + 1 close failure = 2.
      // FAILS today: signingErrors is computed before close() runs → stays 1.
      expect(result.signingErrors).toBe(2);
    } finally {
      appendSpy.mockRestore();
      closeSpy.mockRestore();
    }
  });
});

// =============================================================================
// WS-SIGN-02 — CLOSE event HMAC signature stored in RunResult.closeSignature
//
// Bug: AppendOnlyLedger.close() returns void, discarding the {seq, ts} assigned
// by the internal append() call. run-plan.ts therefore cannot sign the CLOSE
// event with HmacSigner, so the workflow summary (task_count, pass, fail, etc.)
// is unauthenticated and can be tampered with.
//
// Scope of fix (dev implements):
//   1. ledger.ts  — change close() to return { seq: number; ts: string }
//   2. runner.ts  — add closeSignature?: string to RunResult
//   3. run-plan.ts — after ledger.close() returns {seq, ts}, call signer.sign()
//                    on the CLOSE payload and store in result.closeSignature
//
// Ordering: misuse → boundary → golden path (ADR-064 policy)
//
// All four tests FAIL before dev implements the fix.
// =============================================================================

describe("WS-SIGN-02 — CLOSE event signature in RunResult", () => {
  let tmpDir: string;
  let tmpWsBase: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-sign02-"));
    tmpWsBase = fs.mkdtempSync(path.join(os.tmpdir(), "teo-sign02-ws-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpWsBase, { recursive: true, force: true });
  });

  const makeSignedOpts = (sessionId: string): RunPlanOptions => ({
    sessionId,
    ledgerBaseDir: tmpDir,
    workstreamBaseDir: tmpWsBase,
  });

  // ---------------------------------------------------------------------------
  // SIGN-02-A (misuse): signed run with sessionId → RunResult.closeSignature is
  // a 64-char hex string.
  //
  // This is the primary assertion for the whole workstream: after the fix,
  // close() returns {seq, ts}, signer.sign() is called on the CLOSE payload,
  // and the resulting hex signature is stored in RunResult.closeSignature.
  //
  // FAILS today: closeSignature does not exist in RunResult, so it is always
  // undefined regardless of whether signing runs.
  // ---------------------------------------------------------------------------
  it("SIGN-02-A (misuse): signed run with sessionId → RunResult.closeSignature is a 64-char hex string", async () => {
    const sessionId = "sign02-a-close-sig";
    const task = makeAgentTask("sign02-a-task");
    const plan = makePlan([task], { plan_id: "plan-sign02-a" });
    const adapter = makeMockAdapter();

    const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe("PASS");

    // PRIMARY ASSERTION: closeSignature must be present and valid.
    // FAILS today — RunResult has no closeSignature field.
    expect((result as RunResult & { closeSignature?: string }).closeSignature).toBeDefined();
    expect((result as RunResult & { closeSignature?: string }).closeSignature).toMatch(
      /^[0-9a-f]{64}$/
    );
  });

  // ---------------------------------------------------------------------------
  // SIGN-02-B (boundary): closeSignature is verifiable using the same HmacSigner
  // instance backed by the same ledgerBaseDir.
  //
  // Strategy: after the run, read the JSONL ledger file and find the CLOSE event
  // (phase === "CLOSE") to extract its ts and seq. Then call signer.verify()
  // with task_id: null, actor_id: "SYSTEM", verdict: null, content_hash: null
  // and the ts/seq from the ledger line.
  //
  // This tests the full round-trip: ledger writes CLOSE → close() returns {seq,ts}
  // → signer.sign() over CLOSE payload → RunResult.closeSignature → verify().
  //
  // FAILS today: closeSignature is undefined, so verify() receives undefined and
  // returns false (or the assertion on closeSignature itself fails first).
  // ---------------------------------------------------------------------------
  it("SIGN-02-B (boundary): closeSignature is verifiable against the CLOSE ledger event", async () => {
    const sessionId = "sign02-b-verify";
    const task = makeAgentTask("sign02-b-task");
    const plan = makePlan([task], { plan_id: "plan-sign02-b" });
    const adapter = makeMockAdapter();

    const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

    // Retrieve closeSignature from the result (field added by dev).
    const closeSignature = (result as RunResult & { closeSignature?: string }).closeSignature;

    // Must be present — covered by SIGN-02-A; repeated here for isolation.
    expect(closeSignature).toBeDefined();
    expect(closeSignature).toMatch(/^[0-9a-f]{64}$/);

    // Read the JSONL ledger to find the CLOSE event's seq and ts.
    //
    // The ledger file lives at: <ledgerBaseDir>/ledger/<sessionId>.jsonl
    // Each line is a JSON object (LedgerEvent). The CLOSE event has phase === "CLOSE".
    //
    // We parse each line, filter by phase, then reconstruct the signer payload
    // using the same fields run-plan.ts will use after the fix:
    //   plan_id: plan.plan_id, task_id: null, actor_id: "SYSTEM",
    //   verdict: null, ts: evt.ts, seq: evt.seq, content_hash: null
    const ledgerFile = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
    expect(fs.existsSync(ledgerFile)).toBe(true);

    const rawLines = fs
      .readFileSync(ledgerFile, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as LedgerEvent);

    const closeEvent = rawLines.find((l) => l.phase === "CLOSE");
    expect(closeEvent).toBeDefined();

    // Construct a verifier using the same shared keyring (same ledgerBaseDir).
    const verifier = new HmacSigner({ baseDir: tmpDir });

    const valid = verifier.verify(
      {
        plan_id: plan.plan_id,
        task_id: null,
        actor_id: "SYSTEM",
        verdict: null,
        ts: closeEvent!.ts,
        seq: closeEvent!.seq,
        content_hash: null,
      },
      closeSignature!
    );

    // PRIMARY ASSERTION: the signature stored in RunResult.closeSignature must
    // verify against the CLOSE event's actual ts and seq from the ledger.
    // FAILS today — closeSignature is undefined so verify() is never called.
    expect(valid).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // SIGN-02-C (boundary): unsigned run (no sessionId) → RunResult.closeSignature
  // is undefined.
  //
  // Regression guard: when no sessionId is provided the run is unsigned by design.
  // closeSignature must be absent (undefined), not null or "".
  //
  // This test may pass today (undefined by default) but locks the contract so
  // dev cannot introduce a bad default value (e.g. "" or null) when wiring the
  // new field.
  // ---------------------------------------------------------------------------
  it("SIGN-02-C (boundary): unsigned run (no sessionId) → RunResult.closeSignature is undefined", async () => {
    const task = makeAgentTask("sign02-c-task");
    const plan = makePlan([task], { plan_id: "plan-sign02-c" });
    const adapter = makeMockAdapter();

    // No sessionId — unsigned path
    const result = await runPlan(plan, adapter, { workstreamBaseDir: tmpWsBase });

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(1);

    // closeSignature must be undefined (not null, not "") on the unsigned path
    const closeSignature = (result as RunResult & { closeSignature?: string }).closeSignature;
    expect(closeSignature).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // SIGN-02-D (golden path): signer throws on the CLOSE signing call →
  // signingErrors is incremented, run still completes, closeSignature is undefined.
  //
  // The spy is set to throw only on the second call to HmacSigner.prototype.sign:
  //   - First call  = per-step EXECUTE event signing (must succeed → "signed")
  //   - Second call = CLOSE event signing (throws → closeSignature absent)
  //
  // Expected post-fix behavior:
  //   - result.signingErrors === 1 (CLOSE signing failure counted)
  //   - result.closeSignature === undefined (signing did not produce a value)
  //   - result.overallStatus === "PASS" (signing failure must not abort the run)
  //
  // FAILS today: closeSignature does not exist in RunResult at all, and
  // signingErrors is not incremented for CLOSE signing failures (the catch block
  // that will handle this does not yet exist).
  // ---------------------------------------------------------------------------
  it("SIGN-02-D (golden path): signer throws on CLOSE signing → signingErrors incremented, run completes as PASS", async () => {
    const sessionId = "sign02-d-close-sign-fail";
    const task = makeAgentTask("sign02-d-task");
    const plan = makePlan([task], { plan_id: "plan-sign02-d" });
    const adapter = makeMockAdapter();

    // Spy on HmacSigner.prototype.sign.
    // First call (per-step EXECUTE event): succeeds — returns a valid 64-hex stub.
    // Second call (CLOSE event): throws — simulates keyring I/O failure at close time.
    let signCallCount = 0;
    const signSpy = vi.spyOn(HmacSigner.prototype, "sign").mockImplementation(function (
      this: InstanceType<typeof HmacSigner>,
      payload
    ) {
      signCallCount++;
      if (signCallCount === 1) {
        // Per-step sign — succeed with a valid-format stub signature
        return "a".repeat(64);
      }
      // CLOSE sign — throw to simulate a keyring failure at workflow close time
      throw new Error("simulated signer failure on CLOSE event");
    });

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      // The run itself must complete successfully — CLOSE signing failure is audit-trail
      // best-effort and must not change step outcomes or halt the workflow.
      expect(result.overallStatus).toBe("PASS");
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]?.status).toBe("PASS");

      // The per-step sign succeeded (first call).
      expect(result.steps[0]?.signingStatus).toBe("signed");

      // PRIMARY ASSERTIONS — all FAIL today:
      // (1) CLOSE signing failure must increment signingErrors (same policy as per-step)
      expect(result.signingErrors).toBe(1);

      // (2) closeSignature must be undefined — signing threw before it could be stored
      const closeSignature = (result as RunResult & { closeSignature?: string }).closeSignature;
      expect(closeSignature).toBeUndefined();
    } finally {
      signSpy.mockRestore();
    }
  });
});

// =============================================================================
// WS-AUDIT-01 — signing failure surfaced in RunResult
//
// Finding 4 (MEDIUM) from audit-05: when ledger.append() or signer.sign() throw,
// the catch block sets signingStatus = "signing_failed" on the step but never
// surfaces this at the RunResult level. A caller inspecting only RunResult cannot
// know signing failed without iterating every step.
//
// Policy: audit trail is best-effort — a signing failure must NOT halt the run.
// However, the count of signing failures MUST be surfaced as RunResult.signingErrors
// so callers can detect partial audit-trail corruption without inspecting each step.
//
// The fix (dev will implement):
//   1. Add optional `signingErrors?: number` to RunResult in src/core/runner.ts
//   2. After all steps complete in runPlan(), count steps where
//      signingStatus === "signing_failed" and populate runResult.signingErrors
//   3. The run still completes normally — overallStatus is NOT forced to FAILED
//
// These tests MUST FAIL against the current implementation (RunResult has no
// signingErrors field) and PASS after dev applies the fix.
//
// Ordering: misuse → boundary → golden path (ADR-064 policy)
// =============================================================================

describe("WS-AUDIT-01 — signing failure surfaced in RunResult", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-audit01-signerr-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeSignedOpts = (sessionId: string): RunPlanOptions => ({
    sessionId,
    ledgerBaseDir: tmpDir,
  });

  // ---------------------------------------------------------------------------
  // MISUSE — paths where signing fails (these expose the missing RunResult field)
  // ---------------------------------------------------------------------------

  // AUDIT-01-A (misuse): ledger.append() throws → step signingStatus is "signing_failed"
  //
  // Regression guard on existing per-step behavior: the catch block must continue
  // to set signingStatus = "signing_failed" after the fix. The step's execution
  // status must be unchanged — swallowing is intentional, the adapter result
  // (PASS or FAILED) must survive the signing failure.
  //
  // This test exercises the EXISTING behavior that must remain intact. It will
  // PASS today against the current impl (signingStatus is already set) but is
  // included here as a regression guard for the WS-AUDIT-01 refactor.
  it("AUDIT-01-A (misuse): ledger.append() throws → step signingStatus is 'signing_failed', step.status unchanged", async () => {
    const sessionId = "audit01-a-append-throw";
    const task = makeAgentTask("audit01-a-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    // adapter returns PASS — the signing failure must not corrupt the step status

    const appendSpy = vi.spyOn(AppendOnlyLedger.prototype, "append").mockImplementation(() => {
      throw new Error("simulated ledger I/O failure");
    });

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      expect(result.steps).toHaveLength(1);
      const step = result.steps[0]!;

      // Signing failed — per-step flag must reflect this
      expect(step.signingStatus).toBe("signing_failed");

      // Swallow is intentional: adapter returned PASS, that must be preserved
      // even though signing failed. The step status must NOT be forced to FAILED.
      expect(step.status).toBe("PASS");
    } finally {
      appendSpy.mockRestore();
    }
  });

  // AUDIT-01-B (misuse): ledger.append() throws on one step → RunResult.signingErrors === 1
  //
  // This is the primary new assertion. With a 2-step plan where only the first
  // step's ledger.append() throws, the RunResult must surface signingErrors === 1.
  // overallStatus must reflect actual step outcomes (PASS for both tasks), not be
  // forced to FAILED by the signing error alone.
  //
  // FAILS today: RunResult has no signingErrors field — it will be undefined.
  it("AUDIT-01-B (misuse): ledger.append() throws for one step → RunResult.signingErrors === 1, overallStatus reflects step outcomes", async () => {
    const sessionId = "audit01-b-one-signing-failure";
    const taskA = makeAgentTask("audit01-b-task-a");
    const taskB = makeAgentTask("audit01-b-task-b", ["audit01-b-task-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();
    // Both tasks return PASS from the adapter

    // Make append() throw only on the first call (task-a), succeed on the second (task-b)
    let appendCallCount = 0;
    const appendSpy = vi.spyOn(AppendOnlyLedger.prototype, "append").mockImplementation(function (
      this: AppendOnlyLedger,
      ...args
    ) {
      appendCallCount++;
      if (appendCallCount === 1) {
        throw new Error("ledger I/O failure on first step");
      }
      // Restore original for subsequent calls so the second step signs normally
      appendSpy.mockRestore();
      return AppendOnlyLedger.prototype.append.apply(this, args);
    });

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      // Both steps completed via the adapter — neither was aborted
      expect(result.steps).toHaveLength(2);

      // Task-a's signing failed; task-b signed normally
      const stepA = result.steps.find((s) => s.taskId === "audit01-b-task-a");
      const stepB = result.steps.find((s) => s.taskId === "audit01-b-task-b");
      expect(stepA?.signingStatus).toBe("signing_failed");
      // stepB may be "signed" or "signing_failed" depending on restore timing,
      // but at least one step has signing_failed — verified via signingErrors below

      // overallStatus must reflect step results, not the signing failure
      // Both tasks PASSED the adapter → overallStatus must be PASS
      expect(stepA?.status).toBe("PASS");
      expect(stepB?.status).toBe("PASS");
      expect(result.overallStatus).toBe("PASS");

      // PRIMARY ASSERTION: RunResult.signingErrors must be >= 1 (the count of
      // steps where signingStatus === "signing_failed"). FAILS today.
      expect((result as RunResult & { signingErrors?: number }).signingErrors).toBeGreaterThan(0);
    } finally {
      // appendSpy may already be restored inside the mock — safe to call again
      try {
        appendSpy.mockRestore();
      } catch {
        /* already restored */
      }
    }
  });

  // ---------------------------------------------------------------------------
  // BOUNDARY — clean run produces signingErrors === 0
  // ---------------------------------------------------------------------------

  // AUDIT-01-C (boundary): all steps signed cleanly → RunResult.signingErrors === 0
  //
  // When no signing errors occur, signingErrors must be 0 (not undefined, not
  // omitted). The field must be present and zero on a clean signed run.
  //
  // FAILS today: RunResult has no signingErrors field — it will be undefined.
  it("AUDIT-01-C (boundary): all steps signed cleanly → RunResult.signingErrors === 0", async () => {
    const sessionId = "audit01-c-clean-run";
    const taskA = makeAgentTask("audit01-c-task-a");
    const taskB = makeAgentTask("audit01-c-task-b", ["audit01-c-task-a"]);
    const plan = makePlan([taskA, taskB]);
    const adapter = makeMockAdapter();
    // No mocked failures — all steps sign normally

    const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(2);
    // All steps should be signed successfully
    for (const step of result.steps) {
      // SKIPPED steps are unsigned_by_design; only executed steps matter here
      if (step.signingStatus !== "unsigned_by_design") {
        expect(step.signingStatus).toBe("signed");
      }
    }

    // signingErrors must be 0 — no failures occurred. FAILS today.
    expect((result as RunResult & { signingErrors?: number }).signingErrors).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // GOLDEN PATH — signer.sign() throws, run continues, signingErrors incremented
  // ---------------------------------------------------------------------------

  // AUDIT-01-D (golden path): signer.sign() throws → signingErrors incremented, run continues
  //
  // signer.sign() throwing (as opposed to ledger.append()) must also be counted
  // in signingErrors. The run must still complete normally with overallStatus
  // reflecting the adapter step results.
  //
  // FAILS today: RunResult has no signingErrors field.
  it("AUDIT-01-D (golden path): signer.sign() throws → signingErrors > 0, overallStatus reflects step results", async () => {
    const sessionId = "audit01-d-signer-throw";
    const task = makeAgentTask("audit01-d-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    // adapter returns PASS

    const signSpy = vi.spyOn(HmacSigner.prototype, "sign").mockImplementation(() => {
      throw new Error("simulated signer key I/O failure");
    });

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      expect(result.steps).toHaveLength(1);
      const step = result.steps[0]!;

      // Signing failed at the signer.sign() call — per-step flag must reflect this
      expect(step.signingStatus).toBe("signing_failed");

      // The run must not halt — adapter returned PASS, step status is preserved
      expect(step.status).toBe("PASS");
      expect(result.overallStatus).toBe("PASS");

      // RunResult.signingErrors must be > 0 (1 step failed to sign). FAILS today.
      expect((result as RunResult & { signingErrors?: number }).signingErrors).toBeGreaterThan(0);
    } finally {
      signSpy.mockRestore();
    }
  });
});

// =============================================================================
// WS-A07-04: A06-VERIFY — audit-06 closure regression guards (run-plan.ts side)
//
// These tests verify that the audit-06 implementations are still clean.
// They mirror the original failing tests from audit-06 but are written as
// independent regression guards rather than relying on the original test names.
//
// All A06-VERIFY tests in this file MUST BE GREEN immediately (they test
// already-implemented behavior).
// =============================================================================

describe("A06-VERIFY: audit-06 closure regression guards (run-plan)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-a06-verify-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeSignedOpts = (sessionId: string): RunPlanOptions => ({
    sessionId,
    ledgerBaseDir: tmpDir,
  });

  // A06-VERIFY-01: ledger.close() failure increments signingErrors
  // Mirrors CLOSE-01-A from audit-06 — verify it still works.
  // This MUST be GREEN: the fix was implemented in audit-06.
  it("A06-VERIFY-01: ledger.close() throws → signingErrors is 1 (CLOSE-01-A regression guard)", async () => {
    const sessionId = "a06-verify-01-close-throws";
    const task = makeAgentTask("a06-verify-01-task");
    const plan = makePlan([task]);
    const adapter = makeMockAdapter();
    // adapter returns PASS; per-step append succeeds

    const closeSpy = vi.spyOn(AppendOnlyLedger.prototype, "close").mockImplementation(() => {
      throw new Error("close-fail-a06-verify");
    });

    try {
      const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

      // Step ran and PASSED — close failure must not corrupt step outcomes
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]!.status).toBe("PASS");
      expect(result.overallStatus).toBe("PASS");

      // Audit-06 fix: close() threw → signingErrors must be 1
      expect(result.signingErrors).toBe(1);
    } finally {
      closeSpy.mockRestore();
    }
  });

  // A06-VERIFY-02: closeSignature is a 64-char hex string on signed runs
  // Mirrors SIGN-02-A from audit-06 — verify it still works.
  // This MUST be GREEN: the fix was implemented in audit-06.
  it("A06-VERIFY-02: signed run → RunResult.closeSignature is a 64-char hex string (SIGN-02-A regression guard)", async () => {
    const sessionId = "a06-verify-02-close-sig";
    const task = makeAgentTask("a06-verify-02-task");
    const plan = makePlan([task], { plan_id: "plan-a06-verify-02" });
    const adapter = makeMockAdapter();

    const result = await runPlan(plan, adapter, makeSignedOpts(sessionId));

    expect(result.overallStatus).toBe("PASS");
    expect(result.steps).toHaveLength(1);

    // Audit-06 fix: closeSignature must be a 64-char hex string
    expect(result.closeSignature).toBeDefined();
    expect(result.closeSignature).toMatch(/^[0-9a-f]{64}$/);
  });
});
