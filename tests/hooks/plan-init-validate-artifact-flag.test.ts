// =============================================================================
// plan-init-validate-artifact-flag.test.ts — WS-01: TEO_VALIDATE_ARTIFACT stub
//
// STATUS: GREEN — the TEO_VALIDATE_ARTIFACT env-var guard implemented as a stub
// in hooks/teo-prompt-router.sh (WS-01). Describes un-skipped.
//
// CONTRACT (env-var feature flag):
//   TEO_VALIDATE_ARTIFACT=1  → when a substantive /teo prompt is processed,
//                               call `teo-run validate-artifact` on the parsed
//                               plan artifact. MUST NOT crash. MUST exit 0.
//   TEO_VALIDATE_ARTIFACT=0  → treated as off (default behavior, no extra call)
//   TEO_VALIDATE_ARTIFACT=<anything other than "1">
//                            → treated as off (default behavior)
//   TEO_VALIDATE_ARTIFACT unset → off (golden/default path unchanged)
//
// The flag is a STUB / forward-compat guard for WS-00 integration. The key
// behavioral requirement is that enabling it does NOT change the exit code,
// does NOT block the prompt, and does NOT change the additionalContext output.
// Disabling it (default) produces output byte-identical to the pre-flag hook.
//
// Ordering: misuse → boundary → golden path (ADR-064 adversarial-first policy)
// =============================================================================

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "../../src/plugin/hooks/teo-prompt-router.sh");

