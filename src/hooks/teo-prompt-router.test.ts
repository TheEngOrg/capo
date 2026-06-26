// WS-HOOK-01 — passing (post-impl, CAD gate 2)
//
// Tests for hooks/teo-prompt-router.sh — the UserPromptSubmit hook that
// injects CAPO_DIRECTIVE additionalContext for substantive /teo prompts.
//
// Ordering: misuse/boundary → golden path (per TEO convention, ADR-064)
// These tests FAIL until dev implements hooks/teo-prompt-router.sh.

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRIPT = path.join(__dirname, "../plugin/hooks/teo-prompt-router.sh");

/**
 * Run the router script with a given prompt string.
 * Returns { exitCode, stdout, stderr }.
 */
function runRouter(prompt: string): { exitCode: number; stdout: string; stderr: string } {
  const input = JSON.stringify({ prompt });
  try {
    const stdout = execSync(`bash "${SCRIPT}"`, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

// ---------------------------------------------------------------------------
// MISUSE / BOUNDARY: prompts that must NOT inject additionalContext
// (utility keywords, bare /teo, and non-teo prompts must pass through clean)
// ---------------------------------------------------------------------------

describe("teo-prompt-router.sh — bare /teo and utility keywords (misuse/boundary)", () => {
  it("bare /teo with no arguments → exit 0, no additionalContext injected", () => {
    const { exitCode, stdout } = runRouter("/teo");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("/teo help → exit 0, no additionalContext injected", () => {
    const { exitCode, stdout } = runRouter("/teo help");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("/teo status → exit 0, no additionalContext injected", () => {
    const { exitCode, stdout } = runRouter("/teo status");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("/teo version → exit 0, no additionalContext injected", () => {
    const { exitCode, stdout } = runRouter("/teo version");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("/teo list → exit 0, no additionalContext injected", () => {
    const { exitCode, stdout } = runRouter("/teo list");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("/teo stop → exit 0, no additionalContext injected", () => {
    const { exitCode, stdout } = runRouter("/teo stop");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });
});

describe("teo-prompt-router.sh — non-teo prompts (misuse/boundary)", () => {
  it("plain text 'hello world' → exit 0, no additionalContext injected", () => {
    const { exitCode, stdout } = runRouter("hello world");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  it("plain text 'what is 2+2' → exit 0, no additionalContext injected", () => {
    const { exitCode, stdout } = runRouter("what is 2+2");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: substantive /teo prompts must inject additionalContext
// ---------------------------------------------------------------------------

describe("teo-prompt-router.sh — substantive /teo prompts (golden path)", () => {
  it("/teo build a login page → exit 0, stdout contains additionalContext referencing teo:capo", () => {
    const { exitCode, stdout } = runRouter("/teo build a login page");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("additionalContext");
    expect(stdout).toContain("teo:capo");
  });

  it("/teo fix the broken auth middleware → exit 0, stdout contains additionalContext", () => {
    const { exitCode, stdout } = runRouter("/teo fix the broken auth middleware");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("additionalContext");
    expect(stdout).toContain("teo:capo");
  });

  it("/teo review my PR → exit 0, stdout contains additionalContext", () => {
    const { exitCode, stdout } = runRouter("/teo review my PR");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("additionalContext");
    expect(stdout).toContain("teo:capo");
  });

  it("injected output is valid parseable JSON", () => {
    const { exitCode, stdout } = runRouter("/teo build a login page");
    expect(exitCode).toBe(0);
    // stdout must be non-empty JSON when a directive is injected
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it("JSON output has hookSpecificOutput.hookEventName === 'UserPromptSubmit'", () => {
    const { exitCode, stdout } = runRouter("/teo build a login page");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
    };
    expect(parsed.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
  });

  it("JSON output has hookSpecificOutput.additionalContext containing CAPO_DIRECTIVE", () => {
    const { exitCode, stdout } = runRouter("/teo build a login page");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
    };
    expect(parsed.hookSpecificOutput?.additionalContext).toContain("CAPO_DIRECTIVE");
  });
});
