// =============================================================================
// evaluate-gate-cli.test.ts — WS-02: evaluate-gate CLI command integration tests
//
// STATUS: PASSING — evaluate-gate command implemented in teo-run-entry.ts (WS-02)
//
// CONTRACT (CLI arg protocol):
//   node bin/teo-run.js evaluate-gate '<json-string>'
//   - Returns JSON on stdout
//   - Exits 0 on success, non-zero on error
//
// INPUT CONTRACT:
//   {
//     gate_id: string;        // gate identifier
//     task_id: string;        // task being gated
//     session_id: string;     // session context
//     gate_type: string;      // gate profile type (e.g. "qa-spec", "dev", "staff-review")
//     context?: Record<string, unknown>; // optional extra context
//   }
//
// OUTPUT CONTRACT:
//   {
//     gate_id: string;
//     task_id: string;
//     session_id: string;
//     verdict: "PASS";              // always PASS for now (stub)
//     status: "UNENFORCED_MOCK";   // L7 MANDATORY — stub gates MUST emit this
//     evaluated_at: string;         // ISO-8601 timestamp
//     gate_type: string;
//     ledger_seq: number;           // seq from ledger.append()
//   }
//
// CRITICAL L7 AMENDMENT: Stub gates MUST emit status: "UNENFORCED_MOCK".
//   This distinguishes a mock gate from a real passing gate.
//   The verdict field says "PASS" but status: "UNENFORCED_MOCK" is mandatory.
//   This prevents false-compliance during the WS-02–WS-05 transition window.
//
// Ordering: misuse → boundary → golden path (ADR-064 adversarial-first policy)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// CLI binary / entry point — same resolution strategy as teo-run.test.ts
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

/**
 * Run the CLI and return { exitCode, stdout, stderr }.
 * Parses stdout as JSON if possible; otherwise returns the raw string.
 */
function runCli(
  command: string,
  jsonArg: string,
  extraEnv?: Record<string, string>
): { exitCode: number; stdout: unknown; stdoutRaw: string; stderr: string } {
  const { cmd, args } = buildCliArgs(command, jsonArg);
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 15000,
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "teo-eval-gate-test-"));
  tempDirs.push(d);
  return d;
}

beforeEach(() => {
  // No shared setup needed — each test configures its own state
});

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore — test may have already cleaned up
    }
  }
});

// ---------------------------------------------------------------------------
// Minimal valid evaluate-gate input
// ---------------------------------------------------------------------------

const VALID_INPUT = {
  gate_id: "gate-qa-spec-001",
  task_id: "task-ws02-001",
  session_id: "session-ws02-001",
  gate_type: "qa-spec",
};

// =============================================================================
// MISUSE: Missing required fields and malformed input
// =============================================================================

describe("evaluate-gate CLI — misuse: missing required fields and malformed input", () => {
  // Misuse 1: missing gate_id → exit 1, JSON error
  it("M1. evaluate-gate with missing gate_id → exit 1, JSON error", () => {
    const input = JSON.stringify({
      // gate_id intentionally absent
      task_id: "task-001",
      session_id: "session-001",
      gate_type: "qa-spec",
    });

    const { exitCode, stdout } = runCli("evaluate-gate", input);

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result).toHaveProperty("error");
  });

  // Misuse 2: missing task_id → exit 1, JSON error
  it("M2. evaluate-gate with missing task_id → exit 1, JSON error", () => {
    const input = JSON.stringify({
      gate_id: "gate-001",
      // task_id intentionally absent
      session_id: "session-001",
      gate_type: "qa-spec",
    });

    const { exitCode, stdout } = runCli("evaluate-gate", input);

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result).toHaveProperty("error");
  });

  // Misuse 3: missing session_id → exit 1, JSON error
  it("M3. evaluate-gate with missing session_id → exit 1, JSON error", () => {
    const input = JSON.stringify({
      gate_id: "gate-001",
      task_id: "task-001",
      // session_id intentionally absent
      gate_type: "qa-spec",
    });

    const { exitCode, stdout } = runCli("evaluate-gate", input);

    expect(exitCode).toBe(1);
    const result = stdout as Record<string, unknown>;
    expect(result).toHaveProperty("error");
  });

  // Misuse 4: malformed JSON arg → exit 1, JSON error mentioning JSON
  // (already handled by the entrypoint — verify it applies to evaluate-gate too)
  it("M4. evaluate-gate with malformed JSON arg → exit 1, error mentioning 'JSON'", () => {
    const { exitCode, stdout } = runCli("evaluate-gate", "not-valid-json{{{");

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({
      error: expect.stringMatching(/json/i),
    });
  });
});

// =============================================================================
// BOUNDARY: Edge cases
// =============================================================================

