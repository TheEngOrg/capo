// =============================================================================
// skill-wiring.test.ts — WS-SKILL-01 — gate-1 (FAILING — tests written before impl)
//
// Tests for RunPlanOptions wiring through invokeSkill().
//
// BUG DOCUMENTED HERE:
//   invokeSkill() calls runPlan(plan, opts.adapter) with NO third argument.
//   This means:
//     - sessionId is undefined → no signed audit trail, no ledger writes
//     - backend is undefined → defaults to "none" → no WorkstreamTree isolation
//       even when a task has target_dir set
//
// DECIDED FIX (WS-SKILL-01):
//   - Auto-generate a UUID sessionId per invokeSkill() call
//   - When any AGENT task in the plan has target_dir set → backend = "sandbox"
//   - When no task has target_dir → backend = "none"
//   - Both must be passed as RunPlanOptions (third argument) to runPlan()
//   - SkillOptions must also expose optional sessionId and backend overrides
//
// TEST ORDERING: misuse → boundary → golden path → structural (ADR-064 policy)
//
// WHICH TESTS FAIL NOW (current code has no third arg to runPlan):
//   - Test A: sessionId passed to runPlan → FAILS (no third arg)
//   - Test B: backend "sandbox" when plan has target_dir → FAILS (no third arg)
//   - Test C: backend "none" when no target_dir → FAILS (no third arg; undefined !== "none")
//   - Test D: AppendOnlyLedger instantiated with non-undefined sessionId → FAILS
//   - Test E: SkillOptions.sessionId override flows through to runPlan → FAILS (field doesn't exist)
//   - Test F: SkillOptions.backend override flows through to runPlan → FAILS (field doesn't exist)
//
// WHICH TESTS PASS NOW (regression guards):
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
 * This is the plan that should trigger backend = "sandbox".
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
// These tests FAIL NOW because skill.ts calls runPlan(plan, adapter) with no third arg.
// =============================================================================

