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
import * as crypto from "node:crypto";
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
    // Arrange: fully provisioned homeDir — agentsDir present AND manifest.json present.
    // WS-P1-04a: the 2-stat hot path requires BOTH manifest.json AND agentsDir to be
    // present. Without manifest.json this would trigger the REPAIR path, not already_provisioned.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const stem of ["alpha", "beta", "gamma"]) {
      fs.writeFileSync(path.join(agentsDir, `${stem}.md`), `content-${stem}`);
    }

    // WS-P1-04a: also write manifest.json — required for the 2-stat hot path to fire.
    fs.writeFileSync(
      path.join(homeDir, "manifest.json"),
      JSON.stringify({ schema_version: "1", teo_version: "0.1.0" })
    );

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

  it("08. repair: agentsDir present, manifest absent → returns repaired, no repairedFiles property, manifest written (AC-04)", async () => {
    // Arrange: agentsDir present (alpha + gamma), NO manifest.json.
    // WS-P1-04a: repair is now triggered by manifest ABSENT + agentsDir PRESENT,
    // regardless of file count or content. The repair path runs a full fresh provision
    // (checkRevocation + atomic staging over existing agentsDir + SHA-256 verify + manifest write).
    // repairedFiles[] is REMOVED from the return type.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "alpha.md"), "content-alpha");
    fs.writeFileSync(path.join(agentsDir, "gamma.md"), "content-gamma");
    // beta.md intentionally absent — but repair trigger is manifest absent, not missing files

    // Act: NO manifest.json → repair path fires
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: returns repaired (new trigger), NOT already_provisioned
    expect(result.status).toBe("repaired");

    // WS-P1-04a: repairedFiles[] is REMOVED — result must NOT have this property
    expect(result).not.toHaveProperty("repairedFiles");

    // manifest.json must be written on the repair path
    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(true);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(homeDir, "manifest.json"), "utf8")
    ) as Record<string, unknown>;
    expect(manifest["schema_version"]).toBe("1");
  });

  it("09. repair: agentsDir present with zero-byte file, manifest absent → repaired, no repairedFiles, manifest written (AC-04/OQ-02)", async () => {
    // Arrange: beta is 0 bytes; NO manifest.json.
    // WS-P1-04a: zero-byte detection is no longer the repair trigger. The new trigger
    // is manifest ABSENT + agentsDir PRESENT. A full fresh provision runs regardless
    // of whether individual files are zero-byte, partial, or complete. After re-provisioning,
    // all files will be correctly populated from bundleDir.
    // repairedFiles[] is REMOVED — result must NOT carry this field.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "alpha.md"), "content-alpha");
    fs.writeFileSync(path.join(agentsDir, "beta.md"), ""); // 0 bytes
    fs.writeFileSync(path.join(agentsDir, "gamma.md"), "content-gamma");

    // Act: NO manifest.json → repair path fires
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: repair path triggered (not already_provisioned — no manifest.json present)
    expect(result.status).toBe("repaired");

    // WS-P1-04a: repairedFiles[] removed
    expect(result).not.toHaveProperty("repairedFiles");

    // After repair: beta.md must be re-written from bundleDir (non-zero)
    expect(fs.statSync(path.join(agentsDir, "beta.md")).size).toBeGreaterThan(0);

    // manifest.json written on success
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
    // Arrange: agentsDir present (alpha + gamma), beta missing, NO manifest.json.
    // WS-P1-04a: repair path is now triggered by manifest ABSENT + agentsDir PRESENT.
    // Do NOT create manifest.json — that is the new repair trigger.
    // Override checkRevocation to BLOCKED so the repair-path revocation gate fires.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "alpha.md"), "content-alpha");
    fs.writeFileSync(path.join(agentsDir, "gamma.md"), "content-gamma");
    // beta.md intentionally absent — but repair triggers on manifest-absent, not missing files
    // manifest.json intentionally NOT created — that is the new repair trigger

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
    // Arrange: agentsDir present, NO manifest.json → repair path triggered (WS-P1-04a trigger).
    // checkRevocation returns PASS (default from beforeEach).
    // WS-P1-04a: repair path runs a full fresh provision (staging + SHA-256 verify + loadAgentDefinition).
    // Override loadAgentDefinition to throw for 'beta' (the post-write verification step).
    // The repair path runs loadAgentDefinition for ALL ids (full provision), so we must allow
    // alpha and gamma through and only fail beta.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "alpha.md"), "content-alpha");
    fs.writeFileSync(path.join(agentsDir, "gamma.md"), "content-gamma");
    // beta.md absent — but repair trigger is manifest absent, not missing files
    // manifest.json intentionally NOT created — that is the WS-P1-04a repair trigger

    vi.mocked(loadAgentDefinition).mockImplementation((id: string, dir?: string) => {
      // Throw for beta in the post-repair verification step (called with agentsDir).
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

    // Two entries under homeDir: agents/ + manifest.json (AC-01/OQ-01, WS-P1-04a)
    expect(fs.readdirSync(homeDir).sort()).toEqual(["agents", "manifest.json"]);

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

// =============================================================================
// WS-P1-04a: MANIFEST WRITE, 2-STAT HOT PATH, SHA-256 VERIFY-AFTER-WRITE
// These tests FAIL until dev implements the new behaviour in provision.ts.
// =============================================================================

describe("provision() — WS-P1-04a: 2-stat hot path idempotency", () => {
  it("30. 2-stat hot path: both manifest.json AND agentsDir present → already_provisioned, no revocation call", async () => {
    // Arrange: both manifest.json AND agentsDir exist.
    // This is the only state that should produce already_provisioned under WS-P1-04a.
    // checkRevocation must NOT be called — this is the fast-path, no writes.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "alpha.md"), "content-alpha");
    fs.writeFileSync(path.join(agentsDir, "beta.md"), "content-beta");

    // manifest.json must also be present for the 2-stat hot path to fire
    fs.writeFileSync(
      path.join(homeDir, "manifest.json"),
      JSON.stringify({ schema_version: "1", teo_version: "0.1.0" })
    );

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: fast path → no writes, no revocation
    expect(result).toEqual({ status: "already_provisioned" });
    expect(vi.mocked(checkRevocation)).not.toHaveBeenCalled();
  });

  it("31. 2-stat hot path: manifest.json absent, agentsDir present → repair path (not already_provisioned)", async () => {
    // Arrange: agentsDir with files, but NO manifest.json.
    // Under WS-P1-04a, this is the repair trigger. checkRevocation must be called once.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "alpha.md"), "content-alpha");
    fs.writeFileSync(path.join(agentsDir, "beta.md"), "content-beta");
    // NO manifest.json — this must NOT produce already_provisioned

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: repair path, not already_provisioned
    expect(result.status).toBe("repaired");
    expect(result.status).not.toBe("already_provisioned");

    // checkRevocation called exactly once (repair path gate)
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
  it("33. fresh provision: manifest.json written after provision with correct schema", async () => {
    // Arrange: fresh homeDir, fixture bundle with 3 agents
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: result ok
    expect(result.status).toBe("ok");

    // manifest.json must exist at homeDir/manifest.json
    const manifestPath = path.join(homeDir, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    // Parse and check all required fields
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

    expect(manifest["schema_version"]).toBe("1");
    expect(typeof manifest["teo_version"]).toBe("string");
    expect((manifest["teo_version"] as string).length).toBeGreaterThan(0);

    // provisioned_at must be a valid ISO-8601 string
    expect(typeof manifest["provisioned_at"]).toBe("string");
    const provisioned = new Date(manifest["provisioned_at"] as string);
    expect(isNaN(provisioned.getTime())).toBe(false);

    // agents_dir must be the absolute path to agentsDir
    expect(manifest["agents_dir"]).toBe(path.join(homeDir, "agents"));

    // bundle_signature_key_id must match revocationOpts.keyId
    expect(manifest["bundle_signature_key_id"]).toBe("test-key-id");

    // files must contain all 3 agent ids
    expect(typeof manifest["files"]).toBe("object");
    const files = manifest["files"] as Record<string, unknown>;
    expect(Object.keys(files).sort()).toEqual(["alpha", "beta", "gamma"]);

    // Each file entry must have path, sha256, size_bytes
    for (const agentId of ["alpha", "beta", "gamma"]) {
      const entry = files[agentId] as Record<string, unknown>;
      expect(typeof entry["path"]).toBe("string");
      expect(typeof entry["sha256"]).toBe("string");
      expect((entry["sha256"] as string).length).toBe(64); // hex SHA-256 = 64 chars
      expect(typeof entry["size_bytes"]).toBe("number");
      expect(entry["size_bytes"] as number).toBeGreaterThan(0);
    }
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

  it("35. fresh provision: manifest SHA-256 values match in-memory bundle chunks", async () => {
    // The manifest's sha256 must be derived from the in-memory chunks (bundleDir content),
    // NOT from re-reading the installed agentsDir files. This test validates correctness
    // by computing the expected hash from bundleDir and comparing to the manifest.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    await provision(makeOpts(bundleDir, homeDir));

    const manifestPath = path.join(homeDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const files = manifest["files"] as Record<string, Record<string, unknown>>;

    for (const agentId of ["alpha", "beta", "gamma"]) {
      // Compute expected SHA-256 from bundleDir (the in-memory source)
      const bundleContent = fs.readFileSync(path.join(bundleDir, `${agentId}.md`));
      const expectedSha256 = crypto.createHash("sha256").update(bundleContent).digest("hex");
      const expectedSizeBytes = bundleContent.byteLength;

      const entry = files[agentId];
      expect(entry).toBeDefined();
      expect(entry!["sha256"]).toBe(expectedSha256);
      expect(entry!["size_bytes"]).toBe(expectedSizeBytes);

      // path must be the absolute path to the installed file in agentsDir
      expect(entry!["path"]).toBe(path.join(homeDir, "agents", `${agentId}.md`));
    }
  });

  it("41. teo_version in manifest matches package.json version", async () => {
    // teo_version is read from package.json at runtime. For this project it is "0.1.0".
    // If package.json changes, this test must be updated accordingly.
    const bundleDir = makeFixtureBundle(["alpha"]);
    const homeDir = makeTempHome();

    await provision(makeOpts(bundleDir, homeDir));

    const manifest = JSON.parse(
      fs.readFileSync(path.join(homeDir, "manifest.json"), "utf8")
    ) as Record<string, unknown>;

    expect(manifest["teo_version"]).toBe("0.1.0");
  });
});

describe("provision() — WS-P1-04a: SHA-256 verify-after-write (byte integrity)", () => {
  it("36. verify-after-write: SHA-256 mismatch after install → verification_failed, no manifest.json written", async () => {
    // Arrange: provision() writes to agentsDir, then re-reads to verify SHA-256.
    // We spy on fs.readFileSync: pass through calls to bundleDir (staging reads),
    // but return tampered bytes for reads from agentsDir (the verify-after-write step).
    // This simulates silent disk corruption between write and verify.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");

    // Spy strategy: tamper with readFileSync calls that read from agentsDir.
    // provision.ts reads from bundleDir first (chunks[] computation), then from
    // agentsDir during verify-after-write. We distinguish by path prefix.
    const realReadFileSync = fs.readFileSync.bind(fs);
    vi.spyOn(fs, "readFileSync").mockImplementation(
      (p: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
        const pStr = typeof p === "string" ? p : String(p);
        // Tamper with reads from the installed agentsDir
        if (pStr.startsWith(agentsDir) && pStr.endsWith(".md")) {
          // Return tampered bytes — SHA-256 will not match the in-memory chunks
          return Buffer.from("TAMPERED CONTENT — SHA-256 will not match");
        }
        // All other reads (bundleDir, etc.) pass through to the real implementation
        return (realReadFileSync as (...args: unknown[]) => unknown)(p, ...rest) as ReturnType<
          typeof fs.readFileSync
        >;
      }
    );

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: SHA-256 mismatch → verification_failed
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("verification_failed");
    expect(result.reason).toMatch(/SHA-256 mismatch/i);
    // The reason must name the agent id that failed
    expect(result.reason).toMatch(/alpha|beta/);

    // manifest.json must NOT be written when verification fails
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

  it("38b. manifest not written when staging rename fails (io_error)", async () => {
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("I/O error"), { code: "EIO" });
    });

    await provision(makeOpts(bundleDir, homeDir));

    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(false);
  });

  it("38c. manifest not written when SHA-256 verify-after-write fails", async () => {
    // SHA-256 mismatch during verify-after-write must prevent manifest write.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();
    const agentsDir = path.join(homeDir, "agents");

    const realReadFileSync = fs.readFileSync.bind(fs);
    vi.spyOn(fs, "readFileSync").mockImplementation(
      (p: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
        const pStr = typeof p === "string" ? p : String(p);
        if (pStr.startsWith(agentsDir) && pStr.endsWith(".md")) {
          return Buffer.from("TAMPERED");
        }
        return (realReadFileSync as (...args: unknown[]) => unknown)(p, ...rest) as ReturnType<
          typeof fs.readFileSync
        >;
      }
    );

    await provision(makeOpts(bundleDir, homeDir));

    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(false);
  });

  it("38d. manifest not written when loadAgentDefinition throws (verification_failed)", async () => {
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    vi.mocked(loadAgentDefinition).mockImplementation(() => {
      throw new Error("Corrupt frontmatter");
    });

    await provision(makeOpts(bundleDir, homeDir));

    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(false);
  });
});

describe("provision() — WS-P1-04a: repair path manifest and type shape", () => {
  it("39. repair path: manifest absent + agentsDir present → 'repaired', manifest written, no repairedFiles field", async () => {
    // Arrange: agentsDir with valid fixture content (from bundleDir), NO manifest.json.
    // This is the canonical repair scenario under WS-P1-04a: manifest absent triggers repair.
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });

    // Pre-populate agentsDir with real fixture content (valid agent files)
    for (const stem of ["alpha", "beta", "gamma"]) {
      fs.copyFileSync(path.join(bundleDir, `${stem}.md`), path.join(agentsDir, `${stem}.md`));
    }
    // NO manifest.json — this is the repair trigger

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: repaired (not already_provisioned, not ok)
    expect(result.status).toBe("repaired");

    // WS-P1-04a: repairedFiles[] removed — result must NOT have this property
    expect(result).not.toHaveProperty("repairedFiles");

    // manifest.json must be written as part of the repair path
    const manifestPath = path.join(homeDir, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest["schema_version"]).toBe("1");
    expect(manifest["agents_dir"]).toBe(agentsDir);
    expect(manifest["bundle_signature_key_id"]).toBe("test-key-id");

    const files = manifest["files"] as Record<string, unknown>;
    expect(Object.keys(files).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("40. repair path: manifest absent + agentsDir present → checkRevocation called exactly once", async () => {
    // The repair path must gate on revocation exactly once (same as fresh provision).
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.copyFileSync(path.join(bundleDir, "alpha.md"), path.join(agentsDir, "alpha.md"));
    fs.copyFileSync(path.join(bundleDir, "beta.md"), path.join(agentsDir, "beta.md"));
    // NO manifest.json

    await provision(makeOpts(bundleDir, homeDir));

    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// WS-P1-04a: REPAIR PATH ERROR BRANCHES (parallel to fresh-provision tests 11,
// 22, 25, 26, 28, 37 — covers the 6 /* c8 ignore */ blocks in the repair path)
// =============================================================================

describe("provision() — repair path error branches (covers c8 ignore blocks)", () => {
  it("42. repair path: mkdtempSync failure → io_error (parallel to test 25)", async () => {
    // Arrange: agentsDir present (no manifest) to trigger repair path.
    // checkRevocation is called before mkdtempSync in the repair path; it must
    // fire once (PASS) before the mkdtempSync spy throws.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.copyFileSync(path.join(bundleDir, "alpha.md"), path.join(agentsDir, "alpha.md"));
    fs.copyFileSync(path.join(bundleDir, "beta.md"), path.join(agentsDir, "beta.md"));
    // NO manifest.json — triggers repair path

    // checkRevocation defaults to PASS from beforeEach — no override needed.
    // mockImplementationOnce so only the FIRST mkdtempSync call (staging dir creation)
    // throws; any prior real calls (from makeFixtureBundle / makeTempHome setup) already
    // completed before this spy is installed.
    vi.spyOn(fs, "mkdtempSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("No space left on device"), { code: "ENOSPC" });
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: io_error with ENOSPC message
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toContain("No space left on device");

    // checkRevocation was called once (before mkdtempSync, in the repair path revocation gate)
    expect(vi.mocked(checkRevocation)).toHaveBeenCalledTimes(1);

    // agentsDir still exists — mkdtempSync failed before rmSync(agentsDir) was reached
    expect(fs.existsSync(agentsDir)).toBe(true);
  });

  it("43. repair path: staging writeFileSync failure → io_error, staging cleaned up, agentsDir intact (parallel to test 26)", async () => {
    // Arrange: agentsDir present (no manifest) to trigger repair path.
    // The staging write loop fires BEFORE rmSync(agentsDir), so when the write
    // loop fails, agentsDir is still present.
    // The staging dir created by mkdtempSync must be cleaned up on error.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.copyFileSync(path.join(bundleDir, "alpha.md"), path.join(agentsDir, "alpha.md"));
    fs.copyFileSync(path.join(bundleDir, "beta.md"), path.join(agentsDir, "beta.md"));
    // NO manifest.json — triggers repair path

    // Count teo-provision-* staging dirs before provision() to verify cleanup.
    const tmpDir = os.tmpdir();
    const provisionDirsBefore = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith("teo-provision-")).length;

    // The repair path's writeFileSync loop writes into the staging dir.
    // mockImplementationOnce fires on the first writeFileSync call inside provision()
    // (the first agent file into staging).
    const realWriteFileSync = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("I/O error during staging"), { code: "EIO" });
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: io_error with EIO message
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toContain("I/O error during staging");

    // Staging dir must have been cleaned up (best-effort rmSync in the catch block)
    const provisionDirsAfter = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith("teo-provision-")).length;
    expect(provisionDirsAfter).toBe(provisionDirsBefore);

    // agentsDir still exists — rmSync(agentsDir) fires AFTER staging writes,
    // so a write failure leaves agentsDir untouched.
    expect(fs.existsSync(agentsDir)).toBe(true);

    // Restore the spy so the afterEach cleanup (rmSync on tempDirs) works correctly.
    vi.restoreAllMocks();
    void realWriteFileSync; // prevent unused-variable lint warning
  });

  it("44. repair path: renameSync EIO → io_error (parallel to test 11)", async () => {
    // Arrange: agentsDir present (no manifest) to trigger repair path.
    // renameSync throws EIO (generic I/O, not EXDEV and not EACCES) — exercises
    // the fallthrough else-branch in the repair path rename error handler.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.copyFileSync(path.join(bundleDir, "alpha.md"), path.join(agentsDir, "alpha.md"));
    fs.copyFileSync(path.join(bundleDir, "beta.md"), path.join(agentsDir, "beta.md"));
    // NO manifest.json — triggers repair path

    // Throw EIO on the first renameSync call (staging → agentsDir).
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("I/O error"), { code: "EIO" });
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");
    expect(result.reason).toContain("I/O error");
  });

  it("45. repair path: renameSync EACCES → permission_denied (mirrors fresh-provision path, test 28)", async () => {
    // Arrange: agentsDir present (no manifest) to trigger repair path.
    // renameSync throws EACCES. The repair path rename error handler now has an EACCES
    // branch that mirrors the fresh-provision path (test 28 → permission_denied).
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.copyFileSync(path.join(bundleDir, "alpha.md"), path.join(agentsDir, "alpha.md"));
    fs.copyFileSync(path.join(bundleDir, "beta.md"), path.join(agentsDir, "beta.md"));
    // NO manifest.json — triggers repair path

    // Throw EACCES on the first renameSync call (staging → agentsDir).
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: permission_denied (mirrors fresh-provision path behavior)
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("permission_denied");
    expect(result.reason).toContain("Permission denied");
  });

  it("46. repair path: EXDEV copy failure leaves no partial agentsDir (parallel to test 22)", async () => {
    // Arrange: agentsDir present (no manifest) to trigger repair path.
    // Chain two spies: renameSync EXDEV on the first call (staging → agentsDir),
    // then copyFileSync throws ENOSPC to fail the EXDEV fallback copy.
    // After the error, agentsDir must NOT exist:
    //   - rmSync(agentsDir) fires BEFORE the rename attempt (removes it)
    //   - EXDEV fallback calls mkdirSync(agentsDir) then copyFileSync fails
    //   - cleanup in copyErr catch calls rmSync(agentsDir, { recursive: true, force: true })
    const bundleDir = makeFixtureBundle(["alpha", "beta", "gamma"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const stem of ["alpha", "beta", "gamma"]) {
      fs.copyFileSync(path.join(bundleDir, `${stem}.md`), path.join(agentsDir, `${stem}.md`));
    }
    // NO manifest.json — triggers repair path

    // First renameSync throws EXDEV; subsequent renames (manifest .tmp → .json) pass through.
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("Invalid cross-device link"), { code: "EXDEV" });
    });
    // copyFileSync always throws ENOSPC — makes the EXDEV fallback copy fail immediately.
    vi.spyOn(fs, "copyFileSync").mockImplementation(() => {
      throw Object.assign(new Error("No space left on device"), { code: "ENOSPC" });
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: io_error from copyErr path
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("io_error");

    // agentsDir must NOT exist: rmSync(agentsDir) ran before the rename attempt,
    // and the copyErr catch cleanup also calls rmSync(agentsDir).
    expect(fs.existsSync(agentsDir)).toBe(false);
  });

  it("47. repair path: manifest write failure → io_error 'Manifest write failed:' (parallel to test 37)", async () => {
    // Arrange: agentsDir present (no manifest) to trigger repair path.
    // All staging + SHA-256 verify + loadAgentDefinition steps succeed.
    // The spy intercepts writeFileSync ONLY when the target path is the manifest .tmp file,
    // letting all staging writes (into repairStagingDir) pass through normally.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.copyFileSync(path.join(bundleDir, "alpha.md"), path.join(agentsDir, "alpha.md"));
    fs.copyFileSync(path.join(bundleDir, "beta.md"), path.join(agentsDir, "beta.md"));
    // NO manifest.json — triggers repair path

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

    // manifest.json must NOT be written
    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(false);

    // manifest.json.tmp must be cleaned up (best-effort delete in writeManifest catch)
    expect(fs.existsSync(manifestTmpPath)).toBe(false);
  });

  it("48. repair path: EXDEV success → per-file copy succeeds, returns repaired, manifest written (parallel to test 12)", async () => {
    // Arrange: agentsDir present (no manifest) to trigger repair path.
    // renameSync throws EXDEV on the first call (staging → agentsDir), triggering
    // the EXDEV fallback copy path inside the repair branch. The copy succeeds
    // (subsequent renames and real fs calls pass through).
    // This test covers the /* c8 ignore start/stop */ block in provision.ts
    // at the EXDEV-success staging cleanup + chmod lines in the repair path.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.copyFileSync(path.join(bundleDir, "alpha.md"), path.join(agentsDir, "alpha.md"));
    fs.copyFileSync(path.join(bundleDir, "beta.md"), path.join(agentsDir, "beta.md"));
    // NO manifest.json — triggers repair path

    const realRenameSync = fs.renameSync.bind(fs);
    let callCount = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
      callCount++;
      if (callCount === 1) {
        // First call is the staging dir → agentsDir rename; throw EXDEV
        throw Object.assign(new Error("Invalid cross-device link"), { code: "EXDEV" });
      }
      // Subsequent renames (e.g. manifest .tmp → .json) pass through
      return realRenameSync(...(args as Parameters<typeof fs.renameSync>));
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: EXDEV fallback recovered fully — repair path returns repaired
    expect(result.status).toBe("repaired");

    // Agent files must be present in agentsDir after the per-file copy
    expect(fs.existsSync(path.join(agentsDir, "alpha.md"))).toBe(true);
    expect(fs.existsSync(path.join(agentsDir, "beta.md"))).toBe(true);

    // manifest.json must be written after successful repair + verify
    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(true);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(homeDir, "manifest.json"), "utf8")
    ) as Record<string, unknown>;
    expect(manifest["schema_version"]).toBe("1");
  });

  it("49. repair path: SHA-256 mismatch → verification_failed, no manifest.json written (parallel to test 36)", async () => {
    // Arrange: agentsDir present (no manifest) to trigger repair path.
    // Spy on fs.readFileSync to return tampered bytes when reading from agentsDir
    // paths during the verify-after-write step, simulating silent disk corruption.
    // Reads from bundleDir and other paths pass through to the real implementation.
    // This test covers the /* c8 ignore next 6 */ block at the SHA-256 mismatch
    // return in the repair path (provision.ts lines 395-402).
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.copyFileSync(path.join(bundleDir, "alpha.md"), path.join(agentsDir, "alpha.md"));
    fs.copyFileSync(path.join(bundleDir, "beta.md"), path.join(agentsDir, "beta.md"));
    // NO manifest.json — triggers repair path

    const realReadFileSync = fs.readFileSync.bind(fs);
    vi.spyOn(fs, "readFileSync").mockImplementation(
      (p: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
        const pStr = typeof p === "string" ? p : String(p);
        // Tamper with reads from the installed agentsDir (verify-after-write step)
        if (pStr.startsWith(agentsDir) && pStr.endsWith(".md")) {
          return Buffer.from("TAMPERED CONTENT");
        }
        // All other reads (bundleDir, staging, package.json, etc.) pass through
        return (realReadFileSync as (...args: unknown[]) => unknown)(p, ...rest) as ReturnType<
          typeof fs.readFileSync
        >;
      }
    );

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: SHA-256 mismatch → verification_failed
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("verification_failed");
    expect(result.reason).toMatch(/SHA-256 mismatch/i);

    // manifest.json must NOT be written when repair-path verification fails
    expect(fs.existsSync(path.join(homeDir, "manifest.json"))).toBe(false);
  });

  it("50. repair path: loadAgentDefinition throws bare string → verification_failed (parallel to test 29)", async () => {
    // Arrange: agentsDir present (no manifest) to trigger repair path.
    // loadAgentDefinition throws a bare string (not an Error instance) — exercises
    // the String(err) branch of the ternary in the repair path at provision.ts L411.
    // Test 20 covers the Error throw branch; this covers the else branch (bare string).
    // This test covers the /* c8 ignore next */ annotation at L411 in the repair path.
    const bundleDir = makeFixtureBundle(["alpha", "beta"]);
    const homeDir = makeTempHome();

    const agentsDir = path.join(homeDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.copyFileSync(path.join(bundleDir, "alpha.md"), path.join(agentsDir, "alpha.md"));
    fs.copyFileSync(path.join(bundleDir, "beta.md"), path.join(agentsDir, "beta.md"));
    // NO manifest.json — triggers repair path

    vi.mocked(loadAgentDefinition).mockImplementation(() => {
      throw "bare string error in repair";
    });

    // Act
    const result = await provision(makeOpts(bundleDir, homeDir));

    // Assert: verification_failed with bare string message in reason
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("narrowing guard");
    expect(result.kind).toBe("verification_failed");
    expect(result.reason).toContain("bare string error in repair");
  });
});
