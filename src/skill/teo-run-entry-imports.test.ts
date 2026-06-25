// =============================================================================
// teo-run-entry-imports.test.ts — WS-LAZY-IMPORTS-01: lazy dynamic import enforcement
//
// STATUS: PASSING — post-impl (WS-LAZY-IMPORTS-01). All static engine/core
//         imports converted to lazy dynamic imports inside handlers.
//
// PURPOSE: Enforce that teo-run-entry.ts (the CLI entry point) loads engine/core
//          modules on-demand via dynamic import() inside each handler, not at
//          module load time. Prevents cold-start bottleneck in Claude Code tasks.
//
// Forward-going standard: E-1 (source-text characterization) acts as a lint rule
//         preventing static engine/core imports from re-entering teo-run-entry.ts.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Paths — derived from import.meta.url; never hardcoded /tmp or /Users paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../");
const BIN_PATH = path.join(REPO_ROOT, "bin", "teo-run.js");
const ENTRY_PATH = path.join(REPO_ROOT, "src", "skill", "teo-run-entry.ts");

// ---------------------------------------------------------------------------
// CLI runner — matches evaluate-gate-cli.test.ts pattern
// ---------------------------------------------------------------------------

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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "teo-lazy-imports-test-"));
  tempDirs.push(d);
  return d;
}

