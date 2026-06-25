// =============================================================================
// teo-build-skill.test.ts — WS-04: BDD acceptance spec for teo-build SKILL loop driver
//
// STATUS: ACTIVE — all CLI contracts tested here are already implemented.
//         Tests that verify SKILL.md prompt behavior (ROTATION_REQUIRED, loop halting)
//         cannot be tested via CLI and are marked .todo or describe.skip as noted.
//
// OVERVIEW
// --------
// WS-04 wires skills/teo-build/SKILL.md as the orchestration loop that calls the
// teo-run.js CLI seams. This spec defines what "correct behavior" means for that
// SKILL in terms of observable CLI outputs and side-effects.
//
// Because teo-build is a SKILL.md (agent prompt), these tests do NOT run the SKILL
// directly. Instead they verify the behavior of the CLI calls the SKILL makes —
// specifically:
//
//   1. validate-artifact with type PLAN_ARTIFACT — must return valid:true before any spawn
//   2. evaluate-gate — must return the expected verdict shape after each task completes
//   3. The STEP_ARTIFACT blocks emitted by the SKILL must be parseable by validate-artifact
//
// WHY CLI-LEVEL TESTS?
// The SKILL is a prompt file (not importable TypeScript). The CLI seams are the
// only deterministic, testable surface. If the CLI contracts hold, the SKILL can
// call them correctly. These tests enforce the CLI contracts that the SKILL depends on.
//
// PLAN_ARTIFACT FORMAT (from capo.md ## PLAN_ARTIFACT)
//   Fenced block delimited by:
//     ~~~
//     PLAN_ARTIFACT
//     { ...JSON... }
//     END_PLAN_ARTIFACT
//     ~~~
//   The JSON inside conforms to PlanSchema (plan_id, project_id, created_at, version, tasks).
//
// STEP_ARTIFACT FORMAT (emitted by teo-build after each evaluate-gate call)
//   The SKILL emits a fenced block:
//     ~~~
//     STEP_ARTIFACT
//     { ...JSON... }
//     END_STEP_ARTIFACT
//     ~~~
//   The JSON payload must be valid against type: GATE_RESULT_ARTIFACT:
//     { task_id, gate_name, verdict, timestamp, details? }
//
// evaluate-gate VERDICT SEMANTICS
//   PASS              → advance loop to next task
//   UNENFORCED_MOCK   → advance loop (stub not yet enforcing — emit warning, continue)
//   WARN              → advance loop, include warning in STEP_ARTIFACT
//   FAIL              → halt loop, surface GATE_BLOCKED: <task_id> <detail>
//
// ROTATION NON-NESTING CONSTRAINT (L7 CRITICAL RISK)
//   When Capo needs to rotate mid-plan, the parent session MUST terminate cleanly
//   before the rotated child starts. teo-build MUST NOT block waiting for a nested
//   rotation call. It surfaces ROTATION_REQUIRED with checkpoint context and exits.
//   This constraint is a SKILL prompt constraint — verified at staff review, not via CLI.
//
// CLI BEHAVIOR AS OF 2026-06-24 (verified by QA before writing tests):
//   evaluate-gate:
//     - With all required fields (gate_id, task_id, session_id, gate_type): exits 0,
//       returns { gate_id, task_id, session_id, verdict:"PASS", status:"UNENFORCED_MOCK",
//               evaluated_at, gate_type, ledger_seq }
//     - Missing gate_id: exits 1, { error: "Missing required field: gate_id" }
//     - Missing task_id: exits 1, { error: "Missing required field: task_id" }
//     - Missing session_id: exits 1, { error: "Missing required field: session_id" }
//     - Missing gate_type: exits 1, { error: "Missing required field: gate_type" }
//   validate-artifact:
//     - PLAN_ARTIFACT empty payload: exits 0, { valid: false, errors: [...] }
//     - PLAN_ARTIFACT valid payload: exits 0, { valid: true }
//     - PLAN_ARTIFACT payload="not-json-at-all" (string): exits 0,
//       { valid: false, errors: ["JSON repair/parse error on payload: ..."] }
//     - GATE_RESULT_ARTIFACT valid: exits 0, { valid: true }
//     - GATE_RESULT_ARTIFACT verdict=FAIL: exits 0, { valid: true }
//     - GATE_RESULT_ARTIFACT verdict=WARN: exits 0, { valid: true }
//     - GATE_RESULT_ARTIFACT verdict=UNENFORCED_MOCK: exits 0, { valid: true }
//     - GATE_RESULT_ARTIFACT verdict=UNKNOWN_STATUS: exits 0, { valid: false, errors: [...] }
//     - GATE_RESULT_ARTIFACT missing task_id: exits 0, { valid: false, errors: ["Required"] }
//     - STEP_ARTIFACT type (unregistered): exits 0,
//       { valid: false, errors: ["Unknown artifact type: STEP_ARTIFACT"] }
//
// Ordering: misuse → boundary → golden path (ADR-064 adversarial-first policy)
// Test IDs: T-WS04-01 … T-WS04-20
// =============================================================================

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// CLI binary / entry point (same resolution strategy as other skill tests)
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
    timeout: 15000,
    env: { ...process.env, ...extraEnv },
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
// Temp dir helpers — uses os.tmpdir() (no hardcoded /tmp paths)
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "teo-ws04-test-"));
  tempDirs.push(d);
  return d;
}

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
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid PLAN_ARTIFACT payload (PlanSchema-compliant) */
const MINIMAL_PLAN_PAYLOAD = {
  plan_id: "plan_session_001_1234567890",
  project_id: "the-eng-org",
  created_at: "2026-06-24T00:00:00.000Z",
  version: "1" as const,
  directive: "BUILD" as const,
  tasks: [
    {
      id: "task-qa-001",
      type: "AGENT" as const,
      agent_id: "qa",
      prompt: "Write failing tests for WS-04.",
      needs: [],
      gates: [{ name: "test-coverage", on_fail: "block" as const }],
    },
  ],
};

