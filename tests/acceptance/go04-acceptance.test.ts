// =============================================================================
// go04-acceptance.test.ts — WS-GO-04 in-session acceptance harness
//
// STATUS: FAILING — implementation does not yet exist.
// Tests are written before dev implements:
//   - StepResult.signingStatus field (runner.ts)
//   - runPlan() populates signingStatus (run-plan.ts)
//   - runStep() runtime guard for missing/invalid status (runner.ts)
//   - pluginRoot containment check in provision.ts (S3 follow-on)
//   - stderr warning in handleProvision() for result.warning (S8 follow-on)
//
// Ordering: misuse/adversarial first → boundary → golden path (ADR-064)
// =============================================================================

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type { Plan, TEOTask } from "../../src/core/plan.js";
import type { TEOAdapter, AgentContext } from "../../src/adapters/types.js";
import type { StepResult } from "../../src/core/runner.js";
import { runPlan } from "../../src/engine/run-plan.js";
import { StubAdapter } from "../../src/adapters/stub.js";
import { HmacSigner } from "../../src/core/sign.js";
import { provision } from "../../src/bootstrap/provision.js";
import type { ProvisionOptions } from "../../src/bootstrap/provision.js";
import type { LedgerEvent } from "../../src/core/ledger.js";
import * as ed from "@noble/ed25519";
import { signPluginRoot } from "../../src/bootstrap/install-sig.js";

// ---------------------------------------------------------------------------
// Binary path for CLI tests
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../");
const BIN_PATH = path.join(REPO_ROOT, "bin", "teo-run.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid Plan with the given tasks. */
function makePlan(tasks: TEOTask[], overrides?: Partial<Plan>): Plan {
  return {
    plan_id: "go04-acceptance-plan",
    project_id: "proj-go04",
    created_at: "2026-06-20T00:00:00Z",
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

/** Read all lines from a JSONL file, parse each as JSON. */
function readLedgerLines(filePath: string): LedgerEvent[] {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LedgerEvent);
}

/** Build minimal ProvisionOptions with empty revocation list (PASS). */
function makeProvisionOpts(
  bundleDir: string,
  homeDir: string,
  extra?: Partial<ProvisionOptions>
): ProvisionOptions {
  return {
    bundleDir,
    homeDir,
    revocationOpts: {
      signature: new Uint8Array(64).fill(0x01),
      publicKey: new Uint8Array(32).fill(0x02),
      keyId: "go04-test-key",
      revocationList: { revoked_keys: [] },
    },
    ...extra,
  };
}

/** Create a temp bundleDir with a single stub .md file. */
function makeBundleDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "teo-go04-bundle-"));
  const content =
    `---\n` +
    `agent_id: stub-agent\n` +
    `name: Stub Agent\n` +
    `role: Stub role for testing.\n` +
    `disallowedTools_default:\n` +
    `---\n\n` +
    `# Stub agent constitution\n\nBody text.\n`;
  fs.writeFileSync(path.join(d, "stub-agent.md"), content, "utf8");
  return d;
}

// ---------------------------------------------------------------------------
// AC-8: Isolation guard — record ~/.teo state BEFORE the suite starts
// ---------------------------------------------------------------------------

const TEO_HOME_PATH = path.join(os.homedir(), ".teo");
let teoBefore_exists: boolean;
let teoBefore_mtime: number | null;

beforeAll(() => {
  teoBefore_exists = fs.existsSync(TEO_HOME_PATH);
  teoBefore_mtime = teoBefore_exists ? fs.statSync(TEO_HOME_PATH).mtimeMs : null;
});

// ---------------------------------------------------------------------------
// AC-8: Post-suite isolation guard — verify ~/.teo was NOT touched
// ---------------------------------------------------------------------------

afterAll(() => {
  const teoAfter_exists = fs.existsSync(TEO_HOME_PATH);

  if (!teoBefore_exists) {
    // Must not have been created by the suite
    expect(teoAfter_exists).toBe(false);
  } else {
    // Must still exist and not have been mutated
    expect(teoAfter_exists).toBe(true);
    const teoAfter_mtime = fs.statSync(TEO_HOME_PATH).mtimeMs;
    expect(teoAfter_mtime).toBe(teoBefore_mtime);
  }
});

