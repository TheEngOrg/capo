// =============================================================================
// provision.test.ts — specs for src/bootstrap/provision.ts (WS-P1-04 + WS-P1-04a)
//
// STATUS: PASSING — implementation in src/bootstrap/provision.ts, all 54 tests green. WS-P1-04a: manifest write, verify-after-write, 2-stat hot path, repair redefined. Tests 42-50: repair path error branches (covers all c8 ignore blocks). Tests 48-50 (r2): repair EXDEV success, repair SHA-256 mismatch, repair bare-string throw — removes final 3 c8 ignore annotations. DEFECT noted in test 45: repair path renameSync EACCES maps to permission_denied (mirrors fresh-provision path, test 28).
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
//     | { status: 'repaired' }                         // WS-P1-04a: repairedFiles[] REMOVED
//     | { status: 'error'; kind: ProvisionErrorKind; reason: string };
//
//   interface ManifestFile {
//     schema_version: "1";
//     teo_version: string;
//     provisioned_at: string;
//     agents_dir: string;
//     files: {
//       [agentId: string]: {
//         path: string;
//         sha256: string;
//         size_bytes: number;
//       };
//     };
//     bundle_signature_key_id: string;
//   }
//
//   interface ProvisionOptions {
//     bundleDir: string;
//     homeDir?: string;
//     revocationOpts: Omit<CheckRevocationOptions, 'data'>;
//   }
//
//   function provision(opts: ProvisionOptions): Promise<ProvisionResult>
//
// KEY BEHAVIOURS UNDER TEST (WS-P1-04 originals):
//   - checkRevocation() called ONCE before any write, NEVER on already_provisioned
//   - opts.data = Buffer.concat(listAgentIds(bundleDir).sort().map(readFile))
//   - Atomic staging: write to os.tmpdir(), then rename to homeDir+'/agents/'
//   - EXDEV fallback: per-file copy when rename fails with EXDEV
//   - Permissions: homeDir 0o700, agents/ 0o700, each .md 0o600
//   - loadAgentDefinition(id, homeDir+'/agents') run post-write for all written ids
//   - homeDir resolution: opts.homeDir > process.env.TEO_HOME > os.homedir()+'/.teo'
//   - No import-time side effects
//
// KEY BEHAVIOURS UNDER TEST (WS-P1-04a additions):
//   - 2-stat hot path: manifest.json AND agentsDir both present → already_provisioned, no revocation
//   - Repair trigger: manifest ABSENT + agentsDir PRESENT → full fresh provision + return repaired
//   - manifest absent + agentsDir absent → fresh provision → return ok
//   - manifest.json written atomically (tmp → rename) after all writes + verification succeed
//   - manifest.json permissions: 0o644
//   - manifest schema: schema_version="1", teo_version, provisioned_at, agents_dir, files{}, bundle_signature_key_id
//   - SHA-256 in manifest computed from in-memory chunks[] (bundleDir), NOT re-reading agentsDir
//   - Verify-after-write: re-read agentsDir, compute SHA-256, compare vs in-memory chunks
//   - SHA-256 mismatch → verification_failed, no manifest.json written
//   - manifest write failure → io_error with reason starting "Manifest write failed:"
//   - No stale manifest.json.tmp on manifest write failure
//   - repairedFiles[] REMOVED from all return shapes
//
// COVERAGE NOTE FOR DEV:
//   provision.ts must be in vitest.config.ts perFile thresholds at 100%
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

  it("04. WS-GO-02: homeDir exists as file → conflict (role-shift: agents dir removed, homeDir conflict still checked)", async () => {
    // WS-GO-02: The agents/ conflict check is removed. The homeDir-as-file conflict still fires.
    // This test is retained as a regression guard for homeDir conflict detection.
    const parentDir = makeTempHome();
    const homeDirAsFile = path.join(parentDir, "fake-teo-home-04");
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

  it("05. WS-GO-02: revocation BLOCKED returns revocation_blocked (role-shift: no agent-copy/verify path)", async () => {
    // WS-GO-02: Agent-copy and loadAgentDefinition verification are removed.
    // Revocation BLOCKED before data-dir creation remains the primary security gate.
    // This test replaces the old verification_failed test (which tested loadAgentDefinition post-write).
    vi.mocked(checkRevocation).mockResolvedValue({
      verdict: "BLOCKED",
      reason: "Key revoked (test 05)",
    });

    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: revocation gate still fires
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("revocation_blocked");
    expect(result.reason).toContain("Key revoked");

    // Nothing written to homeDir
    expect(fs.existsSync(path.join(homeDir, "ledger"))).toBe(false);
    expect(fs.existsSync(path.join(homeDir, "keyring"))).toBe(false);
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
  it("07. WS-GO-02: already provisioned: ledger/ AND keyring/ both present → already_provisioned, checkRevocation NOT called", async () => {
    // WS-GO-02: New idempotency trigger is ledger/ AND keyring/ both present.
    // The old trigger (manifest.json + agentsDir) is replaced.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    // Pre-create BOTH ledger/ and keyring/ — the new idempotency trigger
    fs.mkdirSync(path.join(homeDir, "ledger"), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(homeDir, "keyring"), { recursive: true, mode: 0o700 });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: idempotent no-op
    expect(result).toEqual({ status: "already_provisioned" });

    // checkRevocation must NOT be called — it's a write-gate, not a read-gate (AC-03)
    expect(vi.mocked(checkRevocation)).not.toHaveBeenCalled();
  });

  it("08. WS-GO-02: fresh provision with only ledger/ absent (keyring present) → ok, ledger/ created", async () => {
    // WS-GO-02: The repair path is removed. The idempotency trigger is now
    // ledger/ AND keyring/ both present. If one is absent, fresh provision runs.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    // Only keyring/ present — ledger/ absent → fresh provision runs
    fs.mkdirSync(path.join(homeDir, "keyring"), { recursive: true, mode: 0o700 });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Fresh provision should succeed (creates both dirs)
    expect(result.status).toBe("ok");

    // ledger/ must now exist
    expect(fs.existsSync(path.join(homeDir, "ledger"))).toBe(true);
    // keyring/ still present
    expect(fs.existsSync(path.join(homeDir, "keyring"))).toBe(true);
  });

  it("09. WS-GO-02: fresh provision with empty homeDir → ok, both ledger/ and keyring/ created", async () => {
    // WS-GO-02: The repair path is removed. Fresh provision creates ledger/ and keyring/.
    // This test replaces the old repair-from-zero-byte-file test.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    // Fresh homeDir — no pre-existing dirs

    const result = await provision(makeOpts(bundleDir, homeDir));

    expect(result.status).toBe("ok");
    expect(result).not.toHaveProperty("repairedFiles");

    // Both data dirs created
    expect(fs.existsSync(path.join(homeDir, "ledger"))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, "keyring"))).toBe(true);

    // manifest.json written
    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(true);
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

  it("12. WS-GO-02: manifest renameSync EXDEV → Manifest write failed io_error (role-shift: no agent staging rename)", async () => {
    // WS-GO-02: The agent-staging rename path is removed. The only renameSync in provision()
    // is the manifest.json.tmp → manifest.json atomic rename. This test verifies that a
    // renameSync failure on the manifest write produces a "Manifest write failed:" io_error.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const manifestTmpPath = path.join(homeDir, "manifest.json.tmp");
    const manifestPath = path.join(homeDir, "manifest.json");
    const realRenameSync = fs.renameSync.bind(fs);

    vi.spyOn(fs, "renameSync").mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
      const [src, dest] = args;
      if (String(src) === manifestTmpPath && String(dest) === manifestPath) {
        throw Object.assign(new Error("Invalid cross-device link"), { code: "EXDEV" });
      }
      return realRenameSync(...args);
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: io_error with "Manifest write failed:" prefix
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toMatch(/^Manifest write failed:/);
  });

  it("13. TEO_HOME override: provision writes to TEO_HOME when homeDir arg is absent (AC-13)", async () => {
    // WS-GO-02: provision() now creates ledger/ and keyring/ instead of agents/.
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
      // WS-GO-02: data dirs created under teoHome
      expect(fs.existsSync(path.join(teoHome, "ledger"))).toBe(true);
      expect(fs.existsSync(path.join(teoHome, "keyring"))).toBe(true);

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
    // WS-GO-02: provision() now creates ledger/ and keyring/ instead of agents/.
    const bundleDir = makeFixtureBundle(["alpha"]);
    const dirA = makeTempHome(); // TEO_HOME value — must NOT receive writes
    const dirB = makeTempHome(); // homeDir arg value — MUST receive writes

    const savedEnv = process.env["TEO_HOME"];
    process.env["TEO_HOME"] = dirA;
    try {
      const result = await provision(makeOpts(bundleDir, dirB));

      expect(result.status).toBe("ok");
      // Writes must be in dirB (explicit arg)
      expect(fs.existsSync(path.join(dirB, "ledger"))).toBe(true);
      expect(fs.existsSync(path.join(dirB, "keyring"))).toBe(true);
      // dirA (TEO_HOME) must be untouched
      expect(fs.existsSync(path.join(dirA, "ledger"))).toBe(false);
      expect(fs.existsSync(path.join(dirA, "keyring"))).toBe(false);
    } finally {
      if (savedEnv === undefined) {
        delete process.env["TEO_HOME"];
      } else {
        process.env["TEO_HOME"] = savedEnv;
      }
    }
  });

  it("19. WS-GO-02: revocation BLOCKED → revocation_blocked, no ledger/ or keyring/ written", async () => {
    // WS-GO-02: The repair path is removed. Revocation BLOCKED before any mkdir prevents
    // ledger/ and keyring/ creation. This test replaces the old repair-path SEC-03 test.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    vi.mocked(checkRevocation).mockResolvedValue({
      verdict: "BLOCKED",
      reason: "Key revoked (test 19)",
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: BLOCKED propagated correctly
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("revocation_blocked");
    expect(result.reason).toContain("Key revoked");

    // No data dirs written — revocation gate fires before mkdirSync
    expect(fs.existsSync(path.join(homeDir, "ledger"))).toBe(false);
    expect(fs.existsSync(path.join(homeDir, "keyring"))).toBe(false);

    // Revocation check called exactly once
    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });

  it("20. WS-GO-02: mkdirSync EACCES for ledger/ → permission_denied (role-shift: no repair path)", async () => {
    // WS-GO-02: The repair path is removed. This test verifies that an EACCES failure
    // when creating ledger/ returns permission_denied. Replaces the old repair-path
    // verification_failed test.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    // checkRevocation returns PASS (default from beforeEach).
    // Spy: mkdirSync succeeds for resolvedHome but fails for ledger/ with EACCES.
    const realMkdirSync = fs.mkdirSync.bind(fs);
    let callCount = 0;
    vi.spyOn(fs, "mkdirSync").mockImplementation((...args: Parameters<typeof fs.mkdirSync>) => {
      callCount++;
      // First call: resolvedHome → pass through
      // Second call: ledger/ → throw EACCES
      if (callCount === 2) {
        throw Object.assign(new Error("Permission denied creating ledger"), { code: "EACCES" });
      }
      return realMkdirSync(...args);
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: permission_denied for ledger/ creation failure
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("permission_denied");
    expect(result.reason).toContain("Permission denied");
  });
});

// =============================================================================
// GOLDEN PATH TESTS
// =============================================================================

describe("provision() — golden path: fresh provision end-to-end", () => {
  it("15. WS-GO-02: fresh provision: returns ok, ledger/ and keyring/ created with mode 0o700, manifest written", async () => {
    // WS-GO-02: Agent-copy is removed. Fresh provision creates data dirs instead.
    const homeDir = makeTempHome();

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

    // Shape — ok result (no warning for this test since sig is provided but mocked PASS)
    expect(result.status).toBe("ok");

    // Permissions on homeDir
    expect(fs.statSync(homeDir).mode & 0o777).toBe(0o700);

    // ledger/ and keyring/ must exist with correct permissions
    const ledgerDir = path.join(homeDir, "ledger");
    const keyringDir = path.join(homeDir, "keyring");
    expect(fs.existsSync(ledgerDir)).toBe(true);
    expect(fs.statSync(ledgerDir).mode & 0o777).toBe(0o700);
    expect(fs.existsSync(keyringDir)).toBe(true);
    expect(fs.statSync(keyringDir).mode & 0o777).toBe(0o700);

    // manifest.json must exist
    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(true);

    // agents/ must NOT exist (role-shift)
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);
  });

  it("16. WS-GO-02: canonical bytes: checkRevocation receives sorted bundle concatenation (still applies)", async () => {
    // WS-GO-02: Data computation for revocation still uses sorted bundleDir content.
    // This test verifies the sorted concatenation contract is preserved post-role-shift.
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

  it("18. WS-GO-02: fresh provision creates manifest.json with correct schema fields", async () => {
    // WS-GO-02: Agent-copy and loadAgentDefinition verification are removed.
    // This test verifies the new manifest schema is written correctly.
    const homeDir = makeTempHome();

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

    // manifest.json must exist and have required fields
    const manifestPath = path.join(homeDir, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest["schema_version"]).toBe("1");
    expect(typeof manifest["teo_version"]).toBe("string");
    expect(typeof manifest["provisioned_at"]).toBe("string");
    expect(manifest["bundle_signature_key_id"]).toBe("test-key-id");

    // New schema: no agents_dir, no files
    expect(manifest).not.toHaveProperty("agents_dir");
    expect(manifest).not.toHaveProperty("files");
  });
});

// =============================================================================
// SECURITY REMEDIATION TESTS (SEC-05 + 7 REACHABLE_UNTESTED branches)
// =============================================================================

describe("provision() — security remediation: SEC-05 + spyable error branches", () => {
  it("22. WS-GO-02: renameSync EXDEV on manifest rename → 'Manifest write failed:' (SEC-05: no agent staging, no agentsDir)", async () => {
    // WS-GO-02: EXDEV in agent staging is removed (no agent-file-copy).
    // The only renameSync is for manifest.json.tmp → manifest.json.
    // EXDEV on that rename produces "Manifest write failed:" io_error.
    // agentsDir is never created (role-shift), so SEC-05 partial-dir cleanup is not applicable.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const manifestTmpPath = path.join(homeDir, "manifest.json.tmp");
    const manifestPath = path.join(homeDir, "manifest.json");
    const realRenameSync = fs.renameSync.bind(fs);

    vi.spyOn(fs, "renameSync").mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
      const [src, dest] = args;
      if (String(src) === manifestTmpPath && String(dest) === manifestPath) {
        throw Object.assign(new Error("Invalid cross-device link"), { code: "EXDEV" });
      }
      return realRenameSync(...args);
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert — Manifest write failed io_error
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toMatch(/^Manifest write failed:/);

    // WS-GO-02: agentsDir must never be created (role-shift)
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);

    // checkRevocation was called (before manifest write)
    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });

  it("23. BLOCKED with no reason field → reason is empty string", async () => {
    // checkRevocation returns BLOCKED without a reason field — exercises the ?? "" fallback.
    // WS-GO-02: This applies to the fresh provision path (repair path is removed).
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    // BLOCKED with no reason field — the ?? "" fallback must return ""
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

  it("25. WS-GO-02: mkdirSync ENOSPC for keyring/ → io_error (role-shift: no staging dir)", async () => {
    // WS-GO-02: mkdtempSync is no longer called (no staging dir). The relevant mkdir
    // that can now fail is for keyring/. This test replaces the old mkdtempSync test.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // checkRevocation defaults to PASS from beforeEach.
    // 3rd mkdirSync call: resolvedHome (1st), ledger/ (2nd), keyring/ (3rd → fail)
    const realMkdirSync = fs.mkdirSync.bind(fs);
    let callCount = 0;
    vi.spyOn(fs, "mkdirSync").mockImplementation((...args: Parameters<typeof fs.mkdirSync>) => {
      callCount++;
      if (callCount === 3) {
        throw Object.assign(new Error("No space left on device"), { code: "ENOSPC" });
      }
      return realMkdirSync(...args);
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toContain("No space left on device");

    // checkRevocation IS called before mkdirSync for data dirs (Step 6 before Step 8)
    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });

  it("26. WS-GO-02: manifest writeFileSync EIO → io_error 'Manifest write failed:', no agentsDir created", async () => {
    // WS-GO-02: Agent staging writeFileSync is removed (no agent-file-copy).
    // The only writeFileSync is for manifest.json.tmp. An EIO on that write
    // produces "Manifest write failed:" io_error.
    // agentsDir must never be created (role-shift).
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const manifestTmpPath = path.join(homeDir, "manifest.json.tmp");
    const realWriteFileSync = fs.writeFileSync.bind(fs);

    vi.spyOn(fs, "writeFileSync").mockImplementation(
      (p: Parameters<typeof fs.writeFileSync>[0], ...rest: unknown[]) => {
        const pStr = typeof p === "string" ? p : String(p);
        if (pStr === manifestTmpPath) {
          throw Object.assign(new Error("I/O error during manifest write"), { code: "EIO" });
        }
        return (realWriteFileSync as (...args: unknown[]) => unknown)(p, ...rest) as ReturnType<
          typeof fs.writeFileSync
        >;
      }
    );

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert — Manifest write failed io_error
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toMatch(/^Manifest write failed:/);
    expect(result.reason).toContain("I/O error during manifest write");

    // agentsDir must not exist (role-shift: no agent-copy)
    expect(fs.existsSync(path.join(homeDir, "agents"))).toBe(false);

    // manifest.json.tmp cleaned up
    expect(fs.existsSync(manifestTmpPath)).toBe(false);
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

  it("28. WS-GO-02: renameSync EACCES on manifest rename → Manifest write failed (role-shift: no agent staging rename)", async () => {
    // WS-GO-02: The only renameSync in provision() is for manifest.json.tmp → manifest.json.
    // An EACCES on that rename produces a "Manifest write failed:" io_error.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const manifestTmpPath = path.join(homeDir, "manifest.json.tmp");
    const manifestPath = path.join(homeDir, "manifest.json");
    const realRenameSync = fs.renameSync.bind(fs);

    vi.spyOn(fs, "renameSync").mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
      const [src, dest] = args;
      if (String(src) === manifestTmpPath && String(dest) === manifestPath) {
        throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
      }
      return realRenameSync(...args);
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: manifest write failure produces io_error (wrapped in writeManifest)
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toMatch(/^Manifest write failed:/);
    expect(result.reason).toContain("Permission denied");
  });

  it("29. WS-GO-02: mkdirSync ENOSPC for homeDir → io_error (role-shift: no agent staging)", async () => {
    // WS-GO-02: loadAgentDefinition post-write verification is removed. The error
    // path for homeDir mkdirSync ENOSPC (non-EACCES) produces io_error.
    // This replaces the old bare-string verification_failed test.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const parentDir = makeTempHome();
    const homeDir = path.join(parentDir, "nonexistent-teo-home-29");

    // homeDir does not exist — triggers mkdirSync(resolvedHome) on Step 7.
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
  });
});

// =============================================================================
// WS-P1-04a: MANIFEST WRITE, 2-STAT HOT PATH, SHA-256 VERIFY-AFTER-WRITE
// These tests FAIL until dev implements the new behaviour in provision.ts.
// =============================================================================

describe("provision() — WS-P1-04a: 2-stat hot path idempotency", () => {
  it("30. WS-GO-02: ledger/ AND keyring/ both present → already_provisioned, no revocation call", async () => {
    // WS-GO-02: New idempotency trigger. Old trigger (manifest.json + agentsDir) is replaced
    // by ledger/ AND keyring/ both present.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // New trigger: ledger/ AND keyring/ both present
    fs.mkdirSync(path.join(homeDir, "ledger"), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(homeDir, "keyring"), { recursive: true, mode: 0o700 });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: fast path → no writes, no revocation
    expect(result).toEqual({ status: "already_provisioned" });
    expect(vi.mocked(checkRevocation)).not.toHaveBeenCalled();
  });

  it("31. WS-GO-02: only ledger/ present (no keyring/) → fresh provision runs (not already_provisioned)", async () => {
    // WS-GO-02: New trigger requires BOTH ledger/ AND keyring/. Only ledger/ present
    // does NOT trigger already_provisioned — fresh provision runs.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // Only ledger/ present — keyring/ absent
    fs.mkdirSync(path.join(homeDir, "ledger"), { recursive: true, mode: 0o700 });
    // keyring/ intentionally absent

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: not already_provisioned — fresh provision runs
    expect(result.status).not.toBe("already_provisioned");
    expect(["ok", "error"]).toContain(result.status);

    // checkRevocation called (fresh provision gate)
    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });

  it("32. 2-stat hot path: manifest.json present, agentsDir absent → fresh provision (not already_provisioned)", async () => {
    // Arrange: manifest.json exists but agentsDir does not.
    // Stale manifest (e.g. agentsDir was deleted) → fresh provision, not idempotent skip.
    // checkRevocation must be called once.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // Write manifest.json but do NOT create agentsDir
    fs.writeFileSync(
      path.join(homeDir, "manifest.json"),
      JSON.stringify({ schema_version: "1", teo_version: "0.1.0" })
    );
    // agentsDir intentionally absent

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: fresh provision (ok), not already_provisioned
    expect(result.status).toBe("ok");
    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });
});

describe("provision() — WS-P1-04a: manifest.json schema and content (fresh provision)", () => {
  it("33. WS-GO-02: fresh provision: manifest.json written with new schema (no agents_dir, no files)", async () => {
    // WS-GO-02: Manifest schema updated — agents_dir and files removed.
    // Retained fields: schema_version, teo_version, provisioned_at, bundle_signature_key_id.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: result ok
    expect(result.status).toBe("ok");

    // manifest.json must exist at homeDir/manifest.json
    const manifestPath = path.join(homeDir, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    // Parse and check retained fields
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

    expect(manifest["schema_version"]).toBe("1");
    expect(typeof manifest["teo_version"]).toBe("string");
    expect((manifest["teo_version"] as string).length).toBeGreaterThan(0);

    // provisioned_at must be a valid ISO-8601 string
    expect(typeof manifest["provisioned_at"]).toBe("string");
    const provisioned = new Date(manifest["provisioned_at"] as string);
    expect(isNaN(provisioned.getTime())).toBe(false);

    // bundle_signature_key_id must match revocationOpts.keyId
    expect(manifest["bundle_signature_key_id"]).toBe("test-key-id");

    // WS-GO-02: agents_dir and files must NOT be present
    expect(manifest).not.toHaveProperty("agents_dir");
    expect(manifest).not.toHaveProperty("files");
  });

  it("34. fresh provision: manifest.json permissions are 0o644", async () => {
    // The manifest is a human-readable file (owners + group read); group/other write blocked.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    await provision(makeOpts(bundleDir, homeDir));

    const manifestPath = path.join(homeDir, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const mode = fs.statSync(manifestPath).mode & 0o777;
    expect(mode).toBe(0o644);
  });

  it("35. WS-GO-02: fresh provision: manifest.json permissions are 0o644, no SHA-256 in new schema", async () => {
    // WS-GO-02: SHA-256 per-file hashes removed from manifest (no files{} block).
    // Manifest permissions are still 0o644.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    await provision(makeOpts(bundleDir, homeDir));

    const manifestPath = path.join(homeDir, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    // Permissions still 0o644
    expect(fs.statSync(manifestPath).mode & 0o777).toBe(0o644);

    // Confirm files{} block is absent (WS-GO-02 schema change)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty("files");
  });

  it("41. WS-GO-02: teo_version in manifest is a non-empty string (process.env.TEO_VERSION or 'unknown')", async () => {
    // WS-GO-02: teo_version is now read from process.env.TEO_VERSION (set by esbuild --define
    // or vitest config). It is not read from package.json at runtime. The value must be a
    // non-empty string (either the injected version or the "unknown" fallback).
    const bundleDir = makeFixtureBundle(["alpha"]);
    const homeDir = makeTempHome();

    await provision(makeOpts(bundleDir, homeDir));

    const manifest = JSON.parse(
      fs.readFileSync(path.join(homeDir, "manifest.json"), "utf8")
    ) as Record<string, unknown>;

    expect(typeof manifest["teo_version"]).toBe("string");
    expect((manifest["teo_version"] as string).length).toBeGreaterThan(0);
    // Value is whatever process.env.TEO_VERSION is set to (may be "unknown" in test env)
  });
});

describe("provision() — WS-P1-04a: SHA-256 verify-after-write (byte integrity)", () => {
  it("36. WS-GO-02: writeFileSync ENOSPC for manifest.json.tmp → io_error 'Manifest write failed:'", async () => {
    // WS-GO-02: SHA-256 verify-after-write is removed (no agent files installed).
    // This test replaces the SHA-256 mismatch test with a manifest write failure test.
    // The only writeFileSync that can fail post-role-shift (and prevent manifest) is
    // the manifest.json.tmp write in writeManifest().
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const manifestTmpPath = path.join(homeDir, "manifest.json.tmp");
    const realWriteFileSync = fs.writeFileSync.bind(fs);

    vi.spyOn(fs, "writeFileSync").mockImplementation(
      (p: Parameters<typeof fs.writeFileSync>[0], ...rest: unknown[]) => {
        const pStr = typeof p === "string" ? p : String(p);
        if (pStr === manifestTmpPath) {
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        }
        return (realWriteFileSync as (...args: unknown[]) => unknown)(p, ...rest) as ReturnType<
          typeof fs.writeFileSync
        >;
      }
    );

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: io_error with "Manifest write failed:" prefix
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toMatch(/^Manifest write failed:/);

    // manifest.json must NOT be written when the tmp write fails
    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(false);
  });
});

describe("provision() — WS-P1-04a: manifest write failure and error path isolation", () => {
  it("37. manifest write failure (writeFileSync throws on tmp) → io_error 'Manifest write failed:', no manifest on disk", async () => {
    // Arrange: happy-path provision but writeFileSync throws when writing manifest.json.tmp.
    // We use a spy that passes through all other writeFileSync calls and only throws
    // when the path ends with "manifest.json.tmp".
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const manifestTmpPath = path.join(homeDir, "manifest.json.tmp");
    const realWriteFileSync = fs.writeFileSync.bind(fs);

    vi.spyOn(fs, "writeFileSync").mockImplementation(
      (p: Parameters<typeof fs.writeFileSync>[0], ...rest: unknown[]) => {
        const pStr = typeof p === "string" ? p : String(p);
        if (pStr === manifestTmpPath) {
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        }
        return (realWriteFileSync as (...args: unknown[]) => unknown)(p, ...rest) as ReturnType<
          typeof fs.writeFileSync
        >;
      }
    );

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: io_error with "Manifest write failed:" prefix
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toMatch(/^Manifest write failed:/);

    // manifest.json must NOT exist on disk
    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(false);

    // manifest.json.tmp must be cleaned up (best-effort delete on failure)
    expect(fs.existsSync(manifestTmpPath)).toBe(false);
  });

  it("37b. manifest write failure (renameSync throws on manifest rename) → io_error 'Manifest write failed:', no manifest on disk", async () => {
    // Arrange: writeFileSync succeeds for manifest.json.tmp but renameSync throws
    // when renaming .tmp → manifest.json. We let the first renameSync (agentsDir staging)
    // pass through, then throw on the second (manifest rename).
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const manifestTmpPath = path.join(homeDir, "manifest.json.tmp");
    const manifestPath = path.join(homeDir, "manifest.json");
    const realRenameSync = fs.renameSync.bind(fs);

    vi.spyOn(fs, "renameSync").mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
      const [src, dest] = args;
      // Throw specifically when renaming manifest.json.tmp → manifest.json
      if (String(src) === manifestTmpPath && String(dest) === manifestPath) {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      }
      return realRenameSync(...args);
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: io_error with "Manifest write failed:" prefix
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toMatch(/^Manifest write failed:/);

    // manifest.json must NOT exist on disk
    expect(fs.existsSync(manifestPath)).toBe(false);

    // manifest.json.tmp best-effort cleanup — may or may not exist depending on impl order
    // (both states are acceptable; we only require manifest.json is absent)
  });

  it("38a. manifest not written when revocation blocked (fresh provision)", async () => {
    // Any error before manifest write must NOT produce manifest.json on disk.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    vi.mocked(checkRevocation).mockResolvedValue({
      verdict: "BLOCKED",
      reason: "Key revoked",
    });

    await provision(makeOpts(bundleDir, homeDir));

    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(false);
  });

  it("38b. WS-GO-02: manifest not written when manifest rename fails (io_error)", async () => {
    // WS-GO-02: The staging rename is removed. The only renameSync is manifest.json.tmp →
    // manifest.json. An EIO on that rename prevents manifest.json from being written.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const manifestTmpPath = path.join(homeDir, "manifest.json.tmp");
    const manifestPath = path.join(homeDir, "manifest.json");
    const realRenameSync = fs.renameSync.bind(fs);

    vi.spyOn(fs, "renameSync").mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
      const [src, dest] = args;
      if (String(src) === manifestTmpPath && String(dest) === manifestPath) {
        throw Object.assign(new Error("I/O error"), { code: "EIO" });
      }
      return realRenameSync(...args);
    });

    await provision(makeOpts(bundleDir, homeDir));

    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(false);
  });

  it("38c. WS-GO-02: manifest not written when mkdirSync for ledger/ fails", async () => {
    // WS-GO-02: SHA-256 verify-after-write removed. Any error before writeManifest()
    // must prevent manifest.json from being written. This test verifies mkdirSync
    // failure for ledger/ (Step 8) prevents manifest creation.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // 2nd mkdirSync call: ledger/ (resolvedHome is 1st) → throw
    const realMkdirSync = fs.mkdirSync.bind(fs);
    let callCount = 0;
    vi.spyOn(fs, "mkdirSync").mockImplementation((...args: Parameters<typeof fs.mkdirSync>) => {
      callCount++;
      if (callCount === 2) {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      }
      return realMkdirSync(...args);
    });

    await provision(makeOpts(bundleDir, homeDir));

    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(false);
  });

  it("38d. WS-GO-02: manifest not written when revocation BLOCKED", async () => {
    // WS-GO-02: loadAgentDefinition verification removed. Revocation BLOCKED
    // (before mkdirSync calls) must prevent manifest.json from being written.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    vi.mocked(checkRevocation).mockResolvedValue({
      verdict: "BLOCKED",
      reason: "Key revoked (38d)",
    });

    await provision(makeOpts(bundleDir, homeDir));

    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(false);
  });
});

describe("provision() — WS-P1-04a: repair path manifest and type shape", () => {
  it("39. WS-GO-02: fresh provision (no pre-existing state) → 'ok', manifest written, no repairedFiles field", async () => {
    // WS-GO-02: The repair path is removed. Old agentsDir-present-without-manifest trigger
    // is replaced by the new idempotency check (ledger+keyring). Fresh provision always returns ok.
    // repairedFiles[] was removed in WS-P1-04a and is still absent in WS-GO-02.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    // Fresh homeDir (no pre-existing state)

    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: ok (not repaired, not already_provisioned)
    expect(result.status).toBe("ok");

    // result must NOT have repairedFiles (removed in WS-P1-04a, still absent in WS-GO-02)
    expect(result).not.toHaveProperty("repairedFiles");

    // manifest.json must be written
    const manifestPath = path.join(homeDir, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest["schema_version"]).toBe("1");
    expect(manifest["bundle_signature_key_id"]).toBe("test-key-id");

    // WS-GO-02: new schema — no agents_dir, no files
    expect(manifest).not.toHaveProperty("agents_dir");
    expect(manifest).not.toHaveProperty("files");
  });

  it("40. WS-GO-02: fresh provision → checkRevocation called exactly once", async () => {
    // WS-GO-02: The repair path is removed. Fresh provision still calls checkRevocation once.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // Fresh homeDir (no pre-existing state)
    await provision(makeOpts(bundleDir, homeDir));

    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// WS-P1-04a: REPAIR PATH ERROR BRANCHES (parallel to fresh-provision tests 11,
// 22, 25, 26, 28, 37 — covers the 6 /* c8 ignore */ blocks in the repair path)
// =============================================================================

describe("provision() — repair path error branches (covers c8 ignore blocks)", () => {
  it("42. WS-GO-02: mkdirSync ENOSPC for ledger/ → io_error (parallel to test 25, no repair path)", async () => {
    // WS-GO-02: The repair path is removed. mkdtempSync is no longer called.
    // This test covers mkdirSync failure for ledger/ (the second mkdir call).
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // checkRevocation defaults to PASS from beforeEach — no override needed.
    // 2nd mkdirSync call: ledger/ → throw ENOSPC
    const realMkdirSync = fs.mkdirSync.bind(fs);
    let callCount = 0;
    vi.spyOn(fs, "mkdirSync").mockImplementation((...args: Parameters<typeof fs.mkdirSync>) => {
      callCount++;
      if (callCount === 2) {
        throw Object.assign(new Error("No space left on device"), { code: "ENOSPC" });
      }
      return realMkdirSync(...args);
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: io_error with ENOSPC message
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toContain("No space left on device");

    // checkRevocation was called once (before mkdirSync for data dirs)
    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });

  it("43. WS-GO-02: manifest writeFileSync failure → io_error, no manifest.json on disk (parallel to test 26)", async () => {
    // WS-GO-02: staging writeFileSync in agent-copy is removed. The only writeFileSync
    // that matters now is for manifest.json.tmp. This test covers that failure path.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const manifestTmpPath = path.join(homeDir, "manifest.json.tmp");
    const realWriteFileSync = fs.writeFileSync.bind(fs);

    vi.spyOn(fs, "writeFileSync").mockImplementation(
      (p: Parameters<typeof fs.writeFileSync>[0], ...rest: unknown[]) => {
        const pStr = typeof p === "string" ? p : String(p);
        if (pStr === manifestTmpPath) {
          throw Object.assign(new Error("I/O error writing manifest"), { code: "EIO" });
        }
        return (realWriteFileSync as (...args: unknown[]) => unknown)(p, ...rest) as ReturnType<
          typeof fs.writeFileSync
        >;
      }
    );

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: io_error with "Manifest write failed:" prefix
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toMatch(/^Manifest write failed:/);

    // manifest.json must NOT exist
    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(false);
    // manifest.json.tmp must be cleaned up
    expect(fs.existsSync(manifestTmpPath)).toBe(false);
  });

  it("44. WS-GO-02: renameSync EIO on manifest rename → io_error Manifest write failed (parallel to test 11)", async () => {
    // WS-GO-02: The agent-staging rename is removed. The only renameSync is for
    // manifest.json.tmp → manifest.json. EIO on that rename produces "Manifest write failed:".
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const manifestTmpPath = path.join(homeDir, "manifest.json.tmp");
    const manifestPath = path.join(homeDir, "manifest.json");
    const realRenameSync = fs.renameSync.bind(fs);

    vi.spyOn(fs, "renameSync").mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
      const [src, dest] = args;
      if (String(src) === manifestTmpPath && String(dest) === manifestPath) {
        throw Object.assign(new Error("I/O error"), { code: "EIO" });
      }
      return realRenameSync(...args);
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toMatch(/^Manifest write failed:/);
    expect(result.reason).toContain("I/O error");
  });

  it("45. WS-GO-02: mkdirSync EACCES for keyring/ → permission_denied (parallel to test 20, no repair path)", async () => {
    // WS-GO-02: The repair path is removed. renameSync EACCES in agent staging no
    // longer applies. The relevant EACCES now comes from mkdirSync for keyring/.
    // This covers the EACCES branch in the keyring/ mkdir handler.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // 3rd mkdirSync call: resolvedHome (1st), ledger/ (2nd), keyring/ (3rd → EACCES)
    const realMkdirSync = fs.mkdirSync.bind(fs);
    let callCount = 0;
    vi.spyOn(fs, "mkdirSync").mockImplementation((...args: Parameters<typeof fs.mkdirSync>) => {
      callCount++;
      if (callCount === 3) {
        throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
      }
      return realMkdirSync(...args);
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: permission_denied from keyring/ mkdir EACCES
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("permission_denied");
    expect(result.reason).toContain("Permission denied");
  });

  it("46. WS-GO-02: chmodSync on resolvedHome is called after ledger/ and keyring/ created (parallel to test 22, no repair path)", async () => {
    // WS-GO-02: The repair path (EXDEV copy fallback) is removed. copyFileSync is
    // no longer called in provision(). This test verifies the post-mkdir chmodSync
    // step: resolvedHome must be set to 0o700 after ledger/ and keyring/ are created.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // Spy on chmodSync to capture what is called
    const chmodSyncSpy = vi.spyOn(fs, "chmodSync");

    await provision(makeOpts(bundleDir, homeDir));

    // chmodSync must be called at least once with resolvedHome and 0o700
    const calls = chmodSyncSpy.mock.calls;
    const homeCall = calls.find(([p, mode]) => String(p) === homeDir && Number(mode) === 0o700);
    expect(homeCall).toBeDefined();

    // ledger/ and keyring/ must exist (chmod still runs after their creation)
    expect(fs.existsSync(path.join(homeDir, "ledger"))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, "keyring"))).toBe(true);
  });

  it("47. WS-GO-02: chmodSync on manifest.json is called after manifest written (parallel to test 37, no repair path)", async () => {
    // WS-GO-02: The repair path is removed. This test verifies the manifest chmodSync
    // call (in writeManifest) still fires correctly after the rename succeeds.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const manifestPath = path.join(homeDir, "manifest.json");

    const chmodSyncSpy = vi.spyOn(fs, "chmodSync");

    await provision(makeOpts(bundleDir, homeDir));

    // chmodSync must be called for manifest.json with 0o644
    const calls = chmodSyncSpy.mock.calls;
    const manifestCall = calls.find(
      ([p, mode]) => String(p) === manifestPath && Number(mode) === 0o644
    );
    expect(manifestCall).toBeDefined();

    // manifest.json must exist with 0o644 permissions
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.statSync(manifestPath).mode & 0o777).toBe(0o644);
  });

  it("48. WS-GO-02: fresh provision → returns ok, ledger/ and keyring/ created, manifest written (parallel to test 12, no repair path)", async () => {
    // WS-GO-02: The repair path (EXDEV renameSync) is removed. This test covers the
    // full fresh provision happy path: ledger/ and keyring/ created, manifest written.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: ok result
    expect(result.status).toBe("ok");

    // ledger/ and keyring/ must exist
    expect(fs.existsSync(path.join(homeDir, "ledger"))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, "keyring"))).toBe(true);

    // manifest.json must be written
    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(true);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(homeDir, "manifest.json"), "utf8")
    ) as Record<string, unknown>;
    expect(manifest["schema_version"]).toBe("1");
  });

  it("49. WS-GO-02: readFileSync for bundleIds contents → used for revocation data only (parallel to test 36, no SHA-256 verify)", async () => {
    // WS-GO-02: SHA-256 verify-after-write is removed. readFileSync in provision()
    // is now only called to read bundleDir files for the revocation data computation.
    // This test verifies that provision() succeeds even when agentsDir reads would be
    // tampered (since there is no verify-after-write reading from agentsDir).
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    // spy on readFileSync but DO NOT tamper — just track what was read
    const readPaths: string[] = [];
    const realReadFileSync = fs.readFileSync.bind(fs);
    vi.spyOn(fs, "readFileSync").mockImplementation(
      (p: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
        const pStr = typeof p === "string" ? p : String(p);
        readPaths.push(pStr);
        return (realReadFileSync as (...args: unknown[]) => unknown)(p, ...rest) as ReturnType<
          typeof fs.readFileSync
        >;
      }
    );

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: provision succeeds
    expect(result.status).toBe("ok");

    // readFileSync must only read from bundleDir (for revocation data) — NOT from homeDir/agents/
    const homeDirAgentsReads = readPaths.filter((p) => p.startsWith(path.join(homeDir, "agents")));
    expect(homeDirAgentsReads).toHaveLength(0);
  });

  it("50. WS-GO-02: fresh provision with multiple bundleIds → all IDs passed to checkRevocation as sorted concat (parallel to test 29, no repair path)", async () => {
    // WS-GO-02: The repair path is removed. loadAgentDefinition verification is removed.
    // This test verifies the sorted bundleId concat is passed to checkRevocation
    // even for a fresh provision with multiple agents.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    let capturedData: Buffer | undefined;
    vi.mocked(checkRevocation).mockImplementation(async (opts) => {
      capturedData = Buffer.from(opts.data);
      return { verdict: "PASS" };
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: provision succeeds
    expect(result.status).toBe("ok");

    // capturedData must equal sorted concat of bundleDir contents
    const alphaContent = fs.readFileSync(path.join(bundleDir, "alpha.md"));
    const betaContent = fs.readFileSync(path.join(bundleDir, "beta.md"));
    const gammaContent = fs.readFileSync(path.join(bundleDir, "gamma.md"));
    const expected = Buffer.concat([alphaContent, betaContent, gammaContent]);

    expect(capturedData).toBeDefined();
    expect(capturedData).toEqual(expected);
  });
});

// =============================================================================
// WS-GO-02: New provision() behaviours — data-dir bootstrap, HostContext,
// idempotency trigger change, bundleDir default, warning propagation,
// manifest schema update.
//
// STATUS: FAILING until dev implements WS-GO-02 changes in provision.ts.
//
// These tests REMOVE the agent-file-copy assertion model and REPLACE it with
// data-dir bootstrap assertions:
//   - provision() now creates ~/.teo/ledger/ and ~/.teo/keyring/ (mode 0o700)
//     instead of copying agent .md files to ~/.teo/agents/
//   - Idempotency trigger changes from (manifest.json + agentsDir present) to
//     (ledger/ AND keyring/ both present)
//   - bundleDir is now optional in plugin context (defaults to ${pluginRoot}/agents)
//   - ProvisionResult ok/already_provisioned/repaired arms gain optional warning?
//   - manifest.json schema loses agents_dir and files; retains schema_version,
//     teo_version, provisioned_at, bundle_signature_key_id
//
// REMOVED TESTS (from earlier describe blocks) and WHY:
//   - "15. fresh provision: returns ok, all agents copied…" — asserts agent .md
//     files are written to agentsDir. Role-shift removes agent-file-copy entirely.
//     REPLACED by T8 (data-dir bootstrap) and T9 (idempotency on ledger+keyring).
//   - "16. canonical bytes ordering…" — asserts listAgentIds + sorted concat for
//     revocation data. Role-shift: bundleDir is now optional; canonical bytes
//     computation changes or is removed.
//   - "33. fresh provision: manifest.json written…" — asserts agents_dir and files
//     fields in manifest. New schema has no agents_dir or files.
//     REPLACED by T14 (new manifest schema).
//   - "35. fresh provision: manifest SHA-256 values match in-memory bundle chunks" —
//     manifest no longer has a files{} block with sha256 entries.
//     REMOVED; covered by T14 asserting files field is absent.
//   - "39. repair path: manifest absent + agentsDir present → 'repaired'…" —
//     repair trigger changes to (ledger/ absent OR keyring/ absent), not manifest.
//     Test 39 uses the OLD trigger (manifest-absent + agentsDir-present) which is
//     no longer the repair trigger. REPLACED by T10 (partial state → fresh provision).
//   - "41. teo_version in manifest matches package.json version" — teo_version is
//     now a build-time injected constant (TEO_VERSION), not runtime readFileSync.
//     The assertion changes: teo_version may be process.env.TEO_VERSION or a
//     placeholder. The specific "0.1.0" value is no longer guaranteed by this path.
//     REPLACED by T14 (teo_version field present, non-empty string).
//   - Tests 07/30/31/32 (2-stat hot path with manifest.json) — idempotency trigger
//     changes from (manifest.json + agentsDir) to (ledger/ + keyring/).
//     These tests use the OLD trigger and will no longer reflect the implementation.
//     They are LEFT IN PLACE as regression guards but are expected to fail once
//     dev implements WS-GO-02 — see note in each test about the trigger change.
//     The new idempotency tests are T9 and T10 below.
// =============================================================================

describe("provision() — WS-GO-02: data-dir bootstrap (ledger/ and keyring/ creation)", () => {
  // T8: Fresh provision → ledger/ and keyring/ created under homeDir with mode 0o700
  // The role-shift removes agent-file-copy. The new job of provision() is to
  // bootstrap the data directories for ledger and keyring.
  it("T8. Fresh provision → ledger/ and keyring/ created under homeDir with mode 0o700", async () => {
    const bundleDir = makeFixtureBundle(["alpha"]);
    const homeDir = makeTempHome();

    const result = await provision(makeOpts(bundleDir, homeDir));

    // Provision must succeed
    expect(result.status).toBe("ok");

    // ledger/ MUST exist under homeDir with mode 0o700
    const ledgerDir = path.join(homeDir, "ledger");
    expect(fs.existsSync(ledgerDir)).toBe(true);
    expect(fs.statSync(ledgerDir).isDirectory()).toBe(true);
    expect(fs.statSync(ledgerDir).mode & 0o777).toBe(0o700);

    // keyring/ MUST exist under homeDir with mode 0o700
    const keyringDir = path.join(homeDir, "keyring");
    expect(fs.existsSync(keyringDir)).toBe(true);
    expect(fs.statSync(keyringDir).isDirectory()).toBe(true);
    expect(fs.statSync(keyringDir).mode & 0o777).toBe(0o700);
  });

  // T9: Already-provisioned check → when ledger/ AND keyring/ both exist → { status: "already_provisioned" }
  // The new idempotency trigger is ledger/ AND keyring/ both present (not manifest.json + agentsDir).
  it("T9. ledger/ AND keyring/ both present → { status: 'already_provisioned' }, checkRevocation NOT called", async () => {
    const bundleDir = makeFixtureBundle(["alpha"]);
    const homeDir = makeTempHome();

    // Pre-create BOTH ledger/ and keyring/ — this is the new idempotency trigger
    fs.mkdirSync(path.join(homeDir, "ledger"), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(homeDir, "keyring"), { recursive: true, mode: 0o700 });

    const result = await provision(makeOpts(bundleDir, homeDir));

    expect(result).toEqual({ status: "already_provisioned" });
    // Idempotency check is a read-gate — checkRevocation must NOT be called
    expect(vi.mocked(checkRevocation)).not.toHaveBeenCalled();
  });

  // T10: Partial state → ledger/ exists but keyring/ absent → fresh provision runs (not already_provisioned)
  // Only when BOTH directories are present is the system considered fully provisioned.
  // A partial state (one dir present, one absent) triggers a fresh provision.
  it("T10. ledger/ present but keyring/ absent → fresh provision runs, not already_provisioned", async () => {
    const bundleDir = makeFixtureBundle(["alpha"]);
    const homeDir = makeTempHome();

    // Only ledger/ present — keyring/ absent → partial state → fresh provision
    fs.mkdirSync(path.join(homeDir, "ledger"), { recursive: true, mode: 0o700 });
    // keyring/ intentionally absent

    const result = await provision(makeOpts(bundleDir, homeDir));

    // Must NOT return already_provisioned — partial state triggers fresh provision
    expect(result.status).not.toBe("already_provisioned");
    // Fresh provision must succeed (ok) or fail with an error — not already_provisioned
    expect(["ok", "repaired", "error"]).toContain(result.status);

    // checkRevocation must have been called (fresh provision gate)
    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });
});

describe("provision() — WS-GO-02: HostContext and bundleDir defaults", () => {
  // T11: bundleDir default in plugin context → when host.kind="claude-code-plugin" + pluginRoot="/fake/plugin"
  // + no bundleDir → bundleDir resolved to "/fake/plugin/agents"
  // ProvisionOptions gains optional host?: HostContext. When host.kind is plugin and
  // bundleDir is not supplied, provision() defaults bundleDir to ${host.pluginRoot}/agents.
  it("T11. host.kind='claude-code-plugin' + no bundleDir → bundleDir defaults to ${pluginRoot}/agents", async () => {
    // The bundleDir default is tested by verifying provision() does NOT return
    // the "bundleDir required" error — it resolves the default and proceeds.
    // We use a real tmpDir as pluginRoot and create an "agents" subdir with valid fixtures.
    const pluginRoot = makeTempHome();
    const agentsSubdir = path.join(pluginRoot, "agents");
    // Create the agents subdir with a valid agent file so listAgentIds() can scan it
    fs.mkdirSync(agentsSubdir, { recursive: true });
    const content =
      `---\n` +
      `agent_id: alpha\n` +
      `name: Alpha\n` +
      `role: Test role.\n` +
      `disallowedTools_default:\n` +
      `---\n\n` +
      `# alpha constitution\n\nBody text.\n`;
    fs.writeFileSync(path.join(agentsSubdir, "alpha.md"), content, "utf8");

    const homeDir = makeTempHome();

    // Build opts WITHOUT bundleDir — the host context should supply the default
    // ProvisionOptions gains host?: HostContext for WS-GO-02
    const opts = {
      homeDir,
      host: { kind: "claude-code-plugin" as const, pluginRoot },
      revocationOpts: {
        signature: new Uint8Array(64).fill(0x01),
        publicKey: new Uint8Array(32).fill(0x02),
        keyId: "test-key-id",
        revocationList: { revoked_keys: [] as { key_id: string }[] },
      },
      // bundleDir intentionally absent — plugin context provides the default
    } as Parameters<typeof provision>[0];

    const result = await provision(opts);

    // Must NOT return "bundleDir is required" error — the host context default kicked in
    if (result.status === "error") {
      expect(result.reason).not.toContain("bundleDir is required");
    }
    // Should succeed (ok or already_provisioned) since pluginRoot/agents is valid
    expect(["ok", "already_provisioned", "repaired"]).toContain(result.status);
  });

  // T12: bundleDir required in standalone → no host.pluginRoot + no bundleDir →
  // { status: "error", kind: "io_error", reason: includes "bundleDir is required" }
  it("T12. standalone context + no bundleDir → { status: 'error', kind: 'io_error', reason includes 'bundleDir is required' }", async () => {
    const homeDir = makeTempHome();

    // Build opts without bundleDir and without a plugin host context
    const opts = {
      homeDir,
      // No bundleDir, no plugin host — standalone context
      host: { kind: "standalone" as const },
      revocationOpts: {
        signature: new Uint8Array(64).fill(0x01),
        publicKey: new Uint8Array(32).fill(0x02),
        keyId: "test-key-id",
        revocationList: { revoked_keys: [] as { key_id: string }[] },
      },
    } as Parameters<typeof provision>[0];

    const result = await provision(opts);

    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toContain("bundleDir is required");
  });
});

describe("provision() — WS-GO-02: warning propagation and manifest schema", () => {
  // T13: warning propagated → fail-open revocation returns warning → ProvisionResult.warning set
  // When checkRevocation() returns { verdict: "PASS", warning: "unsigned-plugin-context" },
  // the ProvisionResult must carry the same warning on the ok/already_provisioned/repaired arms.
  it("T13. checkRevocation returns PASS with warning → ProvisionResult.warning = 'unsigned-plugin-context'", async () => {
    // Override checkRevocation to return a PASS with a warning (simulating plugin context fail-open)
    vi.mocked(checkRevocation).mockResolvedValue({
      verdict: "PASS",
      warning: "unsigned-plugin-context",
    } as import("./revocation.js").RevocationResult & { warning?: string });

    const bundleDir = makeFixtureBundle(["alpha"]);
    const homeDir = makeTempHome();

    const result = await provision(makeOpts(bundleDir, homeDir));

    // Provision should succeed
    expect(result.status).toBe("ok");

    // The warning from checkRevocation must propagate to the ProvisionResult
    const resultWithWarning = result as typeof result & { warning?: string };
    expect(resultWithWarning.warning).toBe("unsigned-plugin-context");
  });

  // T14: manifest.json written with new schema (no agents_dir, no files) →
  // { schema_version, teo_version, provisioned_at, bundle_signature_key_id } all present,
  // agents_dir ABSENT, files ABSENT.
  it("T14. manifest.json new schema: schema_version, teo_version, provisioned_at, bundle_signature_key_id present; agents_dir and files absent", async () => {
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const result = await provision(makeOpts(bundleDir, homeDir));

    expect(result.status).toBe("ok");

    const manifestPath = path.join(homeDir, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

    // Required fields — all must be present
    expect(manifest["schema_version"]).toBe("1");
    expect(typeof manifest["teo_version"]).toBe("string");
    expect((manifest["teo_version"] as string).length).toBeGreaterThan(0);
    expect(typeof manifest["provisioned_at"]).toBe("string");
    const provisioned = new Date(manifest["provisioned_at"] as string);
    expect(isNaN(provisioned.getTime())).toBe(false); // valid ISO-8601
    expect(manifest["bundle_signature_key_id"]).toBe("test-key-id");

    // Removed fields — must NOT be present in the new schema
    expect(manifest).not.toHaveProperty("agents_dir");
    expect(manifest).not.toHaveProperty("files");
  });
});
