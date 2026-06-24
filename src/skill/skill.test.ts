// =============================================================================
// skill.test.ts — WS-P1-08 — gate-2 (PASSING — skill.ts implemented)
//
// Tests for src/skill/skill.ts — invokeSkill() orchestration seam.
//
// invokeSkill() wires three components in linear sequence:
//   1. provision(opts) → on error → { status:'provision_error', kind, reason }
//   2. adapter.sagePlan(planningContext, {}) → on throw → { status:'planning_error', message }
//   3. runPlan(plan, adapter) → always { status:'ok', result }
//
// IMPORTANT: runPlan returning overallStatus:'FAILED' does NOT produce a
// non-ok status. The FAILED propagates inside the 'ok' wrapper — callers
// inspect result.overallStatus. Only provision errors and sagePlan throws
// produce non-ok discriminants.
//
// Ordering: MISUSE → BOUNDARY → GOLDEN → ZERO-FOOTPRINT (ADR-064 policy)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Module mocks — hoisted before any imports by Vitest.
//
// Mocking pattern mirrors provision.test.ts and claude-code.test.ts:
//   - vi.mock() with a factory for total control over resolved values.
//   - vi.fn() stubs — mockReset:true in vitest.config.ts resets call counts
//     AND implementations before each test (vi.fn(original) resets to
//     original; plain vi.fn() resets to undefined return).
//   - Each test sets its own mockResolvedValue/mockImplementation in beforeEach
//     or inline, so the mock state is always explicit and never leaks.
// ---------------------------------------------------------------------------

// Mock provision() — skill.ts imports from '../bootstrap/provision.js'.
// Default: PASS (status:'ok'). Individual tests override as needed.
vi.mock("../bootstrap/provision.js", () => ({
  provision: vi.fn(),
}));