// ---------------------------------------------------------------------------
// Temp dir cleanup
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function makeTempDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

// =============================================================================
// AC-6 adversarial — agent returns no verdict (missing status)
// =============================================================================

describe("AC-6 adversarial: agent returns no verdict (missing status field)", () => {
  it("adapter resolving {taskId} with no status → overallStatus FAILED, step coerced to FAILED with 'invalid status' detail, does NOT throw", async () => {
    // Arrange: adapter that returns a result missing the status field entirely.
    // This is the adversarial case: a buggy or malicious agent drops the verdict.
    const noStatusAdapter: TEOAdapter = {
      sagePlan: async () => {
        throw new Error("not used");
      },
      spawnAgent: async (task: TEOTask, _ctx: AgentContext): Promise<StepResult> => {
        // Cast through any to bypass TypeScript: simulates a runtime contract violation.
        return { taskId: task.id } as unknown as StepResult;
      },
    };

    const plan = makePlan([makeAgentTask("missing-status-task")]);

    // Act — must NOT throw; runPlan must absorb the contract violation.
    const result = await runPlan(plan, noStatusAdapter);

    // Assert: overall plan is FAILED (coerced step counts as failure)
    expect(result.overallStatus).toBe("FAILED");

    // Assert: step was coerced to FAILED
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.status).toBe("FAILED");

    // Assert: coercion detail contains "invalid status"
    // This will FAIL today — runner.ts does not yet have the runtime guard.
    expect(result.steps[0]!.detail).toMatch(/invalid status/i);
  });
});

// =============================================================================
// AC-7 adversarial — ledger tamper detected
// =============================================================================

describe("AC-7 adversarial: ledger tamper — HMAC verify rejects mutated verdict", () => {
  it("mutating a PASS verdict to XXXX in the JSONL file → HmacSigner.verify() returns false for that line, true for unmodified", async () => {
    // Arrange: run a 2-task plan so we get 2 EXECUTE events
    const tmpDir = makeTempDir("teo-go04-tamper-");
    const sessionId = "go04-tamper-test-001";

    const plan = makePlan(
      [makeAgentTask("tamper-task-a"), makeAgentTask("tamper-task-b", ["tamper-task-a"])],
      { plan_id: "go04-tamper-plan" }
    );

    const adapter = new StubAdapter();
    const result = await runPlan(plan, adapter, {
      sessionId,
      ledgerBaseDir: tmpDir,
    });

    expect(result.overallStatus).toBe("PASS");

    const ledgerFilePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
    expect(fs.existsSync(ledgerFilePath)).toBe(true);

    // Read all lines and find EXECUTE events
    const lines = readLedgerLines(ledgerFilePath);
    const executeLines = lines.filter((l) => l.phase === "EXECUTE");
    expect(executeLines.length).toBeGreaterThanOrEqual(1);

    const firstExecute = executeLines[0]!;
    const secondExecute = executeLines[1];

    // Mutate the first EXECUTE event's verdict field in the raw file
    const raw = fs.readFileSync(ledgerFilePath, "utf8");
    const rawLines = raw.split("\n").filter((l) => l.trim().length > 0);

    // Find and mutate the first EXECUTE line
    const mutatedRawLines = rawLines.map((rawLine) => {
      const parsed = JSON.parse(rawLine) as LedgerEvent;
      if (parsed.event_id === firstExecute.event_id && parsed.phase === "EXECUTE") {
        // Mutate the verdict from "PASS" to "XXXX"
        const mutated = { ...parsed, verdict: "XXXX" };
        return JSON.stringify(mutated);
      }
      return rawLine;
    });

    fs.writeFileSync(ledgerFilePath, mutatedRawLines.join("\n") + "\n", "utf8");

    // Reconstruct HmacSigner from the same keyring directory used during the run
    const verifier = new HmacSigner({ baseDir: tmpDir });

    // The signature from the first step result
    const firstStepResult = result.steps.find((s) => s.taskId === firstExecute.task_id);
    expect(firstStepResult).toBeDefined();
    expect(firstStepResult!.signature).toBeDefined();

    // Verify with MUTATED payload — construct payload as it would have been at sign time
    // but using the mutated verdict "XXXX" cast as LedgerVerdict
    const mutatedPayload = {
      plan_id: plan.plan_id,
      task_id: firstExecute.task_id,
      actor_id: firstExecute.actor_id,
      verdict: "XXXX" as Parameters<typeof verifier.verify>[0]["verdict"],
      ts: firstExecute.ts,
      seq: firstExecute.seq,
    };

    // Verify the mutated event against the original signature — should be false
    // (signature was computed over "PASS" but we're now verifying against "XXXX")
    const mutatedVerifyResult = verifier.verify(mutatedPayload, firstStepResult!.signature!);
    expect(mutatedVerifyResult).toBe(false);

    // Verify the ORIGINAL payload for the first event — should be true
    const originalPayload = {
      plan_id: plan.plan_id,
      task_id: firstExecute.task_id,
      actor_id: firstExecute.actor_id,
      verdict: firstExecute.verdict,
      ts: firstExecute.ts,
      seq: firstExecute.seq,
    };
    const originalVerifyResult = verifier.verify(originalPayload, firstStepResult!.signature!);
    expect(originalVerifyResult).toBe(true);

    // For the second (unmodified) execute event, verify should still be true
    if (secondExecute !== undefined) {
      const secondStepResult = result.steps.find((s) => s.taskId === secondExecute.task_id);
      expect(secondStepResult).toBeDefined();
      expect(secondStepResult!.signature).toBeDefined();

      const secondPayload = {
        plan_id: plan.plan_id,
        task_id: secondExecute.task_id,
        actor_id: secondExecute.actor_id,
        verdict: secondExecute.verdict,
        ts: secondExecute.ts,
        seq: secondExecute.seq,
      };
      const secondVerifyResult = verifier.verify(secondPayload, secondStepResult!.signature!);
      expect(secondVerifyResult).toBe(true);
    }
  });
});

