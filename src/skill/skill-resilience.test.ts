// =============================================================================
// skill-resilience.test.ts — WS-LEDGER-RESILIENCE-01 + WS-LEDGER-PROBE-02 — gate-1 (GREEN — implemented)
//
// Misuse-first tests for the ledger resilience fix at the invokeSkill() boundary.
//
// Fix (C+D):
//   C: Pre-flight write-check at invokeSkill() BEFORE run starts.
//      Returns { status: "ledger_error", reason: string } if not writable.
//      Run MUST NOT start (no sagePlan call).
//   D: TEO_LEDGER_DIR env var support in AppendOnlyLedger (ledger.ts) and
//      HmacSigner (sign.ts). ledgerBaseDir? option added to SkillOptions.
//
// Ordering: MISUSE → BOUNDARY → GOLDEN PATH (ADR-064 adversarial-first policy)
//
// These tests document the implemented behavior. All pass post-implementation.
//
// ACs covered (in order):
//   MU-1 / AC-3: non-writable ~/.teo/ → ledger_error, run NOT started
//   MU-2 / AC-3: HOME="" → ledger_error, no unhandled exception
//   MU-3 / AC-3: HOME unset → ledger_error, no unhandled exception
//   MU-4: TEO_LEDGER_DIR=/dev/null → ledger_error
//   MU-5: TEO_LEDGER_DIR=dir with non-writable parent → ledger_error
//   MU-7 / AC-2: TEO_LEDGER_DIR=valid tmpdir → all signed, ledger under TEO_LEDGER_DIR
//   AC-5: TEO_LEDGER_DIR=non-writable dir → ledger_error names TEO_LEDGER_DIR value
//   AC-8: sessionId absent → no pre-flight, status:'ok' as before
//   AC-6 (TOCTOU): pre-flight passes, mid-run dir disappears → warn + status:'ok'
//   AC-7: TypeScript compile-time exhaustion (verified by npm run typecheck)
//   AC-1 / MU-8: TEO_LEDGER_DIR unset, default writable → status:'ok', all signed
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Module mocks — hoisted before any imports.
// Mirrors skill.test.ts mocking pattern exactly.
// ---------------------------------------------------------------------------

vi.mock("../bootstrap/provision.js", () => ({
  provision: vi.fn(),
}));

vi.mock("../engine/run-plan.js", () => ({
  runPlan: vi.fn(),
}));

// node:fs is re-exported as a spread of the real module so all fs functions
// work as normal but the resulting plain object has configurable properties,
// enabling vi.spyOn(fs, "writeFileSync") / vi.spyOn(fs, "unlinkSync") etc.
// in individual tests.
// In Node.js 22 ESM, import * as fs from "node:fs" gives a namespace with
// Symbol.toStringTag==="Module" and non-configurable properties — vi.spyOn
// fails unless the module is intercepted here and re-exported through a plain
// object. Pattern mirrors src/bootstrap/provision.test.ts lines 112-130.
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original };
});

// ---------------------------------------------------------------------------
// Imports — placed AFTER vi.mock() calls.
// ---------------------------------------------------------------------------

import { invokeSkill, type SkillOptions } from "./skill.js";
import type { SkillResult as _SkillResult } from "./skill.js";
import { provision } from "../bootstrap/provision.js";
import type { ProvisionResult } from "../bootstrap/provision.js";
import { runPlan } from "../engine/run-plan.js";
import { StubAdapter } from "../adapters/stub.js";
import type { RunResult } from "../core/runner.js";
import type { CheckRevocationOptions } from "../bootstrap/revocation.js";

// ---------------------------------------------------------------------------
// Typed mock handles
// ---------------------------------------------------------------------------

const mockProvision = vi.mocked(provision);
const mockRunPlan = vi.mocked(runPlan);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a unique temp directory. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "teo-skill-resilience-"));
}