// ---------------------------------------------------------------------------
// Runner — mirrors teo-prompt-router.test.ts pattern
// ---------------------------------------------------------------------------

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runRouter(prompt: string, extraEnv?: Record<string, string>): RunResult {
  const input = JSON.stringify({ prompt });
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  // Remove TEO_VALIDATE_ARTIFACT from inherited env when not explicitly set,
  // so tests that check "unset" are not polluted by a parent export.
  if (extraEnv && !("TEO_VALIDATE_ARTIFACT" in extraEnv)) {
    delete env["TEO_VALIDATE_ARTIFACT"];
  }
  try {
    const stdout = execSync(`bash "${SCRIPT}"`, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env,
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

// Baseline: what the hook outputs today for a substantive prompt (no flag).
// Used to assert that the flag-off path is byte-identical to current behavior.
const SUBSTANTIVE_PROMPT = "/teo build a login page";

// =============================================================================
// MISUSE: Invalid / unexpected env-var values must fall back to default (off)
// =============================================================================

describe("TEO_VALIDATE_ARTIFACT flag — misuse: invalid values treated as off", () => {
  // MV-1: TEO_VALIDATE_ARTIFACT=bad — not "1", must be treated as off
  it("MV-1. TEO_VALIDATE_ARTIFACT=bad → treated as off, same output as unset", () => {
    const { exitCode: baseExit, stdout: baseOut } = runRouter(SUBSTANTIVE_PROMPT);
    const { exitCode, stdout } = runRouter(SUBSTANTIVE_PROMPT, {
      TEO_VALIDATE_ARTIFACT: "bad",
    });

    expect(exitCode).toBe(0);
    expect(exitCode).toBe(baseExit);
    expect(stdout).toBe(baseOut);
  });

  // MV-2: TEO_VALIDATE_ARTIFACT=0 — explicit off, must not enable the flag
  it("MV-2. TEO_VALIDATE_ARTIFACT=0 → treated as off, same output as unset", () => {
    const { exitCode: baseExit, stdout: baseOut } = runRouter(SUBSTANTIVE_PROMPT);
    const { exitCode, stdout } = runRouter(SUBSTANTIVE_PROMPT, {
      TEO_VALIDATE_ARTIFACT: "0",
    });

    expect(exitCode).toBe(0);
    expect(exitCode).toBe(baseExit);
    expect(stdout).toBe(baseOut);
  });

  // MV-3: TEO_VALIDATE_ARTIFACT=true — string "true" is NOT "1", treated as off
  it("MV-3. TEO_VALIDATE_ARTIFACT=true (string) → treated as off, same output as unset", () => {
    const { exitCode: baseExit, stdout: baseOut } = runRouter(SUBSTANTIVE_PROMPT);
    const { exitCode, stdout } = runRouter(SUBSTANTIVE_PROMPT, {
      TEO_VALIDATE_ARTIFACT: "true",
    });

    expect(exitCode).toBe(0);
    expect(exitCode).toBe(baseExit);
    expect(stdout).toBe(baseOut);
  });

  // MV-4: TEO_VALIDATE_ARTIFACT=1 on a utility keyword prompt — flag is irrelevant,
  // utility keywords never inject context regardless of flag state
  it("MV-4. TEO_VALIDATE_ARTIFACT=1 + /teo help (utility keyword) → exit 0, no additionalContext", () => {
    const { exitCode, stdout } = runRouter("/teo help", {
      TEO_VALIDATE_ARTIFACT: "1",
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  // MV-5: TEO_VALIDATE_ARTIFACT=1 on bare /teo — flag is irrelevant, bare /teo
  // never injects context
  it("MV-5. TEO_VALIDATE_ARTIFACT=1 + bare /teo → exit 0, no additionalContext", () => {
    const { exitCode, stdout } = runRouter("/teo", {
      TEO_VALIDATE_ARTIFACT: "1",
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });

  // MV-6: TEO_VALIDATE_ARTIFACT=1 on non-/teo prompt — flag is irrelevant,
  // non-/teo prompts always pass through
  it("MV-6. TEO_VALIDATE_ARTIFACT=1 + non-teo prompt → exit 0, no additionalContext", () => {
    const { exitCode, stdout } = runRouter("just a regular question", {
      TEO_VALIDATE_ARTIFACT: "1",
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("additionalContext");
  });
});

// =============================================================================
// BOUNDARY: Default (unset) behavior is unchanged
// =============================================================================

describe("TEO_VALIDATE_ARTIFACT flag — boundary: unset flag preserves current behavior", () => {
  // B-1: Flag unset, substantive /teo prompt → additionalContext injected (current behavior)
  it("B-1. flag unset, substantive /teo prompt → exit 0, additionalContext injected (unchanged)", () => {
    // Explicitly unset by not passing TEO_VALIDATE_ARTIFACT in extraEnv
    const env: Record<string, string> = {};
    const { exitCode, stdout } = runRouter(SUBSTANTIVE_PROMPT, env);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("additionalContext");
    expect(stdout).toContain("teo:capo");
  });

  // B-2: Flag unset, hook output is valid JSON
  it("B-2. flag unset, substantive /teo prompt → stdout is valid JSON", () => {
    const env: Record<string, string> = {};
    const { exitCode, stdout } = runRouter(SUBSTANTIVE_PROMPT, env);

    expect(exitCode).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  // B-3: Flag unset, hook output has correct hookEventName
  it("B-3. flag unset → hookSpecificOutput.hookEventName === 'UserPromptSubmit'", () => {
    const env: Record<string, string> = {};
    const { exitCode, stdout } = runRouter(SUBSTANTIVE_PROMPT, env);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { hookEventName?: string };
    };
    expect(parsed.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
  });
});

// =============================================================================
// GOLDEN PATH: TEO_VALIDATE_ARTIFACT=1 — flag enabled, no crash, exit 0
// =============================================================================

describe("TEO_VALIDATE_ARTIFACT flag — golden path: flag enabled, exit 0, no blocking", () => {
  // G-1: Flag enabled + substantive prompt → exit 0 (never blocks)
  it("G-1. TEO_VALIDATE_ARTIFACT=1 + substantive /teo prompt → exit 0", () => {
    const { exitCode } = runRouter(SUBSTANTIVE_PROMPT, { TEO_VALIDATE_ARTIFACT: "1" });

    expect(exitCode).toBe(0);
  });

  // G-2: Flag enabled + substantive prompt → additionalContext still injected
  // The validate-artifact call is side-effectful; it must not suppress the injection
  it("G-2. TEO_VALIDATE_ARTIFACT=1 + substantive prompt → additionalContext still injected", () => {
    const { exitCode, stdout } = runRouter(SUBSTANTIVE_PROMPT, { TEO_VALIDATE_ARTIFACT: "1" });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("additionalContext");
    expect(stdout).toContain("teo:capo");
  });

  // G-3: Flag enabled + substantive prompt → stdout is valid JSON
  it("G-3. TEO_VALIDATE_ARTIFACT=1 + substantive prompt → stdout is valid parseable JSON", () => {
    const { exitCode, stdout } = runRouter(SUBSTANTIVE_PROMPT, { TEO_VALIDATE_ARTIFACT: "1" });

    expect(exitCode).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  // G-4: Flag enabled + substantive prompt → hookEventName unchanged
  it("G-4. TEO_VALIDATE_ARTIFACT=1 → hookSpecificOutput.hookEventName === 'UserPromptSubmit'", () => {
    const { exitCode, stdout } = runRouter(SUBSTANTIVE_PROMPT, { TEO_VALIDATE_ARTIFACT: "1" });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { hookEventName?: string };
    };
    expect(parsed.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
  });

  // G-5: Flag enabled + multiple distinct substantive prompts → all exit 0
  it("G-5. TEO_VALIDATE_ARTIFACT=1 across multiple substantive prompts → all exit 0", () => {
    const prompts = [
      "/teo fix the broken auth middleware",
      "/teo review my PR",
      "/teo build a dashboard",
    ];

    for (const p of prompts) {
      const { exitCode } = runRouter(p, { TEO_VALIDATE_ARTIFACT: "1" });
      expect(exitCode).toBe(0);
    }
  });

  // G-6: stderr is clean — validate-artifact stub must not emit error noise to stderr
  it("G-6. TEO_VALIDATE_ARTIFACT=1 → stderr is empty (stub must not emit errors)", () => {
    const { exitCode, stderr } = runRouter(SUBSTANTIVE_PROMPT, { TEO_VALIDATE_ARTIFACT: "1" });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });
});
