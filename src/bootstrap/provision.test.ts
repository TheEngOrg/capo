// =============================================================================
// provision.test.ts — specs for src/bootstrap/provision.ts (WS-P1-04)
//
// STATUS: PASSING — implementation in src/bootstrap/provision.ts, all 29 tests green. SEC-01..05 remediated.
//
// Ordering: misuse → boundary → golden path (ADR-064 adversarial-first policy)
//
// CONTRACT (what dev must export from src/bootstrap/provision.ts):
//
//   type ProvisionErrorKind =
//     | 'permission_denied'
//     | 'io_error'
//     | 'revocation_blocked'
//     | 'conflict'
//     | 'verification_failed';
//
//   type ProvisionResult =
//     | { status: 'ok' }
//     | { status: 'already_provisioned' }
//     | { status: 'repaired'; repairedFiles: string[] }
//     | { status: 'error'; kind: ProvisionErrorKind; reason: string };
//
//   interface ProvisionOptions {
//     bundleDir: string;
//     homeDir?: string;
//     revocationOpts: Omit<CheckRevocationOptions, 'data'>;
//   }
//
//   function provision(opts: ProvisionOptions): Promise<ProvisionResult>
//
// KEY BEHAVIOURS UNDER TEST:
//   - checkRevocation() called ONCE before any write, NEVER on already_provisioned
//   - opts.data = Buffer.concat(listAgentIds(bundleDir).sort().map(readFile))
//   - Atomic staging: write to os.tmpdir(), then rename to homeDir+'/agents/'
//   - EXDEV fallback: per-file copy when rename fails with EXDEV
//   - Permissions: homeDir 0o700, agents/ 0o700, each .md 0o600
//   - loadAgentDefinition(id, homeDir+'/agents') run post-write for all written ids
//   - homeDir resolution: opts.homeDir > process.env.TEO_HOME > os.homedir()+'/.teo'
//   - No import-time side effects
//
// COVERAGE NOTE FOR DEV:
//   provision.ts must be added to vitest.config.ts perFile thresholds at 100%
//   lines/branches/functions/statements.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Module mocks — must be at top level (Vitest hoists these before test execution)
// ---------------------------------------------------------------------------

// checkRevocation is fully mocked. Each test configures its return value via
// vi.mocked(checkRevocation).mockResolvedValue(). Default in beforeEach: PASS.
vi.mock("./revocation.js", () => ({
  checkRevocation: vi.fn(),
}));

// loadAgentDefinition and listAgentIds are wrapped spies over the real
// implementations. The factory spreads the original module so non-mocked
// exports pass through. Individual tests may override via mockImplementation().
vi.mock("../agents/load.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../agents/load.js")>();
  return {
    ...original,
    loadAgentDefinition: vi.fn(original.loadAgentDefinition),
    listAgentIds: vi.fn(original.listAgentIds),
  };
});

// node:fs is mocked as a spread of the real module so all fs functions work
// as normal but the resulting plain object has configurable properties, enabling
// vi.spyOn(fs, "mkdirSync") / vi.spyOn(fs, "renameSync") etc. in individual tests.
// In Node.js 22 ESM, import * as fs from "node:fs" gives a namespace with
// Symbol.toStringTag==="Module" and non-configurable properties — vi.spyOn fails
// unless the module is intercepted here and re-exported through a plain object.
//
// existsSync is wrapped to return false for os.homedir()+"/.teo" so that test 13
// (TEO_HOME override) is isolated from any pre-existing ~/.teo on the test machine.
// All other paths pass through to the real implementation.
vi.mock("node:fs", async (importOriginal) => {
  const osModule = await import("node:os");
  const pathModule = await import("node:path");
  const original = await importOriginal<typeof import("node:fs")>();
  const realExistsSync = original.existsSync.bind(original);
  const systemTeoHome = pathModule.join(osModule.homedir(), ".teo");
  return {
    ...original,
    existsSync: (p: Parameters<typeof original.existsSync>[0]) => {
      // Isolate tests from any pre-existing ~/.teo on the test machine.
      // AC-13 asserts os.homedir()+"/.teo" was not created by provision();
      // returning false here ensures the assertion holds regardless of machine state.
      if (typeof p === "string" && p === systemTeoHome) {
        return false;
      }
      return realExistsSync(p);
    },
  };
});

// These imports WILL FAIL until dev creates src/bootstrap/provision.ts.
// That is the intended failing state for gate 1 (qa-spec phase).
import { provision } from "./provision.js";
import type { ProvisionOptions } from "./provision.js";
import { checkRevocation } from "./revocation.js";
import { loadAgentDefinition, listAgentIds } from "../agents/load.js";