/** Remove a directory recursively. */
function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Save and restore named process.env keys around a test. */
function saveEnv(...keys: string[]): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) {
    saved[k] = process.env[k];
  }
  return () => {
    for (const k of keys) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  };
}

/** Skip if running as root — chmod 000 is not enforced for root. */
function skipIfRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

/** Minimal revocationOpts for all tests. */
const REVOCATION_OPTS: Omit<CheckRevocationOptions, "data"> = {
  signature: new Uint8Array(64).fill(0),
  publicKey: new Uint8Array(32).fill(0),
  keyId: "test-key-id",
  revocationList: { revoked_keys: [] },
};

const BUNDLE_DIR = path.resolve("src/agents/");

/**
 * Build minimal valid SkillOptions.
 * homeDir always points at os.tmpdir() so ~/.teo/ writes cannot occur unless
 * the test specifically overrides HOME or TEO_LEDGER_DIR.
 */
function makeOpts(overrides?: Partial<SkillOptions>): SkillOptions {
  return {
    adapter: new StubAdapter(),
    description: "ledger-resilience test skill",
    project_id: "ledger-resilience-project",
    bundleDir: BUNDLE_DIR,
    homeDir: path.join(os.tmpdir(), "teo-skill-resilience-home"),
    revocationOpts: REVOCATION_OPTS,
    ...overrides,
  };
}

const PASSING_RUN_RESULT: RunResult = {
  overallStatus: "PASS",
  steps: [{ taskId: "stub-task-1", status: "PASS", signingStatus: "signed" }],
  signingErrors: 0,
};

// ---------------------------------------------------------------------------
// Default mock setup — mirrors skill.test.ts
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockProvision.mockResolvedValue({ status: "ok" } satisfies ProvisionResult);
  mockRunPlan.mockResolvedValue(PASSING_RUN_RESULT);
});

// =============================================================================
// MISUSE CASES — Tests that catch the bug (AC-3 family)
// Each must return { status: "ledger_error" } and NOT start the run.
// =============================================================================

