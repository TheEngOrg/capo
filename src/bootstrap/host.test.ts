// =============================================================================
// host.test.ts — WS-GO-02: HostContext / detectHost() spec
//
// STATUS: PASSING — implementation in src/bootstrap/host.ts
//
// CONTRACT (what dev must export from src/bootstrap/host.ts):
//
//   type HostKind = "claude-code-plugin" | "standalone"
//
//   interface HostContext {
//     kind: HostKind;
//     pluginRoot?: string;
//     dataDir?: string;
//   }
//
//   function detectHost(): HostContext
//
// RULES:
//   - CLAUDE_PLUGIN_ROOT set and non-empty → kind="claude-code-plugin", pluginRoot=value
//   - CLAUDE_PLUGIN_ROOT unset or empty string → kind="standalone", pluginRoot=undefined
//   - CLAUDE_PLUGIN_DATA present alongside CLAUDE_PLUGIN_ROOT → dataDir=value
//   - CLAUDE_PLUGIN_DATA present without CLAUDE_PLUGIN_ROOT (standalone) → dataDir ignored
//     (or set — not covered by spec; standalone kind takes precedence)
//
// Ordering: misuse → boundary → golden path (ADR-064 adversarial-first policy)
// =============================================================================

import { describe, it, expect, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Import the module under test.
// The catch() fallback sets detectHost to undefined if the module fails to load;
// requireImpl() guards every test. Under normal (post-implementation) conditions
// the import succeeds and moduleLoaded is true.
// ---------------------------------------------------------------------------

const { detectHost } = await import("./host.js").catch(() => ({
  detectHost: undefined,
}));

const moduleLoaded = typeof detectHost === "function";

function requireImpl(name: string): void {
  if (!moduleLoaded) {
    throw new Error(
      `[WS-GO-02] ${name}: detectHost() not yet implemented. ` +
        `Create src/bootstrap/host.ts exporting detectHost() to make this test pass.`
    );
  }
}

// ---------------------------------------------------------------------------
// Env-var cleanup helpers.
// vi.stubEnv is the preferred mechanism, but afterEach restores manually too
// for belt-and-suspenders isolation.
// ---------------------------------------------------------------------------

const ENV_VARS = ["CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_DATA"] as const;

/** Snapshot env vars before each test for manual restore in afterEach. */
const savedEnv: Partial<Record<string, string>> = {};

function saveEnv(): void {
  for (const key of ENV_VARS) {
    savedEnv[key] = process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_VARS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
}

afterEach(() => {
  restoreEnv();
});

// =============================================================================
// MISUSE: Invalid / edge-case CLAUDE_PLUGIN_ROOT values
// =============================================================================

describe("detectHost() — misuse: empty or missing CLAUDE_PLUGIN_ROOT → standalone", () => {
  // T4: CLAUDE_PLUGIN_ROOT set to empty string → kind="standalone" (treat empty as unset)
  it("T4. CLAUDE_PLUGIN_ROOT set to empty string → kind='standalone', pluginRoot=undefined", () => {
    requireImpl("T4: empty CLAUDE_PLUGIN_ROOT");
    saveEnv();
    process.env["CLAUDE_PLUGIN_ROOT"] = "";
    delete process.env["CLAUDE_PLUGIN_DATA"];

    const result = (detectHost as () => { kind: string; pluginRoot?: string; dataDir?: string })();

    expect(result.kind).toBe("standalone");
    expect(result.pluginRoot).toBeUndefined();
  });

  // T2 (misuse guard): CLAUDE_PLUGIN_ROOT unset → kind="standalone"
  // This is the fail-safe — an absent root means we're not in a plugin context.
  it("T2. CLAUDE_PLUGIN_ROOT unset → kind='standalone', pluginRoot=undefined", () => {
    requireImpl("T2: unset CLAUDE_PLUGIN_ROOT");
    saveEnv();
    delete process.env["CLAUDE_PLUGIN_ROOT"];
    delete process.env["CLAUDE_PLUGIN_DATA"];

    const result = (detectHost as () => { kind: string; pluginRoot?: string; dataDir?: string })();

    expect(result.kind).toBe("standalone");
    expect(result.pluginRoot).toBeUndefined();
  });
});

// =============================================================================
// BOUNDARY: CLAUDE_PLUGIN_ROOT + CLAUDE_PLUGIN_DATA combinations
// =============================================================================

describe("detectHost() — boundary: CLAUDE_PLUGIN_ROOT + CLAUDE_PLUGIN_DATA combinations", () => {
  // T3: Both CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA set → dataDir=CLAUDE_PLUGIN_DATA value
  it("T3. CLAUDE_PLUGIN_ROOT + CLAUDE_PLUGIN_DATA both set → kind='claude-code-plugin', dataDir=CLAUDE_PLUGIN_DATA value", () => {
    requireImpl("T3: CLAUDE_PLUGIN_ROOT + CLAUDE_PLUGIN_DATA");
    saveEnv();
    process.env["CLAUDE_PLUGIN_ROOT"] = "/opt/claude-plugins/teo";
    process.env["CLAUDE_PLUGIN_DATA"] = "/var/claude-plugin-data/teo";

    const result = (detectHost as () => { kind: string; pluginRoot?: string; dataDir?: string })();

    expect(result.kind).toBe("claude-code-plugin");
    expect(result.pluginRoot).toBe("/opt/claude-plugins/teo");
    expect(result.dataDir).toBe("/var/claude-plugin-data/teo");
  });

  // CLAUDE_PLUGIN_ROOT set but CLAUDE_PLUGIN_DATA absent → dataDir=undefined
  it("CLAUDE_PLUGIN_ROOT set, CLAUDE_PLUGIN_DATA absent → kind='claude-code-plugin', dataDir=undefined", () => {
    requireImpl("boundary: CLAUDE_PLUGIN_ROOT without CLAUDE_PLUGIN_DATA");
    saveEnv();
    process.env["CLAUDE_PLUGIN_ROOT"] = "/opt/claude-plugins/teo";
    delete process.env["CLAUDE_PLUGIN_DATA"];

    const result = (detectHost as () => { kind: string; pluginRoot?: string; dataDir?: string })();

    expect(result.kind).toBe("claude-code-plugin");
    expect(result.pluginRoot).toBe("/opt/claude-plugins/teo");
    expect(result.dataDir).toBeUndefined();
  });
});

// =============================================================================
// GOLDEN PATH: CLAUDE_PLUGIN_ROOT set and non-empty → plugin context
// =============================================================================

describe("detectHost() — golden path: CLAUDE_PLUGIN_ROOT set → plugin context", () => {
  // T1: CLAUDE_PLUGIN_ROOT set → kind="claude-code-plugin", pluginRoot=value
  it("T1. CLAUDE_PLUGIN_ROOT set → kind='claude-code-plugin', pluginRoot=value", () => {
    requireImpl("T1: CLAUDE_PLUGIN_ROOT set");
    saveEnv();
    process.env["CLAUDE_PLUGIN_ROOT"] = "/opt/claude-plugins/teo";
    delete process.env["CLAUDE_PLUGIN_DATA"];

    const result = (detectHost as () => { kind: string; pluginRoot?: string; dataDir?: string })();

    expect(result.kind).toBe("claude-code-plugin");
    expect(result.pluginRoot).toBe("/opt/claude-plugins/teo");
  });

  // pluginRoot value matches the CLAUDE_PLUGIN_ROOT env var exactly (not trimmed/mutated)
  it("pluginRoot preserves the exact CLAUDE_PLUGIN_ROOT value including trailing slash", () => {
    requireImpl("golden: pluginRoot exact value");
    saveEnv();
    process.env["CLAUDE_PLUGIN_ROOT"] = "/path/with/trailing/slash/";
    delete process.env["CLAUDE_PLUGIN_DATA"];

    const result = (detectHost as () => { kind: string; pluginRoot?: string; dataDir?: string })();

    expect(result.kind).toBe("claude-code-plugin");
    expect(result.pluginRoot).toBe("/path/with/trailing/slash/");
  });

  // result shape has no extra keys beyond { kind, pluginRoot?, dataDir? }
  it("result shape has only kind, pluginRoot, and optional dataDir keys", () => {
    requireImpl("golden: result shape");
    saveEnv();
    process.env["CLAUDE_PLUGIN_ROOT"] = "/fake/plugin";
    delete process.env["CLAUDE_PLUGIN_DATA"];

    const result = (detectHost as () => { kind: string; pluginRoot?: string; dataDir?: string })();

    const allowedKeys = new Set(["kind", "pluginRoot", "dataDir"]);
    for (const key of Object.keys(result)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});
