// =============================================================================
// teo-run-artifact.test.ts — WS-00: validate-artifact CLI command integration tests
//
// STATUS: PASSING — validate-artifact CLI implemented.
// These tests specify the CLI contract that dev must add.
//
// CONTRACT (CLI arg protocol):
//   node bin/teo-run.js validate-artifact '<json-string>'
//   Input JSON: { type: string, payload: unknown, strict?: boolean }
//   Output: { valid: boolean } or { valid: false, errors: string[] }
//   Exit code: 0 always (validation failures are NOT exit-code errors)
//
// COMMANDS TESTED:
//   validate-artifact — validates artifact payload against registered type schema
//
// Ordering: misuse → boundary → golden path (ADR-064 adversarial-first policy)
// =============================================================================

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// CLI binary / entry point (mirrors teo-run.test.ts pattern)
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
  jsonArg: string
): { exitCode: number; stdout: unknown; stdoutRaw: string; stderr: string } {
  const { cmd, args } = buildCliArgs(command, jsonArg);
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env },
  });

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const stdoutRaw = result.stdout ?? "";
  let stdout: unknown = stdoutRaw;
  try {
    stdout = JSON.parse(stdoutRaw.trim());
  } catch {
    // not JSON — keep raw string
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
// Shared fixtures
// ---------------------------------------------------------------------------

const VALID_GATE_RESULT = {
  task_id: "task-1",
  gate_name: "coverage",
  verdict: "PASS",
  timestamp: "2026-06-20T00:00:00.000Z",
};

const VALID_PLAN_PAYLOAD = {
  plan_id: "test-plan-1",
  project_id: "test-project",
  created_at: "2026-06-20T00:00:00.000Z",
  version: "1",
  tasks: [
    {
      id: "task-1",
      type: "SCRIPT",
      command: "echo hello",
      needs: [],
      gates: [],
    },
  ],
};

// =============================================================================
// MISUSE: validate-artifact CLI — wrong / unexpected inputs
// =============================================================================

describe("teo-run validate-artifact CLI — misuse", () => {
  // CLI-M1: unknown artifact type → exit 0, { valid: false } (not an exit-code error)
  it("CLI-M1. unknown type 'BOGUS_ARTIFACT' → exit 0, { valid: false, errors: [...] }", () => {
    const input = JSON.stringify({ type: "BOGUS_ARTIFACT", payload: {} });
    const { exitCode, stdout } = runCli("validate-artifact", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({
      valid: false,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      errors: expect.arrayContaining([expect.stringMatching(/unknown artifact type/i)]),
    });
  });

  // CLI-M2: malformed JSON arg (trailing comma) → repair runs, does NOT throw,
  // returns { valid: boolean } — NOT exit code 1 with JSON parse error
  it("CLI-M2. malformed JSON arg with trailing comma → repair step runs, returns { valid: boolean }, exit 0", () => {
    // The CLI receives a raw JSON arg with a trailing comma in the payload.
    // The validate-artifact handler must run repairJson() before Zod parsing.
    const rawArg =
      '{"type": "GATE_RESULT_ARTIFACT", "payload": {"task_id": "t1", "gate_name": "cov", "verdict": "PASS", "timestamp": "2026-06-20T00:00:00.000Z",}}';

    const { exitCode, stdout } = runCli("validate-artifact", rawArg);

    // Must exit 0 (repair + valid parse → { valid: true })
    expect(exitCode).toBe(0);
    // Result must be a valid JSON object with a boolean `valid` field
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    expect(stdout).toMatchObject({ valid: expect.any(Boolean) });
  });

  // CLI-M3: completely unparseable payload even after repair → exit 0,
  // { valid: false, errors: [mentions JSON parse error after repair] }
  it("CLI-M3. completely unparseable payload after repair → exit 0, { valid: false, errors: [repair error] }", () => {
    // Outer arg is valid JSON (so the CLI arg parser works), but payload field
    // contains garbage that repairJson cannot fix.
    const input = JSON.stringify({
      type: "GATE_RESULT_ARTIFACT",
      payload: "%%%garbage%%%that%%%cannot%%%repair",
    });

    const { exitCode, stdout } = runCli("validate-artifact", input);

    // Must exit 0 (validation failures are not CLI errors)
    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result["valid"]).toBe(false);
    // errors must reference the parse/repair failure
    const errors = result["errors"] as string[] | undefined;
    expect(errors).toBeDefined();
    expect(errors!.some((e) => /json|parse|repair/i.test(e))).toBe(true);
  });

  // CLI-M4: GATE_RESULT_ARTIFACT missing task_id → exit 0, { valid: false }
  it("CLI-M4. GATE_RESULT_ARTIFACT missing task_id → exit 0, { valid: false, errors: [...] }", () => {
    const input = JSON.stringify({
      type: "GATE_RESULT_ARTIFACT",
      payload: { gate_name: "coverage", verdict: "PASS", timestamp: "2026-06-20T00:00:00.000Z" },
    });
    const { exitCode, stdout } = runCli("validate-artifact", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({
      valid: false,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      errors: expect.arrayContaining([expect.anything()]),
    });
  });

  // CLI-M5: GATE_RESULT_ARTIFACT with verdict "UNENFORCED_MOCK" → exit 0, { valid: true }
  // CRITICAL: UNENFORCED_MOCK is a legal verdict — must NOT be rejected.
  it("CLI-M5. GATE_RESULT_ARTIFACT verdict 'UNENFORCED_MOCK' → exit 0, { valid: true }", () => {
    const input = JSON.stringify({
      type: "GATE_RESULT_ARTIFACT",
      payload: {
        task_id: "task-1",
        gate_name: "coverage",
        verdict: "UNENFORCED_MOCK",
        timestamp: "2026-06-20T00:00:00.000Z",
      },
    });
    const { exitCode, stdout } = runCli("validate-artifact", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ valid: true });
  });
});

// =============================================================================
// BOUNDARY: validate-artifact CLI — edge cases
// =============================================================================

describe("teo-run validate-artifact CLI — boundary", () => {
  // CLI-B1: PLAN_ARTIFACT wrapping a valid plan → exit 0, { valid: true }
  it("CLI-B1. PLAN_ARTIFACT with valid plan → exit 0, { valid: true }", () => {
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload: VALID_PLAN_PAYLOAD });
    const { exitCode, stdout } = runCli("validate-artifact", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ valid: true });
  });

  // CLI-B2: PLAN_ARTIFACT with invalid plan (missing plan_id) → exit 0, { valid: false, errors: [...] }
  it("CLI-B2. PLAN_ARTIFACT with plan missing plan_id → exit 0, { valid: false, errors: [...] }", () => {
    const badPlan = {
      project_id: "proj",
      created_at: "2026-06-20T00:00:00.000Z",
      version: "1",
      tasks: [{ id: "t1", type: "SCRIPT", command: "echo", needs: [], gates: [] }],
    };
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload: badPlan });
    const { exitCode, stdout } = runCli("validate-artifact", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({
      valid: false,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      errors: expect.arrayContaining([expect.anything()]),
    });
  });

  // CLI-B3: strict: true with extra field → exit 0, { valid: false }
  it("CLI-B3. strict: true + GATE_RESULT_ARTIFACT with extra field → exit 0, { valid: false }", () => {
    const input = JSON.stringify({
      type: "GATE_RESULT_ARTIFACT",
      payload: { ...VALID_GATE_RESULT, extra_field: "bad" },
      strict: true,
    });
    const { exitCode, stdout } = runCli("validate-artifact", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ valid: false });
  });
});