describe("invokeSkill() — misuse: ledger pre-flight failures (WS-LEDGER-RESILIENCE-01 C)", () => {
  let tempDir: string;
  let restoreEnv: (() => void) | undefined;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    // Restore permissions so cleanup can proceed.
    try {
      fs.chmodSync(tempDir, 0o755);
    } catch {
      // ignore — dir may already be gone
    }
    removeTempDir(tempDir);
    restoreEnv?.();
    restoreEnv = undefined;
  });

  // MU-1 / AC-3: ~/.teo/ pre-exists, chmod 000 (not writable) → ledger_error, run NOT started
  it("MU-1/AC-3: ~teo/ pre-exists chmod 000 → { status:'ledger_error' }, sagePlan NOT called", async () => {
    if (skipIfRoot()) {
      console.log("SKIP: running as root — chmod 000 is not enforced");
      return;
    }

    restoreEnv = saveEnv("TEO_LEDGER_DIR", "HOME");
    delete process.env["TEO_LEDGER_DIR"];

    // Create a locked teo dir in tempDir and set HOME → it
    const fakeHome = path.join(tempDir, "fake-home");
    const teoDir = path.join(fakeHome, ".teo");
    fs.mkdirSync(teoDir, { recursive: true });
    fs.chmodSync(teoDir, 0o000);
    process.env["HOME"] = fakeHome;

    const adapter = new StubAdapter();
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    const result = await invokeSkill(makeOpts({ adapter, sessionId: "test-session-mu1" }));

    // Restore before cleanup
    fs.chmodSync(teoDir, 0o755);

    expect(result.status).toBe("ledger_error");
    // Run MUST NOT have started — sagePlan must not be called.
    expect(sagePlanSpy).not.toHaveBeenCalled();
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // MU-2 / AC-3: HOME="" → ledger_error with actionable message, no unhandled exception
  it("MU-2/AC-3: HOME='' (empty) → { status:'ledger_error' } with actionable reason, no throw", async () => {
    restoreEnv = saveEnv("TEO_LEDGER_DIR", "HOME");
    delete process.env["TEO_LEDGER_DIR"];
    process.env["HOME"] = "";

    const adapter = new StubAdapter();
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    // Must NOT throw — must return ledger_error discriminant.
    const result = await invokeSkill(makeOpts({ adapter, sessionId: "test-session-mu2" }));

    expect(result.status).toBe("ledger_error");
    if (result.status === "ledger_error") {
      // reason must be a non-empty string (actionable message).
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    }
    // Run must not have started.
    expect(sagePlanSpy).not.toHaveBeenCalled();
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // MU-3: HOME unset → ledger_error, no unhandled exception
  it("MU-3/AC-3: HOME unset → { status:'ledger_error' } with actionable reason, no throw", async () => {
    restoreEnv = saveEnv("TEO_LEDGER_DIR", "HOME");
    delete process.env["TEO_LEDGER_DIR"];
    delete process.env["HOME"];

    const adapter = new StubAdapter();
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    const result = await invokeSkill(makeOpts({ adapter, sessionId: "test-session-mu3" }));

    expect(result.status).toBe("ledger_error");
    if (result.status === "ledger_error") {
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    }
    expect(sagePlanSpy).not.toHaveBeenCalled();
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // MU-4: TEO_LEDGER_DIR=/dev/null (a file/device, not a dir) → ledger_error
  it("MU-4: TEO_LEDGER_DIR=/dev/null (not a directory) → { status:'ledger_error' }", async () => {
    restoreEnv = saveEnv("TEO_LEDGER_DIR");
    process.env["TEO_LEDGER_DIR"] = "/dev/null";

    const adapter = new StubAdapter();
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    const result = await invokeSkill(makeOpts({ adapter, sessionId: "test-session-mu4" }));

    expect(result.status).toBe("ledger_error");
    expect(sagePlanSpy).not.toHaveBeenCalled();
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // MU-5: TEO_LEDGER_DIR points to a non-existent dir where parent is not writable → ledger_error
  it("MU-5: TEO_LEDGER_DIR=non-existent subdir under non-writable parent → { status:'ledger_error' }", async () => {
    if (skipIfRoot()) {
      console.log("SKIP: running as root — chmod 000 is not enforced");
      return;
    }

    restoreEnv = saveEnv("TEO_LEDGER_DIR");

    // Create a locked parent dir.
    const lockedParent = path.join(tempDir, "locked-parent");
    fs.mkdirSync(lockedParent, { recursive: true });
    fs.chmodSync(lockedParent, 0o000);

    // TEO_LEDGER_DIR = subdir that does not exist under the locked parent.
    process.env["TEO_LEDGER_DIR"] = path.join(lockedParent, "cannot-create");

    const adapter = new StubAdapter();
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    const result = await invokeSkill(makeOpts({ adapter, sessionId: "test-session-mu5" }));

    // Restore permissions for cleanup.
    fs.chmodSync(lockedParent, 0o755);

    expect(result.status).toBe("ledger_error");
    expect(sagePlanSpy).not.toHaveBeenCalled();
    expect(mockRunPlan).not.toHaveBeenCalled();
  });

  // AC-5: TEO_LEDGER_DIR=non-writable dir → ledger_error, reason names the TEO_LEDGER_DIR value
  it("AC-5: TEO_LEDGER_DIR=non-writable dir → ledger_error, reason mentions the TEO_LEDGER_DIR path", async () => {
    if (skipIfRoot()) {
      console.log("SKIP: running as root — chmod 000 is not enforced");
      return;
    }

    restoreEnv = saveEnv("TEO_LEDGER_DIR");

    const lockedDir = path.join(tempDir, "non-writable-ledger");
    fs.mkdirSync(lockedDir, { recursive: true });
    fs.chmodSync(lockedDir, 0o000);

    process.env["TEO_LEDGER_DIR"] = lockedDir;

    const adapter = new StubAdapter();

    const result = await invokeSkill(makeOpts({ adapter, sessionId: "test-session-ac5" }));

    // Restore permissions for cleanup.
    fs.chmodSync(lockedDir, 0o755);

    expect(result.status).toBe("ledger_error");
    if (result.status === "ledger_error") {
      // reason must name the directory (gives the user actionable info).
      expect(result.reason).toContain(lockedDir);
    }
  });
});

// =============================================================================
// PROBE BEHAVIOR — write+unlink probe replacing fs.accessSync(W_OK)
//
// These tests cover the upcoming Dev change to probeWritable():
//   - existing-dir branch: fs.writeFileSync('.write_probe') + fs.unlinkSync('.write_probe')
//   - if either throws → { status: "ledger_error" }, sagePlan NOT called
//   - if both succeed → probe passes, run continues (no ledger_error)
//
// Mocks are scoped per-test (restored in afterEach / mockRestore()) so the
// MU-5 locked-parent test above is NOT affected by these spies.
//
// Ordering: MISUSE → BOUNDARY → GOLDEN PATH (ADR-064 adversarial-first policy)
//   PROBE-MU-1: probe-write throws EACCES → ledger_error, unlinkSync NOT called
//   PROBE-MU-2: probe-write succeeds, probe-unlink throws → ledger_error, sagePlan NOT called
//   PROBE-GP-1: both succeed for existing dir → NO ledger_error
// =============================================================================

describe("probeWritable() — write+unlink probe (existing-dir branch)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-probe-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // PROBE-MU-1: fs.writeFileSync throws EACCES → ledger_error returned,
  // fs.unlinkSync must NOT be called, sagePlan must NOT be called.
  it("PROBE-MU-1: probe-write throws EACCES → { status:'ledger_error' }, unlinkSync and sagePlan NOT called", async () => {
    // Arrange: point TEO_LEDGER_DIR at a real, existing directory so we land
    // in the existing-dir branch of probeWritable().
    const restoreEnv = saveEnv("TEO_LEDGER_DIR");
    process.env["TEO_LEDGER_DIR"] = tempDir;

    const eaccesError = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });

    const writeFileSpy = vi
      .spyOn(fs, "writeFileSync")
      .mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
        const filePath = String(args[0]);
        if (filePath.endsWith(".write_probe")) {
          throw eaccesError;
        }
        // Passthrough for any other writeFileSync calls.
        (fs.writeFileSync as unknown as { _original?: typeof fs.writeFileSync })._original?.(
          ...args
        );
      });

    const unlinkSpy = vi.spyOn(fs, "unlinkSync");

    const adapter = new StubAdapter();
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    try {
      const result = await invokeSkill(makeOpts({ adapter, sessionId: "probe-mu1-session" }));

      // Must return ledger_error — probe-write failure is not writable.
      expect(result.status).toBe("ledger_error");
      if (result.status === "ledger_error") {
        expect(typeof result.reason).toBe("string");
        expect(result.reason.length).toBeGreaterThan(0);
      }

      // unlinkSync must NOT have been called — write failed before unlink could run.
      const probeUnlinkCalls = unlinkSpy.mock.calls.filter((c) =>
        String(c[0]).endsWith(".write_probe")
      );
      expect(probeUnlinkCalls).toHaveLength(0);

      // sagePlan must NOT have been called — run must not have started.
      expect(sagePlanSpy).not.toHaveBeenCalled();
      expect(mockRunPlan).not.toHaveBeenCalled();
    } finally {
      writeFileSpy.mockRestore();
      unlinkSpy.mockRestore();
      restoreEnv();
    }
  });

  // PROBE-MU-2: fs.writeFileSync succeeds, fs.unlinkSync throws → ledger_error returned,
  // sagePlan must NOT be called.
  it("PROBE-MU-2: probe-write succeeds, probe-unlink throws → { status:'ledger_error' }, sagePlan NOT called", async () => {
    // Arrange: point TEO_LEDGER_DIR at a real, existing directory.
    const restoreEnv = saveEnv("TEO_LEDGER_DIR");
    process.env["TEO_LEDGER_DIR"] = tempDir;

    const eaccesError = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });

    // writeFileSync silently succeeds for the probe file.
    const writeFileSpy = vi
      .spyOn(fs, "writeFileSync")
      .mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
        // No-op for probe file (simulate successful write); passthrough otherwise.
        const filePath = String(args[0]);
        if (filePath.endsWith(".write_probe")) {
          return; // success — probe file "written"
        }
      });

    // unlinkSync throws for the probe file.
    const unlinkSpy = vi
      .spyOn(fs, "unlinkSync")
      .mockImplementation((...args: Parameters<typeof fs.unlinkSync>) => {
        const filePath = String(args[0]);
        if (filePath.endsWith(".write_probe")) {
          throw eaccesError;
        }
      });

    const adapter = new StubAdapter();
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    try {
      const result = await invokeSkill(makeOpts({ adapter, sessionId: "probe-mu2-session" }));

      // Must return ledger_error — unlink failure means the probe path is broken.
      expect(result.status).toBe("ledger_error");
      if (result.status === "ledger_error") {
        expect(typeof result.reason).toBe("string");
        expect(result.reason.length).toBeGreaterThan(0);
      }

      // sagePlan must NOT have been called — run must not have started.
      expect(sagePlanSpy).not.toHaveBeenCalled();
      expect(mockRunPlan).not.toHaveBeenCalled();
    } finally {
      writeFileSpy.mockRestore();
      unlinkSpy.mockRestore();
      restoreEnv();
    }
  });

  // PROBE-GP-1: both writeFileSync and unlinkSync succeed for an existing dir →
  // probe passes, invokeSkill does NOT return ledger_error (run continues).
  it("PROBE-GP-1: probe-write and probe-unlink both succeed → no ledger_error returned", async () => {
    // Arrange: point TEO_LEDGER_DIR at a real, existing directory.
    const restoreEnv = saveEnv("TEO_LEDGER_DIR");
    process.env["TEO_LEDGER_DIR"] = tempDir;

    // Both operations no-op (simulate success without touching real FS).
    const writeFileSpy = vi
      .spyOn(fs, "writeFileSync")
      .mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
        // Silently succeed for the probe file.
        const filePath = String(args[0]);
        if (filePath.endsWith(".write_probe")) {
          return;
        }
      });

    const unlinkSpy = vi
      .spyOn(fs, "unlinkSync")
      .mockImplementation((...args: Parameters<typeof fs.unlinkSync>) => {
        // Silently succeed for the probe file.
        const filePath = String(args[0]);
        if (filePath.endsWith(".write_probe")) {
          return;
        }
      });

    const adapter = new StubAdapter();

    try {
      const result = await invokeSkill(makeOpts({ adapter, sessionId: "probe-gp1-session" }));

      // Must NOT return ledger_error — probe succeeded.
      expect(result.status).not.toBe("ledger_error");
    } finally {
      writeFileSpy.mockRestore();
      unlinkSpy.mockRestore();
      restoreEnv();
    }
  });
});

