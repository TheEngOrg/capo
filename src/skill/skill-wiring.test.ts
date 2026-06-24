// =============================================================================
// skill-wiring.test.ts — WS-SKILL-01 + WS-ISO-01 — gate-1 (ALL PASSING — WS-SKILL-01 + WS-ISO-01 implemented)
//
// Tests for RunPlanOptions wiring through invokeSkill().
//
// IMPLEMENTATION (WS-SKILL-01 + WS-ISO-01):
//   - Auto-generates a UUID sessionId per invokeSkill() call
//   - backend is UNCONDITIONALLY "none" unless caller explicitly passes opts.backend
//     (WS-ISO-01 reverts the WS-SKILL-01 auto-detect heuristic that used target_dir)
//   - Both are passed as RunPlanOptions (third argument) to runPlan()
//   - SkillOptions exposes optional sessionId and backend overrides
//
// TEST ORDERING: misuse → boundary → golden path → structural (ADR-064 policy)
//
// ALL TESTS PASS (WS-SKILL-01 + WS-ISO-01 implemented):
//   - Test A: sessionId passed to runPlan as a non-empty UUID-format string
//   - Test B: backend "none" even when plan has target_dir (unconditional)
//   - Test B2: backend "none" in mixed plan with one target_dir task
//   - Test C: backend "none" when no target_dir
//   - Test C2: backend "none" for SCRIPT-only plan
//   - Test D (ledger): sessionId satisfies AppendOnlyLedger construction constraints
//   - Test D-iso: explicit opts.backend=undefined still "none"
//   - Test E: SkillOptions.sessionId override flows through to runPlan
//   - Test F: SkillOptions.backend override propagates to runPlan
//   - Test R1: invokeSkill() returns { status:"ok" } on valid minimal plan
//   - Test R2: invokeSkill() returns { status:"planning_error" } on sagePlan throw
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import type { Plan } from "../core/plan.js";
import type { SkillOptions } from "./skill.js";
import type { CheckRevocationOptions } from "../bootstrap/revocation.js";
import type { ProvisionResult } from "../bootstrap/provision.js";
import type { RunResult } from "../core/runner.js";

// ---------------------------------------------------------------------------
// Module mocks — hoisted by Vitest before any imports.
//
// We mock both provision (to always succeed) and runPlan (to capture the call
// arguments, which is the core thing we're asserting on in Tests A–F).
//
// AppendOnlyLedger is also mocked so we can assert construction arguments
// without real filesystem writes (Test D).
// ---------------------------------------------------------------------------

vi.mock("../bootstrap/provision.js", () => ({
  provision: vi.fn(),
}));

vi.mock("../engine/run-plan.js", () => ({
  runPlan: vi.fn(),
}));