// =============================================================================
// AC-4 — provision() creates correct data-dir structure
// =============================================================================

describe("AC-4: provision() creates correct data-dir structure", () => {
  it("fresh provision with temp homeDir and bundleDir → ok, ledger/ keyring/ manifest.json all correct", async () => {
    const homeDir = makeTempDir("teo-go04-home-");
    const bundleDir = makeBundleDir();
    tempDirs.push(bundleDir);

    // WS-REVOKE-01: fail-open is gone. We must write a real install-sig so that
    // checkRevocation()'s Step 0 (install-sig path) passes and provision() can proceed.
    const privKey = ed.utils.randomSecretKey();
    const pubKey = await ed.getPublicKeyAsync(privKey);
    const keyId = "go04-test-key";
    await signPluginRoot(bundleDir, keyId, privKey);

    vi.stubEnv("CLAUDE_PLUGIN_ROOT", bundleDir);

    let result: Awaited<ReturnType<typeof provision>>;
    try {
      // Act: call provision() with plugin context (via CLAUDE_PLUGIN_ROOT env)
      result = await provision({
        bundleDir,
        homeDir,
        host: { kind: "claude-code-plugin", pluginRoot: bundleDir },
        revocationOpts: {
          // No explicit signature — checkRevocation() auto-verifies via .teo-install-sig
          signature: undefined,
          publicKey: pubKey,
          keyId,
          revocationList: { revoked_keys: [] },
        },
      });
    } finally {
      vi.unstubAllEnvs();
    }

    // Assert: status ok or already_provisioned (idempotency)
    expect(["ok", "already_provisioned"]).toContain(result.status);

    // Assert: ledger/ directory created
    expect(fs.statSync(path.join(homeDir, "ledger")).isDirectory()).toBe(true);

    // Assert: keyring/ directory created
    expect(fs.statSync(path.join(homeDir, "keyring")).isDirectory()).toBe(true);

    // Assert: manifest.json exists
    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(true);

    // Assert: manifest.json has required schema fields
    const manifest = JSON.parse(
      fs.readFileSync(path.join(homeDir, "manifest.json"), "utf8")
    ) as Record<string, unknown>;

    expect(manifest["schema_version"]).toBe("1");
    expect(typeof manifest["teo_version"]).toBe("string");
    expect(typeof manifest["provisioned_at"]).toBe("string");
    const provisioned = new Date(manifest["provisioned_at"] as string);
    expect(isNaN(provisioned.getTime())).toBe(false); // valid ISO-8601
    expect(typeof manifest["bundle_signature_key_id"]).toBe("string");
    expect((manifest["bundle_signature_key_id"] as string).length).toBeGreaterThan(0);

    // Assert: calling provision() a second time returns already_provisioned
    // The .teo-install-sig written above is still present in bundleDir; reuse same keys.
    vi.stubEnv("CLAUDE_PLUGIN_ROOT", bundleDir);
    let secondResult: Awaited<ReturnType<typeof provision>>;
    try {
      secondResult = await provision({
        bundleDir,
        homeDir,
        host: { kind: "claude-code-plugin", pluginRoot: bundleDir },
        revocationOpts: {
          signature: undefined,
          publicKey: pubKey,
          keyId,
          revocationList: { revoked_keys: [] },
        },
      });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(secondResult.status).toBe("already_provisioned");

    // Assert: real ~/.teo was NOT touched
    // (covered by the suite-level AC-8 isolation guard in afterAll)
    const teoExists = fs.existsSync(TEO_HOME_PATH);
    if (!teoBefore_exists) {
      expect(teoExists).toBe(false);
    }
  });
});

// =============================================================================
// AC-4 adversarial — pluginRoot containment check (S3 follow-on)
// =============================================================================

describe("AC-4 adversarial: pluginRoot containment check (S3 follow-on)", () => {
  it("bundleDir traversing above pluginRoot → status: error, reason contains 'containment'", async () => {
    // Arrange: a temp pluginRoot, but bundleDir is derived via traversal above it.
    // This test exercises the NEW containment check in provision.ts (not yet implemented).
    const tempPluginRoot = makeTempDir("teo-go04-pluginroot-");
    const homeDir = makeTempDir("teo-go04-home-contain-");

    // The derived bundleDir from pluginRoot traversal: <pluginRoot>/../sensitive
    // path.resolve will collapse ".." so this resolves ABOVE tempPluginRoot.
    const traversingBundleDir = path.resolve(tempPluginRoot, "..", "sensitive");

    // Today: provision() does NOT have a containment check. listAgentIds() is called
    // on the traversing path first, and it may throw ENOENT (path doesn't exist).
    // After dev implements: provision() must return { status: "error", reason: "...containment..." }
    // BEFORE calling listAgentIds().
    //
    // We wrap in try/catch to handle the current throw behavior:
    // - Today: throws ENOENT → test fails because result.status !== "error" OR throws
    // - After impl: returns { status: "error", reason: "...containment..." } → test passes
    let result: Awaited<ReturnType<typeof provision>> | null = null;
    let caughtError: unknown = null;

    vi.stubEnv("CLAUDE_PLUGIN_ROOT", tempPluginRoot);
    try {
      result = await provision({
        homeDir,
        host: {
          kind: "claude-code-plugin",
          pluginRoot: tempPluginRoot,
        },
        bundleDir: traversingBundleDir,
        revocationOpts: {
          signature: undefined, // fail-open: plugin context path → "unsigned-plugin-context" PASS
          publicKey: new Uint8Array(32).fill(0x02),
          keyId: "go04-contain-key",
          revocationList: { revoked_keys: [] },
        },
      });
    } catch (err) {
      caughtError = err;
    } finally {
      vi.unstubAllEnvs();
    }

    // Assert: containment check fires BEFORE listAgentIds() (so no ENOENT).
    // This will FAIL today — provision.ts does not yet have the containment check.
    // Today: caughtError is set (ENOENT) and result is null.
    // After impl: result is set with status:"error" and reason contains "containment".
    expect(caughtError).toBeNull(); // must NOT throw — containment check returns error, not throw
    expect(result).not.toBeNull();
    expect(result!.status).toBe("error");
    if (result!.status !== "error") throw new Error("narrowing guard");
    expect(result!.reason).toMatch(/containment/i);
  });
});

// =============================================================================
// AC-1 + AC-2 + AC-3 golden path — end-to-end signed run
// =============================================================================

describe("AC-1 + AC-2 + AC-3: golden path signed run", () => {
  it("golden path: signed 2-task plan runs to PASS with verified JSONL ledger", async () => {
    // Setup
    const tmpHomeDir = makeTempDir("teo-go04-golden-");
    const sessionId = "acceptance-test-001";

    // 2-task sequential plan
    const task1 = makeAgentTask("task-1");
    const task2 = makeAgentTask("task-2", ["task-1"]);
    const plan = makePlan([task1, task2], { plan_id: "go04-golden-plan" });

    const adapter = new StubAdapter();

    // Act
    const result = await runPlan(plan, adapter, {
      sessionId,
      ledgerBaseDir: tmpHomeDir,
    });

    // --- Assertion 1: overallStatus is PASS
    expect(result.overallStatus).toBe("PASS");

    // --- Assertion 2: 2 steps
    expect(result.steps.length).toBe(2);

    // --- Assertion 3: every step status is PASS
    for (const step of result.steps) {
      expect(step.status).toBe("PASS");
    }

    // --- Assertion 4: every step has signingStatus === "signed"
    // This will FAIL today — StepResult.signingStatus is not yet implemented.
    for (const step of result.steps) {
      expect((step as StepResult & { signingStatus?: string }).signingStatus).toBe("signed");
    }

    // --- Assertion 5: every step has a 64-char lowercase hex signature
    for (const step of result.steps) {
      expect(step.signature).toMatch(/^[0-9a-f]{64}$/);
    }

    // --- Assertion 6: ledger file exists
    const ledgerFilePath = path.join(tmpHomeDir, "ledger", `${sessionId}.jsonl`);
    expect(fs.existsSync(ledgerFilePath)).toBe(true);

    // --- Assertion 7: file is non-empty
    const stat = fs.statSync(ledgerFilePath);
    expect(stat.size).toBeGreaterThan(0);

    // --- Assertion 8: every line is valid JSON with an event_id
    const lines = readLedgerLines(ledgerFilePath);
    for (const line of lines) {
      expect(typeof line.event_id).toBe("string");
      expect(line.event_id.length).toBeGreaterThan(0);
    }

    // --- Assertion 9: last line has phase === "CLOSE"
    const lastLine = lines[lines.length - 1]!;
    expect(lastLine.phase).toBe("CLOSE");

    // --- Assertion 10: CLOSE line's detail.task_count === 2
    expect((lastLine.detail as Record<string, unknown>)["task_count"]).toBe(2);

    // --- Assertion 11: CLOSE line's detail.pass === 2
    expect((lastLine.detail as Record<string, unknown>)["pass"]).toBe(2);

    // --- Assertion 12: HmacSigner.verify() returns true for every EXECUTE line's signature
    const verifier = new HmacSigner({ baseDir: tmpHomeDir });
    const executeLines = lines.filter((l) => l.phase === "EXECUTE");
    expect(executeLines).toHaveLength(2);

    for (const evt of executeLines) {
      // Find the corresponding step result to get the signature
      const step = result.steps.find((s) => s.taskId === evt.task_id);
      expect(step).toBeDefined();
      expect(step!.signature).toBeDefined();

      const valid = verifier.verify(
        {
          plan_id: plan.plan_id,
          task_id: evt.task_id,
          actor_id: evt.actor_id,
          verdict: evt.verdict,
          ts: evt.ts,
          seq: evt.seq,
        },
        step!.signature!
      );
      expect(valid).toBe(true);
    }

    // --- Assertion 13: real ~/.teo was NOT used
    // Covered by the suite-level AC-8 isolation guard in afterAll.
    // Additionally verify explicitly here:
    if (!teoBefore_exists) {
      expect(fs.existsSync(TEO_HOME_PATH)).toBe(false);
    }
  });
});

// =============================================================================
// AC-1 variant — unsigned run has signingStatus: "unsigned_by_design"
// =============================================================================

describe("AC-1 variant: unsigned run (no sessionId) → signingStatus: unsigned_by_design", () => {
  it("runPlan() without sessionId → all steps have signingStatus: 'unsigned_by_design', no ledger file", async () => {
    const tmpHomeDir = makeTempDir("teo-go04-unsigned-");

    const task1 = makeAgentTask("unsigned-task-1");
    const task2 = makeAgentTask("unsigned-task-2", ["unsigned-task-1"]);
    const plan = makePlan([task1, task2], { plan_id: "go04-unsigned-plan" });

    const adapter = new StubAdapter();

    // Act: unsigned path — no sessionId
    const result = await runPlan(plan, adapter, {
      ledgerBaseDir: tmpHomeDir,
      // No sessionId
    });

    // Assert: plan succeeds
    expect(result.overallStatus).toBe("PASS");

    // Assert: every step has signingStatus: "unsigned_by_design"
    // This will FAIL today — StepResult.signingStatus is not yet implemented.
    for (const step of result.steps) {
      expect((step as StepResult & { signingStatus?: string }).signingStatus).toBe(
        "unsigned_by_design"
      );
    }

    // Assert: no ledger file created
    const ledgerDir = path.join(tmpHomeDir, "ledger");
    if (fs.existsSync(ledgerDir)) {
      const files = fs.readdirSync(ledgerDir);
      expect(files).toHaveLength(0);
    } else {
      expect(fs.existsSync(ledgerDir)).toBe(false);
    }
  });
});

// =============================================================================
// AC-5 CLI binary — bin/teo-run.js acceptance (skip if binary absent)
// =============================================================================

/** Run the CLI synchronously and return { exitCode, stdout, stderr }. */
function runCli(
  command: string,
  jsonArg: string,
  extraEnv?: Record<string, string>
): { exitCode: number; stdout: unknown; stdoutRaw: string; stderr: string } {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const result = spawnSync("node", [BIN_PATH, command, jsonArg], {
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const stdoutRaw = (result.stdout ?? "") as string;
  let stdout: unknown = stdoutRaw;
  try {
    stdout = JSON.parse(stdoutRaw.trim());
  } catch {
    // not JSON — keep raw
  }

  return {
    exitCode: (result.status ?? 1) as number,
    stdout,
    stdoutRaw,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    stderr: (result.stderr ?? "") as string,
  };
}

const binExists = fs.existsSync(BIN_PATH);

describe("AC-5 CLI binary: bin/teo-run.js acceptance", () => {
  it.skipIf(!binExists)(
    "validate-plan golden path: valid 2-task plan JSON → { valid: true }, exit 0",
    () => {
      const validPlan = JSON.stringify({
        plan_id: "cli-go04-plan",
        project_id: "proj-cli-go04",
        created_at: "2026-06-20T00:00:00Z",
        version: "1",
        tasks: [
          {
            id: "cli-task-1",
            type: "AGENT",
            agent_id: "eng",
            prompt: "Do task 1",
            needs: [],
            gates: [],
          },
          {
            id: "cli-task-2",
            type: "AGENT",
            agent_id: "eng",
            prompt: "Do task 2",
            needs: ["cli-task-1"],
            gates: [],
          },
        ],
      });

      const { exitCode, stdout } = runCli("validate-plan", validPlan);

      expect(exitCode).toBe(0);
      expect(stdout).toMatchObject({ valid: true });
    }
  );

  // SKIPPED (WS-REVOKE-01): The compiled binary predates WS-REVOKE-01 and still has the old
  // fail-open path. These CLI provision tests rely on unsigned plugin context producing PASS.
  // After the binary is rebuilt with WS-REVOKE-01 source, restore and add signPluginRoot() setup.
  it.skip("provision golden path with plugin context: CLAUDE_PLUGIN_ROOT set → exit 0, status ok or already_provisioned", () => {
    const bundleDir = makeBundleDir();
    tempDirs.push(bundleDir);
    const homeDir = makeTempDir("teo-go04-cli-prov-");

    // Requires real install-sig after WS-REVOKE-01: signPluginRoot(bundleDir, keyId, privKey)
    // must be called and the matching publicKey passed before this test is meaningful.
    const provisionOpts = JSON.stringify({
      bundleDir,
      homeDir,
      revocationOpts: {
        keyId: "cli-go04-key",
        revocationList: { revoked_keys: [] },
      },
    });

    const { exitCode, stdout } = runCli("provision", provisionOpts, {
      CLAUDE_PLUGIN_ROOT: bundleDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({
      status: expect.stringMatching(/^(ok|already_provisioned)$/),
    });
  });

  // SKIPPED (WS-REVOKE-01): The old "unsigned-plugin-context" warning no longer exists —
  // unsigned plugin context is now BLOCKED, not a warned PASS. The S8 follow-on behavior
  // (warning → stderr) is superseded. Skip until a new CLI test covering REVOKE-01
  // behavior (signed install-sig → ok) is written for the rebuilt binary.
  it.skip("provision with plugin context (unsigned): stdout is clean JSON, stderr contains 'unsigned-plugin-context' (S8 follow-on)", () => {
    // This test is obsolete: WS-REVOKE-01 removed the fail-open "unsigned-plugin-context"
    // path. Unsigned plugin context now produces BLOCKED + status:error, not a warning.
    const bundleDir = makeBundleDir();
    tempDirs.push(bundleDir);
    const homeDir = makeTempDir("teo-go04-cli-s8-");

    const provisionOpts = JSON.stringify({
      bundleDir,
      homeDir,
      revocationOpts: {
        keyId: "cli-go04-s8-key",
        revocationList: { revoked_keys: [] },
      },
    });

    const { exitCode, stdoutRaw, stderr } = runCli("provision", provisionOpts, {
      CLAUDE_PLUGIN_ROOT: bundleDir,
    });

    expect(() => JSON.parse(stdoutRaw.trim())).not.toThrow();
    expect(exitCode).toBe(0);
    expect(stderr).toContain("unsigned-plugin-context");
  });

  it.skipIf(!binExists)(
    "sign golden path: valid payload → { signature: 64-char hex }, exit 0",
    () => {
      const tmpDir = makeTempDir("teo-go04-cli-sign-");

      const signOpts = JSON.stringify({
        baseDir: tmpDir,
        payload: {
          plan_id: "cli-plan-1",
          task_id: "cli-task-1",
          actor_id: "eng",
          verdict: "PASS",
          ts: "2026-06-20T00:00:00.000Z",
          seq: 1,
        },
      });

      const { exitCode, stdout } = runCli("sign", signOpts);

      expect(exitCode).toBe(0);
      expect(stdout).toMatchObject({
        signature: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    }
  );

  it.skipIf(!binExists)(
    "ledger-append + ledger-close golden path → append returns {seq, ts}, close returns {ok: true}",
    () => {
      const tmpDir = makeTempDir("teo-go04-cli-ledger-");
      const sessionId = "cli-go04-ledger-test";

      // ledger-append
      const appendOpts = JSON.stringify({
        baseDir: tmpDir,
        session_id: sessionId,
        entry: {
          session_id: sessionId,
          workflow_id: "wf-cli-001",
          task_id: "cli-task-1",
          turn_id: null,
          actor_id: "eng",
          actor_type: "AGENT",
          phase: "EXECUTE",
          verdict: "PASS",
          detail: null,
        },
      });

      const appendResult = runCli("ledger-append", appendOpts);
      expect(appendResult.exitCode).toBe(0);
      expect(appendResult.stdout).toMatchObject({
        seq: expect.any(Number),
        ts: expect.any(String),
      });

      // ledger-close
      const closeOpts = JSON.stringify({
        baseDir: tmpDir,
        session_id: sessionId,
        summary: {
          task_count: 1,
          pass: 1,
          fail: 0,
          skipped: 0,
          tokens: 0,
          cost_usd: 0,
        },
      });

      const closeResult = runCli("ledger-close", closeOpts);
      expect(closeResult.exitCode).toBe(0);
      expect(closeResult.stdout).toMatchObject({ ok: true });
    }
  );
});