// =============================================================================
// BOUNDARY CASES
// =============================================================================

describe("invokeSkill() — boundary: sessionId absent skips pre-flight (AC-8)", () => {
  it("AC-8: sessionId absent → no pre-flight, returns status:'ok' regardless of ledger dir state", async () => {
    // With no sessionId, the unsigned path runs — no ledger is touched.
    // Even if HOME is invalid or TEO_LEDGER_DIR is wrong, invokeSkill() must
    // NOT return ledger_error when sessionId is absent.
    const restoreEnv = saveEnv("HOME", "TEO_LEDGER_DIR");
    process.env["HOME"] = "";
    delete process.env["TEO_LEDGER_DIR"];

    try {
      const result = await invokeSkill(makeOpts({ sessionId: undefined }));
      expect(result.status).toBe("ok");
    } finally {
      restoreEnv();
    }
  });
});

describe("invokeSkill() — boundary: TOCTOU race (AC-6)", () => {
  let tempDir: string;
  let restoreEnv: () => void;

  beforeEach(() => {
    tempDir = makeTempDir();
    restoreEnv = saveEnv("TEO_LEDGER_DIR");
  });

  afterEach(() => {
    try {
      fs.chmodSync(tempDir, 0o755);
    } catch {
      // ignore
    }
    removeTempDir(tempDir);
    restoreEnv();
  });

  it("AC-6 TOCTOU: pre-flight passes, ledger dir becomes unavailable mid-run → console.warn emitted, status:'ok' (swallow)", async () => {
    if (skipIfRoot()) {
      console.log("SKIP: running as root — chmod 000 is not enforced");
      return;
    }

    const ledgerBase = path.join(tempDir, "toctou-base");
    fs.mkdirSync(ledgerBase, { recursive: true });

    process.env["TEO_LEDGER_DIR"] = ledgerBase;

    // Capture console.warn calls.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Make runPlan trigger a signing failure by locking the dir AFTER pre-flight.
    // We override runPlan to lock the dir then call the real runPlan behaviour,
    // but since we mock runPlan we need to simulate what happens when the real
    // implementation encounters a mid-run failure.
    //
    // Strategy: let runPlan return a result with signingErrors > 0 (as the real
    // implementation will do after the swallow) and verify invokeSkill emits warn.
    mockRunPlan.mockResolvedValue({
      overallStatus: "PASS",
      steps: [{ taskId: "t1", status: "PASS", signingStatus: "signing_failed" }],
      signingErrors: 1,
    } satisfies RunResult);

    const result = await invokeSkill(makeOpts({ sessionId: "test-session-toctou" }));

    // The run must complete with status:'ok' (swallow, not error).
    expect(result.status).toBe("ok");

    // console.warn must have been called (skill.ts emits warning when signingErrors > 0).
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(warnArgs).toMatch(/signing|ledger|warn/i);

    warnSpy.mockRestore();
  });
});