describe("evaluate-gate CLI — boundary: edge cases", () => {
  // Boundary 5: minimal valid input (no context field) → exit 0, valid output shape
  it("B5. evaluate-gate with minimal valid input (no context) → exit 0, valid output shape", () => {
    const ledgerBase = makeTempDir();
    const input = JSON.stringify({
      ...VALID_INPUT,
      session_id: "session-b5-no-context",
      ledger_base_dir: ledgerBase,
    });

    const { exitCode, stdout } = runCli("evaluate-gate", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result).toHaveProperty("gate_id");
    expect(result).toHaveProperty("task_id");
    expect(result).toHaveProperty("session_id");
    expect(result).toHaveProperty("verdict");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("evaluated_at");
    expect(result).toHaveProperty("gate_type");
    expect(result).toHaveProperty("ledger_seq");
  });

  // Boundary 6: input with context field → exit 0, output still valid
  it("B6. evaluate-gate with optional context field → exit 0, output still valid", () => {
    const ledgerBase = makeTempDir();
    const input = JSON.stringify({
      ...VALID_INPUT,
      session_id: "session-b6-with-context",
      ledger_base_dir: ledgerBase,
      context: {
        workstream: "ws-02",
        phase: "qa-spec",
        notes: "boundary test with context",
      },
    });

    const { exitCode, stdout } = runCli("evaluate-gate", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result).toHaveProperty("gate_id");
    expect(result).toHaveProperty("verdict");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("ledger_seq");
  });
});

// =============================================================================
// GOLDEN PATH: Full valid input, L7 enforcement, field correctness
// =============================================================================

describe("evaluate-gate CLI — golden path: full output contract and L7 enforcement", () => {
  // Golden path 7: full valid input → all required output fields present and correct
  it("G7. evaluate-gate with full valid input → exit 0, all output fields match input and contract", () => {
    const ledgerBase = makeTempDir();
    const inputObj = {
      gate_id: "gate-golden-001",
      task_id: "task-golden-001",
      session_id: "session-golden-001",
      gate_type: "staff-review",
      context: { reviewer: "staff-engineer", iteration: 1 },
      ledger_base_dir: ledgerBase,
    };

    const { exitCode, stdout } = runCli("evaluate-gate", JSON.stringify(inputObj));

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;

    // Fields must echo back input values
    expect(result["gate_id"]).toBe(inputObj.gate_id);
    expect(result["task_id"]).toBe(inputObj.task_id);
    expect(result["session_id"]).toBe(inputObj.session_id);
    expect(result["gate_type"]).toBe(inputObj.gate_type);

    // Verdict must be "PASS" (stub)
    expect(result["verdict"]).toBe("PASS");

    // L7 MANDATORY: status must be "UNENFORCED_MOCK"
    expect(result["status"]).toBe("UNENFORCED_MOCK");

    // evaluated_at must be a valid ISO-8601 string
    expect(typeof result["evaluated_at"]).toBe("string");
    const ts = new Date(result["evaluated_at"] as string);
    expect(isNaN(ts.getTime())).toBe(false);

    // ledger_seq must be a positive number
    expect(typeof result["ledger_seq"]).toBe("number");
    expect(result["ledger_seq"] as number).toBeGreaterThanOrEqual(1);
  });

  // Golden path 8: critical L7 enforcement — status MUST be "UNENFORCED_MOCK", NOT absent or "PASS"
  it("G8. evaluate-gate status is 'UNENFORCED_MOCK' — not absent, not 'PASS' alone (L7 critical)", () => {
    const ledgerBase = makeTempDir();
    const input = JSON.stringify({
      gate_id: "gate-l7-check-001",
      task_id: "task-l7-001",
      session_id: "session-l7-001",
      gate_type: "dev",
      ledger_base_dir: ledgerBase,
    });

    const { exitCode, stdout } = runCli("evaluate-gate", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;

    // The L7 critical assertion: status MUST be exactly "UNENFORCED_MOCK"
    expect(result["status"]).toBe("UNENFORCED_MOCK");

    // Defensive: status must NOT be absent
    expect(result["status"]).toBeDefined();

    // Defensive: status must NOT be equal to verdict (would mean the field is wrong)
    expect(result["status"]).not.toBe("PASS");

    // verdict is allowed to be "PASS" — that's the stub verdict
    expect(result["verdict"]).toBe("PASS");
  });

  // Golden path 9: evaluated_at is a valid ISO-8601 date string
  it("G9. evaluate-gate evaluated_at is a valid ISO-8601 date string", () => {
    const ledgerBase = makeTempDir();
    const input = JSON.stringify({
      gate_id: "gate-ts-001",
      task_id: "task-ts-001",
      session_id: "session-ts-001",
      gate_type: "qa-spec",
      ledger_base_dir: ledgerBase,
    });

    const before = new Date();
    const { exitCode, stdout } = runCli("evaluate-gate", input);
    const after = new Date();

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;

    expect(typeof result["evaluated_at"]).toBe("string");

    const ts = new Date(result["evaluated_at"] as string);

    // Must parse as a valid date
    expect(isNaN(ts.getTime())).toBe(false);

    // Must fall within the window of the test execution
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);

    // Must match ISO-8601 format (includes 'T' and 'Z' or offset)
    expect(result["evaluated_at"] as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
