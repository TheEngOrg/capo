// =============================================================================
// verify-gate-cli.test.ts — HMAC gate signing: verify-gate command tests
//
// STATUS: PASSING — post-impl, CAD gate 2 (dev phase)
//
// CONTRACT (CLI arg protocol):
//   node bin/teo-run.js verify-gate '<json-string>'
//   - Returns JSON on stdout
//   - Exits 0 when valid: true OR on hard field-validation errors (see below)
//   - Exits 1 on hard input errors (missing required fields)
//   - Exits 0 with { valid: false } when signature fails verification
//
// INPUT CONTRACT:
//   {
//     plan_id: string;           — required
//     task_id: string;           — required
//     actor_id: string;          — required
//     verdict: string;           — required
//     ts: string;                — ISO-8601 from evaluate-gate output
//     seq: number;               — from evaluate-gate output
//     gate_sig: string;          — 64-char lowercase hex HMAC-SHA-256
//     baseDir?: string;          — must match the baseDir used during signing
//   }
//
// OUTPUT CONTRACT:
//   {
//     valid: boolean;
//     plan_id: string;
//     task_id: string;
//     verdict: string;
//     seq: number;
//   }
//
// Ordering: misuse → boundary → golden path  (ADR-064 adversarial-first policy)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// CLI binary / entry point — same resolution strategy as evaluate-gate-cli.test.ts
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../");
const BIN_PATH = path.join(REPO_ROOT, "bin", "teo-run.js");
const ENTRY_PATH = path.join(REPO_ROOT, "src", "skill", "teo-run-entry.ts");

function buildCliArgs(command: string, jsonArg: string): { cmd: string; args: string[] } {
  if (fs.existsSync(BIN_PATH)) {
    return { cmd: "node", args: [BIN_PATH, command, jsonArg] };
  }
  return { cmd: "node", args: ["--import", "tsx/esm", ENTRY_PATH, command, jsonArg] };
}

function runCli(
  command: string,
  jsonArg: string,
  extraEnv?: Record<string, string>
): { exitCode: number; stdout: unknown; stdoutRaw: string; stderr: string } {
  const { cmd, args } = buildCliArgs(command, jsonArg);
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const stdoutRaw = result.stdout ?? "";
  let stdout: unknown = stdoutRaw;
  try {
    stdout = JSON.parse(stdoutRaw.trim());
  } catch {
    // stdout is not JSON — keep raw string
  }

  return {
    exitCode: result.status ?? 1,
    stdout,
    stdoutRaw,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    stderr: result.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// Temp dir helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "teo-verify-gate-"));
  tempDirs.push(d);
  return d;
}

beforeEach(() => {
  // No shared setup — each test manages its own temp state
});

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

// ---------------------------------------------------------------------------
// Fixture: minimal valid base inputs for verify-gate
// ---------------------------------------------------------------------------

/**
 * Returns the minimum well-formed verify-gate payload for a given baseDir.
 * gate_sig is a placeholder 64-char hex value — tests mutate as needed.
 */
function baseVerifyInput(baseDir: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    plan_id: "plan-vg-test-001",
    task_id: "task-vg-test-001",
    actor_id: "SYSTEM",
    verdict: "PASS",
    ts: "2026-06-28T00:00:00.000Z",
    seq: 1,
    gate_sig: "a".repeat(64), // 64-char placeholder — invalid sig but correct format
    baseDir,
    ...overrides,
  });
}

/**
 * Run evaluate-gate with a plan_id so that HMAC signing happens.
 * Returns the full parsed result (including gate_sig, ts, seq).
 */
function runEvaluateGateWithSign(
  baseDir: string,
  sessionId: string
): { exitCode: number; result: Record<string, unknown> } {
  // Write a minimal ac.json so acceptance-criteria profile produces a real verdict
  const acPath = path.join(baseDir, "ac.json");
  if (!fs.existsSync(acPath)) {
    fs.writeFileSync(
      acPath,
      JSON.stringify({
        workstream: "vg-roundtrip",
        acs: [{ id: "AC-1", description: "roundtrip ac" }],
      }),
      "utf8"
    );
  }

  const input = JSON.stringify({
    gate_id: "gate-vg-roundtrip-001",
    task_id: "task-vg-test-001",
    session_id: sessionId,
    gate_type: "acceptance-criteria",
    context: { cwd: baseDir },
    plan_id: "plan-vg-test-001",
    ledger_base_dir: baseDir,
  });

  const { exitCode, stdout } = runCli("evaluate-gate", input);
  return { exitCode, result: stdout as Record<string, unknown> };
}

// =============================================================================
// MISUSE — bad inputs that must be rejected before any verification attempt
// =============================================================================