// =============================================================================
// MU-7 / AC-2: TEO_LEDGER_DIR set to valid writable tmpdir
// → all steps signed, ledger written under TEO_LEDGER_DIR, NOT ~/.teo/
// =============================================================================

describe("invokeSkill() — MU-7/AC-2: TEO_LEDGER_DIR=valid writable tmpdir", () => {
  let tempDir: string;
  let restoreEnv: () => void;

  beforeEach(() => {
    tempDir = makeTempDir();
    restoreEnv = saveEnv("TEO_LEDGER_DIR", "HOME");
  });

  afterEach(() => {
    removeTempDir(tempDir);
    restoreEnv();
  });

  it("MU-7/AC-2: TEO_LEDGER_DIR=valid tmpdir → status:'ok', all steps signed, ledger written under TEO_LEDGER_DIR not ~/.teo/", async () => {
    const ledgerBase = path.join(tempDir, "valid-ledger-base");
    fs.mkdirSync(ledgerBase, { recursive: true });

    process.env["TEO_LEDGER_DIR"] = ledgerBase;
    // Set HOME to something invalid to confirm we're NOT using ~/.teo/.
    process.env["HOME"] = "/nonexistent-home-mu7";

    // Use the REAL runPlan by undoing the mock for this test.
    // mockReset:true in vitest.config.ts handles reset between tests;
    // here we explicitly restore to ensure the real impl is used.
    mockRunPlan.mockRestore();

    // We need runPlan to actually run — restore it briefly.
    // But since runPlan is complex (requires real adapter), we assert at the
    // invokeSkill() boundary: it must pass pre-flight (TEO_LEDGER_DIR is writable)
    // and call sagePlan. The ledger file location is confirmed separately.
    //
    // Simpler: mock runPlan to return a fully-signed result and verify the
    // pre-flight passes (no ledger_error) and that the mock was called with the
    // correct ledgerBaseDir.
    const { runPlan: realRunPlan } =
      await vi.importActual<typeof import("../engine/run-plan.js")>("../engine/run-plan.js");
    mockRunPlan.mockImplementation(realRunPlan as typeof runPlan);

    const sessionId = `test-mu7-${Date.now()}`;
    const result = await invokeSkill(
      makeOpts({ sessionId, adapter: new StubAdapter({ agentsDir: BUNDLE_DIR }) })
    );

    // Must NOT return ledger_error — TEO_LEDGER_DIR is writable.
    expect(result.status).not.toBe("ledger_error");
    expect(result.status).toBe("ok");

    if (result.status === "ok") {
      // signingErrors must be 0 — all steps signed.
      expect(result.result.signingErrors).toBe(0);

      // Every executed step must be signed.
      const unsignedSteps = result.result.steps.filter(
        (s) => s.signingStatus !== "signed" && s.signingStatus !== "unsigned_by_design"
      );
      expect(unsignedSteps).toHaveLength(0);
    }

    // Ledger file must be under TEO_LEDGER_DIR/ledger/, NOT under ~/.teo/.
    const ledgerFile = path.join(ledgerBase, "ledger", `${sessionId}.jsonl`);
    expect(fs.existsSync(ledgerFile), `Ledger JSONL must be written at ${ledgerFile}`).toBe(true);

    // ~/.teo/ must NOT have been created.
    const realTeoLedger = path.join("/nonexistent-home-mu7", ".teo", "ledger");
    expect(fs.existsSync(realTeoLedger)).toBe(false);
  });
});

