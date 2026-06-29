// WS-JQ-FIX — post-implementation (all 17 tests green)
//
// Tests for the pure-bash fallback in hooks/teo-prompt-router.sh.
// Verifies that when `jq` is absent from PATH, the hook:
//   - Does NOT inject on empty/malformed/non-teo/utility inputs (M-1..M-7)
//   - Handles edge cases correctly (B-1..B-5)
//   - Correctly injects CAPO_DIRECTIVE on substantive /teo prompts (G-1..G-5)
//
// Ordering: misuse → boundary → golden path (ADR-064 convention)
//
// The existing teo-prompt-router.test.ts covers the jq-PRESENT path and is
// left unchanged (regression guard). This file covers only the jq-ABSENT path
// and the parity assertion between the two paths.

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRIPT = path.join(__dirname, "../../src/plugin/hooks/teo-prompt-router.sh");

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

/**
 * Build a PATH string that omits the directory containing `jq`.
 * If jq is not installed at all, the current PATH already exercises the
 * no-jq fallback, so we return it as-is.
 */
function pathWithoutJq(): string {
  try {
    const jqPath = execSync("which jq", { encoding: "utf8" }).trim();
    const jqDir = path.dirname(jqPath);
    return (process.env.PATH ?? "")
      .split(":")
      .filter((p) => p !== jqDir)
      .join(":");
  } catch {
    // jq not found — current PATH already lacks it
    return process.env.PATH ?? "";
  }
}

/**
 * Run the router script WITHOUT jq on PATH.
 * Uses the raw string as stdin (callers that need JSON must pass it pre-encoded).
 */
function runRouterNoJqRaw(stdinContent: string): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execSync(`bash "${SCRIPT}"`, {
      input: stdinContent,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PATH: pathWithoutJq() },
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

/**
 * Run the router script WITHOUT jq on PATH, with a prompt string as input.
 * Wraps the prompt in `{"prompt":"..."}` JSON.
 */
function runRouterNoJq(prompt: string): { exitCode: number; stdout: string; stderr: string } {
  return runRouterNoJqRaw(JSON.stringify({ prompt }));
}

/**
 * Run the router script WITH jq on PATH (explicit jq-present path).
 * Identical to runRouter() in the existing test file.
 */
function runRouterWithJq(prompt: string): { exitCode: number; stdout: string; stderr: string } {
  const input = JSON.stringify({ prompt });
  try {
    const stdout = execSync(`bash "${SCRIPT}"`, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

// ---------------------------------------------------------------------------
// MISUSE — jq absent, inputs that must NOT inject additionalContext
// (M-1 through M-7)
// ---------------------------------------------------------------------------

describe("teo-prompt-router.sh (jq absent) — misuse: inputs that must not inject", () => {
  it("M-1: empty stdin → exit 0, no additionalContext", () => {
    const { exitCode, stdout } = runRouterNoJqRaw("");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("M-2: malformed JSON (bare string) → exit 0, no additionalContext", () => {
    const { exitCode, stdout } = runRouterNoJqRaw("not valid json at all");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("M-3: JSON with no prompt field → exit 0, no additionalContext", () => {
    const { exitCode, stdout } = runRouterNoJqRaw('{"other":"value"}');
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("M-4: JSON with null prompt → exit 0, no additionalContext", () => {
    const { exitCode, stdout } = runRouterNoJqRaw('{"prompt":null}');
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("M-5: non-/teo prompt → exit 0, no additionalContext", () => {
    const { exitCode, stdout } = runRouterNoJq("hello world");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("M-6: /teo help (utility keyword) → exit 0, no additionalContext", () => {
    const { exitCode, stdout } = runRouterNoJq("/teo help");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("M-7: bare /teo with no arguments → exit 0, no additionalContext", () => {
    const { exitCode, stdout } = runRouterNoJq("/teo");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY — jq absent, edge cases at the routing threshold
// (B-1 through B-5)
// ---------------------------------------------------------------------------

describe("teo-prompt-router.sh (jq absent) — boundary: edge cases", () => {
  it("B-1: /teo stop (utility keyword) → exit 0, no additionalContext", () => {
    const { exitCode, stdout } = runRouterNoJq("/teo stop");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("B-2: /teo status (utility keyword) → exit 0, no additionalContext", () => {
    const { exitCode, stdout } = runRouterNoJq("/teo status");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("B-3: /teofoo bar — both jq-present and jq-absent paths agree (parity assertion)", () => {
    // The routing predicate `[[ "$prompt" == /teo* ]]` matches /teofoo.
    // This test confirms the fallback extracts the prompt correctly and that
    // both code paths produce the same routing decision — not a specific outcome.
    const withJq = runRouterWithJq("/teofoo bar");
    const withoutJq = runRouterNoJq("/teofoo bar");
    expect(withoutJq.exitCode).toBe(withJq.exitCode);
    // Both paths must agree on whether to inject
    const withJqInjects = withJq.stdout.includes("additionalContext");
    const withoutJqInjects = withoutJq.stdout.includes("additionalContext");
    expect(withoutJqInjects).toBe(withJqInjects);
  });

  it("B-4: JSON with space after colon (pretty-printed) → exit 0, injects additionalContext", () => {
    // Claude Code emits compact JSON, but a single space after the colon is handled.
    const { exitCode, stdout } = runRouterNoJqRaw('{"prompt": "/teo build X" }');
    expect(exitCode).toBe(0);
    expect(stdout).toContain("additionalContext");
    expect(stdout).toContain("teo:capo");
  });

  it("B-5: JSON with escaped quotes in prompt → does not crash (exit 0)", () => {
    // The hard requirement is non-crash. Whether the extraction is perfect through
    // the escaping is a nice-to-have; fail-open contract is the gate here.
    const { exitCode } = runRouterNoJqRaw('{"prompt":"/teo build a \\"login\\" page"}');
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH — jq absent, substantive /teo prompts must inject
// (G-1 through G-5)
// ---------------------------------------------------------------------------

describe("teo-prompt-router.sh (jq absent) — golden path: injection must occur", () => {
  it("G-1: /teo build X → exit 0, stdout contains additionalContext and teo:capo", () => {
    const { exitCode, stdout } = runRouterNoJq("/teo build a login page");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("additionalContext");
    expect(stdout).toContain("teo:capo");
  });

  it("G-2: /teo fix X → exit 0, stdout contains additionalContext and teo:capo", () => {
    const { exitCode, stdout } = runRouterNoJq("/teo fix the broken auth middleware");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("additionalContext");
    expect(stdout).toContain("teo:capo");
  });

  it("G-3: injected output is valid JSON", () => {
    const { exitCode, stdout } = runRouterNoJq("/teo build a login page");
    expect(exitCode).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it("G-4: injected JSON has correct hookSpecificOutput shape", () => {
    const { exitCode, stdout } = runRouterNoJq("/teo build a login page");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
    };
    expect(parsed.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput?.additionalContext).toContain("CAPO_DIRECTIVE");
  });

  it("G-5: jq-present and jq-absent paths produce identical injection output", () => {
    const prompt = "/teo build a login page";
    const withJq = runRouterWithJq(prompt);
    const withoutJq = runRouterNoJq(prompt);
    expect(withoutJq.exitCode).toBe(0);
    expect(withJq.exitCode).toBe(0);
    // Exact output must match — parity test
    expect(withoutJq.stdout).toBe(withJq.stdout);
  });
});