describe("verify-gate: MISUSE", () => {
  // [VG-1] Missing gate_sig field entirely → exit 1 with JSON error.
  // The field is required; its absence is a caller mistake, not a verification failure.
  it("[VG-1] missing gate_sig field → exit 1, JSON error", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      plan_id: "plan-vg-test-001",
      task_id: "task-vg-test-001",
      actor_id: "SYSTEM",
      verdict: "PASS",
      ts: "2026-06-28T00:00:00.000Z",
      seq: 1,
      // gate_sig intentionally omitted
      baseDir,
    });

    const { exitCode, stdout } = runCli("verify-gate", input);

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result).toHaveProperty("error");
    expect(result["error"]).toMatch(/gate_sig/i);
  });

  // [VG-2] gate_sig present but wrong length (not 64 chars) → exit 0, { valid: false }.
  // A wrong-length hex string is definitionally unverifiable against HMAC-SHA-256.
  // This is a verification result, not a missing-field error — exit 0, valid: false.
  it("[VG-2] gate_sig wrong length (not 64 chars) → exit 0, { valid: false }", () => {
    const baseDir = makeTempDir();
    const input = baseVerifyInput(baseDir, {
      gate_sig: "deadbeef", // 8 chars — too short
    });

    const { exitCode, stdout } = runCli("verify-gate", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result["valid"]).toBe(false);
    // Structural output fields must still be present even on invalid sig
    expect(result).toHaveProperty("plan_id");
    expect(result).toHaveProperty("task_id");
    expect(result).toHaveProperty("verdict");
    expect(result).toHaveProperty("seq");
  });

  // [VG-3] gate_sig is exactly 64 chars but carries the wrong value → exit 0, { valid: false }.
  // Correct format, wrong content. verify() must return false (not throw or error out).
  it("[VG-3] gate_sig 64 chars but wrong value (corrupted) → exit 0, { valid: false }", () => {
    const baseDir = makeTempDir();
    // All-zeros is 64 chars of valid hex but will never match a real HMAC.
    const input = baseVerifyInput(baseDir, {
      gate_sig: "0".repeat(64),
    });

    const { exitCode, stdout } = runCli("verify-gate", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result["valid"]).toBe(false);
  });

  // [VG-4] Missing plan_id → exit 1 with JSON error.
  // plan_id is required to reconstruct the canonical payload for verification.
  it("[VG-4] missing plan_id → exit 1, JSON error", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      // plan_id intentionally absent
      task_id: "task-vg-test-001",
      actor_id: "SYSTEM",
      verdict: "PASS",
      ts: "2026-06-28T00:00:00.000Z",
      seq: 1,
      gate_sig: "a".repeat(64),
      baseDir,
    });

    const { exitCode, stdout } = runCli("verify-gate", input);

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result).toHaveProperty("error");
    expect(result["error"]).toMatch(/plan_id/i);
  });

  // [VG-5] Missing task_id → exit 1 with JSON error.
  // task_id is part of the signed payload; without it the canonical string cannot be built.
  it("[VG-5] missing task_id → exit 1, JSON error", () => {
    const baseDir = makeTempDir();
    const input = JSON.stringify({
      plan_id: "plan-vg-test-001",
      // task_id intentionally absent
      actor_id: "SYSTEM",
      verdict: "PASS",
      ts: "2026-06-28T00:00:00.000Z",
      seq: 1,
      gate_sig: "a".repeat(64),
      baseDir,
    });

    const { exitCode, stdout } = runCli("verify-gate", input);

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result).toHaveProperty("error");
    expect(result["error"]).toMatch(/task_id/i);
  });
});

// =============================================================================
// BOUNDARY — edge cases around the verification path
// =============================================================================