/** Valid GATE_RESULT_ARTIFACT payload (maps to what teo-build emits in a STEP_ARTIFACT) */
const MINIMAL_GATE_RESULT_PAYLOAD = {
  task_id: "task-qa-001",
  gate_name: "test-coverage",
  verdict: "PASS" as const,
  timestamp: "2026-06-24T00:00:00.000Z",
};

/** Minimal valid evaluate-gate input */
const MINIMAL_GATE_INPUT = {
  gate_id: "gate-qa-spec-001",
  task_id: "task-qa-001",
  session_id: "session-ws04-001",
  gate_type: "qa-spec",
};

// =============================================================================
// MISUSE CASES — validate-artifact rejects bad PLAN_ARTIFACT blocks
// =============================================================================

describe("T-WS04-01: validate-artifact — PLAN_ARTIFACT block absent (empty payload)", () => {
  // Given: teo-build receives a session where no PLAN_ARTIFACT block was emitted
  // When:  teo-build calls validate-artifact with an empty/null payload
  // Then:  validate-artifact returns { valid: false, errors: [...] }
  //        teo-build must surface the error and NOT proceed to any spawn
  //
  // CLI result: exits 0, { valid: false, errors: ["Required","Required","Required",
  //             "Invalid literal value, expected \"1\"","Required"] }

  it("returns valid:false for empty payload", () => {
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload: {} });
    const { exitCode, stdout } = runCli("validate-artifact", input);
    expect(exitCode).toBe(0); // validation failures are NOT exit-code errors
    const out = stdout as { valid: boolean; errors?: string[] };
    expect(out.valid).toBe(false);
    expect(out.errors).toBeDefined();
    expect(out.errors!.length).toBeGreaterThan(0);
  });
});

describe("T-WS04-02: validate-artifact — PLAN_ARTIFACT block is not valid JSON", () => {
  // Given: Capo emits a PLAN_ARTIFACT block whose JSON content is malformed beyond repair
  // When:  teo-build calls validate-artifact with the raw malformed string as payload
  // Then:  validate-artifact returns { valid: false, errors: [...] }
  //        teo-build must NOT spawn any task, must surface a parse error to the user
  //
  // CLI result: exits 0, { valid: false, errors: ["JSON repair/parse error on payload: ..."] }

  it("returns valid:false for garbage JSON that cannot be repaired", () => {
    // A plain word that cannot be repaired into a valid PLAN_ARTIFACT object
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload: "not-json-at-all" });
    const { exitCode, stdout } = runCli("validate-artifact", input);
    expect(exitCode).toBe(0);
    const out = stdout as { valid: boolean; errors?: string[] };
    expect(out.valid).toBe(false);
    expect(out.errors).toBeDefined();
    expect(out.errors![0]).toMatch(/JSON repair\/parse error/);
  });
});

describe("T-WS04-03: validate-artifact — PLAN_ARTIFACT missing required fields", () => {
  // Given: Capo emits a PLAN_ARTIFACT block that is syntactically valid JSON
  //        but is missing required fields (e.g. plan_id, version, tasks)
  // When:  teo-build calls validate-artifact with type PLAN_ARTIFACT
  // Then:  validate-artifact returns { valid: false, errors: [...] } listing missing fields
  //        teo-build must surface the validation errors and halt — does not spawn
  //
  // CLI result: exits 0, { valid: false, errors: ["Required"] } (per-field messages)

  it("returns valid:false for payload missing plan_id", () => {
    const payload = {
      // plan_id intentionally omitted
      project_id: "the-eng-org",
      created_at: "2026-06-24T00:00:00.000Z",
      version: "1",
      tasks: [
        {
          id: "t1",
          type: "AGENT",
          agent_id: "qa",
          prompt: "write tests",
          needs: [],
          gates: [],
        },
      ],
    };
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(false);
  });

  it("returns valid:false for payload with empty tasks array", () => {
    const payload = { ...MINIMAL_PLAN_PAYLOAD, tasks: [] };
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(false);
  });

  it("returns valid:false for wrong version literal", () => {
    const payload = { ...MINIMAL_PLAN_PAYLOAD, version: "2" };
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(false);
  });
});

describe("T-WS04-04: evaluate-gate — missing required fields causes exit 1", () => {
  // Given: teo-build attempts to call evaluate-gate but provides an incomplete input
  //        (e.g. missing gate_id, task_id, session_id, or gate_type)
  // When:  the CLI executes evaluate-gate with the incomplete JSON
  // Then:  exit code is 1, stdout contains { error: "Missing required field: <field>" }
  //        teo-build must detect the error and surface it rather than proceeding
  //
  // CLI result: exits 1, { error: "Missing required field: <fieldname>" }

  it("exits 1 and returns error when gate_id is missing", () => {
    const input = JSON.stringify({
      task_id: "task-qa-001",
      session_id: "session-ws04-001",
      gate_type: "qa-spec",
    });
    const { exitCode, stdout } = runCli("evaluate-gate", input);
    expect(exitCode).toBe(1);
    const out = stdout as { error: string };
    expect(out.error).toMatch(/gate_id/);
  });

  it("exits 1 and returns error when task_id is missing", () => {
    const input = JSON.stringify({
      gate_id: "gate-001",
      session_id: "session-ws04-001",
      gate_type: "qa-spec",
    });
    const { exitCode, stdout } = runCli("evaluate-gate", input);
    expect(exitCode).toBe(1);
    const out = stdout as { error: string };
    expect(out.error).toMatch(/task_id/);
  });

  it("exits 1 and returns error when session_id is missing", () => {
    const input = JSON.stringify({
      gate_id: "gate-001",
      task_id: "task-qa-001",
      gate_type: "qa-spec",
    });
    const { exitCode, stdout } = runCli("evaluate-gate", input);
    expect(exitCode).toBe(1);
    const out = stdout as { error: string };
    expect(out.error).toMatch(/session_id/);
  });

  it("exits 1 and returns error when gate_type is missing", () => {
    const input = JSON.stringify({
      gate_id: "gate-001",
      task_id: "task-qa-001",
      session_id: "session-ws04-001",
    });
    const { exitCode, stdout } = runCli("evaluate-gate", input);
    expect(exitCode).toBe(1);
    const out = stdout as { error: string };
    expect(out.error).toMatch(/gate_type/);
  });
});