describe("WS-SKILL-01 — boundary: RunPlanOptions wiring (ALL FAIL NOW — expose the bugs)", () => {
  // -------------------------------------------------------------------------
  // Test A — sessionId is passed to runPlan as a non-empty UUID-format string.
  //
  // FAILS NOW: runPlan is called with 2 args; opts.sessionId is undefined.
  // PASSES AFTER FIX: invokeSkill generates a UUID and passes it in RunPlanOptions.
  // -------------------------------------------------------------------------
  it("A. sessionId is passed to runPlan as a non-empty UUID-format string [FAILS NOW]", async () => {
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
  // Test B — backend is "sandbox" when any AGENT task has target_dir.
  //
  // FAILS NOW: no third arg → opts.backend is undefined, not "sandbox".
  // PASSES AFTER FIX: invokeSkill detects target_dir in plan tasks and sets backend = "sandbox".
  // -------------------------------------------------------------------------
  it("B. backend is 'sandbox' when an AGENT task has target_dir [FAILS NOW]", async () => {
    await invokeSkill(makeOpts(PLAN_WITH_TARGET_DIR));

    expect(mockRunPlan).toHaveBeenCalledOnce();
    const callArgs = mockRunPlan.mock.calls[0]!;
    // Third arg must exist
    expect(callArgs).toHaveLength(3);
    const runOpts = callArgs[2] as RunPlanOptions;
    expect(runOpts.backend).toBe("sandbox");
  });

  // -------------------------------------------------------------------------
  // Test C — backend is "none" when NO task has target_dir.
  //
  // FAILS NOW: no third arg → opts.backend is undefined; undefined !== "none".
  // PASSES AFTER FIX: invokeSkill sets backend = "none" when no target_dir detected.
  // -------------------------------------------------------------------------
  it("C. backend is 'none' when no task has target_dir [FAILS NOW]", async () => {
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
  // SCRIPT tasks never have target_dir — backend must be "none".
  // FAILS NOW: no third arg.
  // -------------------------------------------------------------------------
  it("C2. backend is 'none' for a SCRIPT-only plan (no target_dir possible) [FAILS NOW]", async () => {
    await invokeSkill(makeOpts(PLAN_SCRIPT_ONLY));

    expect(mockRunPlan).toHaveBeenCalledOnce();
    const callArgs = mockRunPlan.mock.calls[0]!;
    expect(callArgs).toHaveLength(3);
    const runOpts = callArgs[2] as RunPlanOptions;
    expect(runOpts.backend).toBe("none");
  });

  // -------------------------------------------------------------------------
  // Test B2 — MIXED plan: only one task needs target_dir → backend = "sandbox".
  //
  // A plan with two tasks where only one has target_dir must still choose "sandbox".
  // FAILS NOW: no third arg.
  // -------------------------------------------------------------------------
  it("B2. backend is 'sandbox' in a mixed plan where only one of two tasks has target_dir [FAILS NOW]", async () => {
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
    expect(runOpts.backend).toBe("sandbox");
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
  //
  // FAILS NOW: no third arg → sessionId is undefined.
  // PASSES AFTER FIX: UUID is generated, passes ledger validation constraints.
  // -------------------------------------------------------------------------
  it("D. sessionId passed to runPlan satisfies AppendOnlyLedger construction constraints [FAILS NOW]", async () => {
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
  // FAILS NOW: no third arg → sessionId is undefined both times (trivially "equal").
  // PASSES AFTER FIX: crypto.randomUUID() produces collision-resistant values.
  // -------------------------------------------------------------------------
  it("A2. two invokeSkill() calls each get a UNIQUE sessionId (collision resistance) [FAILS NOW]", async () => {
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
// FAILS NOW: SkillOptions does not have sessionId or backend fields.
// =============================================================================

describe("WS-SKILL-01 — structural: SkillOptions must accept sessionId and backend overrides", () => {
  // -------------------------------------------------------------------------
  // Test E — caller-provided sessionId in SkillOptions overrides the auto-UUID.
  //
  // Dev MUST add an optional sessionId field to SkillOptions. When provided,
  // it takes precedence over the auto-generated UUID.
  //
  // FAILS NOW: SkillOptions has no sessionId field (TypeScript type error → runtime
  // pass with no effect, but the sessionId sent to runPlan is still undefined).
  // PASSES AFTER FIX: SkillOptions.sessionId? exists and overrides auto-UUID.
  // -------------------------------------------------------------------------
  it("E. caller-provided SkillOptions.sessionId flows through to runPlan as opts.sessionId [FAILS NOW]", async () => {
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
  // Test F — caller-provided backend in SkillOptions overrides the auto-detection.
  //
  // Dev MUST add an optional backend field to SkillOptions. When provided,
  // it takes precedence over the target_dir scan heuristic.
  //
  // Example: caller may force "none" even if plan has a target_dir agent task
  // (for testing or in environments where sandbox is unavailable).
  //
  // FAILS NOW: SkillOptions has no backend field.
  // PASSES AFTER FIX: SkillOptions.backend? exists and overrides auto-detection.
  // -------------------------------------------------------------------------
  it("F. caller-provided SkillOptions.backend overrides auto-detection (forces 'none' even with target_dir) [FAILS NOW]", async () => {
    // PLAN_WITH_TARGET_DIR would normally produce backend = "sandbox"
    // but the caller explicitly overrides with "none"
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
// These tests PASS NOW and must continue to pass after dev implements WS-SKILL-01.
// =============================================================================

describe("WS-SKILL-01 — regression guards: existing invokeSkill() behavior preserved [PASS NOW]", () => {
  // -------------------------------------------------------------------------
  // Test R1 — invokeSkill() returns { status:"ok" } on a valid minimal plan.
  //
  // The new RunPlanOptions wiring must not break the happy-path return shape.
  // PASSES NOW: runPlan is mocked to return PASSING_RUN_RESULT.
  // MUST PASS AFTER FIX: same shape, new third arg to runPlan is the only change.
  // -------------------------------------------------------------------------
  it("R1. invokeSkill() returns { status:'ok', result:{ overallStatus:'PASS' } } on a valid plan [PASSES NOW]", async () => {
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
  // PASSES NOW: existing try/catch in skill.ts wraps sagePlan.
  // MUST PASS AFTER FIX: same behavior.
  // -------------------------------------------------------------------------
  it("R2. invokeSkill() returns { status:'planning_error' } when sagePlan throws [PASSES NOW]", async () => {
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
  // PASSES NOW: skill.ts calls runPlan(plan, opts.adapter).
  // MUST PASS AFTER FIX: still runPlan(plan, adapter, runPlanOpts).
  // -------------------------------------------------------------------------
  it("R3. runPlan first arg is the plan, second arg is the adapter (arg positions preserved) [PASSES NOW]", async () => {
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