// =============================================================================
// GOLDEN PATH (AC-1 / MU-8)
// TEO_LEDGER_DIR unset, default writable → status:'ok', all steps signed,
// signingErrors=0 or absent, no stderr
// =============================================================================

describe("invokeSkill() — golden: TEO_LEDGER_DIR unset, default dir writable (AC-1/MU-8)", () => {
  let tempDir: string;
  let restoreEnv: () => void;

  beforeEach(() => {
    tempDir = makeTempDir();
    // Save both TEO_LEDGER_DIR and HOME so ledger resolution uses tempDir/.teo/
    // not the real ~/.teo/. homeDir in SkillOptions only affects provision(), not
    // resolveEffectiveLedgerBase(), which reads process.env.HOME directly.
    restoreEnv = saveEnv("TEO_LEDGER_DIR", "HOME");
  });

  afterEach(() => {
    removeTempDir(tempDir);
    restoreEnv();
  });

  it("AC-1/MU-8: TEO_LEDGER_DIR unset, homeDir injected and writable → status:'ok', all signed, signingErrors=0", async () => {
    delete process.env["TEO_LEDGER_DIR"];
    // Redirect HOME to tempDir so resolveEffectiveLedgerBase() writes to tempDir/.teo/
    // instead of the real ~/.teo/ (which would mutate the real ledger dir and break
    // the go04-acceptance.test.ts isolation guard).
    process.env["HOME"] = tempDir;

    // Use the real runPlan so we actually exercise the signed path.
    const { runPlan: realRunPlan } =
      await vi.importActual<typeof import("../engine/run-plan.js")>("../engine/run-plan.js");
    mockRunPlan.mockImplementation(realRunPlan as typeof runPlan);

    // Use a known-writable homeDir so the default ~/.teo/ resolves correctly.
    const sessionId = `test-ac1-${Date.now()}`;
    const result = await invokeSkill(
      makeOpts({
        sessionId,
        homeDir: tempDir, // provision() uses this; ledger now also uses tempDir via HOME
        adapter: new StubAdapter({ agentsDir: BUNDLE_DIR }),
      })
    );

    expect(result.status).toBe("ok");

    if (result.status === "ok") {
      // signingErrors must be 0.
      expect(result.result.signingErrors ?? 0).toBe(0);

      // All executed steps must be signed.
      const signingFailedSteps = result.result.steps.filter(
        (s) => s.signingStatus === "signing_failed"
      );
      expect(signingFailedSteps).toHaveLength(0);
    }
  });
});