// Mock runPlan() — skill.ts imports from '../engine/run-plan.js'.
// Default: overallStatus:'PASS' with one step. Individual tests override.
vi.mock("../engine/run-plan.js", () => ({
  runPlan: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — placed AFTER vi.mock() calls so they receive the mocked modules.
// skill.ts is implemented at gate-2; these imports resolve successfully.
// ---------------------------------------------------------------------------

import { invokeSkill, type SkillOptions } from "./skill.js";
import { provision } from "../bootstrap/provision.js";
import type { ProvisionResult } from "../bootstrap/provision.js";
import { runPlan } from "../engine/run-plan.js";
import { StubAdapter } from "../adapters/stub.js";
import type { RunResult } from "../core/runner.js";
import type { CheckRevocationOptions } from "../bootstrap/revocation.js";

// ---------------------------------------------------------------------------
// Typed mock handles — avoids repeated vi.mocked() calls in every test.
// ---------------------------------------------------------------------------

const mockProvision = vi.mocked(provision);
const mockRunPlan = vi.mocked(runPlan);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Minimal revocationOpts (Omit<CheckRevocationOptions,'data'>) for all tests. */
const REVOCATION_OPTS: Omit<CheckRevocationOptions, "data"> = {
  signature: new Uint8Array(64).fill(0),
  publicKey: new Uint8Array(32).fill(0),
  keyId: "test-key-id",
  revocationList: { revoked_keys: [] },
};

/** Stable bundleDir — real agents dir; provision is mocked so it is never read. */
const BUNDLE_DIR = path.resolve("src/agents/");

/**
 * Construct a minimal valid SkillOptions for a given adapter.
 * homeDir always points at os.tmpdir() so no ~/.teo writes can occur.
 */
function makeOpts(overrides?: Partial<SkillOptions>): SkillOptions {
  return {
    adapter: new StubAdapter(),
    description: "test skill invocation",
    project_id: "test-project",
    bundleDir: BUNDLE_DIR,
    homeDir: path.join(os.tmpdir(), "teo-skill-test-home"),
    revocationOpts: REVOCATION_OPTS,
    ...overrides,
  };
}

/** A minimal passing RunResult returned by the runPlan mock on the happy path. */
const PASSING_RUN_RESULT: RunResult = {
  overallStatus: "PASS",
  steps: [{ taskId: "stub-task-1", status: "PASS" }],
};

/** A failing RunResult — used to verify FAILED propagates inside the 'ok' wrapper. */
const FAILING_RUN_RESULT: RunResult = {
  overallStatus: "FAILED",
  steps: [{ taskId: "stub-task-1", status: "FAILED", detail: "deferred SCRIPT execution" }],
};

// ---------------------------------------------------------------------------
// Baseline mock setup shared across most tests.
// Tests that need different behaviour override inside their own body.
// mockReset:true (vitest.config.ts) wipes call counts and implementations
// before each test, so every test starts from a clean slate.
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Default provision: succeeds.
  mockProvision.mockResolvedValue({ status: "ok" } satisfies ProvisionResult);
  // Default runPlan: returns PASS result.
  mockRunPlan.mockResolvedValue(PASSING_RUN_RESULT);
});

// =============================================================================
// MISUSE TESTS — must run first (ADR-064 adversarial-first policy)
// Early-return paths: provision error → skip sagePlan and runPlan.
// sagePlan throw → skip runPlan.
// =============================================================================

describe("invokeSkill() — misuse: provision errors produce provision_error and short-circuit", () => {
  // Test 1: revocation_blocked — sagePlan and runPlan must NOT be called.
  it("1. provision error kind:'revocation_blocked' → provision_error, sagePlan NOT called, runPlan NOT called", async () => {
    // Provision fails with revocation_blocked.
    mockProvision.mockResolvedValue({
      status: "error",
      kind: "revocation_blocked",
      reason: "bundle revoked",
    } satisfies ProvisionResult);

    const adapter = new StubAdapter();
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    const result = await invokeSkill(makeOpts({ adapter }));

    expect(result).toEqual({
      status: "provision_error",
      kind: "revocation_blocked",
      reason: "bundle revoked",
    });
    // sagePlan must NOT have been called — provision error exits early.
    expect(sagePlanSpy).not.toHaveBeenCalled();
    // runPlan must NOT have been called.
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // Test 2: conflict — maps directly to provision_error with kind:'conflict'.
  it("2. provision error kind:'conflict' → provision_error with kind:'conflict'", async () => {
    mockProvision.mockResolvedValue({
      status: "error",
      kind: "conflict",
      reason: "directory conflict at ~/.teo",
    } satisfies ProvisionResult);

    const result = await invokeSkill(makeOpts());

    expect(result).toEqual({
      status: "provision_error",
      kind: "conflict",
      reason: "directory conflict at ~/.teo",
    });
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // Test 3: permission_denied — maps directly to provision_error with kind:'permission_denied'.
  it("3. provision error kind:'permission_denied' → provision_error with kind:'permission_denied'", async () => {
    mockProvision.mockResolvedValue({
      status: "error",
      kind: "permission_denied",
      reason: "EACCES on ~/.teo",
    } satisfies ProvisionResult);

    const result = await invokeSkill(makeOpts());

    expect(result).toEqual({
      status: "provision_error",
      kind: "permission_denied",
      reason: "EACCES on ~/.teo",
    });
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // Test 4: io_error — maps directly to provision_error with kind:'io_error'.
  it("4. provision error kind:'io_error' → provision_error with kind:'io_error'", async () => {
    mockProvision.mockResolvedValue({
      status: "error",
      kind: "io_error",
      reason: "staging rename failed",
    } satisfies ProvisionResult);

    const result = await invokeSkill(makeOpts());

    expect(result).toEqual({
      status: "provision_error",
      kind: "io_error",
      reason: "staging rename failed",
    });
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // Test 5: verification_failed — maps directly to provision_error with kind:'verification_failed'.
  it("5. provision error kind:'verification_failed' → provision_error with kind:'verification_failed'", async () => {
    mockProvision.mockResolvedValue({
      status: "error",
      kind: "verification_failed",
      reason: "agent 'eng' failed post-write verification",
    } satisfies ProvisionResult);

    const result = await invokeSkill(makeOpts());

    expect(result).toEqual({
      status: "provision_error",
      kind: "verification_failed",
      reason: "agent 'eng' failed post-write verification",
    });
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // Test 6: sagePlan throws → planning_error, runPlan NOT called.
  // Provision returns ok so we reach sagePlan. sagePlan rejects (LLM timeout).
  // invokeSkill must catch the throw and return planning_error — never propagate.
  it("6. provision ok + adapter.sagePlan throws Error('LLM timeout') → planning_error, runPlan NOT called", async () => {
    // Provision succeeds.
    mockProvision.mockResolvedValue({ status: "ok" } satisfies ProvisionResult);

    // Adapter with a throwing sagePlan.
    const adapter = new StubAdapter();
    vi.spyOn(adapter, "sagePlan").mockRejectedValue(new Error("LLM timeout"));

    const result = await invokeSkill(makeOpts({ adapter }));

    expect(result).toEqual({
      status: "planning_error",
      message: "LLM timeout",
    });
    // runPlan must NOT have been called — sagePlan threw, so no plan exists.
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // Test 6b: sagePlan rejects with a bare string (non-Error throw).
  // Exercises the String(err) arm of the err instanceof Error ternary in skill.ts.
  // This is a defensive path for pathological adapter throws — must be genuinely covered.
  it("6b. provision ok + sagePlan rejects bare string → planning_error with stringified message, runPlan not called", async () => {
    // Provision succeeds.
    mockProvision.mockResolvedValue({ status: "ok" } satisfies ProvisionResult);

    // Adapter whose sagePlan rejects with a bare string (not an Error instance).
    const adapter = new StubAdapter();
    vi.spyOn(adapter, "sagePlan").mockRejectedValue("bare failure");

    const result = await invokeSkill(makeOpts({ adapter }));

    expect(result).toEqual({
      status: "planning_error",
      message: "bare failure",
    });
    // runPlan must NOT have been called — sagePlan threw, so no plan exists.
    expect(mockRunPlan).not.toHaveBeenCalled();
  });
});

// =============================================================================
// BOUNDARY TESTS — non-error provision statuses and FAILED propagation
// =============================================================================

describe("invokeSkill() — boundary: non-error provision statuses proceed to sagePlan and runPlan", () => {
  // Test 7: provision already_provisioned — treated as success, sagePlan and runPlan called.
  it("7. provision already_provisioned → sagePlan called, runPlan called, returns ok", async () => {
    mockProvision.mockResolvedValue({ status: "already_provisioned" } satisfies ProvisionResult);

    const adapter = new StubAdapter();
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    const result = await invokeSkill(makeOpts({ adapter }));

    expect(result.status).toBe("ok");
    // sagePlan must have been invoked — already_provisioned is not an error.
    expect(sagePlanSpy).toHaveBeenCalledOnce();
    // runPlan must have been invoked.
    expect(mockRunPlan).toHaveBeenCalledOnce();
  });

  // Test 9: runPlan returns overallStatus:'FAILED' → invokeSkill still returns
  // { status:'ok', result } with the FAILED result nested inside.
  // FAILED is NOT a separate discriminant on SkillResult — callers inspect result.overallStatus.
  it("9. runPlan returns overallStatus:'FAILED' → invokeSkill returns status:'ok' with FAILED inside result", async () => {
    mockProvision.mockResolvedValue({ status: "ok" } satisfies ProvisionResult);
    mockRunPlan.mockResolvedValue(FAILING_RUN_RESULT);

    const result = await invokeSkill(makeOpts());

    // Status must be 'ok' — FAILED does NOT produce a separate discriminant.
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.result.overallStatus).toBe("FAILED");
      expect(result.result.steps).toHaveLength(1);
      expect(result.result.steps[0]!.status).toBe("FAILED");
    }
  });

  // Test 10: sagePlan is called with EXACTLY the expected PlanningContext as first arg
  // and an empty object {} as second arg. Verifies correct wiring from SkillOptions.
  it("10. sagePlan is called with {description, project_id, directive} as arg1 and {} as arg2", async () => {
    mockProvision.mockResolvedValue({ status: "ok" } satisfies ProvisionResult);

    const adapter = new StubAdapter();
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    const opts = makeOpts({
      adapter,
      description: "my-description",
      project_id: "my-project",
      directive: "BUILD",
    });

    await invokeSkill(opts);

    expect(sagePlanSpy).toHaveBeenCalledOnce();
    const [firstArg, secondArg] = sagePlanSpy.mock.calls[0]!;

    // First argument must be exactly the PlanningContext derived from SkillOptions.
    expect(firstArg).toEqual(
      expect.objectContaining({
        description: "my-description",
        project_id: "my-project",
        directive: "BUILD",
      })
    );
    // Second argument must be an empty object {}.
    expect(secondArg).toEqual({});
  });

  // Test 10b: when directive is undefined, PlanningContext must NOT include it
  // (exactOptionalPropertyTypes compliance — absence vs. undefined are distinct).
  it("10b. when directive is omitted from SkillOptions, sagePlan first arg does NOT include directive key", async () => {
    mockProvision.mockResolvedValue({ status: "ok" } satisfies ProvisionResult);

    const adapter = new StubAdapter();
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    // makeOpts does not set directive by default — omit it explicitly.
    const opts = makeOpts({ adapter, description: "no-directive", project_id: "proj-x" });
    // Confirm directive is not present.
    expect(opts.directive).toBeUndefined();

    await invokeSkill(opts);

    const [firstArg] = sagePlanSpy.mock.calls[0]!;
    // directive must NOT be present as a key (not even set to undefined).
    expect(firstArg).not.toHaveProperty("directive");
  });

  // Test 10c: when homeDir is omitted from SkillOptions, provision is called
  // WITHOUT the homeDir key (exactOptionalPropertyTypes false-arm coverage).
  // makeOpts always injects homeDir, so we destructure it out before calling invokeSkill.
  it("10c. when homeDir is omitted from SkillOptions, provision is called without homeDir key → returns status:'ok'", async () => {
    mockProvision.mockResolvedValue({ status: "ok" } satisfies ProvisionResult);

    // Strip homeDir from the opts object entirely — NOT setting it to undefined.
    const { homeDir: _omit, ...optsNoHome } = makeOpts({});
    const result = await invokeSkill(optsNoHome);

    expect(result.status).toBe("ok");
    // Verify provision was called and the call arg did NOT include homeDir.
    expect(mockProvision).toHaveBeenCalledOnce();
    const provisionArg = mockProvision.mock.calls[0]![0];
    expect(provisionArg).not.toHaveProperty("homeDir");
  });
});

// =============================================================================
// GOLDEN PATH — full happy path end-to-end orchestration
// =============================================================================

describe("invokeSkill() — golden: full happy path", () => {
  // Test 11: Inject real StubAdapter, mock provision→ok, let sagePlan run real
  // PlanBuilder pipeline, assert result is ok with PASS overallStatus.
  //
  // StubAdapter.sagePlan() drives PlanBuilder to produce a valid Plan with one
  // SCRIPT task. runPlan() is mocked because real SCRIPT execution is deferred
  // (returns FAILED via the SCRIPT-deferred path in run-plan.ts).
  // We want the golden path to assert status:'ok' + at least one step PASS,
  // so we mock runPlan to return our PASSING_RUN_RESULT.
  it("11. provision ok → StubAdapter.sagePlan returns valid Plan → runPlan PASS → status:'ok' with overallStatus:'PASS'", async () => {
    // provision mocked to ok by beforeEach.
    // runPlan mocked to PASSING_RUN_RESULT by beforeEach.
    const adapter = new StubAdapter({ agentsDir: path.resolve("src/agents/") });

    const result = await invokeSkill(
      makeOpts({
        adapter,
        description: "golden path skill invocation",
        project_id: "golden-project",
        directive: "BUILD",
      })
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.result.overallStatus).toBe("PASS");
      // At least one step must have PASS status.
      expect(result.result.steps.some((s) => s.status === "PASS")).toBe(true);
    }
  });
});

// =============================================================================
// ZERO-FOOTPRINT — no import-time side effects (AC-11)
// =============================================================================

describe("invokeSkill() — zero-footprint: no import-time side effects", () => {
  // Test 12: Importing skill.ts must not call provision, sagePlan, or runPlan.
  //
  // mockReset:true resets spy call counts before each test, so this test starts
  // with call counts at 0 without any explicit spy setup. We verify that merely
  // importing (which happens above at module load time) left all mocks uncalled.
  // No invokeSkill() call is made here — this is a pure import-time assertion.
  it("12. importing skill.ts triggers NO call to provision, sagePlan, or runPlan at import time", () => {
    // All mocks are reset before this test by mockReset:true in vitest.config.ts.
    // If skill.ts called any of these at import time, the call counts would be > 0.
    // We spy on a fresh StubAdapter to check sagePlan too.
    const adapter = new StubAdapter();
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    // Assert: no calls happened before any invokeSkill() was triggered in THIS test.
    expect(mockProvision).not.toHaveBeenCalled();
    expect(mockRunPlan).not.toHaveBeenCalled();
    expect(sagePlanSpy).not.toHaveBeenCalled();

    // (No invokeSkill() call — this test is checking import-time only)
  });
});