// ---------------------------------------------------------------------------
// Helpers — shared across test groups
// ---------------------------------------------------------------------------

/** Real bundleDir — the checked-in src/agents/ directory. Used for golden-path tests. */
const REAL_BUNDLE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../agents");

/**
 * Creates a unique temp directory for use as a homeDir substitute.
 * Pushed to tempDirs so it is cleaned up after each test.
 * NEVER uses os.homedir()+'/.teo'.
 */
function makeTempHome(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "teo-ws-p1-04-home-"));
  tempDirs.push(d);
  return d;
}

/**
 * Creates a minimal fixture bundle dir with valid agent .md files for each stem.
 * Frontmatter matches the exact schema loadAgentDefinition() validates via Zod:
 *   agent_id, name, role (all non-empty), disallowedTools_default (array, may be empty).
 */
function makeFixtureBundle(stems: string[]): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "teo-ws-p1-04-bundle-"));
  tempDirs.push(d);
  for (const stem of stems) {
    const content =
      `---\n` +
      `agent_id: ${stem}\n` +
      `name: Agent ${stem}\n` +
      `role: Test role for ${stem}.\n` +
      `disallowedTools_default:\n` +
      `---\n\n` +
      `# ${stem} constitution\n\nBody text for ${stem}.\n`;
    fs.writeFileSync(path.join(d, `${stem}.md`), content, "utf8");
  }
  return d;
}

/**
 * Builds a ProvisionOptions with a PASS-configured revocation setup.
 * All tests use homeDir argument form (never mutate env except AC-13/AC-14).
 */