describe("verify-gate: BOUNDARY", () => {
  // [VG-6] All fields present and gate_sig is the valid HMAC for the payload → exit 0, { valid: true }.
  // Synthesize a signature directly via HmacSigner to bypass needing a prior evaluate-gate call.
  // This tests the verifier independently of the signer path in teo-run-entry.ts.
  //
  // Implementation note for dev: this test imports HmacSigner directly. If the module
  // path changes, update this import. The test intentionally bypasses the CLI signing
  // path to isolate verify-gate behavior.
  it("[VG-6] all fields present, gate_sig is valid signature for the payload → exit 0, { valid: true }", async () => {
    const baseDir = makeTempDir();

    // Import HmacSigner directly to synthesize the correct signature
    const { HmacSigner } = await import("../core/sign.js");
    const signer = new HmacSigner({ baseDir });

    const payload = {
      plan_id: "plan-vg-test-001",
      task_id: "task-vg-test-001",
      actor_id: "SYSTEM",
      verdict: "PASS" as const,
      ts: "2026-06-28T12:00:00.000Z",
      seq: 1,
      content_hash: null,
    };
    const gate_sig = signer.sign(payload);
    expect(gate_sig).toHaveLength(64); // sanity: signature is well-formed

    const input = JSON.stringify({
      plan_id: payload.plan_id,
      task_id: payload.task_id,
      actor_id: payload.actor_id,
      verdict: payload.verdict,
      ts: payload.ts,
      seq: payload.seq,
      gate_sig,
      baseDir,
    });

    const { exitCode, stdout } = runCli("verify-gate", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result["valid"]).toBe(true);
    expect(result["plan_id"]).toBe(payload.plan_id);
    expect(result["task_id"]).toBe(payload.task_id);
    expect(result["verdict"]).toBe(payload.verdict);
    expect(result["seq"]).toBe(payload.seq);
  });

  // [VG-7] All fields present, verdict tampered after signing → exit 0, { valid: false }.
  // The canonical payload uses the provided verdict. If an attacker changes verdict from
  // PASS to FAIL after signing, the reconstructed canonical will differ → verify returns false.
  it("[VG-7] verdict tampered (was PASS, now FAIL in verify call) → exit 0, { valid: false }", async () => {
    const baseDir = makeTempDir();

    const { HmacSigner } = await import("../core/sign.js");
    const signer = new HmacSigner({ baseDir });

    // Sign with the original PASS verdict
    const originalPayload = {
      plan_id: "plan-vg-tamper-001",
      task_id: "task-vg-tamper-001",
      actor_id: "SYSTEM",
      verdict: "PASS" as const,
      ts: "2026-06-28T12:00:00.000Z",
      seq: 2,
      content_hash: null,
    };
    const gate_sig = signer.sign(originalPayload);

    // Present FAIL verdict to verify-gate — tampered from the signed PASS
    const input = JSON.stringify({
      plan_id: originalPayload.plan_id,
      task_id: originalPayload.task_id,
      actor_id: originalPayload.actor_id,
      verdict: "FAIL", // tampered — was PASS at sign time
      ts: originalPayload.ts,
      seq: originalPayload.seq,
      gate_sig,
      baseDir,
    });

    const { exitCode, stdout } = runCli("verify-gate", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result["valid"]).toBe(false);
  });
});

// =============================================================================
// GOLDEN PATH — full round-trip through the CLI
// =============================================================================

describe("verify-gate: GOLDEN PATH", () => {
  // [VG-8] Full round-trip: call evaluate-gate (with plan_id) then verify-gate using
  // the returned gate_sig → valid: true.
  //
  // This is the only test that chains two CLI invocations. It requires:
  //   1. evaluate-gate produces a gate_sig (HMAC signing wired)
  //   2. verify-gate accepts that gate_sig with the same baseDir and returns valid: true
  //
  // The same baseDir must be used for both calls so the key file (keyring) is shared.
  it("[VG-8] evaluate-gate → verify-gate round-trip with returned gate_sig → valid: true", () => {
    const baseDir = makeTempDir();
    const sessionId = "session-vg-roundtrip-001";

    // Step 1: call evaluate-gate with plan_id to trigger HMAC signing
    const { exitCode: evalExit, result } = runEvaluateGateWithSign(baseDir, sessionId);

    // evaluate-gate with a valid ac.json should exit 0 (PASS verdict)
    expect(evalExit).toBe(0);

    // gate_sig must be present and 64 chars — Change 1 is implemented
    const gate_sig = result["gate_sig"];
    expect(typeof gate_sig).toBe("string");
    expect((gate_sig as string).length).toBe(64);

    // Extract fields assigned by the ledger (ts and seq are set at write time)
    const ts = result["ts"] as string | undefined;
    const seq = result["ledger_seq"] as number | undefined;
    const task_id = result["task_id"] as string;
    const verdict = result["verdict"] as string;

    expect(typeof ts).toBe("string");
    expect(typeof seq).toBe("number");

    // Step 2: verify-gate using the gate_sig returned by evaluate-gate
    const verifyInput = JSON.stringify({
      plan_id: "plan-vg-test-001",
      task_id,
      actor_id: "SYSTEM",
      verdict,
      ts,
      seq,
      gate_sig,
      baseDir,
    });

    const { exitCode: verifyExit, stdout: verifyStdout } = runCli("verify-gate", verifyInput);

    expect(verifyExit).toBe(0);
    const verifyResult = verifyStdout as Record<string, unknown>;
    expect(verifyResult["valid"]).toBe(true);
    expect(verifyResult["plan_id"]).toBe("plan-vg-test-001");
    expect(verifyResult["task_id"]).toBe(task_id);
    expect(verifyResult["verdict"]).toBe(verdict);
    expect(verifyResult["seq"]).toBe(seq);
  });
});