beforeEach(() => {
  // No shared state — each test manages its own temp dirs
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
// Source text helper — read entry point once per test section
// ---------------------------------------------------------------------------

function readEntrySource(): string {
  return fs.readFileSync(ENTRY_PATH, "utf8");
}

// =============================================================================
// MISUSE + BOUNDARY + ENFORCEMENT (source-text characterization)
//
// These tests read teo-run-entry.ts source text and assert the absence of
// static top-level imports of engine/core/bootstrap/lib modules.
//
// STATUS: PASSING — implementation complete (WS-LAZY-IMPORTS-01). Static imports
//   removed; dynamic imports added inside each handler.
// =============================================================================

describe("teo-run-entry-imports — misuse: static imports must be absent (WS-LAZY-IMPORTS-01)", () => {
  // M-1: validate-plan handler — PlanSchema must not be a top-level static import
  it("[M-1] validate-plan cold-start: source MUST NOT contain top-level `import { PlanSchema }`", () => {
    const src = readEntrySource();
    // A top-level static import looks like: import { PlanSchema } from "..."
    // Dynamic imports inside a handler look like: await import("../core/plan.js")
    const staticPlanSchemaImport = /^import\s+\{[^}]*PlanSchema[^}]*\}\s+from\s+/m;
    expect(src).not.toMatch(staticPlanSchemaImport);
  });

  // M-2: sign handler — HmacSigner must not be a top-level static import
  it("[M-2] sign cold-start: source MUST NOT contain top-level `import { HmacSigner }`", () => {
    const src = readEntrySource();
    const staticHmacSignerImport = /^import\s+\{[^}]*HmacSigner[^}]*\}\s+from\s+/m;
    expect(src).not.toMatch(staticHmacSignerImport);
  });

  // M-3: ledger-append handler — AppendOnlyLedger must not be a top-level static import
  it("[M-3] ledger-append cold-start: source MUST NOT contain top-level `import { AppendOnlyLedger }`", () => {
    const src = readEntrySource();
    const staticLedgerImport = /^import\s+\{[^}]*AppendOnlyLedger[^}]*\}\s+from\s+/m;
    expect(src).not.toMatch(staticLedgerImport);
  });

  // M-4: evaluate-gate handler — runGateProfile must not be a top-level static import
  it("[M-4] evaluate-gate cold-start: source MUST NOT contain top-level `import { runGateProfile }`", () => {
    const src = readEntrySource();
    const staticRunGateProfileImport = /^import\s+\{[^}]*runGateProfile[^}]*\}\s+from\s+/m;
    expect(src).not.toMatch(staticRunGateProfileImport);
  });

  // M-5: verify-ledger handler — verifyAsync must not be a top-level static import
  it("[M-5] verify-ledger cold-start: source MUST NOT contain top-level `import { verifyAsync }`", () => {
    const src = readEntrySource();
    const staticVerifyAsyncImport = /^import\s+\{[^}]*verifyAsync[^}]*\}\s+from\s+/m;
    expect(src).not.toMatch(staticVerifyAsyncImport);
  });

  // M-6: provision handler — provision() must not be a top-level static import
  it("[M-6] provision cold-start: source MUST NOT contain top-level `import { provision }`", () => {
    const src = readEntrySource();
    const staticProvisionImport = /^import\s+\{[^}]*\bprovision\b[^}]*\}\s+from\s+/m;
    expect(src).not.toMatch(staticProvisionImport);
  });

  // M-7: characterization — zero top-level static imports of engine-layer modules
  // Pattern: lines that start with `import ` (non-type) and reference ../core/, ../bootstrap/, ../lib/, ../engine/
  it("[M-7] characterization: source contains ZERO lines matching static engine-layer import pattern", () => {
    const src = readEntrySource();
    const lines = src.split("\n");
    const offendingLines = lines.filter((line) =>
      /^import\s+(?!type\s).+from\s+["']\.\.\/(core|bootstrap|lib|engine)\//.test(line)
    );
    expect(offendingLines).toHaveLength(0);
  });

  // B-1: type-only imports are acceptable — `import type` lines must NOT be flagged
  it("[B-1] boundary: `import type` lines for engine modules are acceptable (zero runtime cost)", () => {
    const src = readEntrySource();
    // Count lines that ARE type-only imports of engine-layer modules
    const lines = src.split("\n");
    const typeOnlyEngineImports = lines.filter((line) =>
      /^import\s+type\s+.+from\s+["']\.\.\/(core|bootstrap|lib|engine)\//.test(line)
    );
    // The enforcement rule (M-7 / E-1) must NOT flag these — they are zero-cost
    // Verify by running M-7 logic against only type imports (expect 0 offenders)
    const offendingLines = lines.filter((line) =>
      /^import\s+(?!type\s).+from\s+["']\.\.\/(core|bootstrap|lib|engine)\//.test(line)
    );
    // Type imports may exist (they are fine); non-type static imports must not
    expect(offendingLines).toHaveLength(0);
    // Confirm the type-only filter actually excludes them from offense count
    for (const typeLine of typeOnlyEngineImports) {
      expect(offendingLines).not.toContain(typeLine);
    }
  });

  // B-2: Node.js builtins used only in specific handlers must not be top-level static imports
  // fs and crypto are only needed in handleVerifyLedger — they should move inside that handler
  it("[B-2] boundary: top-level static `node:fs` and `node:crypto` builtins must be absent (handler-scoped only)", () => {
    const src = readEntrySource();
    // These builtins are used only in handleVerifyLedger — they must be lazy inside the handler
    const staticFsImport = /^import\s+\*\s+as\s+fs\s+from\s+["']node:fs["']/m;
    const staticCryptoImport = /^import\s+\*\s+as\s+crypto\s+from\s+["']node:crypto["']/m;
    expect(src).not.toMatch(staticFsImport);
    expect(src).not.toMatch(staticCryptoImport);
  });
});

// =============================================================================
// ENFORCEMENT (forward-going standard — source-text characterization)
//
// E-1 is the lint-equivalent gate. Once dev implements lazy imports, this
// test prevents any future PR from re-introducing static engine-layer imports.
//
// STATUS: PASSING — implementation complete (WS-LAZY-IMPORTS-01).
//         Forward-going gate enforced.
// =============================================================================

describe("teo-run-entry-imports — enforcement: forward-going static import gate (E-1)", () => {
  it("[E-1] source-text characterization: teo-run-entry.ts contains NO static imports of ../core/, ../bootstrap/, ../lib/, or ../engine/", () => {
    const src = fs.readFileSync(ENTRY_PATH, "utf8");
    const lines = src.split("\n");

    // Collect any offending lines for a useful failure message
    const offenders = lines
      .map((line, i) => ({ line, lineNum: i + 1 }))
      .filter(({ line }) =>
        /^import\s+(?!type\s).+from\s+["']\.\.\/(core|bootstrap|lib|engine)\//.test(line)
      );

    if (offenders.length > 0) {
      const detail = offenders
        .map(({ lineNum, line }) => `  line ${lineNum}: ${line.trim()}`)
        .join("\n");
      throw new Error(
        `[E-1] teo-run-entry.ts still has ${offenders.length} static engine-layer import(s).\n` +
          `These must be converted to lazy dynamic imports inside each handler:\n${detail}`
      );
    }

    expect(offenders).toHaveLength(0);
  });
});

// =============================================================================
// GOLDEN PATH: CLI subprocess tests — each command works end-to-end
//
// These tests spawn teo-run-entry.ts via CLI and assert correct output.
// They PASS on current code (CLI works before the refactor) and must
// continue to PASS after dev converts the imports to lazy form.
//
// NOT skipped — they are the regression gate for the refactor.
// =============================================================================

// ---------------------------------------------------------------------------
// Fixtures reused across golden-path tests
// ---------------------------------------------------------------------------

const VALID_PLAN = {
  plan_id: "test-plan-lazy-01",
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

describe("teo-run-entry-imports — golden path: CLI commands work after lazy-import refactor", () => {
  // G-1: provision still works end-to-end via CLI subprocess
  it("[G-1] provision command → exit 0 or structured error JSON (no crash from missing lazy module)", () => {
    const bundleDir = makeTempDir();
    const homeDir = makeTempDir();

    // Write a minimal valid agent file so provision has something to read
    const agentContent =
      `---\n` +
      `agent_id: alpha\n` +
      `name: Alpha\n` +
      `role: Test agent.\n` +
      `disallowedTools_default:\n` +
      `---\n\n` +
      `# alpha\n\nBody text.\n`;
    fs.writeFileSync(path.join(bundleDir, "alpha.md"), agentContent, "utf8");

    const input = JSON.stringify({
      bundleDir,
      homeDir,
      revocationOpts: {
        // All-zeros signature → treated as unsigned; no CLAUDE_PLUGIN_ROOT → fail-open
        signature: Array.from(new Uint8Array(64).fill(0)),
        publicKey: Array.from(new Uint8Array(32).fill(0x02)),
        keyId: "test-key",
        revocationList: { revoked_keys: [] },
      },
    });

    const { exitCode, stdout } = runCli("provision", input);

    // May succeed (exit 0) or exit 1 with { status: "error" } — both are structured outcomes.
    // What must NOT happen is a crash (non-JSON stdout or ENOENT) caused by a missing lazy import.
    expect(typeof stdout).toBe("object");
    expect(stdout).not.toBeNull();
    const result = stdout as Record<string, unknown>;
    expect(result).toHaveProperty("status");
    expect([0, 1]).toContain(exitCode);
  });

  // G-2: validate-plan still works — valid plan → exit 0, { valid: true }
  it("[G-2] validate-plan command → exit 0, { valid: true } for well-formed plan", () => {
    const { exitCode, stdout } = runCli("validate-plan", JSON.stringify(VALID_PLAN));

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ valid: true });
  });

  // G-3: sign still works — valid payload → exit 0, { signature: 64-char hex }
  it("[G-3] sign command → exit 0, { signature: 64-char lowercase hex }", () => {
    const keyringBase = makeTempDir();
    const input = JSON.stringify({
      baseDir: keyringBase,
      keyring_id: "default",
      payload: {
        plan_id: "plan-lazy-001",
        task_id: "task-lazy-001",
        actor_id: "eng",
        verdict: "PASS",
        ts: "2026-06-20T00:00:00.000Z",
        seq: 1,
      },
    });

    const { exitCode, stdout } = runCli("sign", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(typeof result["signature"]).toBe("string");
    const sig = result["signature"] as string;
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  // G-4: ledger-append still works — valid entry → exit 0, { seq: number, ts: string }
  it("[G-4] ledger-append command → exit 0, { seq: number >= 1, ts: valid ISO-8601 }", () => {
    const ledgerBase = makeTempDir();
    const input = JSON.stringify({
      baseDir: ledgerBase,
      session_id: "session-lazy-001",
      entry: {
        session_id: "session-lazy-001",
        workflow_id: "wf-lazy-001",
        task_id: null,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "PLAN",
        verdict: null,
        detail: { note: "lazy-imports-01 regression test" },
      },
    });

    const { exitCode, stdout } = runCli("ledger-append", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(typeof result["seq"]).toBe("number");
    expect(result["seq"] as number).toBeGreaterThanOrEqual(1);
    expect(typeof result["ts"]).toBe("string");
    const ts = new Date(result["ts"] as string);
    expect(isNaN(ts.getTime())).toBe(false);
  });

  // G-5: evaluate-gate still works — valid input → exit 0, ENFORCED output with PASS verdict
  it("[G-5] evaluate-gate command → exit 0, verdict: 'PASS', status: 'ENFORCED'", () => {
    const ledgerBase = makeTempDir();
    const input = JSON.stringify({
      gate_id: "gate-lazy-001",
      task_id: "task-lazy-001",
      session_id: "session-lazy-gate-001",
      gate_type: "dev",
      context: {
        cwd: REPO_ROOT,
        mock_runner: { exit_code: 0, stdout: "100 passed\nAll files | 100.0", stderr: "" },
      },
      ledger_base_dir: ledgerBase,
    });

    const { exitCode, stdout } = runCli("evaluate-gate", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result["verdict"]).toBe("PASS");
    // WS-06: real gate profiles now output ENFORCED
    expect(result["status"]).toBe("ENFORCED");
    expect(result["gate_id"]).toBe("gate-lazy-001");
    expect(result["task_id"]).toBe("task-lazy-001");
    expect(result["session_id"]).toBe("session-lazy-gate-001");
    expect(result["gate_type"]).toBe("dev");
    expect(typeof result["ledger_seq"]).toBe("number");
    expect(typeof result["evaluated_at"]).toBe("string");
    const ts = new Date(result["evaluated_at"] as string);
    expect(isNaN(ts.getTime())).toBe(false);
  });

  // G-6: verify-ledger — after dev adds the handler, assert structured JSON output
  // (no crash caused by a module that failed to lazy-load)
  it("[G-6] verify-ledger command → exits with structured JSON (no unhandled crash or non-JSON stdout)", () => {
    const ledgerBase = makeTempDir();
    const sessionId = "session-verify-lazy-001";

    // Seed a ledger entry so there is something to verify
    const appendInput = JSON.stringify({
      baseDir: ledgerBase,
      session_id: sessionId,
      entry: {
        session_id: sessionId,
        workflow_id: "wf-verify",
        task_id: null,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "PLAN",
        verdict: null,
        detail: { note: "seed entry for verify-ledger test" },
      },
    });
    runCli("ledger-append", appendInput);

    const input = JSON.stringify({
      session_id: sessionId,
      ledger_base_dir: ledgerBase,
    });

    const { stdout, stdoutRaw } = runCli("verify-ledger", input);

    // Must produce non-empty parseable JSON — not a raw Node crash dump
    expect(stdoutRaw.trim()).not.toBe("");
    expect(typeof stdout).toBe("object");
    expect(stdout).not.toBeNull();
    // Output must carry at least one of: ok, verified, error, status
    const result = stdout as Record<string, unknown>;
    const hasExpectedShape =
      "ok" in result || "verified" in result || "error" in result || "status" in result;
    expect(hasExpectedShape).toBe(true);
  });
});