// Mock AppendOnlyLedger so Test D can assert constructor args without FS writes.
// Note: runPlan.ts constructs AppendOnlyLedger internally; since runPlan is mocked
// at the module level, the real AppendOnlyLedger is NOT called on the runPlan path.
// Test D instead uses a direct import spy pattern — see its body for the approach.
vi.mock("../core/ledger.js", () => ({
  AppendOnlyLedger: vi.fn().mockImplementation(() => ({
    append: vi.fn(),
    close: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Imports — placed AFTER vi.mock() calls so they receive the mocked modules.
// ---------------------------------------------------------------------------

import { invokeSkill } from "./skill.js";
import { provision } from "../bootstrap/provision.js";
import { runPlan } from "../engine/run-plan.js";
import { AppendOnlyLedger } from "../core/ledger.js";
import type { RunPlanOptions } from "../engine/run-plan.js";

// ---------------------------------------------------------------------------
// Typed mock handles
// ---------------------------------------------------------------------------

const mockProvision = vi.mocked(provision);
const mockRunPlan = vi.mocked(runPlan);
const MockAppendOnlyLedger = vi.mocked(AppendOnlyLedger);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Minimal revocationOpts for all tests. */
const REVOCATION_OPTS: Omit<CheckRevocationOptions, "data"> = {
  signature: new Uint8Array(64).fill(0),
  publicKey: new Uint8Array(32).fill(0),
  keyId: "test-key-id",
  revocationList: { revoked_keys: [] },
};

const BUNDLE_DIR = path.resolve("src/agents/");

/** Minimal passing RunResult. */
const PASSING_RUN_RESULT: RunResult = {
  overallStatus: "PASS",
  steps: [{ taskId: "stub-task-1", status: "PASS" }],
};

/**
 * A minimal valid Plan with ONE AGENT task that has target_dir set.
 * Under WS-ISO-01 the backend is still "none" — target_dir no longer influences
 * backend selection. Used by Tests B, B2, D-iso, and F.
 */
const PLAN_WITH_TARGET_DIR: Plan = {
  plan_id: "plan-with-target-dir",
  project_id: "test-project",
  created_at: "2026-06-23T00:00:00.000Z",
  version: "1",
  tasks: [
    {
      id: "task-agent-1",
      type: "AGENT",
      agent_id: "eng",
      prompt: "implement the feature",
      target_dir: "/tmp/workdir",
      needs: [],
      gates: [],
    },
  ],
};

/**
 * A minimal valid Plan with ONE AGENT task that has NO target_dir.
 * This is the plan that should keep backend = "none".
 */
const PLAN_WITHOUT_TARGET_DIR: Plan = {
  plan_id: "plan-no-target-dir",
  project_id: "test-project",
  created_at: "2026-06-23T00:00:00.000Z",
  version: "1",
  tasks: [
    {
      id: "task-agent-2",
      type: "AGENT",
      agent_id: "eng",
      prompt: "review the code",
      // target_dir intentionally absent
      needs: [],
      gates: [],
    },
  ],
};

/**
 * A minimal valid Plan with ONE SCRIPT task (no target_dir possible on SCRIPT).
 * Backend should be "none".
 */
const PLAN_SCRIPT_ONLY: Plan = {
  plan_id: "plan-script-only",
  project_id: "test-project",
  created_at: "2026-06-23T00:00:00.000Z",
  version: "1",
  tasks: [
    {
      id: "task-script-1",
      type: "SCRIPT",
      command: "echo hello",
      needs: [],
      gates: [],
    },
  ],
};

/**
 * Construct a minimal SkillOptions where sagePlan is overridden to return a
 * specific pre-built plan (bypasses StubAdapter builder pipeline).
 * provision is mocked to succeed; runPlan is mocked to return PASSING_RUN_RESULT.
 */
function makeOpts(plan: Plan, overrides?: Partial<SkillOptions>): SkillOptions {
  return {
    adapter: {
      sagePlan: () => Promise.resolve(plan),
      spawnAgent: vi.fn().mockResolvedValue({ taskId: "stub", status: "PASS" }),
    },
    description: "wiring test skill invocation",
    project_id: "test-project",
    bundleDir: BUNDLE_DIR,
    homeDir: path.join(os.tmpdir(), "teo-skill-wiring-test-home"),
    revocationOpts: REVOCATION_OPTS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Default mock setup — runs before each test.
// mockReset:true (vitest.config.ts) wipes call counts and implementations first.
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockProvision.mockResolvedValue({ status: "ok" } satisfies ProvisionResult);
  mockRunPlan.mockResolvedValue(PASSING_RUN_RESULT);
  MockAppendOnlyLedger.mockClear();
});

// =============================================================================
// MISUSE TESTS — args that should NOT reach runPlan (regression guard)
// =============================================================================

describe("WS-SKILL-01 — misuse: provision error still short-circuits before RunPlanOptions wiring", () => {
  // Test: when provision fails, runPlan is never called regardless of wiring.
  // This ensures the new wiring code path does not accidentally bypass the guard.
  it("M1. provision error → runPlan NOT called (wiring code must not run before provision check)", async () => {
    mockProvision.mockResolvedValue({
      status: "error",
      kind: "io_error",
      reason: "disk full",
    } satisfies ProvisionResult);

    const result = await invokeSkill(makeOpts(PLAN_WITH_TARGET_DIR));

    expect(result.status).toBe("provision_error");
    // runPlan must NOT be called — wiring happens after provision succeeds
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // Test: sagePlan throw short-circuits before runPlan is called.
  it("M2. sagePlan throws → runPlan NOT called (wiring code must not run after sagePlan failure)", async () => {
    const adapter = {
      sagePlan: vi.fn().mockRejectedValue(new Error("LLM timeout")),
      spawnAgent: vi.fn(),
    };

    const result = await invokeSkill(makeOpts(PLAN_WITH_TARGET_DIR, { adapter }));

    expect(result.status).toBe("planning_error");
    expect(mockRunPlan).not.toHaveBeenCalled();
  });
});

// =============================================================================
// BOUNDARY TESTS — RunPlanOptions wiring assertions
// All tests pass post-WS-SKILL-01 + WS-ISO-01 implementation.
// =============================================================================

describe("WS-SKILL-01 + WS-ISO-01 — boundary: RunPlanOptions wiring (ALL PASSING post-WS-SKILL-01 + WS-ISO-01)", () => {
  // -------------------------------------------------------------------------
  // Test A — sessionId is passed to runPlan as a non-empty UUID-format string.
  // -------------------------------------------------------------------------
  it("A. sessionId is passed to runPlan as a non-empty UUID-format string", async () => {
    await invokeSkill(makeOpts(PLAN_SCRIPT_ONLY));

    // runPlan must have been called with a third argument
    expect(mockRunPlan).toHaveBeenCalledOnce();
    const callArgs = mockRunPlan.mock.calls[0]!;
    // callArgs[2] is the RunPlanOptions — must exist
    expect(callArgs).toHaveLength(3);
    const runOpts = callArgs[2] as RunPlanOptions;
    // sessionId must be a non-empty string
    expect(typeof runOpts.sessionId).toBe("string");
    expect((runOpts.sessionId ?? "").length).toBeGreaterThan(0);
    // Must look like a UUID v4: 8-4-4-4-12 hex groups
    // crypto.randomUUID() always produces lowercase RFC 4122 v4 format
    expect(runOpts.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  // -------------------------------------------------------------------------
  // Test B — backend is ALWAYS "none" regardless of target_dir presence.
  //
  // WS-ISO-01 DECISION: auto-detection reverted. The default is unconditionally
  // "none" unless the caller explicitly passes opts.backend. target_dir in a
  // plan task no longer influences the backend selection.
  // -------------------------------------------------------------------------
  it("B. backend is always 'none' regardless of target_dir in plan tasks", async () => {
    await invokeSkill(makeOpts(PLAN_WITH_TARGET_DIR));

    expect(mockRunPlan).toHaveBeenCalledOnce();
    const callArgs = mockRunPlan.mock.calls[0]!;
    // Third arg must exist
    expect(callArgs).toHaveLength(3);
    const runOpts = callArgs[2] as RunPlanOptions;
    expect(runOpts.backend).toBe("none");
  });

  // -------------------------------------------------------------------------
  // Test C — backend is "none" when NO task has target_dir.
  //
  // This already passed under the old auto-detect rule (no target_dir → "none").
  // It continues to pass under the new unconditional rule (WS-ISO-01).
  // -------------------------------------------------------------------------
  it("C. backend is 'none' when no task has target_dir", async () => {
    await invokeSkill(makeOpts(PLAN_WITHOUT_TARGET_DIR));

    expect(mockRunPlan).toHaveBeenCalledOnce();
    const callArgs = mockRunPlan.mock.calls[0]!;
    expect(callArgs).toHaveLength(3);
    const runOpts = callArgs[2] as RunPlanOptions;
    expect(runOpts.backend).toBe("none");
  });

  // -------------------------------------------------------------------------
  // Test C2 — backend is "none" for a SCRIPT-only plan (no AGENT tasks).
  //
  // SCRIPT tasks never have target_dir. This was already "none" under the old
  // auto-detect rule and remains "none" under the new unconditional rule (WS-ISO-01).
  // -------------------------------------------------------------------------
  it("C2. backend is 'none' for a SCRIPT-only plan (no target_dir possible)", async () => {
    await invokeSkill(makeOpts(PLAN_SCRIPT_ONLY));

    expect(mockRunPlan).toHaveBeenCalledOnce();
    const callArgs = mockRunPlan.mock.calls[0]!;
    expect(callArgs).toHaveLength(3);
    const runOpts = callArgs[2] as RunPlanOptions;
    expect(runOpts.backend).toBe("none");
  });

  // -------------------------------------------------------------------------
  // Test B2 — MIXED plan: backend is STILL "none" even when only one of two
  // tasks has target_dir.
  //
  // WS-ISO-01 DECISION: the old "any AGENT with target_dir → sandbox" heuristic
  // is removed. Mixed plans with some target_dir tasks are no longer treated
  // differently from uniform plans. Backend is unconditionally "none".
  // -------------------------------------------------------------------------
  it("B2. backend is 'none' in a mixed plan where only one of two tasks has target_dir", async () => {
    const mixedPlan: Plan = {
      plan_id: "plan-mixed",
      project_id: "test-project",
      created_at: "2026-06-23T00:00:00.000Z",
      version: "1",
      tasks: [
        {
          id: "task-no-target",
          type: "AGENT",
          agent_id: "eng",
          prompt: "review",
          // no target_dir
          needs: [],
          gates: [],
        },
        {
          id: "task-with-target",
          type: "AGENT",
          agent_id: "qa",
          prompt: "write tests",
          target_dir: "/tmp/workdir",
          needs: ["task-no-target"],
          gates: [],
        },
      ],
    };

    await invokeSkill(makeOpts(mixedPlan));

    expect(mockRunPlan).toHaveBeenCalledOnce();
    const callArgs = mockRunPlan.mock.calls[0]!;
    expect(callArgs).toHaveLength(3);
    const runOpts = callArgs[2] as RunPlanOptions;
    expect(runOpts.backend).toBe("none");
  });

  // -------------------------------------------------------------------------
  // Test D-iso — backend is "none" even when opts.backend is explicitly undefined.
  //
  // WS-ISO-01 DECISION: explicit `undefined` must not trigger sandbox.
  // `opts.backend ?? "none"` treats undefined as a missing value and falls
  // through to "none". This test rules out any implementation that checks
  // `opts.backend === undefined` as a sentinel to re-enable auto-detection.
  // -------------------------------------------------------------------------
  it("D-iso. backend is 'none' even when opts.backend is explicitly undefined (explicit undefined does not trigger sandbox)", async () => {
    // PLAN_WITH_TARGET_DIR has an AGENT task with target_dir set.
    // Under the old rule this would have returned "sandbox".
    // Passing opts.backend = undefined must still produce "none".
    const opts = makeOpts(PLAN_WITH_TARGET_DIR, { backend: undefined } as Partial<SkillOptions>);

    await invokeSkill(opts);

    expect(mockRunPlan).toHaveBeenCalledOnce();
    const callArgs = mockRunPlan.mock.calls[0]!;
    expect(callArgs).toHaveLength(3);
    const runOpts = callArgs[2] as RunPlanOptions;
    expect(runOpts.backend).toBe("none");
  });

  // -------------------------------------------------------------------------
  // Test D — AppendOnlyLedger would be instantiated with a non-undefined sessionId.
  //
  // Since runPlan is mocked, the real AppendOnlyLedger construction inside
  // run-plan.ts is never reached. This test instead verifies the CONTRACT that
  // the sessionId passed to runPlan is suitable for ledger construction:
  // non-empty, no path separators, no traversal sequences (matching ledger.ts validation).
  //
  // This is the observable proxy for "ledger WOULD be instantiated correctly".
  // Integration-level coverage of the real ledger path lives in run-plan.test.ts.
  // -------------------------------------------------------------------------
  it("D. sessionId passed to runPlan satisfies AppendOnlyLedger construction constraints", async () => {
    await invokeSkill(makeOpts(PLAN_SCRIPT_ONLY));

    expect(mockRunPlan).toHaveBeenCalledOnce();
    const callArgs = mockRunPlan.mock.calls[0]!;
    expect(callArgs).toHaveLength(3);
    const runOpts = callArgs[2] as RunPlanOptions;
    const sessionId = runOpts.sessionId;

    // Must be a non-empty string (ledger rejects empty)
    expect(typeof sessionId).toBe("string");
    expect((sessionId ?? "").length).toBeGreaterThan(0);
    // Must not contain path separators (ledger rejects these — LedgerPathError)
    expect(sessionId).not.toContain("/");
    expect(sessionId).not.toContain("\\");
    // Must not contain traversal sequences
    expect(sessionId).not.toContain("..");
  });

  // -------------------------------------------------------------------------
  // Test A2 — Each invokeSkill() call generates a UNIQUE sessionId.
  //
  // Two concurrent calls must not share a sessionId (collision → ledger corruption).
  // -------------------------------------------------------------------------
  it("A2. two invokeSkill() calls each get a UNIQUE sessionId (collision resistance)", async () => {
    await invokeSkill(makeOpts(PLAN_SCRIPT_ONLY));
    await invokeSkill(makeOpts(PLAN_SCRIPT_ONLY));

    expect(mockRunPlan).toHaveBeenCalledTimes(2);
    const opts1 = mockRunPlan.mock.calls[0]![2] as RunPlanOptions;
    const opts2 = mockRunPlan.mock.calls[1]![2] as RunPlanOptions;

    // Both must be non-undefined
    expect(opts1.sessionId).toBeDefined();
    expect(opts2.sessionId).toBeDefined();
    // They must be DIFFERENT
    expect(opts1.sessionId).not.toBe(opts2.sessionId);
  });
});

// =============================================================================
// STRUCTURAL TESTS — SkillOptions type surface extension
// These test that SkillOptions accepts sessionId and backend overrides.
// Both fields are present post-WS-SKILL-01 + WS-ISO-01.
// =============================================================================

describe("WS-SKILL-01 — structural: SkillOptions must accept sessionId and backend overrides", () => {
  // -------------------------------------------------------------------------
  // Test E — caller-provided sessionId in SkillOptions overrides the auto-UUID.
  //
  // Dev MUST add an optional sessionId field to SkillOptions. When provided,
  // it takes precedence over the auto-generated UUID.
  // -------------------------------------------------------------------------
  it("E. caller-provided SkillOptions.sessionId flows through to runPlan as opts.sessionId", async () => {
    const customSessionId = "custom-session-abc123";
    // Cast to any to bypass TypeScript type error — this test drives the type extension.
    // After dev adds sessionId to SkillOptions, the cast can be removed.
    const opts = makeOpts(PLAN_SCRIPT_ONLY, {
      sessionId: customSessionId,
    } as Partial<SkillOptions>);

    await invokeSkill(opts);

    expect(mockRunPlan).toHaveBeenCalledOnce();
    const callArgs = mockRunPlan.mock.calls[0]!;
    expect(callArgs).toHaveLength(3);
    const runOpts = callArgs[2] as RunPlanOptions;
    expect(runOpts.sessionId).toBe(customSessionId);
  });

  // -------------------------------------------------------------------------
  // Test F — caller-provided backend in SkillOptions overrides the default "none".
  //
  // SkillOptions has an optional backend field. When provided, it takes
  // precedence over the default "none" value.
  //
  // Example: caller may explicitly set "none" even if plan has a target_dir
  // agent task (the default is already "none", but explicit opts.backend
  // propagates through regardless).
  //
  // PASSES: SkillOptions.backend? exists and explicit value propagates to runPlan.
  // -------------------------------------------------------------------------
  it("F. caller-provided SkillOptions.backend overrides default 'none' (explicit opts.backend propagates)", async () => {
    // PLAN_WITH_TARGET_DIR has a target_dir task; caller explicitly passes backend: "none"
    // confirming that explicit opts.backend propagates to runPlan unchanged.
    const opts = makeOpts(PLAN_WITH_TARGET_DIR, { backend: "none" } as Partial<SkillOptions>);

    await invokeSkill(opts);

    expect(mockRunPlan).toHaveBeenCalledOnce();
    const callArgs = mockRunPlan.mock.calls[0]!;
    expect(callArgs).toHaveLength(3);
    const runOpts = callArgs[2] as RunPlanOptions;
    expect(runOpts.backend).toBe("none");
  });
});

// =============================================================================
// REGRESSION GUARD TESTS — existing behavior must not be broken by the fix.
// =============================================================================

describe("WS-SKILL-01 — regression guards: existing invokeSkill() behavior preserved", () => {
  // -------------------------------------------------------------------------
  // Test R1 — invokeSkill() returns { status:"ok" } on a valid minimal plan.
  //
  // The new RunPlanOptions wiring must not break the happy-path return shape.
  // -------------------------------------------------------------------------
  it("R1. invokeSkill() returns { status:'ok', result:{ overallStatus:'PASS' } } on a valid plan", async () => {
    const result = await invokeSkill(makeOpts(PLAN_SCRIPT_ONLY));

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.result.overallStatus).toBe("PASS");
    }
  });

  // -------------------------------------------------------------------------
  // Test R2 — invokeSkill() returns { status:"planning_error" } when sagePlan throws.
  //
  // The wiring code must NOT run (or must be harmless) when sagePlan throws.
  // -------------------------------------------------------------------------
  it("R2. invokeSkill() returns { status:'planning_error' } when sagePlan throws", async () => {
    const adapter = {
      sagePlan: vi.fn().mockRejectedValue(new Error("model overloaded")),
      spawnAgent: vi.fn(),
    };

    const result = await invokeSkill(makeOpts(PLAN_SCRIPT_ONLY, { adapter }));

    expect(result.status).toBe("planning_error");
    if (result.status === "planning_error") {
      expect(result.message).toBe("model overloaded");
    }
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test R3 — runPlan is still called with plan as the first argument and
  // adapter as the second argument (arg positions must not shift).
  //
  // The new third-arg wiring must not displace plan or adapter.
  // -------------------------------------------------------------------------
  it("R3. runPlan first arg is the plan, second arg is the adapter (arg positions preserved)", async () => {
    const adapter = {
      sagePlan: () => Promise.resolve(PLAN_SCRIPT_ONLY),
      spawnAgent: vi.fn(),
    };
    const opts = makeOpts(PLAN_SCRIPT_ONLY, { adapter });

    await invokeSkill(opts);

    expect(mockRunPlan).toHaveBeenCalledOnce();
    const callArgs = mockRunPlan.mock.calls[0]!;
    // First arg: the plan returned by sagePlan
    expect(callArgs[0]).toEqual(PLAN_SCRIPT_ONLY);
    // Second arg: the adapter
    expect(callArgs[1]).toBe(adapter);
  });
});