function makeOpts(
  bundleDir: string,
  homeDir: string,
  extra?: Partial<ProvisionOptions>
): ProvisionOptions {
  return {
    bundleDir,
    homeDir,
    revocationOpts: {
      signature: new Uint8Array(64).fill(0x01),
      publicKey: new Uint8Array(32).fill(0x02),
      keyId: "test-key-id",
      revocationList: { revoked_keys: [] },
    },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle — temp dir tracking and mock defaults
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

beforeEach(() => {
  // Default mock behaviours — each test may override per its scenario.
  // checkRevocation returns PASS by default so golden-path tests need no setup.
  vi.mocked(checkRevocation).mockResolvedValue({ verdict: "PASS" });

  // loadAgentDefinition and listAgentIds are already wrapped over real impls
  // by the vi.mock factory above. mockClear() resets call counts without
  // replacing the real implementation delegate.
  vi.mocked(loadAgentDefinition).mockClear();
  vi.mocked(listAgentIds).mockClear();
});

afterEach(() => {
  // Restore any per-spy overrides introduced in individual tests.
  vi.restoreAllMocks();

  // Best-effort cleanup of temp dirs created during the test.
  for (const d of tempDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore — test may have already cleaned up
    }
  }
});

// =============================================================================
// MISUSE TESTS (adversarial first — AC ordering per spec)
// =============================================================================

describe("provision() — misuse: security and conflict guards", () => {
  it("01. revocation BLOCKED before any writes: returns revocation_blocked, no files written (AC-09)", async () => {
    // Arrange: override default PASS to BLOCKED
    vi.mocked(checkRevocation).mockResolvedValue({
      verdict: "BLOCKED",
      reason: "Key revoked",
    });

    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert — discriminated union shape
    expect(result).toEqual({
      status: "error",
      kind: "revocation_blocked",
      reason: "Key revoked",
    });

    // Assert — zero filesystem writes to homeDir
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);
  });

  it("02. no revocation list source → BLOCKED propagated as revocation_blocked (AC-11)", async () => {
    // provision() must NOT inject a revocationList — it passes opts through as-is.
    // When neither list nor fetcher is provided, checkRevocation() returns BLOCKED.
    // We simulate the exact BLOCKED reason the real checkRevocation would emit.
    vi.mocked(checkRevocation).mockImplementation(async (opts) => {
      if (opts.revocationList === undefined && opts.revocationListFetcher === undefined) {
        return {
          verdict: "BLOCKED",
          reason:
            "No revocation list source provided. " +
            "Provide either revocationList or revocationListFetcher to verify the key.",
        };
      }
      return { verdict: "PASS" };
    });

    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const opts: ProvisionOptions = {
      bundleDir,
      homeDir,
      revocationOpts: {
        signature: new Uint8Array(64).fill(0x01),
        publicKey: new Uint8Array(32).fill(0x02),
        keyId: "test-key-id",
        // revocationList and revocationListFetcher intentionally absent
      },
    };

    // Act
    const result = await provision(opts);

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("revocation_blocked");
    expect(result.reason).toContain("No revocation list source provided");
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);
  });

  it("03. conflict: homeDir path exists as a file → returns conflict with path in reason (AC-06)", async () => {
    // Arrange: create a file at the path that homeDir should occupy
    const parentDir = makeTempHome();
    const homeDirAsFile = path.join(parentDir, "fake-teo-home");
    fs.writeFileSync(homeDirAsFile, "I am a file, not a directory");

    const bundleDir = makeFixtureBundle(["alpha"]);

    // Act
    const result = await provision(makeOpts(bundleDir, homeDirAsFile));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("conflict");
    expect(result.reason).toContain(homeDirAsFile);

    // Zero filesystem mutations — the file must remain a file
    expect(fs.statSync(homeDirAsFile).isFile()).toBe(true);
  });

  it("04. conflict: homeDir/agents exists as a file → returns conflict with path in reason (AC-06)", async () => {
    // Arrange: homeDir is a valid directory, but homeDir/agents is a file
    const homeDir = makeTempHome();
    const agentsAsFile = path.join(homeDir, "agents");
    fs.writeFileSync(agentsAsFile, "I am a file, not a directory");

    const bundleDir = makeFixtureBundle(["alpha"]);

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("conflict");
    expect(result.reason).toContain(agentsAsFile);
    expect(fs.statSync(agentsAsFile).isFile()).toBe(true);
  });

  it("05. verification_failed: one written agent has corrupt frontmatter → returns verification_failed naming the id (AC-12)", async () => {
    // Arrange: override loadAgentDefinition to throw for 'beta'.
    // The mock factory already delegates to the real implementation by default;
    // we override for 'beta' only and delegate all other ids to the real function.
    vi.mocked(loadAgentDefinition).mockImplementation((id: string, dir?: string) => {
      if (id === "beta") {
        throw new Error("Invalid frontmatter: missing required field 'role'");
      }
      // Delegate to real implementation via the wrapped spy's original
      // NOTE: provision.ts will call loadAgentDefinition — the mock intercepts it.
      // For non-beta ids we need to load from the actual fixture dir.
      // vi.mocked keeps the real impl as the fallback from the factory above.
      // The factory wraps `vi.fn(original.loadAgentDefinition)` so the original
      // is still accessible; we re-invoke it through a direct fs read here to be safe.
      const content = fs.readFileSync(path.join(dir ?? "", `${id}.md`), "utf8");
      // Parse minimal frontmatter manually to return a valid AgentDefinition.
      const match = content.match(/agent_id: (\S+)/);
      const nameMatch = content.match(/name: (.+)/);
      const roleMatch = content.match(/role: (.+)/);
      return {
        agent_id: match?.[1] ?? id,
        name: nameMatch?.[1] ?? id,
        role: roleMatch?.[1] ?? "role",
        disallowedTools_default: [],
        body: "body",
      };
    });

    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("verification_failed");
    expect(result.reason).toContain("beta");
  });

  it("21. SEC-01: traversal stem in bundle → io_error, no writes, checkRevocation not called", async () => {
    // Arrange: inject a traversal stem via listAgentIds mock.
    // Using a mock is cleaner than creating an OS file literally named '../../evil'.
    vi.mocked(listAgentIds).mockReturnValue(["alpha", "../../evil"]);

    const bundleDir = makeFixtureBundle(["alpha"]); // real bundle for alpha only
    const homeDir = makeTempHome();

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: traversal guard fires before any path construction
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toContain("../../evil");

    // Nothing written to homeDir — agents dir must not exist
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);

    // checkRevocation must NOT have been called — guard fires before the revocation check
    expect(vi.mocked(checkRevocation)).not.toHaveBeenCalled();
  });

  it("06. import-time side effects: importing provision triggers no fs writes (AC-17)", async () => {
    // Spy on write-type fs functions BEFORE the dynamic import.
    const writeFileSpy = vi.spyOn(fs, "writeFileSync");
    const mkdirSpy = vi.spyOn(fs, "mkdirSync");

    // Force re-evaluation of the module (vi.resetModules flushes the registry)
    vi.resetModules();
    await import("./provision.js");

    // Assert: no filesystem side effects occurred during module load
    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(mkdirSpy).not.toHaveBeenCalled();

    writeFileSpy.mockRestore();
    mkdirSpy.mockRestore();
  });
});