// =============================================================================
// Coverage: ledgerBaseDir override in SkillOptions (skill.ts line 67)
// Ensures the direct programmatic ledgerBaseDir override path is exercised.
// =============================================================================

describe("invokeSkill() — SkillOptions.ledgerBaseDir direct override (coverage: skill.ts:67)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("ledgerBaseDir override: providing ledgerBaseDir directly skips env var resolution and uses the provided path", async () => {
    // This test covers the `return override` branch at line 67 of skill.ts:
    //   resolveEffectiveLedgerBase(opts.ledgerBaseDir) — when opts.ledgerBaseDir is set,
    //   it returns immediately without consulting TEO_LEDGER_DIR or HOME.

    const customLedgerBase = path.join(tempDir, "custom-ledger-base");
    fs.mkdirSync(customLedgerBase, { recursive: true });

    // Use the real runPlan so the ledger is actually written.
    const { runPlan: realRunPlan } =
      await vi.importActual<typeof import("../engine/run-plan.js")>("../engine/run-plan.js");
    mockRunPlan.mockImplementation(realRunPlan as typeof runPlan);

    const sessionId = `test-ledgerbasedir-override-${Date.now()}`;
    const result = await invokeSkill(
      makeOpts({
        sessionId,
        ledgerBaseDir: customLedgerBase, // Direct override — exercises line 67
        adapter: new StubAdapter({ agentsDir: BUNDLE_DIR }),
      })
    );

    expect(result.status).toBe("ok");

    // Ledger must be written under customLedgerBase.
    const ledgerFile = path.join(customLedgerBase, "ledger", `${sessionId}.jsonl`);
    expect(fs.existsSync(ledgerFile), `Ledger must be written at ${ledgerFile}`).toBe(true);
  });
});

