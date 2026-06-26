// =============================================================================
// evaluate-gate-cli.test.ts — WS-06: real gate-profile enforcement tests
//
// STATUS: PASSING — post-impl, CAD gate 2 (WS-06)
//
// CONTRACT (CLI arg protocol):
//   node bin/teo-run.js evaluate-gate '<json-string>'
//   - Returns JSON on stdout
//   - Exits 0 on PASS/BLOCKED, non-zero on hard errors; exits 1 on FAIL verdict
//
// INPUT CONTRACT (WS-06 additions):
//   {
//     gate_id: string;
//     task_id: string;
//     session_id: string;
//     gate_type: "acceptance-criteria"|"qa-spec"|"dev"|"staff-review";
//     context?: {
//       cwd?: string;            // working dir for profile to inspect
//       mock_runner?: {          // inject mock runner results via JSON env
//         exit_code: number;
//         stdout: string;
//         stderr: string;
//       };
//     };
//     ledger_base_dir?: string;
//   }
//
// OUTPUT CONTRACT (WS-06):
//   {
//     gate_id: string;
//     task_id: string;
//     session_id: string;
//     verdict: "PASS" | "FAIL" | "BLOCKED";
//     status: "ENFORCED";
//     evaluated_at: string;       // ISO-8601
//     gate_type: string;
//     ledger_seq: number;
//     evidence: Record<string, unknown>;
//   }
//
// RUNNER INJECTION (D1):
//   The gate profiles accept a mock runner via context.mock_runner JSON field.
//   The CLI handler deserializes it and injects it as the GateProfileRunner.
//   This crosses the subprocess boundary without spawning npm.
//
// Ordering: misuse → boundary → per-profile golden paths → ledger integration
// (ADR-064 adversarial-first policy)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// CLI binary / entry point — same resolution strategy as existing tests
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "teo-eval-gate-ws06-"));
  tempDirs.push(d);
  return d;
}

/** Write an ac.json fixture into the given directory. */
function writeAcJson(dir: string, acs: Array<{ id: string; description: string }>): void {
  const payload = {
    workstream: "ws-06",
    acs,
  };
  fs.writeFileSync(path.join(dir, "ac.json"), JSON.stringify(payload), "utf8");
}

/** Write a test file that references [AC-N] tags in its it() names. */
function writeTestFile(dir: string, filename: string, acRefs: string[]): void {
  const lines = [
    `import { describe, it } from "vitest";`,
    `describe("ws-06 specs", () => {`,
    ...acRefs.map((ref) => `  it("${ref} — some assertion", () => {});`),
    `});`,
  ];
  fs.writeFileSync(path.join(dir, filename), lines.join("\n"), "utf8");
}

/**
 * Build a mock_runner context field.
 * The CLI handler deserializes this and injects a synchronous runner that
 * returns these values, bypassing real child_process execution.
 */
function mockRunner(exitCode: number, stdout: string, stderr = ""): Record<string, unknown> {
  return { mock_runner: { exit_code: exitCode, stdout, stderr } };
}