// =============================================================================
// GOLDEN PATH: validate-artifact CLI — full round-trip
// =============================================================================

describe("teo-run validate-artifact CLI — golden path", () => {
  // CLI-G1: valid GATE_RESULT_ARTIFACT → exit 0, { valid: true }
  it("CLI-G1. valid GATE_RESULT_ARTIFACT → exit 0, { valid: true }", () => {
    const input = JSON.stringify({ type: "GATE_RESULT_ARTIFACT", payload: VALID_GATE_RESULT });
    const { exitCode, stdout } = runCli("validate-artifact", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ valid: true });
  });

  // CLI-G2: valid STEP_RESULT_ARTIFACT → exit 0, { valid: true }
  it("CLI-G2. valid STEP_RESULT_ARTIFACT → exit 0, { valid: true }", () => {
    const input = JSON.stringify({
      type: "STEP_RESULT_ARTIFACT",
      payload: { task_id: "task-1", status: "COMPLETED", timestamp: "2026-06-20T00:00:00.000Z" },
    });
    const { exitCode, stdout } = runCli("validate-artifact", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ valid: true });
  });

  // CLI-G3: stdout must always be parseable JSON, even on validation failure
  it("CLI-G3. stdout is always parseable JSON regardless of validation result", () => {
    const input = JSON.stringify({ type: "BOGUS", payload: {} });
    const { stdoutRaw } = runCli("validate-artifact", input);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    expect(() => JSON.parse(stdoutRaw.trim())).not.toThrow();
  });
});