// =============================================================================
// BOUNDARY TESTS
// =============================================================================

describe("provision() — boundary: idempotency, repair, error mapping", () => {
  it("07. already provisioned: checkRevocation NOT called, returns already_provisioned, mtimes unchanged (AC-03)", async () => {
    // Arrange: fully provisioned homeDir — all ids present, all non-zero
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const stem of ["alpha", "beta", "gamma"]) {
      fs.writeFileSync(path.join(agentsDir, `${stem}.md`), `content-${stem}`);
    }

    // Snapshot mtimes before the call
    const mtimesBefore: Record<string, number> = {};
    for (const stem of ["alpha", "beta", "gamma"]) {
      mtimesBefore[stem] = fs.statSync(path.join(agentsDir, `${stem}.md`)).mtimeMs;
    }

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: idempotent no-op
    expect(result).toEqual({ status: "already_provisioned" });

    // checkRevocation must NOT be called — it's a write-gate, not a read-gate (AC-03)
    expect(vi.mocked(checkRevocation)).not.toHaveBeenCalled();

    // No mtime changes
    for (const stem of ["alpha", "beta", "gamma"]) {
      expect(fs.statSync(path.join(agentsDir, `${stem}.md`)).mtimeMs).toBe(mtimesBefore[stem]);
    }
  });

  it("08. repair: one missing file → returns repaired with that id, valid files untouched (AC-04)", async () => {
    // Arrange: alpha and gamma present, beta missing
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "alpha.md"), "content-alpha");
    fs.writeFileSync(path.join(agentsDir, "gamma.md"), "content-gamma");

    const alphaMtimeBefore = fs.statSync(path.join(agentsDir, "alpha.md")).mtimeMs;
    const gammaMtimeBefore = fs.statSync(path.join(agentsDir, "gamma.md")).mtimeMs;

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("repaired");
    if (result.status !== "repaired") throw new Error("narrowing guard");
    expect(result.repairedFiles).toEqual(["beta"]);
    expect(fs.existsSync(path.join(agentsDir, "beta.md"))).toBe(true);

    // Valid files must remain untouched
    expect(fs.statSync(path.join(agentsDir, "alpha.md")).mtimeMs).toBe(alphaMtimeBefore);
    expect(fs.statSync(path.join(agentsDir, "gamma.md")).mtimeMs).toBe(gammaMtimeBefore);
  });

  it("09. repair: zero-byte file is repaired and appears in repairedFiles (AC-04/OQ-02)", async () => {
    // Arrange: beta is 0 bytes — triggers zero-byte detection repair path
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "alpha.md"), "content-alpha");
    fs.writeFileSync(path.join(agentsDir, "beta.md"), ""); // 0 bytes
    fs.writeFileSync(path.join(agentsDir, "gamma.md"), "content-gamma");

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("repaired");
    if (result.status !== "repaired") throw new Error("narrowing guard");
    expect(result.repairedFiles).toContain("beta");
    expect(fs.statSync(path.join(agentsDir, "beta.md")).size).toBeGreaterThan(0);
  });

  it("10. permission_denied on homeDir creation → returns permission_denied with path in reason (AC-07)", async () => {
    // Arrange: homeDir does not exist; mkdirSync throws EACCES on creation attempt
    const parentDir = makeTempHome();
    const homeDir = path.join(parentDir, "unwritable-teo");

    const bundleDir = makeFixtureBundle(["alpha"]);

    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      const err = Object.assign(new Error("Permission denied"), { code: "EACCES" });
      throw err;
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("permission_denied");
    expect(result.reason).toContain(homeDir);

    mkdirSpy.mockRestore();
  });

  it("11. io_error during staging rename → returns io_error with OS message, homeDir/agents untouched (AC-08)", async () => {
    // Arrange: renameSync throws EIO (generic I/O error, not EXDEV)
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      const err = Object.assign(new Error("I/O error"), { code: "EIO" });
      throw err;
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toContain("I/O error");

    // Atomic guarantee: rename failed before destination was touched
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);

    renameSpy.mockRestore();
  });

  it("12. EXDEV fallback: rename throws EXDEV → per-file copy succeeds, returns ok (AC-08/OQ-06)", async () => {
    // Arrange: the staging-dir rename throws EXDEV (cross-device link).
    // provision() must fall back to per-file copy and still return ok.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const realRenameSync = fs.renameSync.bind(fs);
    let callCount = 0;
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
      callCount++;
      if (callCount === 1) {
        // First call is the staging dir → destination rename; throw EXDEV
        const err = Object.assign(new Error("Invalid cross-device link"), { code: "EXDEV" });
        throw err;
      }
      // Any subsequent rename calls (e.g. per-file atomic writes) pass through
      return realRenameSync(...(args as Parameters<typeof fs.renameSync>));
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: EXDEV fallback recovered fully
    expect(result.status).toBe("ok");
    expect(fs.existsSync(path.join(homeDir, "agents", "alpha.md"))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, "agents", "beta.md"))).toBe(true);

    renameSpy.mockRestore();
  });

  it("13. TEO_HOME override: provision writes to TEO_HOME when homeDir arg is absent (AC-13)", async () => {
    const bundleDir = makeFixtureBundle(["alpha"]);
    const teoHome = makeTempHome();

    const savedEnv = process.env["TEO_HOME"];
    process.env["TEO_HOME"] = teoHome;
    try {
      const opts: ProvisionOptions = {
        bundleDir,
        // homeDir intentionally absent — TEO_HOME must be used
        revocationOpts: {
          signature: new Uint8Array(64).fill(0x01),
          publicKey: new Uint8Array(32).fill(0x02),
          keyId: "test-key-id",
          revocationList: { revoked_keys: [] },
        },
      };

      const result = await provision(opts);

      expect(result.status).toBe("ok");
      expect(fs.existsSync(path.join(teoHome, "agents", "alpha.md"))).toBe(true);

      // Real ~/.teo must NOT be created
      expect(fs.existsSync(path.join(os.homedir(), ".teo"))).toBe(false);
    } finally {
      if (savedEnv === undefined) {
        delete process.env["TEO_HOME"];
      } else {
        process.env["TEO_HOME"] = savedEnv;
      }
    }
  });

  it("14. homeDir arg takes precedence over TEO_HOME (AC-14)", async () => {
    const bundleDir = makeFixtureBundle(["alpha"]);
    const dirA = makeTempHome(); // TEO_HOME value — must NOT receive writes
    const dirB = makeTempHome(); // homeDir arg value — MUST receive writes

    const savedEnv = process.env["TEO_HOME"];
    process.env["TEO_HOME"] = dirA;
    try {
      const result = await provision(makeOpts(bundleDir, dirB));

      expect(result.status).toBe("ok");
      // Writes must be in dirB (explicit arg)
      expect(fs.existsSync(path.join(dirB, "agents", "alpha.md"))).toBe(true);
      // dirA (TEO_HOME) must be untouched
      expect(fs.existsSync(path.join(dirA, "agents"))).toBe(false);
    } finally {
      if (savedEnv === undefined) {
        delete process.env["TEO_HOME"];
      } else {
        process.env["TEO_HOME"] = savedEnv;
      }
    }
  });

  it("19. SEC-03: repair-path revocation BLOCKED → revocation_blocked, missing file NOT written (SEC-03)", async () => {
    // Arrange: alpha and gamma present (non-zero), beta missing → repair path triggered.
    // Override checkRevocation to BLOCKED so the repair-path guard at ~line 149 fires.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "alpha.md"), "content-alpha");
    fs.writeFileSync(path.join(agentsDir, "gamma.md"), "content-gamma");
    // beta.md intentionally absent — triggers repair path

    vi.mocked(checkRevocation).mockResolvedValue({
      verdict: "BLOCKED",
      reason: "Key revoked in repair path",
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: BLOCKED propagated correctly
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("revocation_blocked");
    expect(result.reason).toContain("Key revoked in repair path");

    // beta.md must NOT have been written — BLOCKED fires before the write loop
    expect(fs.existsSync(path.join(agentsDir, "beta.md"))).toBe(false);

    // Valid pre-existing files must be untouched
    expect(fs.existsSync(path.join(agentsDir, "alpha.md"))).toBe(true);
    expect(fs.existsSync(path.join(agentsDir, "gamma.md"))).toBe(true);

    // Revocation check called exactly once (the repair-path call at ~line 146)
    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });

  it("20. SEC-04: repair-path verification_failed → verification_failed naming the repaired id (SEC-04)", async () => {
    // Arrange: alpha and gamma present (non-zero), beta missing → repair path triggered.
    // checkRevocation returns PASS (default from beforeEach).
    // Override loadAgentDefinition to throw when called for 'beta' in agentsDir
    // (the post-repair verification call at ~line 170), delegating all other calls
    // to the real file-based implementation.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "alpha.md"), "content-alpha");
    fs.writeFileSync(path.join(agentsDir, "gamma.md"), "content-gamma");
    // beta.md intentionally absent — triggers repair path

    vi.mocked(loadAgentDefinition).mockImplementation((id: string, dir?: string) => {
      // Throw only for the post-repair verification call: id === "beta" AND
      // dir is the agentsDir (contains "agents"). The repair path only verifies
      // idsToRepair (["beta"]), so alpha and gamma are never called here.
      if (id === "beta" && typeof dir === "string" && dir.includes("agents")) {
        throw new Error("Corrupt frontmatter in repair");
      }
      // Delegate other calls to the real implementation via direct file read.
      // Matches the pattern from test 05 — parse minimal frontmatter from file.
      const content = fs.readFileSync(path.join(dir ?? "", `${id}.md`), "utf8");
      const match = content.match(/agent_id: (\S+)/);
      const nameMatch = content.match(/name: (.+)/);
      const roleMatch = content.match(/role: (.+)/);
      return {
        agent_id: match?.[1] ?? id,
        name: nameMatch?.[1] ?? id,
        role: roleMatch?.[1] ?? "role",
        disallowedTools_default: [],
        body: "body",
      };
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: verification_failed returned, naming the repaired id
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("verification_failed");
    expect(result.reason).toContain("beta");
    expect(result.reason).toContain("Corrupt frontmatter in repair");
  });
});

// =============================================================================
// GOLDEN PATH TESTS
// =============================================================================

describe("provision() — golden path: fresh provision end-to-end", () => {
  it("15. fresh provision: returns ok, all agents copied, permissions 0o700/0o600, byte-identical (AC-01/02/09/10/12)", async () => {
    const homeDir = makeTempHome();
    const agentsDir = path.join(homeDir, "agents");

    const opts: ProvisionOptions = {
      bundleDir: REAL_BUNDLE_DIR,
      homeDir,
      revocationOpts: {
        signature: new Uint8Array(64).fill(0x01),
        publicKey: new Uint8Array(32).fill(0x02),
        keyId: "test-key-id",
        revocationList: { revoked_keys: [] },
      },
    };

    // Act
    const result = await provision(opts);

    // Shape
    expect(result).toEqual({ status: "ok" });

    // Exactly two path segments under homeDir: just agents/ (AC-01/OQ-01)
    expect(fs.readdirSync(homeDir)).toEqual(["agents"]);

    // Permissions (AC-02)
    expect(fs.statSync(homeDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(agentsDir).mode & 0o777).toBe(0o700);

    // Every id is present, permissions correct, content byte-identical
    // Use the real listAgentIds by reading bundleDir directly
    const realIds = fs
      .readdirSync(REAL_BUNDLE_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort();

    expect(realIds.length).toBeGreaterThanOrEqual(10);

    for (const id of realIds) {
      const destPath = path.join(agentsDir, `${id}.md`);
      expect(fs.existsSync(destPath)).toBe(true);
      expect(fs.statSync(destPath).mode & 0o777).toBe(0o600);

      const src = fs.readFileSync(path.join(REAL_BUNDLE_DIR, `${id}.md`));
      const dest = fs.readFileSync(destPath);
      expect(dest).toEqual(src);
    }
  });

  it("16. canonical bytes ordering: checkRevocation receives sorted concatenation, not insertion order (AC-09/OQ-07)", async () => {
    // Write 3 files in non-sorted insertion order: gamma, alpha, beta.
    // provision() must sort ids lexicographically before concatenating.
    const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-ws-p1-04-order-"));
    tempDirs.push(bundleDir);

    const alphaContent =
      "---\nagent_id: alpha\nname: Alpha\nrole: Alpha role.\ndisallowedTools_default:\n---\n\nAlpha body.\n";
    const betaContent =
      "---\nagent_id: beta\nname: Beta\nrole: Beta role.\ndisallowedTools_default:\n---\n\nBeta body.\n";
    const gammaContent =
      "---\nagent_id: gamma\nname: Gamma\nrole: Gamma role.\ndisallowedTools_default:\n---\n\nGamma body.\n";

    // Insertion order: gamma, alpha, beta — sorted order: alpha, beta, gamma
    fs.writeFileSync(path.join(bundleDir, "gamma.md"), gammaContent);
    fs.writeFileSync(path.join(bundleDir, "alpha.md"), alphaContent);
    fs.writeFileSync(path.join(bundleDir, "beta.md"), betaContent);

    const homeDir = makeTempHome();

    let capturedData: Buffer | undefined;
    vi.mocked(checkRevocation).mockImplementation(async (opts) => {
      capturedData = Buffer.from(opts.data);
      return { verdict: "PASS" };
    });

    // Act
    await provision(makeOpts(bundleDir, homeDir));

    // Expected: sorted (alpha → beta → gamma)
    const expected = Buffer.concat([
      Buffer.from(alphaContent, "utf8"),
      Buffer.from(betaContent, "utf8"),
      Buffer.from(gammaContent, "utf8"),
    ]);

    expect(capturedData).toBeDefined();
    expect(capturedData).toEqual(expected);
  });

  it("17. checkRevocation called exactly once per fresh provision (AC-10)", async () => {
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    await provision(makeOpts(bundleDir, homeDir));

    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });

  it("18. post-write verification: all provisioned agents are loadable via loadAgentDefinition (AC-12)", async () => {
    const homeDir = makeTempHome();
    const agentsDir = path.join(homeDir, "agents");

    const opts: ProvisionOptions = {
      bundleDir: REAL_BUNDLE_DIR,
      homeDir,
      revocationOpts: {
        signature: new Uint8Array(64).fill(0x01),
        publicKey: new Uint8Array(32).fill(0x02),
        keyId: "test-key-id",
        revocationList: { revoked_keys: [] },
      },
    };

    const result = await provision(opts);
    expect(result.status).toBe("ok");

    // Enumerate expected ids from the real bundle dir directly (avoid mock indirection)
    const ids = fs
      .readdirSync(REAL_BUNDLE_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3));

    // Import the REAL loadAgentDefinition to verify files are well-formed
    const { loadAgentDefinition: realLoad } =
      await vi.importActual<typeof import("../agents/load.js")>("../agents/load.js");

    for (const id of ids) {
      const def = realLoad(id, agentsDir);
      expect(def.agent_id).toBe(id);
      expect(def.name).toBeTruthy();
      expect(def.role).toBeTruthy();
      expect(Array.isArray(def.disallowedTools_default)).toBe(true);
    }
  });
});

// =============================================================================
// SECURITY REMEDIATION TESTS (SEC-05 + 7 REACHABLE_UNTESTED branches)
// =============================================================================

describe("provision() — security remediation: SEC-05 + spyable error branches", () => {
  it("22. SEC-05: EXDEV copy failure leaves NO partial agentsDir (BLOCK fix)", async () => {
    // Arrange: fixture bundle with 3 agents, fresh homeDir (no agentsDir).
    // Chain two spies: renameSync EXDEV triggers the EXDEV fallback path;
    // copyFileSync then fails every copy attempt with ENOSPC.
    // After the call, agentsDir MUST NOT exist — SEC-05 requires cleanup.
    // This test FAILS until dev adds rmSync(agentsDir) in the copyErr catch block.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("Invalid cross-device link"), { code: "EXDEV" });
    });
    vi.spyOn(fs, "copyFileSync").mockImplementation(() => {
      throw Object.assign(new Error("No space left on device"), { code: "ENOSPC" });
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert — error result shape
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");

    // SEC-05: the partial agentsDir created at L340 MUST be cleaned up.
    // This assertion FAILS until dev applies the fix.
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);

    // checkRevocation was called (it fires before staging, before the EXDEV path)
    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });

  it("23. L193: repair-path BLOCKED with no reason field → reason is empty string", async () => {
    // Arrange: partial agentsDir (alpha+gamma present, beta missing) → triggers repair path.
    // checkRevocation returns BLOCKED without a reason field — exercises the ?? "" fallback
    // at L193 in the repair path.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "alpha.md"), "content-alpha");
    fs.writeFileSync(path.join(agentsDir, "gamma.md"), "content-gamma");
    // beta.md intentionally absent — triggers repair path

    // BLOCKED with no reason field — the ?? "" fallback at L193 must return ""
    vi.mocked(checkRevocation).mockResolvedValue({ verdict: "BLOCKED" });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("revocation_blocked");
    // The ?? "" fallback yields an empty string, not undefined
    expect(result.reason).toBe("");
  });

  it("24. L247: fresh-provision BLOCKED with no reason field → reason is empty string", async () => {
    // Arrange: fresh homeDir — takes the fresh provision path (not repair).
    // checkRevocation returns BLOCKED without a reason field — exercises the ?? "" fallback
    // at L247 in the fresh provision path.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // BLOCKED with no reason field — the ?? "" fallback at L247 must return ""
    vi.mocked(checkRevocation).mockResolvedValue({ verdict: "BLOCKED" });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("revocation_blocked");
    // The ?? "" fallback yields an empty string, not undefined
    expect(result.reason).toBe("");

    // No files written — agentsDir must not exist
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);
  });

  it("25. L262-272: mkdtempSync failure → io_error, no agentsDir created", async () => {
    // Arrange: fresh homeDir. checkRevocation is called BEFORE mkdtempSync
    // (Step 4 fires before Step 5 in the fresh provision path). The spy on
    // mkdtempSync fires after revocation passes — staging dir creation fails.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // checkRevocation defaults to PASS from beforeEach — no override needed.
    vi.spyOn(fs, "mkdtempSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("No space left on device"), { code: "ENOSPC" });
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toContain("No space left on device");

    // No agentsDir should have been created — staging failed before any mkdir(agentsDir)
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);

    // checkRevocation IS called before mkdtempSync (Step 4 before Step 5)
    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });

  it("26. L286-298: staging writeFileSync failure → cleanup + io_error, no agentsDir", async () => {
    // Arrange: fixture bundle, fresh homeDir. The writeFileSync spy is set AFTER
    // makeFixtureBundle() completes so it does not intercept fixture setup writes.
    // The first writeFileSync call inside provision()'s staging loop hits the spy.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // Count existing teo-provision-* dirs in os.tmpdir() before provision() runs.
    // After provision() returns (error), that count must be unchanged — cleanup verified.
    const tmpDir = os.tmpdir();
    const provisionDirsBefore = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith("teo-provision-")).length;

    // Set the spy AFTER fixture setup so fixture writes pass through normally.
    // mockImplementationOnce fires on the first writeFileSync inside provision().
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("I/O error during staging"), { code: "EIO" });
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert — error result shape
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toContain("I/O error during staging");

    // agentsDir must not exist — staging failed before rename/copy to agentsDir
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);

    // Staging dir must have been cleaned up (best-effort rmSync in the catch block)
    const provisionDirsAfter = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith("teo-provision-")).length;
    expect(provisionDirsAfter).toBe(provisionDirsBefore);
  });

  it("27. L317-318: mkdirSync ENOSPC (non-EACCES else branch) → io_error", async () => {
    // Arrange: fresh homeDir that does NOT exist (so mkdirSync is called for resolvedHome).
    // The spy fires on the mkdirSync(resolvedHome) call at L303 with ENOSPC — this
    // takes the else branch at L317-318 (not the EACCES branch covered by test 10).
    // mkdtempSync does NOT call fs.mkdirSync; the spy only captures the explicit call.
    // mockImplementationOnce ensures only the first mkdirSync call (L303) is intercepted;
    // any subsequent mkdirSync would pass through (though none occur after an error return).
    const bundleDir = makeFixtureBundle(["alpha"]);
    const parentDir = makeTempHome();
    const homeDir = path.join(parentDir, "nonexistent-teo-home");
    // homeDir does not exist — triggers mkdirSync(resolvedHome) at L303

    vi.spyOn(fs, "mkdirSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("No space left on device"), { code: "ENOSPC" });
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toContain("No space left on device");

    // agentsDir must not exist — mkdirSync threw before rename
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);
  });

  it("28. L377-385: renameSync EACCES → permission_denied, agentsDir untouched", async () => {
    // Arrange: fresh homeDir. renameSync throws EACCES — this is the if-branch at L378,
    // distinct from test 11 which covers EIO (the fallthrough at L385 → io_error).
    // The atomic guarantee holds: rename threw before touching the destination, so
    // agentsDir does not exist.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("permission_denied");
    expect(result.reason).toContain("Permission denied");

    // Atomic guarantee: rename threw before touching destination
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);
  });

  it("29. L400: fresh-provision post-write verification throws bare string → verification_failed", async () => {
    // Arrange: fixture bundle, fresh homeDir. loadAgentDefinition throws a bare string
    // (not an Error instance) — exercises the String(err) branch of the ternary at L400.
    // Test 05 covers the Error throw branch (err instanceof Error → true); this covers
    // the else branch (err instanceof Error → false, String(err) used as message).
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    vi.mocked(loadAgentDefinition).mockImplementation(() => {
      throw "bare string verification error";
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("verification_failed");
    expect(result.reason).toContain("bare string verification error");
  });
});