beforeEach(() => {
  // No shared setup — each test configures its own state
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
// Minimal valid base input (WS-06 adds status: "ENFORCED" requirement)
// ---------------------------------------------------------------------------

const BASE_INPUT = {
  gate_id: "gate-ws06-001",
  task_id: "task-ws06-001",
  session_id: "session-ws06-001",
};

// =============================================================================
// WS-06: FAILING — implement in dev gate
// =============================================================================

describe("WS-06: gate-profile enforcement", () => {
  // ===========================================================================
  // MISUSE: unknown gate_type, missing cwd, nonexistent cwd, malformed JSON
  // ===========================================================================

  describe("misuse: AC-1 — unknown gate_type is rejected", () => {
    // [AC-1] Unknown gate_type must return exit 1 with a JSON error (not BLOCKED)
    it("[AC-1] evaluate-gate with unknown gate_type → exit 1, JSON error", () => {
      const dir = makeTempDir();
      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "not-a-real-gate",
        context: { cwd: dir },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(1);
      const result = stdout as Record<string, unknown>;
      expect(result).toHaveProperty("error");
      expect(result["error"]).toMatch(/unknown.*gate_type|gate_type.*unknown|not.*supported/i);
    });
  });

  describe("misuse: AC-2 — profile requires cwd but context.cwd is missing", () => {
    // [AC-2] Profiles that need cwd (all four do) must fail cleanly when context.cwd is absent.
    // The verdict must be FAIL (not BLOCKED — infrastructure is fine, input is wrong).
    it("[AC-2] evaluate-gate acceptance-criteria without context.cwd → exit 1, FAIL verdict", () => {
      const dir = makeTempDir();
      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "acceptance-criteria",
        // context.cwd intentionally absent
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(1);
      const result = stdout as Record<string, unknown>;
      // Must be a structured gate result, not a raw JSON parse error
      expect(result).toHaveProperty("verdict");
      expect(result["verdict"]).toBe("FAIL");
      expect(result["status"]).toBe("ENFORCED");
      const evidence = result["evidence"] as Record<string, unknown>;
      expect(evidence).toHaveProperty("reason");
    });
  });

  describe("misuse: AC-3 — cwd does not exist on disk → FAIL verdict (not hard error)", () => {
    // [AC-3] If context.cwd is provided but the directory does not exist, the gate must return
    // a FAIL verdict with structured evidence — not crash with an unstructured error.
    it("[AC-3] evaluate-gate with nonexistent cwd → exit 1, FAIL verdict with evidence.reason", () => {
      const dir = makeTempDir();
      const nonexistentCwd = path.join(dir, "does-not-exist");
      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "acceptance-criteria",
        context: { cwd: nonexistentCwd },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(1);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("FAIL");
      expect(result["status"]).toBe("ENFORCED");
      const evidence = result["evidence"] as Record<string, unknown>;
      expect(evidence).toHaveProperty("reason");
      expect(typeof evidence["reason"]).toBe("string");
    });
  });

  describe("misuse: AC-4 — malformed JSON arg → exit 1 with JSON error", () => {
    // [AC-4] Malformed JSON at the CLI arg level must still exit 1 with a JSON error object.
    it("[AC-4] evaluate-gate with malformed JSON arg → exit 1, error mentioning 'JSON'", () => {
      const { exitCode, stdout } = runCli("evaluate-gate", "not-valid-json{{{");

      expect(exitCode).toBe(1);
      expect(stdout).toMatchObject({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        error: expect.stringMatching(/json/i),
      });
    });
  });

  // ===========================================================================
  // PER-PROFILE: acceptance-criteria
  // ===========================================================================

  describe("acceptance-criteria profile: AC-5, AC-6, AC-7", () => {
    // [AC-5] PASS: ac.json exists and is valid → exit 0, ENFORCED PASS with ac_count
    it("[AC-5] acceptance-criteria with valid ac.json → exit 0, verdict PASS, status ENFORCED, evidence.ac_count", () => {
      const dir = makeTempDir();
      writeAcJson(dir, [
        { id: "AC-1", description: "First acceptance criterion" },
        { id: "AC-2", description: "Second acceptance criterion" },
        { id: "AC-3", description: "Third acceptance criterion" },
      ]);

      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "acceptance-criteria",
        context: { cwd: dir },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(0);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("PASS");
      expect(result["status"]).toBe("ENFORCED");
      expect(result["gate_id"]).toBe(BASE_INPUT.gate_id);
      expect(result["gate_type"]).toBe("acceptance-criteria");
      expect(typeof result["ledger_seq"]).toBe("number");
      const evidence = result["evidence"] as Record<string, unknown>;
      expect(evidence["ac_count"]).toBe(3);
    });

    // [AC-6] FAIL: ac.json is absent → exit 1, ENFORCED FAIL with evidence.reason
    it("[AC-6] acceptance-criteria with missing ac.json → exit 1, verdict FAIL, evidence.reason", () => {
      const dir = makeTempDir();
      // Intentionally do NOT write ac.json

      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "acceptance-criteria",
        context: { cwd: dir },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(1);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("FAIL");
      expect(result["status"]).toBe("ENFORCED");
      const evidence = result["evidence"] as Record<string, unknown>;
      expect(typeof evidence["reason"]).toBe("string");
    });

    // [AC-7] FAIL: ac.json exists but fails schema validation → exit 1, ENFORCED FAIL
    it("[AC-7] acceptance-criteria with malformed ac.json → exit 1, verdict FAIL, evidence has errors", () => {
      const dir = makeTempDir();
      // Write invalid ac.json — missing required 'acs' array
      fs.writeFileSync(path.join(dir, "ac.json"), JSON.stringify({ workstream: "ws-06" }), "utf8");

      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "acceptance-criteria",
        context: { cwd: dir },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(1);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("FAIL");
      expect(result["status"]).toBe("ENFORCED");
      const evidence = result["evidence"] as Record<string, unknown>;
      // Must provide either reason or errors
      expect(typeof evidence["reason"] === "string" || Array.isArray(evidence["errors"])).toBe(
        true
      );
    });
  });

  // ===========================================================================
  // PER-PROFILE: qa-spec
  // ===========================================================================

  describe("qa-spec profile: AC-8, AC-9, AC-10", () => {
    // [AC-8] PASS: all ACs in ac.json are referenced in test files → exit 0, ENFORCED PASS
    it("[AC-8] qa-spec with full coverage → exit 0, verdict PASS, covered_acs matches ac_ids, uncovered_acs empty", () => {
      const dir = makeTempDir();
      writeAcJson(dir, [
        { id: "AC-1", description: "First" },
        { id: "AC-2", description: "Second" },
      ]);
      writeTestFile(dir, "feature.test.ts", ["[AC-1] does the thing", "[AC-2] also does it"]);

      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "qa-spec",
        context: { cwd: dir },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(0);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("PASS");
      expect(result["status"]).toBe("ENFORCED");
      const evidence = result["evidence"] as Record<string, unknown>;
      expect(Array.isArray(evidence["covered_acs"])).toBe(true);
      expect(Array.isArray(evidence["uncovered_acs"])).toBe(true);
      expect((evidence["uncovered_acs"] as string[]).length).toBe(0);
      const covered = evidence["covered_acs"] as string[];
      expect(covered).toContain("AC-1");
      expect(covered).toContain("AC-2");
    });

    // [AC-9] FAIL: some ACs have no test references → exit 1, ENFORCED FAIL, uncovered_acs lists them
    it("[AC-9] qa-spec with partial coverage → exit 1, verdict FAIL, uncovered_acs non-empty", () => {
      const dir = makeTempDir();
      writeAcJson(dir, [
        { id: "AC-1", description: "First" },
        { id: "AC-2", description: "Second" },
        { id: "AC-3", description: "Third — no test" },
      ]);
      // Only cover AC-1 and AC-2
      writeTestFile(dir, "partial.test.ts", ["[AC-1] covered", "[AC-2] covered"]);

      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "qa-spec",
        context: { cwd: dir },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(1);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("FAIL");
      expect(result["status"]).toBe("ENFORCED");
      const evidence = result["evidence"] as Record<string, unknown>;
      const uncovered = evidence["uncovered_acs"] as string[];
      expect(Array.isArray(uncovered)).toBe(true);
      expect(uncovered).toContain("AC-3");
    });

    // [AC-10] FAIL: ac.json missing → exit 1, ENFORCED FAIL (qa-spec depends on ac.json)
    it("[AC-10] qa-spec with missing ac.json → exit 1, verdict FAIL", () => {
      const dir = makeTempDir();
      // No ac.json — qa-spec cannot enumerate ACs to check
      writeTestFile(dir, "something.test.ts", ["[AC-1] a test"]);

      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "qa-spec",
        context: { cwd: dir },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(1);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("FAIL");
      expect(result["status"]).toBe("ENFORCED");
    });
  });

  // ===========================================================================
  // PER-PROFILE: dev (uses injectable runner)
  // ===========================================================================

  describe("dev profile: AC-11, AC-12, AC-13 (mock runner injection)", () => {
    // [AC-11] PASS: mock runner returns coverage ≥ 99% → exit 0, ENFORCED PASS
    it("[AC-11] dev gate with mocked runner returning 100% coverage → exit 0, verdict PASS, evidence fields present", () => {
      const dir = makeTempDir();
      // Simulate npm run test:cov stdout with a coverage line the profile can parse
      const mockStdout = [
        "All files  |  100  |  100  |  100  |  100  |",
        "Test Files  10 passed (10)",
        "",
      ].join("\n");

      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "dev",
        context: {
          cwd: dir,
          ...mockRunner(0, mockStdout),
        },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(0);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("PASS");
      expect(result["status"]).toBe("ENFORCED");
      const evidence = result["evidence"] as Record<string, unknown>;
      expect(typeof evidence["test_count"]).toBe("number");
      expect(typeof evidence["coverage_pct"]).toBe("number");
      expect(typeof evidence["threshold"]).toBe("number");
      expect(evidence["threshold"]).toBe(99);
    });

    // [AC-12] FAIL: mock runner returns coverage < 99% → exit 1, ENFORCED FAIL
    it("[AC-12] dev gate with mocked runner returning 85% coverage → exit 1, verdict FAIL, evidence.coverage_pct < threshold", () => {
      const dir = makeTempDir();
      const mockStdout = [
        "All files  |  85  |  80  |  85  |  85  |",
        "Test Files  5 passed (5)",
        "",
      ].join("\n");

      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "dev",
        context: {
          cwd: dir,
          ...mockRunner(0, mockStdout),
        },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(1);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("FAIL");
      expect(result["status"]).toBe("ENFORCED");
      const evidence = result["evidence"] as Record<string, unknown>;
      expect(typeof evidence["coverage_pct"]).toBe("number");
      expect(evidence["coverage_pct"] as number).toBeLessThan(99);
    });

    // [AC-13] FAIL: mock runner returns non-zero exit → exit 1, ENFORCED FAIL, evidence.reason present
    it("[AC-13] dev gate with mocked runner returning exit 1 (tests failed) → exit 1, verdict FAIL, evidence.reason", () => {
      const dir = makeTempDir();

      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "dev",
        context: {
          cwd: dir,
          ...mockRunner(1, "", "FAIL: 3 tests failed"),
        },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(1);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("FAIL");
      expect(result["status"]).toBe("ENFORCED");
      const evidence = result["evidence"] as Record<string, unknown>;
      expect(typeof evidence["reason"]).toBe("string");
    });
  });

  // [AC-14] Acceptance test: real subprocess integration
  // This test requires a real repo with npm installed. Marked skip for unit/CI.
  describe("WS-06 acceptance: real subprocess", () => {
    it.skip("[AC-14] dev gate with real npm run test:cov → passes in a real repo environment", () => {
      // This test only passes in a real repo where npm and the test suite are available.
      // Run manually to validate the real subprocess path end-to-end.
      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "dev",
        context: { cwd: REPO_ROOT },
        ledger_base_dir: makeTempDir(),
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(0);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("PASS");
    });
  });

  // ===========================================================================
  // PER-PROFILE: staff-review (uses injectable runner for typecheck)
  // ===========================================================================

  describe("staff-review profile: AC-15, AC-16, AC-17 (mock runner injection)", () => {
    // [AC-15] PASS: commit present and typecheck clean → exit 0, ENFORCED PASS
    it("[AC-15] staff-review with commit present and typecheck clean → exit 0, verdict PASS", () => {
      const dir = makeTempDir();
      // Mock runner for typecheck subprocess — exits 0, no errors
      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "staff-review",
        context: {
          cwd: REPO_ROOT, // Use real repo so git log works
          ...mockRunner(0, ""),
        },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(0);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("PASS");
      expect(result["status"]).toBe("ENFORCED");
      const evidence = result["evidence"] as Record<string, unknown>;
      expect(evidence["commit_present"]).toBe(true);
      expect(evidence["typecheck_clean"]).toBe(true);
    });

    // [AC-16] FAIL: typecheck fails (mock runner exits 1) → exit 1, ENFORCED FAIL
    it("[AC-16] staff-review with typecheck errors → exit 1, verdict FAIL, evidence.typecheck_clean false", () => {
      const dir = makeTempDir();
      const typecheckErrors = "error TS2345: Argument of type 'string' is not assignable";
      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "staff-review",
        context: {
          cwd: REPO_ROOT,
          ...mockRunner(1, "", typecheckErrors),
        },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(1);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("FAIL");
      expect(result["status"]).toBe("ENFORCED");
      const evidence = result["evidence"] as Record<string, unknown>;
      expect(evidence["typecheck_clean"]).toBe(false);
      expect(typeof evidence["typecheck_errors"]).toBe("string");
    });

    // [AC-17] FAIL: no commits exist in cwd → exit 1, ENFORCED FAIL, evidence.commit_present false
    it("[AC-17] staff-review with no commits in cwd → exit 1, verdict FAIL, evidence.commit_present false", () => {
      const dir = makeTempDir();
      // Use a temp dir that is not a git repo — no commits possible
      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "staff-review",
        context: {
          cwd: dir, // not a git repo → no commits
          ...mockRunner(0, ""), // typecheck passes
        },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      expect(exitCode).toBe(1);
      const result = stdout as Record<string, unknown>;
      expect(result["verdict"]).toBe("FAIL");
      expect(result["status"]).toBe("ENFORCED");
      const evidence = result["evidence"] as Record<string, unknown>;
      expect(evidence["commit_present"]).toBe(false);
    });
  });

  // ===========================================================================
  // OUTPUT CONTRACT: common fields across all profiles
  // ===========================================================================

  describe("output contract: AC-18 — status is ENFORCED (not UNENFORCED_MOCK)", () => {
    // [AC-18] Every WS-06 gate result must carry status: "ENFORCED" — never "UNENFORCED_MOCK".
    it("[AC-18] evaluate-gate always returns status: 'ENFORCED' — never 'UNENFORCED_MOCK'", () => {
      const dir = makeTempDir();
      writeAcJson(dir, [{ id: "AC-1", description: "first" }]);

      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "acceptance-criteria",
        context: { cwd: dir },
        ledger_base_dir: dir,
      });

      const { stdout } = runCli("evaluate-gate", input);

      const result = stdout as Record<string, unknown>;
      expect(result["status"]).toBe("ENFORCED");
      expect(result["status"]).not.toBe("UNENFORCED_MOCK");
    });
  });

  describe("output contract: AC-19 — evaluated_at is valid ISO-8601", () => {
    // [AC-19] evaluated_at must be a parseable ISO-8601 string produced during the call.
    it("[AC-19] evaluate-gate result.evaluated_at is valid ISO-8601 string within execution window", () => {
      const dir = makeTempDir();
      writeAcJson(dir, [{ id: "AC-1", description: "first" }]);

      const input = JSON.stringify({
        ...BASE_INPUT,
        gate_type: "acceptance-criteria",
        context: { cwd: dir },
        ledger_base_dir: dir,
      });

      const before = new Date();
      const { exitCode, stdout } = runCli("evaluate-gate", input);
      const after = new Date();

      // This test passes whether verdict is PASS or FAIL
      void exitCode;
      const result = stdout as Record<string, unknown>;
      expect(typeof result["evaluated_at"]).toBe("string");
      const ts = new Date(result["evaluated_at"] as string);
      expect(isNaN(ts.getTime())).toBe(false);
      expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(ts.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
      expect(result["evaluated_at"] as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  // ===========================================================================
  // LEDGER INTEGRATION
  // ===========================================================================

  describe("ledger integration: AC-20 — verdict is recorded in the ledger", () => {
    // [AC-20] A real gate verdict (PASS or FAIL) must be appended to the ledger file
    // with phase: "GATE" and the verdict reflected in the ledger entry's detail field.
    it("[AC-20] evaluate-gate records real verdict in ledger — ledger_seq > 0, ledger file readable", () => {
      const dir = makeTempDir();
      writeAcJson(dir, [
        { id: "AC-1", description: "first" },
        { id: "AC-2", description: "second" },
      ]);

      const sessionId = "session-ws06-ledger-ac20";
      const input = JSON.stringify({
        ...BASE_INPUT,
        session_id: sessionId,
        gate_id: "gate-ws06-ledger-001",
        gate_type: "acceptance-criteria",
        context: { cwd: dir },
        ledger_base_dir: dir,
      });

      const { exitCode, stdout } = runCli("evaluate-gate", input);

      void exitCode; // may be 0 or 1 depending on verdict
      const result = stdout as Record<string, unknown>;

      // ledger_seq must be a positive integer
      expect(typeof result["ledger_seq"]).toBe("number");
      expect(result["ledger_seq"] as number).toBeGreaterThanOrEqual(1);

      // Ledger file must exist and contain a GATE entry with the real verdict
      const ledgerFile = path.join(dir, "ledger", `${sessionId}.jsonl`);
      expect(fs.existsSync(ledgerFile)).toBe(true);

      const lines = fs
        .readFileSync(ledgerFile, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(1);

      // Find the GATE phase entry
      const gateEntry = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((e) => e["phase"] === "GATE");

      expect(gateEntry).toBeDefined();
      // The ledger verdict must match the output verdict
      expect(gateEntry!["verdict"]).toBe(result["verdict"]);
    });
  });
}); // end describe("WS-06: gate-profile enforcement")