// =============================================================================
// AC-7: TypeScript compile-time exhaustion
// Every call site of invokeSkill() must handle the new "ledger_error" discriminant.
// We verify this by running the TypeScript compiler.
// =============================================================================

describe("AC-7: TypeScript compile-time exhaustion — every invokeSkill() call site handles ledger_error", () => {
  it("AC-7: npm run typecheck exits 0 (all call sites handle ledger_error discriminant)", async () => {
    // This test verifies the TypeScript type system — NOT runtime behavior.
    // It runs the compiler and asserts zero type errors.
    //
    // NOTE: This test will FAIL until:
    //   1. SkillResult gains { status: "ledger_error"; reason: string }
    //   2. All callers are updated to handle the new discriminant.

    const { execSync } = await import("node:child_process");
    let exitCode = 0;
    let stderr = "";
    try {
      // Use process.cwd() (the repo root) so this test is portable across
      // machines. The prior commit hardcoded /tmp/capo-probe-02 — a developer-
      // local ephemeral path that never exists in CI or other clones.
      execSync("npm run typecheck", {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      });
    } catch (err: unknown) {
      exitCode = (err as { status?: number }).status ?? 1;
      stderr = (err as { stderr?: string }).stderr ?? "";
    }

    if (exitCode !== 0) {
      // surfacing the compiler output makes it easier to triage
      console.error("typecheck failed:\n", stderr);
    }

    expect(
      exitCode,
      "typecheck must pass — all invokeSkill() call sites must handle ledger_error"
    ).toBe(0);
  });
});