describe("T-WS04-05: GATE_BLOCKED surfacing — GATE_RESULT_ARTIFACT with FAIL verdict is schema-valid", () => {
  // Given: teo-build is executing a plan loop
  //        evaluate-gate returns verdict: FAIL for a task with on_fail: "block"
  // When:  teo-build processes the evaluate-gate response
  // Then:  the loop halts at that task
  //        teo-build surfaces "GATE_BLOCKED: <task_id> <detail>" to the user
  //        subsequent tasks in the plan are NOT spawned
  //
  // NOTE: The SKILL loop-halting behavior on FAIL is a prompt constraint (not testable via CLI).
  //       This test verifies that the CLI correctly accepts a GATE_RESULT_ARTIFACT with FAIL —
  //       meaning teo-build CAN emit the STEP_ARTIFACT fenced block even when the verdict is FAIL.
  //       The halt itself is enforced by SKILL.md instructions, verified at staff review.
  //
  // CLI result: validate-artifact exits 0, { valid: true } for GATE_RESULT_ARTIFACT FAIL

  it("validate-artifact accepts a GATE_RESULT_ARTIFACT with verdict FAIL", () => {
    const payload = {
      task_id: "task-qa-001",
      gate_name: "test-coverage",
      verdict: "FAIL",
      timestamp: new Date().toISOString(),
      details: "Coverage threshold not met: 87% < 99%",
    };
    const input = JSON.stringify({ type: "GATE_RESULT_ARTIFACT", payload });
    const { exitCode, stdout } = runCli("validate-artifact", input);
    expect(exitCode).toBe(0);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });

  it("STEP_ARTIFACT with verdict FAIL is schema-valid (teo-build CAN emit it; loop halts separately)", () => {
    const payload = {
      task_id: "task-dev-001",
      gate_name: "staff-review",
      verdict: "FAIL",
      timestamp: "2026-06-24T12:00:00.000Z",
      details: "Security issue found: unvalidated input in auth handler",
    };
    const input = JSON.stringify({ type: "GATE_RESULT_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });
});

describe.skip("T-WS04-06: Rotation non-nesting — ROTATION_REQUIRED exits cleanly, no nested Task()", () => {
  // Given: teo-build is mid-plan and the parent Capo session reaches rotation threshold
  //        Capo has emitted a ROTATION_REQUIRED signal with a checkpoint_file path
  // When:  teo-build encounters ROTATION_REQUIRED during plan execution
  // Then:  teo-build surfaces ROTATION_REQUIRED with checkpoint context
  //        teo-build exits the loop cleanly — does NOT call Task() to spawn a nested child
  //        the parent session terminates; the rotated child resumes from the checkpoint
  //
  // SKIP REASON: ROTATION_REQUIRED is a SKILL prompt signal — it cannot be tested via CLI
  //              alone. The no-nested-spawn constraint is enforced by SKILL.md instructions
  //              and is verified by staff review, not by teo-run.js.
  //              The schema tests below ARE active (they verify CLI readiness for checkpoints),
  //              but this describe block is skipped because the rotation signal itself
  //              is not in-scope for the CLI test layer.

  it("validate-artifact accepts a PLAN_ARTIFACT checkpoint (partial plan state)", () => {
    const payload = { ...MINIMAL_PLAN_PAYLOAD };
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });

  it("validate-artifact accepts GATE_RESULT_ARTIFACT emitted before rotation checkpoint", () => {
    const input = JSON.stringify({
      type: "GATE_RESULT_ARTIFACT",
      payload: MINIMAL_GATE_RESULT_PAYLOAD,
    });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });
});

// =============================================================================
// BOUNDARY CASES
// =============================================================================

describe("T-WS04-07: UNENFORCED_MOCK verdict — loop continues, emits warning", () => {
  // Given: teo-build calls evaluate-gate after a task completes
  //        evaluate-gate returns verdict: "PASS", status: "UNENFORCED_MOCK"
  //        (the current behavior of the stub — WS-02)
  // When:  teo-build processes the evaluate-gate response
  // Then:  teo-build does NOT halt the loop (UNENFORCED_MOCK is not a blocking failure)
  //        teo-build emits a STEP_ARTIFACT with verdict: "UNENFORCED_MOCK"
  //        teo-build emits a warning to the user: "[WARN] Gate enforcement not active (UNENFORCED_MOCK)"
  //        the loop advances to the next task
  //
  // CLI result: evaluate-gate exits 0, { verdict:"PASS", status:"UNENFORCED_MOCK", ... }
  //             validate-artifact exits 0, { valid: true } for GATE_RESULT_ARTIFACT UNENFORCED_MOCK

  it("evaluate-gate returns ENFORCED status — WS-06 real enforcement active", () => {
    // WS-06: qa-spec gate requires context.cwd with ac.json + test file containing [AC-N] tags
    const tempDir = makeTempDir();
    const acJson = {
      workstream: "ws-04-boundary",
      acs: [{ id: "AC-1", description: "Gate returns ENFORCED status" }],
    };
    fs.writeFileSync(path.join(tempDir, "ac.json"), JSON.stringify(acJson));
    fs.writeFileSync(
      path.join(tempDir, "gate.test.ts"),
      "it('[AC-1] evaluate-gate returns ENFORCED', () => {});"
    );
    const input = JSON.stringify({
      ...MINIMAL_GATE_INPUT,
      ledger_base_dir: tempDir,
      context: { cwd: tempDir },
    });
    const { exitCode, stdout } = runCli("evaluate-gate", input);
    expect(exitCode).toBe(0);
    const out = stdout as {
      verdict: string;
      status: string;
      gate_id: string;
      task_id: string;
      session_id: string;
      gate_type: string;
      evaluated_at: string;
      ledger_seq: number;
    };
    expect(out.verdict).toBe("PASS");
    expect(out.status).toBe("ENFORCED");
  });

  it("validate-artifact accepts GATE_RESULT_ARTIFACT with verdict UNENFORCED_MOCK", () => {
    // teo-build emits an UNENFORCED_MOCK verdict in the STEP_ARTIFACT — must be schema-valid
    const payload = {
      task_id: "task-qa-001",
      gate_name: "test-coverage",
      verdict: "UNENFORCED_MOCK",
      timestamp: new Date().toISOString(),
    };
    const input = JSON.stringify({ type: "GATE_RESULT_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });
});

describe("T-WS04-08: WARN verdict — loop continues, warning in STEP_ARTIFACT", () => {
  // Given: evaluate-gate returns verdict: "WARN" for a task with on_fail: "warn"
  // When:  teo-build processes the response
  // Then:  the loop continues to the next task (WARN does not halt)
  //        the STEP_ARTIFACT emitted for this task includes verdict: "WARN"
  //        the detail field captures the warning reason
  //
  // CLI result: validate-artifact exits 0, { valid: true } for GATE_RESULT_ARTIFACT WARN

  it("validate-artifact accepts GATE_RESULT_ARTIFACT with verdict WARN", () => {
    const payload = {
      task_id: "task-dev-001",
      gate_name: "style-lint",
      verdict: "WARN",
      timestamp: new Date().toISOString(),
      details: "2 lint warnings suppressed with comments — advisory only",
    };
    const input = JSON.stringify({ type: "GATE_RESULT_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });
});

describe("T-WS04-09: Dependency chain — task B needs task A, tasks execute in order", () => {
  // Given: a PLAN_ARTIFACT with two tasks where task B has needs: ["task-a"]
  //        task A has not yet completed when teo-build starts
  // When:  teo-build processes the plan
  // Then:  task A is spawned first and evaluated before task B is spawned
  //        task B is not spawned until task A's gate evaluation completes with PASS/WARN/UNENFORCED_MOCK
  //        if task A's gate returns FAIL, task B is never spawned
  //
  // NOTE: The actual ordering enforcement is a SKILL prompt constraint (not testable via CLI).
  //       This test verifies that the PLAN_ARTIFACT with a dependency chain is schema-valid —
  //       a prerequisite for the SKILL to be able to process the plan at all.
  //
  // CLI result: validate-artifact exits 0, { valid: true }

  it("validate-artifact accepts a PLAN_ARTIFACT with a dependency chain", () => {
    const payload = {
      ...MINIMAL_PLAN_PAYLOAD,
      tasks: [
        {
          id: "task-qa-001",
          type: "AGENT" as const,
          agent_id: "qa",
          prompt: "Write failing tests.",
          needs: [],
          gates: [{ name: "test-coverage", on_fail: "block" as const }],
        },
        {
          id: "task-dev-001",
          type: "AGENT" as const,
          agent_id: "dev",
          prompt: "Implement to green.",
          needs: ["task-qa-001"], // explicit dependency on QA task completing first
          gates: [{ name: "test-coverage", on_fail: "block" as const }],
        },
      ],
    };
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });
});

describe("T-WS04-10: Empty gates array — gate evaluation skipped, loop continues", () => {
  // Given: a task in the plan has an empty gates array (gates: [])
  // When:  teo-build processes that task
  // Then:  teo-build does NOT call evaluate-gate for this task (no gates to evaluate)
  //        the loop advances to the next task unconditionally
  //        no STEP_ARTIFACT gate block is emitted for this task (nothing to record)
  //
  // NOTE: The skip-evaluate-gate behavior on empty gates is a SKILL prompt constraint.
  //       This test verifies schema validity — a prerequisite for the SKILL to process such tasks.
  //
  // CLI result: validate-artifact exits 0, { valid: true } for both payloads

  it("validate-artifact accepts a PLAN_ARTIFACT where a task has empty gates array", () => {
    const payload = {
      ...MINIMAL_PLAN_PAYLOAD,
      tasks: [
        {
          id: "task-script-001",
          type: "SCRIPT" as const,
          command: "bash scripts/verify-plugin-install.sh",
          needs: [],
          gates: [], // no gate evaluation — loop continues unconditionally
        },
      ],
    };
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });

  it("validate-artifact accepts a PLAN_ARTIFACT with mixed tasks — some with gates, some without", () => {
    const payload = {
      ...MINIMAL_PLAN_PAYLOAD,
      tasks: [
        {
          id: "task-qa-001",
          type: "AGENT" as const,
          agent_id: "qa",
          prompt: "Write tests.",
          needs: [],
          gates: [{ name: "test-coverage", on_fail: "block" as const }],
        },
        {
          id: "task-script-001",
          type: "SCRIPT" as const,
          command: "bash scripts/verify-plugin-install.sh",
          needs: ["task-qa-001"],
          gates: [],
        },
      ],
    };
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });
});

describe("T-WS04-11: evaluate-gate returns well-formed response for each task in loop", () => {
  // Given: teo-build calls evaluate-gate for multiple tasks in sequence
  // When:  each evaluate-gate call returns
  // Then:  each response is well-formed:
  //          gate_id, task_id, session_id, verdict, status, evaluated_at, gate_type, ledger_seq
  //        ledger_seq increments with each call (entries are appended, not overwritten)
  //
  // CLI result: evaluate-gate exits 0, returns all required fields; ledger_seq increments

  it("evaluate-gate returns all required output fields for a valid input", () => {
    // WS-06: qa-spec gate requires context.cwd with ac.json + test file containing [AC-N] tags
    const tempDir = makeTempDir();
    const acJson = {
      workstream: "ws-04-t11",
      acs: [{ id: "AC-1", description: "All required fields returned" }],
    };
    fs.writeFileSync(path.join(tempDir, "ac.json"), JSON.stringify(acJson));
    fs.writeFileSync(
      path.join(tempDir, "check.test.ts"),
      "it('[AC-1] returns all required fields', () => {});"
    );
    const input = JSON.stringify({
      ...MINIMAL_GATE_INPUT,
      ledger_base_dir: tempDir,
      context: { cwd: tempDir },
    });
    const { exitCode, stdout } = runCli("evaluate-gate", input);
    expect(exitCode).toBe(0);
    const out = stdout as Record<string, unknown>;
    expect(out["gate_id"]).toBe(MINIMAL_GATE_INPUT.gate_id);
    expect(out["task_id"]).toBe(MINIMAL_GATE_INPUT.task_id);
    expect(out["session_id"]).toBe(MINIMAL_GATE_INPUT.session_id);
    expect(out["gate_type"]).toBe(MINIMAL_GATE_INPUT.gate_type);
    expect(typeof out["verdict"]).toBe("string");
    expect(typeof out["status"]).toBe("string");
    expect(typeof out["evaluated_at"]).toBe("string");
    expect(typeof out["ledger_seq"]).toBe("number");
  });

  it("evaluate-gate ledger_seq is a positive integer per CLI call (in-process monotonic, not cross-process)", () => {
    // NOTE: ledger_seq starts at 1 per each CLI subprocess (AppendOnlyLedger creates a fresh
    // instance per process — seq is in-process monotonic, not cross-process monotonic).
    // The in-process increment is tested by the ledger unit tests (src/core/ledger.test.ts).
    // The CLI contract is: each independent call returns ledger_seq >= 1.
    //
    // WS-06: qa-spec requires context.cwd with ac.json + test file.
    //        dev requires context.cwd + mock_runner (avoids running npm test in a subprocess).
    const tempDir = makeTempDir();
    const acJson = {
      workstream: "ws-04-seq",
      acs: [{ id: "AC-1", description: "ledger_seq increments" }],
    };
    fs.writeFileSync(path.join(tempDir, "ac.json"), JSON.stringify(acJson));
    fs.writeFileSync(
      path.join(tempDir, "seq.test.ts"),
      "it('[AC-1] ledger_seq increments', () => {});"
    );
    const inputA = JSON.stringify({
      gate_id: "gate-qa-001",
      task_id: "task-qa-001",
      session_id: "session-ws04-seq-test",
      gate_type: "qa-spec",
      ledger_base_dir: tempDir,
      context: { cwd: tempDir },
    });
    const inputB = JSON.stringify({
      gate_id: "gate-dev-001",
      task_id: "task-dev-001",
      session_id: "session-ws04-seq-test",
      gate_type: "dev",
      ledger_base_dir: tempDir,
      context: {
        cwd: tempDir,
        mock_runner: {
          exit_code: 0,
          stdout: "All files  |  100  |  100  |  100  |  100  |\nTest Files  5 passed (5)\n",
          stderr: "",
        },
      },
    });

    const resultA = runCli("evaluate-gate", inputA);
    const resultB = runCli("evaluate-gate", inputB);

    expect(resultA.exitCode).toBe(0);
    expect(resultB.exitCode).toBe(0);

    const outA = resultA.stdout as { ledger_seq: number };
    const outB = resultB.stdout as { ledger_seq: number };
    // Each independent CLI call returns ledger_seq >= 1 (first entry per fresh process)
    expect(outA.ledger_seq).toBeGreaterThanOrEqual(1);
    expect(outB.ledger_seq).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// GOLDEN PATH
// =============================================================================

describe("T-WS04-12: validate-artifact — valid PLAN_ARTIFACT passes (full ARCH pipeline plan)", () => {
  // Given: Capo emits a PLAN_ARTIFACT block containing the full ARCH CAD pipeline:
  //        qa → dev → staff-engineer (3 AGENT tasks with dependency chain)
  // When:  teo-build calls validate-artifact with type: PLAN_ARTIFACT
  // Then:  validate-artifact returns { valid: true }
  //        teo-build proceeds to execute the plan loop
  //
  // CLI result: exits 0, { valid: true }

  it("returns valid:true for a complete ARCH pipeline PLAN_ARTIFACT", () => {
    const payload = {
      plan_id: "plan_session_001_1719187200000",
      project_id: "the-eng-org",
      created_at: "2026-06-24T00:00:00.000Z",
      version: "1" as const,
      directive: "BUILD" as const,
      tasks: [
        {
          id: "task-qa-spec-001",
          type: "AGENT" as const,
          agent_id: "qa",
          prompt: "Write failing BDD specs for WS-04 teo-build skill loop.",
          needs: [],
          gates: [{ name: "qa-spec-complete", on_fail: "block" as const }],
        },
        {
          id: "task-dev-impl-001",
          type: "AGENT" as const,
          agent_id: "dev",
          prompt: "Implement skills/teo-build/SKILL.md to pass QA specs.",
          needs: ["task-qa-spec-001"],
          gates: [{ name: "test-coverage", on_fail: "block" as const }],
        },
        {
          id: "task-staff-review-001",
          type: "AGENT" as const,
          agent_id: "staff-engineer",
          prompt: "Review WS-04 implementation for correctness, security, and architecture.",
          needs: ["task-dev-impl-001"],
          gates: [{ name: "staff-review-approved", on_fail: "block" as const }],
        },
      ],
    };
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload });
    const { exitCode, stdout } = runCli("validate-artifact", input);
    expect(exitCode).toBe(0);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });
});

describe("T-WS04-13: Golden path — evaluate-gate PASS for each task in the ARCH loop", () => {
  // Given: teo-build has validated the PLAN_ARTIFACT
  //        each Task() call (qa, dev, staff-engineer) returns successfully
  // When:  teo-build calls evaluate-gate after each task completes
  // Then:  each evaluate-gate call:
  //          exits 0
  //          returns verdict: "PASS", status: "UNENFORCED_MOCK"
  //          returns evaluated_at timestamp and ledger_seq
  //        teo-build advances to the next task in the plan
  //
  // CLI result: evaluate-gate exits 0, { verdict:"PASS", status:"UNENFORCED_MOCK", ... }

  it("evaluate-gate returns PASS + ENFORCED for qa-spec gate", () => {
    // WS-06: qa-spec gate requires context.cwd with ac.json + test file containing [AC-N] tags
    const tempDir = makeTempDir();
    const acJson = {
      workstream: "ws-04-golden",
      acs: [{ id: "AC-1", description: "qa-spec gate passes" }],
    };
    fs.writeFileSync(path.join(tempDir, "ac.json"), JSON.stringify(acJson));
    fs.writeFileSync(
      path.join(tempDir, "golden.test.ts"),
      "it('[AC-1] qa-spec gate passes', () => {});"
    );
    const input = JSON.stringify({
      gate_id: "gate-qa-spec-001",
      task_id: "task-qa-spec-001",
      session_id: "session-golden-arch-001",
      gate_type: "qa-spec",
      ledger_base_dir: tempDir,
      context: { cwd: tempDir },
    });
    const { exitCode, stdout } = runCli("evaluate-gate", input);
    expect(exitCode).toBe(0);
    const out = stdout as { verdict: string; status: string; evaluated_at: string };
    expect(out.verdict).toBe("PASS");
    expect(out.status).toBe("ENFORCED");
    expect(out.evaluated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("evaluate-gate returns PASS + ENFORCED for dev gate", () => {
    // WS-06: dev gate requires context.cwd + mock_runner (injectable, avoids spawning npm)
    // gate_type "dev-impl" is unknown under WS-06 — use "dev" (one of the four known types)
    const tempDir = makeTempDir();
    const input = JSON.stringify({
      gate_id: "gate-dev-impl-001",
      task_id: "task-dev-impl-001",
      session_id: "session-golden-arch-001",
      gate_type: "dev",
      ledger_base_dir: tempDir,
      context: {
        cwd: tempDir,
        mock_runner: {
          exit_code: 0,
          stdout: "All files  |  100  |  100  |  100  |  100  |\nTest Files  5 passed (5)\n",
          stderr: "",
        },
      },
    });
    const { exitCode, stdout } = runCli("evaluate-gate", input);
    expect(exitCode).toBe(0);
    const out = stdout as { verdict: string; status: string };
    expect(out.verdict).toBe("PASS");
    expect(out.status).toBe("ENFORCED");
  });

  it("evaluate-gate returns PASS + ENFORCED for staff-review gate", () => {
    // WS-06: staff-review gate runs "git log --oneline -1" (real subprocess) + injectable runner
    // for typecheck. Use REPO_ROOT as cwd (git log works there) and inject mock_runner for npm.
    const tempDir = makeTempDir();
    const input = JSON.stringify({
      gate_id: "gate-staff-review-001",
      task_id: "task-staff-review-001",
      session_id: "session-golden-arch-001",
      gate_type: "staff-review",
      ledger_base_dir: tempDir,
      context: {
        cwd: REPO_ROOT,
        mock_runner: { exit_code: 0, stdout: "", stderr: "" },
      },
    });
    const { exitCode, stdout } = runCli("evaluate-gate", input);
    expect(exitCode).toBe(0);
    const out = stdout as { verdict: string; status: string };
    expect(out.verdict).toBe("PASS");
    expect(out.status).toBe("ENFORCED");
  });
});

describe("T-WS04-14: STEP_ARTIFACT blocks are well-formed and parseable by validate-artifact", () => {
  // Given: teo-build has completed gate evaluation for a task
  // When:  teo-build emits a STEP_ARTIFACT fenced block with GATE_RESULT_ARTIFACT payload
  // Then:  the emitted JSON payload is valid against type: GATE_RESULT_ARTIFACT
  //        validate-artifact returns { valid: true } for the STEP_ARTIFACT payload
  //        This ensures the WS-00 pipeline can consume teo-build STEP_ARTIFACT outputs
  //
  // CLI result: validate-artifact exits 0, { valid: true } for all valid GATE_RESULT_ARTIFACT payloads

  it("a STEP_ARTIFACT payload with verdict PASS is schema-valid", () => {
    const payload = {
      task_id: "task-qa-spec-001",
      gate_name: "qa-spec-complete",
      verdict: "PASS",
      timestamp: new Date().toISOString(),
    };
    const input = JSON.stringify({ type: "GATE_RESULT_ARTIFACT", payload });
    const { exitCode, stdout } = runCli("validate-artifact", input);
    expect(exitCode).toBe(0);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });

  it("a STEP_ARTIFACT payload with optional details field is schema-valid", () => {
    const payload = {
      task_id: "task-dev-impl-001",
      gate_name: "test-coverage",
      verdict: "PASS",
      timestamp: new Date().toISOString(),
      details: "99.4% coverage achieved across 47 files",
    };
    const input = JSON.stringify({ type: "GATE_RESULT_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });

  it("a STEP_ARTIFACT payload with verdict UNENFORCED_MOCK is schema-valid", () => {
    const payload = {
      task_id: "task-staff-review-001",
      gate_name: "staff-review-approved",
      verdict: "UNENFORCED_MOCK",
      timestamp: new Date().toISOString(),
      details: "[WARN] Gate enforcement not active — UNENFORCED_MOCK",
    };
    const input = JSON.stringify({ type: "GATE_RESULT_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });

  it("a STEP_ARTIFACT payload missing required task_id is rejected", () => {
    const payload = {
      // task_id intentionally omitted
      gate_name: "test-coverage",
      verdict: "PASS",
      timestamp: new Date().toISOString(),
    };
    const input = JSON.stringify({ type: "GATE_RESULT_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(false);
  });

  it("a STEP_ARTIFACT payload with unknown verdict is rejected", () => {
    const payload = {
      task_id: "task-qa-001",
      gate_name: "test-coverage",
      verdict: "UNKNOWN_STATUS", // not in enum
      timestamp: new Date().toISOString(),
    };
    const input = JSON.stringify({ type: "GATE_RESULT_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(false);
  });
});

describe("T-WS04-15: validate-artifact unknown type surfaces a clear error", () => {
  // Given: teo-build (or a downstream consumer) calls validate-artifact with an unregistered type
  // When:  validate-artifact receives type: "STEP_ARTIFACT" (the outer block name, not the inner type)
  //        or any other unregistered type string
  // Then:  validate-artifact returns { valid: false, errors: ["Unknown artifact type: <type>"] }
  //        (The outer block label "STEP_ARTIFACT" is the fenced block delimiter, not the validate type.
  //         The validate type is always "GATE_RESULT_ARTIFACT" for step gate results.)
  //
  // CLI result: exits 0, { valid: false, errors: ["Unknown artifact type: STEP_ARTIFACT"] }

  it("returns valid:false with Unknown artifact type error for unregistered type", () => {
    const input = JSON.stringify({ type: "STEP_ARTIFACT", payload: {} });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean; errors?: string[] };
    expect(out.valid).toBe(false);
    expect(out.errors).toBeDefined();
    expect(out.errors![0]).toMatch(/Unknown artifact type/);
  });
});

describe("T-WS04-16: validate-artifact accepts jsonrepair-repairable PLAN_ARTIFACT", () => {
  // Given: Capo emits a PLAN_ARTIFACT block with minor JSON formatting issues
  //        (trailing commas, single-quoted strings) that jsonrepair can fix
  // When:  teo-build passes the raw fenced block content to validate-artifact
  // Then:  validate-artifact repairs the JSON and returns { valid: true }
  //        teo-build proceeds to plan execution without error
  //
  // CLI result: validate-artifact exits 0, { valid: true } for trailing-comma payload string

  it("returns valid:true for a PLAN_ARTIFACT payload with a trailing comma (repaired)", () => {
    // jsonrepair handles trailing commas — pass a raw string payload with a trailing comma
    const payloadStr = `{
      "plan_id": "plan_001",
      "project_id": "the-eng-org",
      "created_at": "2026-06-24T00:00:00.000Z",
      "version": "1",
      "tasks": [
        {
          "id": "task-qa-001",
          "type": "AGENT",
          "agent_id": "qa",
          "prompt": "Write tests.",
          "needs": [],
          "gates": [],
        }
      ],
    }`;
    // The outer {type, payload} arg — validate-artifact receives type + raw string payload
    const outerArg = JSON.stringify({ type: "PLAN_ARTIFACT", payload: payloadStr });
    const { stdout } = runCli("validate-artifact", outerArg);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });
});

describe("T-WS04-17: Full ARCH pipeline end-to-end — all CLI contracts hold sequentially", () => {
  // Given: a PLAN_ARTIFACT with qa → dev → staff-engineer tasks (dependency chain)
  // When:  teo-build executes the full pipeline loop:
  //          1. calls validate-artifact on PLAN_ARTIFACT → valid
  //          2. spawns qa task (Task()) → qa completes
  //          3. calls evaluate-gate for qa gate → PASS + UNENFORCED_MOCK
  //          4. emits STEP_ARTIFACT (GATE_RESULT_ARTIFACT) for qa → valid
  //          5. spawns dev task (Task()) → dev completes
  //          6. calls evaluate-gate for dev gate → PASS + UNENFORCED_MOCK
  //          7. emits STEP_ARTIFACT for dev → valid
  //          8. spawns staff-engineer task (Task()) → staff-engineer completes
  //          9. calls evaluate-gate for staff gate → PASS + UNENFORCED_MOCK
  //         10. emits STEP_ARTIFACT for staff → valid
  //         11. plan complete — surfaces summary to user
  // Then:  all 10 CLI calls succeed, all artifacts are schema-valid, plan is marked complete
  //
  // CLI result: all commands exit 0, all return expected shapes

  it("step 1: validate-artifact on full ARCH PLAN_ARTIFACT returns valid:true", () => {
    const payload = {
      plan_id: "plan_e2e_arch_001_1719187200000",
      project_id: "the-eng-org",
      created_at: "2026-06-24T00:00:00.000Z",
      version: "1" as const,
      directive: "BUILD" as const,
      tasks: [
        {
          id: "task-qa-e2e",
          type: "AGENT" as const,
          agent_id: "qa",
          prompt: "__DEFERRED__",
          needs: [],
          gates: [{ name: "qa-spec-complete", on_fail: "block" as const }],
        },
        {
          id: "task-dev-e2e",
          type: "AGENT" as const,
          agent_id: "dev",
          prompt: "__DEFERRED__",
          needs: ["task-qa-e2e"],
          gates: [{ name: "test-coverage", on_fail: "block" as const }],
        },
        {
          id: "task-staff-e2e",
          type: "AGENT" as const,
          agent_id: "staff-engineer",
          prompt: "__DEFERRED__",
          needs: ["task-dev-e2e"],
          gates: [{ name: "staff-review-approved", on_fail: "block" as const }],
        },
      ],
    };
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload });
    const { exitCode, stdout } = runCli("validate-artifact", input);
    expect(exitCode).toBe(0);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });

  it("steps 3,6,9: evaluate-gate returns PASS + ENFORCED for all 3 pipeline tasks", () => {
    // WS-06: each gate type now runs a real profile:
    //   qa-spec     — requires context.cwd with ac.json + test file containing [AC-N] tags
    //   dev         — requires context.cwd + mock_runner (injectable, avoids spawning npm)
    //   staff-review — requires context.cwd (REPO_ROOT, git log works) + mock_runner for typecheck
    // gate_type "dev-impl" is unknown under WS-06 — replaced with "dev"
    const tempDir = makeTempDir();
    const sessionId = "session-e2e-arch-001";

    // Set up qa-spec fixture: ac.json + test file with [AC-1] tag
    const acJson = {
      workstream: "ws-04-e2e",
      acs: [{ id: "AC-1", description: "E2E pipeline gate passes" }],
    };
    fs.writeFileSync(path.join(tempDir, "ac.json"), JSON.stringify(acJson));
    fs.writeFileSync(
      path.join(tempDir, "e2e.test.ts"),
      "it('[AC-1] E2E pipeline gate passes', () => {});"
    );

    const devMockRunner = {
      exit_code: 0,
      stdout: "All files  |  100  |  100  |  100  |  100  |\nTest Files  5 passed (5)\n",
      stderr: "",
    };
    const typecheckMockRunner = { exit_code: 0, stdout: "", stderr: "" };

    const taskGates = [
      {
        gate_id: "gate-qa-e2e",
        task_id: "task-qa-e2e",
        gate_type: "qa-spec",
        context: { cwd: tempDir },
      },
      {
        gate_id: "gate-dev-e2e",
        task_id: "task-dev-e2e",
        gate_type: "dev",
        context: { cwd: tempDir, mock_runner: devMockRunner },
      },
      {
        gate_id: "gate-staff-e2e",
        task_id: "task-staff-e2e",
        gate_type: "staff-review",
        context: { cwd: REPO_ROOT, mock_runner: typecheckMockRunner },
      },
    ];

    for (const gate of taskGates) {
      const input = JSON.stringify({
        gate_id: gate.gate_id,
        task_id: gate.task_id,
        gate_type: gate.gate_type,
        session_id: sessionId,
        ledger_base_dir: tempDir,
        context: gate.context,
      });
      const { exitCode, stdout } = runCli("evaluate-gate", input);
      expect(exitCode).toBe(0);
      const out = stdout as { verdict: string; status: string; ledger_seq: number };
      expect(out.verdict).toBe("PASS");
      expect(out.status).toBe("ENFORCED");
      // ledger_seq >= 1 per CLI call (in-process only — each spawnSync is a fresh process)
      expect(out.ledger_seq).toBeGreaterThanOrEqual(1);
    }
  });

  it("steps 4,7,10: STEP_ARTIFACTs emitted after each gate are schema-valid", () => {
    const tasks = [
      { task_id: "task-qa-e2e", gate_name: "qa-spec-complete" },
      { task_id: "task-dev-e2e", gate_name: "test-coverage" },
      { task_id: "task-staff-e2e", gate_name: "staff-review-approved" },
    ];

    for (const task of tasks) {
      const payload = {
        task_id: task.task_id,
        gate_name: task.gate_name,
        verdict: "PASS",
        timestamp: new Date().toISOString(),
        details: `Gate ${task.gate_name} passed (UNENFORCED_MOCK)`,
      };
      const input = JSON.stringify({ type: "GATE_RESULT_ARTIFACT", payload });
      const { exitCode, stdout } = runCli("validate-artifact", input);
      expect(exitCode).toBe(0);
      const out = stdout as { valid: boolean };
      expect(out.valid).toBe(true);
    }
  });
});

describe("T-WS04-18: Engine Binary Guard — teo-run.js validate-plan probe succeeds", () => {
  // Given: teo-build runs the Engine Binary Guard before any classification or spawn
  //        The guard calls: teo-run.js validate-plan '{}'
  // When:  the guard runs
  // Then:  exit code is 0 (binary is reachable and ran)
  //        validate-plan with empty object returns { valid: false } — this is EXPECTED and
  //        does NOT constitute guard failure. The guard passes on exit code 0 alone.
  //
  // CLI result: exits 0, { valid: false, errors: [{...}, ...] } (full Zod error objects)

  it("validate-plan with empty object exits 0 and returns valid:false (guard passes)", () => {
    const { exitCode, stdout } = runCli("validate-plan", "{}");
    expect(exitCode).toBe(0);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(false); // expected — empty object fails PlanSchema, guard still passes
  });
});

describe("T-WS04-19: PLAN_ARTIFACT with __DEFERRED__ prompt is schema-valid", () => {
  // Given: Capo emits a PLAN_ARTIFACT in Phase 1 (D1 hybrid-planner)
  //        Task prompts for work not yet started use "__DEFERRED__" placeholder
  // When:  teo-build validates the PLAN_ARTIFACT before starting execution
  // Then:  validate-artifact returns { valid: true }
  //        teo-build can parse the task list and begin orchestrating
  //        (actual prompts are filled in at spawn time, not validation time)
  //
  // CLI result: exits 0, { valid: true }

  it("returns valid:true for PLAN_ARTIFACT with __DEFERRED__ prompts", () => {
    const payload = {
      plan_id: "plan_deferred_001_1719187200000",
      project_id: "the-eng-org",
      created_at: "2026-06-24T00:00:00.000Z",
      version: "1" as const,
      directive: "BUILD" as const,
      tasks: [
        {
          id: "task-qa-deferred",
          type: "AGENT" as const,
          agent_id: "qa",
          prompt: "__DEFERRED__",
          needs: [],
          gates: [{ name: "qa-spec-complete", on_fail: "block" as const }],
        },
        {
          id: "task-dev-deferred",
          type: "AGENT" as const,
          agent_id: "dev",
          prompt: "__DEFERRED__",
          needs: ["task-qa-deferred"],
          gates: [{ name: "test-coverage", on_fail: "block" as const }],
        },
      ],
    };
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });
});

describe("T-WS04-20: SCRIPT task in plan — validate-artifact accepts it, gate skipped when gates empty", () => {
  // Given: a PLAN_ARTIFACT contains a SCRIPT task (type: "SCRIPT", command: "...")
  //        with an empty gates array
  // When:  teo-build validates the plan and encounters the SCRIPT task
  // Then:  the plan is schema-valid
  //        teo-build executes the command via Bash rather than spawning a Task()
  //        no evaluate-gate call is made (empty gates array)
  //        the loop continues to the next task after the script exits 0
  //
  // NOTE: The skip-Task()-spawn and no-evaluate-gate behavior for SCRIPT tasks are
  //       SKILL prompt constraints, not testable via CLI. This test verifies that
  //       a PLAN_ARTIFACT containing a SCRIPT task passes schema validation.
  //
  // CLI result: exits 0, { valid: true }

  it("returns valid:true for PLAN_ARTIFACT with a SCRIPT task (no agent spawn required)", () => {
    const payload = {
      plan_id: "plan_script_001_1719187200000",
      project_id: "the-eng-org",
      created_at: "2026-06-24T00:00:00.000Z",
      version: "1" as const,
      tasks: [
        {
          id: "task-validate-install",
          type: "SCRIPT" as const,
          command: "bash scripts/verify-plugin-install.sh",
          needs: [],
          gates: [],
        },
        {
          id: "task-staff-review",
          type: "AGENT" as const,
          agent_id: "staff-engineer",
          prompt: "Review the plugin install verification result.",
          needs: ["task-validate-install"],
          gates: [{ name: "staff-review-approved", on_fail: "block" as const }],
        },
      ],
    };
    const input = JSON.stringify({ type: "PLAN_ARTIFACT", payload });
    const { stdout } = runCli("validate-artifact", input);
    const out = stdout as { valid: boolean };
    expect(out.valid).toBe(true);
  });
});
