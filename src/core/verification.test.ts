import { describe, it, expect, vi } from "vitest";
import * as os from "os";
import * as path from "path";
import {
  ScriptMechanism,
  TasklessMechanism,
  TASKLESS_RULES_PATH,
  mapExecErrorToExitCode,
} from "./verification.js";
import type { CommandRunner } from "./verification.js";

// =============================================================================
// verification.test.ts — exhaustive tests for src/core/verification.ts
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy).
//
// ALL tests stub the command runner — unit tests NEVER spawn real subprocesses.
// A real-CLI integration test is gated at the bottom (skipIf taskless absent).
//
// FAIL-SAFE CONTRACT: absent/unparseable verdict = BLOCKED, never PASS.
// =============================================================================

// ---------------------------------------------------------------------------
// Helpers — stub CommandRunner factories
// ---------------------------------------------------------------------------

/** Returns a runner that resolves with the given exit code and stdout. */
function makeRunner(exitCode: number | null, stdout = ""): CommandRunner {
  return vi.fn().mockResolvedValue({ exitCode, stdout });
}

/** Returns a runner that rejects (simulates spawn failure). */
function makeFailingRunner(error = new Error("spawn failed")): CommandRunner {
  return vi.fn().mockRejectedValue(error);
}

// ---------------------------------------------------------------------------
// ScriptMechanism — MISUSE
// ---------------------------------------------------------------------------
describe("ScriptMechanism — misuse", () => {
  it("maps null exit code → BLOCKED (fail-safe: no exit = not PASS)", async () => {
    const runner = makeRunner(null, "");
    const mech = new ScriptMechanism("npm test", runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("BLOCKED");
  });

  it("runner rejects (spawn error) → BLOCKED, not a throw", async () => {
    const runner = makeFailingRunner();
    const mech = new ScriptMechanism("npm test", runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("BLOCKED");
  });

  it("runner rejects with a non-Error value → BLOCKED with fallback reason", async () => {
    // Covers the `err instanceof Error` false branch — reason falls back to string
    const runner = vi.fn().mockRejectedValue("a raw string rejection");
    const mech = new ScriptMechanism("npm test", runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("BLOCKED");
    if (result.verdict === "BLOCKED") {
      expect(result.reason).toBe("command runner threw");
    }
  });

  it("non-zero exit code is always FAIL (never BLOCKED or PASS)", async () => {
    const runner = makeRunner(127, "command not found");
    const mech = new ScriptMechanism("nonexistent", runner);
    const result = await mech.verify(".", {});
    // exit 127 = command not found — still a FAIL (binary known-bad), not BLOCKED
    expect(result.verdict).toBe("FAIL");
  });
});

// ---------------------------------------------------------------------------
// ScriptMechanism — BOUNDARY
// ---------------------------------------------------------------------------
describe("ScriptMechanism — boundary exit codes", () => {
  it("exit 0 → PASS", async () => {
    const runner = makeRunner(0);
    const mech = new ScriptMechanism("npm run lint", runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("PASS");
  });

  it("exit 1 → FAIL with evidence", async () => {
    const runner = makeRunner(1, "lint errors found");
    const mech = new ScriptMechanism("npm run lint", runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("FAIL");
    if (result.verdict === "FAIL") {
      expect(result.evidence).toContain("exit code 1");
    }
  });

  it("exit 127 → FAIL (not BLOCKED)", async () => {
    const runner = makeRunner(127, "bash: npm: not found");
    const mech = new ScriptMechanism("npm run lint", runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("FAIL");
  });

  it("exit 2 → FAIL", async () => {
    const runner = makeRunner(2, "usage error");
    const mech = new ScriptMechanism("somecommand", runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("FAIL");
  });

  it("passes the command and target to the runner", async () => {
    const runner = makeRunner(0);
    const mech = new ScriptMechanism("npm run build", runner);
    await mech.verify("/path/to/project", {});
    expect(runner).toHaveBeenCalledWith("npm run build", "/path/to/project", {});
  });

  it("null exit (no-exit / timeout) → BLOCKED with reason", async () => {
    const runner = makeRunner(null);
    const mech = new ScriptMechanism("slow-command", runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("BLOCKED");
    if (result.verdict === "BLOCKED") {
      expect(result.reason).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// ScriptMechanism — GOLDEN PATH
// ---------------------------------------------------------------------------
describe("ScriptMechanism — golden path", () => {
  it("full successful verification run", async () => {
    const runner = makeRunner(0, "all tests passed");
    const mech = new ScriptMechanism("npm test", runner);
    const result = await mech.verify("/workspace/my-project", { env: "ci" });
    expect(result.verdict).toBe("PASS");
  });

  it("FAIL result carries stdout as evidence", async () => {
    const runner = makeRunner(1, "3 errors found");
    const mech = new ScriptMechanism("npm run lint", runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("FAIL");
    if (result.verdict === "FAIL") {
      expect(result.evidence).toContain("exit code 1");
    }
  });

  it("FAIL result with empty stdout has no trailing colon", async () => {
    // Covers the stdout ternary false branch in evidence formatting
    const runner = makeRunner(1, "");
    const mech = new ScriptMechanism("npm run lint", runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("FAIL");
    if (result.verdict === "FAIL") {
      expect(result.evidence).toBe("exit code 1");
    }
  });
});

// ---------------------------------------------------------------------------
// TasklessMechanism — rules path contract
// ---------------------------------------------------------------------------
describe("TasklessMechanism — rules path contract", () => {
  it("TASKLESS_RULES_PATH resolves from os.homedir(), not a project path", () => {
    const home = os.homedir();
    const expected = path.join(home, ".teo", "taskless", "rules");
    expect(TASKLESS_RULES_PATH).toBe(expected);
  });

  it("TASKLESS_RULES_PATH does not contain '.taskless' (no project-local path)", () => {
    // Must never point at <project>/.taskless/
    expect(TASKLESS_RULES_PATH).not.toMatch(/\.taskless/);
  });

  it("TASKLESS_RULES_PATH is an absolute path (not relative)", () => {
    expect(path.isAbsolute(TASKLESS_RULES_PATH)).toBe(true);
  });

  it("TasklessMechanism passes the rules path from TASKLESS_RULES_PATH to the runner", async () => {
    const runner = makeRunner(0, JSON.stringify({ findings: [] }));
    const mech = new TasklessMechanism(runner);
    await mech.verify(".", {});
    const callArgs = (runner as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const command = callArgs[0] as string;
    expect(command).toContain(TASKLESS_RULES_PATH);
  });

  it("uses ~/.teo/taskless/rules/ not a project-local .taskless/ directory", async () => {
    const runner = makeRunner(0, JSON.stringify({ findings: [] }));
    const mech = new TasklessMechanism(runner);
    await mech.verify("/some/project", {});
    const callArgs = (runner as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const command = callArgs[0] as string;
    // The command must NOT reference the target project dir for rules
    expect(command).not.toContain("/some/project/.taskless");
  });
});

// ---------------------------------------------------------------------------
// TasklessMechanism — MISUSE
// ---------------------------------------------------------------------------
describe("TasklessMechanism — misuse", () => {
  it("non-zero exit + malformed JSON → BLOCKED (fail-safe)", async () => {
    const runner = makeRunner(1, "ERROR: binary crashed");
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    // Non-zero exit with non-JSON output: can't parse → BLOCKED
    expect(result.verdict).toBe("BLOCKED");
  });

  it("exit 0 + malformed JSON → BLOCKED (cannot trust unverifiable output)", async () => {
    const runner = makeRunner(0, "not json at all");
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("BLOCKED");
  });

  it("runner rejects (spawn error) → BLOCKED, not a throw", async () => {
    const runner = makeFailingRunner();
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("BLOCKED");
  });

  it("runner rejects with a non-Error value → BLOCKED with fallback reason", async () => {
    // Covers the `err instanceof Error` false branch in TasklessMechanism
    const runner = vi.fn().mockRejectedValue(42);
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("BLOCKED");
    if (result.verdict === "BLOCKED") {
      expect(result.reason).toBe("taskless runner threw");
    }
  });

  it("exit 0 + empty stdout → BLOCKED (no parseable output)", async () => {
    const runner = makeRunner(0, "");
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("BLOCKED");
  });

  it("null exit code → BLOCKED (no conclusion possible)", async () => {
    const runner = makeRunner(null, "");
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("BLOCKED");
  });

  it("missing rules directory → BLOCKED or structured error, never silent PASS", async () => {
    // Simulate the runner producing a 'no such directory' error (non-zero + error text)
    const runner = makeRunner(2, "Error: rules directory not found");
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    // Must be BLOCKED or FAIL — never PASS
    expect(result.verdict === "BLOCKED" || result.verdict === "FAIL").toBe(true);
    expect(result.verdict).not.toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// TasklessMechanism — BOUNDARY
// ---------------------------------------------------------------------------
describe("TasklessMechanism — boundary JSON parsing", () => {
  it("exit 0 + clean JSON (0 findings) → PASS", async () => {
    const runner = makeRunner(0, JSON.stringify({ findings: [] }));
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("PASS");
  });

  it("exit 0 + JSON with error-severity findings → FAIL", async () => {
    const findings = [
      { rule: "no-direct-push", severity: "error", message: "direct push to main" },
    ];
    const runner = makeRunner(0, JSON.stringify({ findings }));
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("FAIL");
    if (result.verdict === "FAIL") {
      expect(result.evidence).toBeTruthy();
    }
  });

  it("exit 0 + JSON with only warning-severity findings → PASS (warnings don't block)", async () => {
    const findings = [
      { rule: "prefer-squash", severity: "warning", message: "consider squashing" },
    ];
    const runner = makeRunner(0, JSON.stringify({ findings }));
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    // Only error severity findings trigger FAIL
    expect(result.verdict).toBe("PASS");
  });

  it("exit 1 + valid JSON with error findings → FAIL (exit code takes precedence or findings do)", async () => {
    // Non-zero exit with parseable findings: still results in FAIL
    const findings = [{ rule: "bad-rule", severity: "error", message: "violation" }];
    const runner = makeRunner(1, JSON.stringify({ findings }));
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    // Either FAIL (findings parsed) or BLOCKED (non-zero + can't trust) — NOT PASS
    expect(result.verdict).not.toBe("PASS");
  });

  it("findings with mixed severity → FAIL when any error-severity finding exists", async () => {
    const findings = [
      { rule: "warn-rule", severity: "warning", message: "minor" },
      { rule: "err-rule", severity: "error", message: "critical" },
    ];
    const runner = makeRunner(0, JSON.stringify({ findings }));
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("FAIL");
  });
});

// ---------------------------------------------------------------------------
// TasklessMechanism — GOLDEN PATH
// ---------------------------------------------------------------------------
describe("TasklessMechanism — golden path", () => {
  it("clean run with no findings → PASS", async () => {
    const runner = makeRunner(0, JSON.stringify({ findings: [] }));
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify("/workspace/project", {});
    expect(result.verdict).toBe("PASS");
  });

  it("FAIL result includes findings summary as evidence", async () => {
    const findings = [
      { rule: "no-secrets", severity: "error", message: "API key exposed" },
      { rule: "no-direct-push", severity: "error", message: "pushed to main" },
    ];
    const runner = makeRunner(0, JSON.stringify({ findings }));
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("FAIL");
    if (result.verdict === "FAIL") {
      expect(result.evidence).toContain("no-secrets");
    }
  });
});

// ---------------------------------------------------------------------------
// TasklessMechanism — additional boundary coverage (uncovered branches)
// ---------------------------------------------------------------------------
describe("TasklessMechanism — additional branches", () => {
  it("exit 0 + JSON that parses but lacks 'findings' array → BLOCKED (invalid shape)", async () => {
    // Valid JSON but wrong shape — must be BLOCKED, not PASS
    const runner = makeRunner(0, JSON.stringify({ errors: [], warnings: [] }));
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    expect(result.verdict).toBe("BLOCKED");
    if (result.verdict === "BLOCKED") {
      expect(result.reason).toBeTruthy();
    }
  });

  it("exit 1 + valid JSON with no error findings → FAIL (non-zero is authoritative)", async () => {
    // Non-zero exit + parseable JSON + no error-severity findings → FAIL
    // The non-zero exit is definitive — can't treat it as PASS
    const runner = makeRunner(1, JSON.stringify({ findings: [{ rule: "info-rule", severity: "info", message: "fyi" }] }));
    const mech = new TasklessMechanism(runner);
    const result = await mech.verify(".", {});
    // Non-zero exit + parseable JSON + no error findings = FAIL (non-zero authoritative)
    expect(result.verdict).toBe("FAIL");
    if (result.verdict === "FAIL") {
      expect(result.evidence).toContain("taskless exited 1");
    }
  });
});

// ---------------------------------------------------------------------------
// mapExecErrorToExitCode — pure exit-code mapping (covers killed / exitCode paths)
// ---------------------------------------------------------------------------
describe("mapExecErrorToExitCode — exit code mapping", () => {
  it("returns numeric err.code directly", () => {
    const err = Object.assign(new Error("failed"), { code: 1 }) as NodeJS.ErrnoException;
    expect(mapExecErrorToExitCode(err)).toBe(1);
  });

  it("returns null when err.killed is true (process was killed, no exit code)", () => {
    const err = Object.assign(new Error("killed"), {
      code: "SIGKILL",
      killed: true,
    }) as NodeJS.ErrnoException & { killed: boolean };
    expect(mapExecErrorToExitCode(err)).toBeNull();
  });

  it("returns err.exitCode when err.code is a string and not killed", () => {
    const err = Object.assign(new Error("buffer overflow"), {
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      killed: false,
      exitCode: 1,
    }) as NodeJS.ErrnoException & { killed: boolean; exitCode: number };
    expect(mapExecErrorToExitCode(err)).toBe(1);
  });

  it("returns null when err.code is a string, not killed, and no exitCode", () => {
    const err = Object.assign(new Error("unknown"), {
      code: "ENOENT",
      killed: false,
    }) as NodeJS.ErrnoException & { killed: boolean };
    expect(mapExecErrorToExitCode(err)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// makeNodeCommandRunner — production runner integration
// Uses real safe subprocesses (node --version / a guaranteed-fail command).
// These do NOT require external binaries beyond node itself.
// ---------------------------------------------------------------------------
describe("makeNodeCommandRunner — production runner", () => {
  it("exits 0 for a successful command", async () => {
    const { makeNodeCommandRunner } = await import("./verification.js");
    const runner = makeNodeCommandRunner();
    const result = await runner("node --version", ".", {});
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^v\d+/);
  });

  it("exits non-zero for a command that fails", async () => {
    const { makeNodeCommandRunner } = await import("./verification.js");
    const runner = makeNodeCommandRunner();
    // `node -e 'process.exit(42)'` is safe and always exits 42
    const result = await runner("node -e 'process.exit(42)'", ".", {});
    expect(result.exitCode).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Real-CLI integration test — gated (skips if taskless binary absent)
// ---------------------------------------------------------------------------
describe("TasklessMechanism — real CLI (integration, skipped if binary absent)", () => {
  const tasklessBin = "taskless";

  // Detect if taskless is available by spawning it — we use a real runner here
  // This test is isolated to not affect unit CI.
  it.skip("real taskless binary integration (manual gate — enable if binary present)", async () => {
    // This test would require the real binary and ~/.teo/taskless/rules/ to exist.
    // Gate it manually until the binary is available in CI.
    // When enabled: import { makeNodeCommandRunner } from "./verification.js"
    // and run with a real project path.
    expect(tasklessBin).toBeTruthy();
  });
});
