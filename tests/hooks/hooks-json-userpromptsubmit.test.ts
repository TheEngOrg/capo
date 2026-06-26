// WS-HOOK-01 — passing (post-impl, CAD gate 2)
//
// Tests that hooks/hooks.json registers the UserPromptSubmit event and
// references teo-prompt-router.sh.
//
// These tests FAIL until dev adds the UserPromptSubmit registration to
// hooks/hooks.json.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOOKS_JSON_PATH = path.join(__dirname, "../../src/plugin/hooks/hooks.json");

// ---------------------------------------------------------------------------
// MISUSE / BOUNDARY: structure guards — assert the file is parseable and
// has the top-level shape we depend on before making specific claims
// ---------------------------------------------------------------------------

describe("hooks/hooks.json — structure guards (boundary)", () => {
  it("hooks.json exists and is valid JSON", () => {
    expect(() => {
      const raw = readFileSync(HOOKS_JSON_PATH, "utf8");
      JSON.parse(raw);
    }).not.toThrow();
  });

  it("hooks.json has a top-level 'hooks' object", () => {
    const raw = readFileSync(HOOKS_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as { hooks?: unknown };
    expect(parsed).toHaveProperty("hooks");
    expect(typeof parsed.hooks).toBe("object");
    expect(parsed.hooks).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GOLDEN PATH: UserPromptSubmit registration and teo-prompt-router.sh reference
// (FAILS until dev adds the UserPromptSubmit entry)
// ---------------------------------------------------------------------------

describe("hooks/hooks.json — UserPromptSubmit registration (golden path)", () => {
  it("hooks.json contains a 'UserPromptSubmit' key", () => {
    const raw = readFileSync(HOOKS_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      hooks: Record<string, unknown>;
    };
    expect(Object.keys(parsed.hooks)).toContain("UserPromptSubmit");
  });

  it("UserPromptSubmit entry is a non-empty array", () => {
    const raw = readFileSync(HOOKS_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      hooks: Record<string, unknown[]>;
    };
    const entry = parsed.hooks["UserPromptSubmit"];
    expect(Array.isArray(entry)).toBe(true);
    expect((entry as unknown[]).length).toBeGreaterThan(0);
  });

  it("UserPromptSubmit entry references 'teo-prompt-router.sh'", () => {
    const raw = readFileSync(HOOKS_JSON_PATH, "utf8");
    // Search the raw JSON string for the script name — covers any nesting depth
    expect(raw).toContain("teo-prompt-router.sh");
  });

  it("teo-prompt-router.sh hook command is typed as 'command'", () => {
    const raw = readFileSync(HOOKS_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      hooks: {
        UserPromptSubmit?: Array<{
          hooks?: Array<{ type?: string; command?: string }>;
        }>;
      };
    };
    const entries = parsed.hooks["UserPromptSubmit"] ?? [];
    const allHookCommands = entries.flatMap((e) => e.hooks ?? []);
    const routerHook = allHookCommands.find((h) => h.command?.includes("teo-prompt-router.sh"));
    expect(routerHook).toBeDefined();
    expect(routerHook?.type).toBe("command");
  });
});
