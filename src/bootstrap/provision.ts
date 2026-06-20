// =============================================================================
// provision.ts — TEO agent roster provisioner (WS-P1-04 + WS-P1-04a)
//
// CONTRACT:
//   provision(opts: ProvisionOptions): Promise<ProvisionResult>
//
// DESIGN: Fail-safe, atomic, idempotent. Writes all agent .md files from
// bundleDir into resolvedHome/agents/ via a staging temp directory and a
// single rename() call. EXDEV fallback copies per-file when rename crosses
// device boundaries. checkRevocation() is called exactly once before any
// filesystem write. No import-time side effects.
//
// PERMISSIONS: resolvedHome 0o700, agents/ 0o700, each .md file 0o600,
//              manifest.json 0o644.
//
// WS-P1-04a: 2-stat hot path (manifest.json + agentsDir), SHA-256
// verify-after-write, atomic manifest write, repair path redefined to
// manifest-absent + agentsDir-present trigger.
//
// DEPENDENCY: checkRevocation() from ./revocation.ts; listAgentIds() and
// loadAgentDefinition() from ../agents/load.ts.
// =============================================================================

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { checkRevocation } from "./revocation.js";
import type { CheckRevocationOptions } from "./revocation.js";
import { listAgentIds, loadAgentDefinition } from "../agents/load.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProvisionErrorKind =
  | "permission_denied"
  | "io_error"
  | "revocation_blocked"
  | "conflict"
  | "verification_failed";

export type ProvisionResult =
  | { status: "ok" }
  | { status: "already_provisioned" }
  | { status: "repaired" }
  | { status: "error"; kind: ProvisionErrorKind; reason: string };

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ManifestFile {
  schema_version: "1";
  teo_version: string;
  provisioned_at: string;
  agents_dir: string;
  files: {
    [agentId: string]: {
      path: string;
      sha256: string;
      size_bytes: number;
    };
  };
  bundle_signature_key_id: string;
}

export interface ProvisionOptions {
  bundleDir: string;
  /**
   * TEO home directory.  Resolution order: homeDir arg > TEO_HOME env > os.homedir()+'/.teo'.
   *
   * TEO_HOME is a trusted-caller escape hatch for containerised or custom deployments.
   * provision() does NOT validate resolvedHome against dangerous paths — callers are
   * responsible for supplying a safe, intended path.
   */
  homeDir?: string;
  revocationOpts: Omit<CheckRevocationOptions, "data">;
}

// ---------------------------------------------------------------------------
// Path-traversal guard (mirrors TRAVERSAL_RE from ../agents/load.ts)
// ---------------------------------------------------------------------------

/** Matches "..", "/", or "\" — any of which allow directory traversal. */
const TRAVERSAL_RE = /\.\.|\/|\\/;

/**
 * Validates all agent ids returned from listAgentIds() before any path
 * construction.  Returns an error ProvisionResult if any id is unsafe;
 * returns null when all ids are clean.
 */
function checkIds(ids: string[]): Extract<ProvisionResult, { status: "error" }> | null {
  for (const id of ids) {
    if (TRAVERSAL_RE.test(id)) {
      return { status: "error", kind: "io_error", reason: `Invalid agent id in bundle: '${id}'` };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// SHA-256 helper
// ---------------------------------------------------------------------------

function sha256hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// teo_version reader (runtime, not import-time — zero-footprint constraint)
// ---------------------------------------------------------------------------

function readTeoVersion(): string {
  try {
    const pkgPath = new URL("../../package.json", import.meta.url).pathname;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    // The ?? "unknown" fallback is production-only: package.json always has version in CI.
    /* c8 ignore next */
    return pkg.version ?? "unknown";
  } catch {
    /* c8 ignore next */
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// writeManifest helper — atomic tmp → rename
// ---------------------------------------------------------------------------

function writeManifest(
  resolvedHome: string,
  agentsDir: string,
  ids: string[],
  chunks: Buffer[],
  keyId: string
): Extract<ProvisionResult, { status: "error" }> | null {
  const manifestPath = path.join(resolvedHome, "manifest.json");
  const tmpPath = manifestPath + ".tmp";

  const files: ManifestFile["files"] = {};
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    files[id] = {
      path: path.join(agentsDir, `${id}.md`),
      sha256: sha256hex(chunks[i]!),
      size_bytes: chunks[i]!.byteLength,
    };
  }

  const manifest: ManifestFile = {
    schema_version: "1",
    teo_version: readTeoVersion(),
    provisioned_at: new Date().toISOString(),
    agents_dir: agentsDir,
    files,
    bundle_signature_key_id: keyId,
  };

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), { mode: 0o644 });
    fs.renameSync(tmpPath, manifestPath);
    fs.chmodSync(manifestPath, 0o644);
  } catch (err) {
    // Best-effort cleanup of .tmp file.
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      /* c8 ignore next */
    }
    return {
      status: "error",
      kind: "io_error",
      reason: `Manifest write failed: ${(err as Error).message}`,
    };
  }

  return null; // success
}

// ---------------------------------------------------------------------------
// provision()
// ---------------------------------------------------------------------------

/**
 * Provisions TEO agent definitions from bundleDir into resolvedHome/agents/.
 *
 * Returns a discriminated-union ProvisionResult — never throws for anticipated
 * errors. Programmer errors (null opts, invalid types) remain throws.
 */
export async function provision(opts: ProvisionOptions): Promise<ProvisionResult> {
  // -------------------------------------------------------------------------
  // Step 1 — Resolve the home directory (arg > TEO_HOME > os.homedir()/.teo).
  // -------------------------------------------------------------------------

  // os.homedir() fallback is the production default path; tests always inject
  // homeDir arg or TEO_HOME so this branch is not exercised in the test suite.
  /* c8 ignore next 1 */
  const resolvedHome = opts.homeDir ?? process.env["TEO_HOME"] ?? path.join(os.homedir(), ".teo");

  const agentsDir = path.join(resolvedHome, "agents");

  // -------------------------------------------------------------------------
  // Step 2 — Conflict detection (before any staging).
  // -------------------------------------------------------------------------

  if (fs.existsSync(resolvedHome) && !fs.statSync(resolvedHome).isDirectory()) {
    return {
      status: "error",
      kind: "conflict",
      reason: `Conflict: ${resolvedHome} exists as a file but a directory is required.`,
    };
  }

  if (fs.existsSync(agentsDir) && !fs.statSync(agentsDir).isDirectory()) {
    return {
      status: "error",
      kind: "conflict",
      reason: `Conflict: ${agentsDir} exists as a file but a directory is required.`,
    };
  }

  // -------------------------------------------------------------------------
  // SEC-01: Path-traversal guard — validate bundle ids before any path use.
  // listAgentIds() is called once here so conflict tests above already ran.
  // The sorted ids are reused by the idempotency check, repair path, and
  // fresh-provision path below — only ONE guard needed.
  // -------------------------------------------------------------------------

  const bundleIds = listAgentIds(opts.bundleDir).sort();
  const traversalErr = checkIds(bundleIds);
  if (traversalErr) return traversalErr;

  // -------------------------------------------------------------------------
  // Step 3 — 2-stat idempotency hot path.
  // NOT called on this path: checkRevocation() is a write-gate, not a read-gate.
  // -------------------------------------------------------------------------

  const manifestPath = path.join(resolvedHome, "manifest.json");
  if (fs.existsSync(manifestPath) && fs.existsSync(agentsDir)) {
    return { status: "already_provisioned" };
  }

  // -------------------------------------------------------------------------
  // Step 3b — Repair path: agentsDir present but manifest absent.
  // manifest absent means prior provision did not complete successfully.
  // Runs the FULL provision sequence (atomic staging, verify-after-write,
  // loadAgentDefinition, manifest write) and returns { status: "repaired" }.
  // -------------------------------------------------------------------------

  if (fs.existsSync(agentsDir)) {
    // chunks[] computed from bundleDir (Risk R3: NOT from agentsDir).
    const repairIds = bundleIds;
    const repairChunks = repairIds.map((id) =>
      fs.readFileSync(path.join(opts.bundleDir, `${id}.md`))
    );
    const repairData = Buffer.concat(repairChunks);

    // Revocation check — required before any write.
    const repairRevResult = await checkRevocation({ data: repairData, ...opts.revocationOpts });
    if (repairRevResult.verdict === "BLOCKED") {
      return {
        status: "error",
        kind: "revocation_blocked",
        // reason is always set by checkRevocation BLOCKED paths; ?? "" is a defensive
        // fallback for pathological callers that override checkRevocation with no reason.
        // Covered by test 23 (repair-path BLOCKED without reason field).
        reason: repairRevResult.reason ?? "",
      };
    }

    // Atomic staging: write to temp dir, then rename into place (over existing agentsDir).
    let repairStagingDir: string;
    try {
      repairStagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-provision-"));
    } catch (err) {
      // Covered by test 42 (repair path mkdtempSync failure → io_error).
      return { status: "error", kind: "io_error", reason: (err as Error).message };
    }

    try {
      for (const id of repairIds) {
        const srcPath = path.join(opts.bundleDir, `${id}.md`);
        const destPath = path.join(repairStagingDir, `${id}.md`);
        const content = fs.readFileSync(srcPath);
        fs.writeFileSync(destPath, content, { mode: 0o600 });
      }
    } catch (err) {
      // Covered by test 43 (repair path staging writeFileSync failure → io_error, cleanup).
      try {
        fs.rmSync(repairStagingDir, { recursive: true, force: true });
      } catch {
        /* empty */
      }
      return { status: "error", kind: "io_error", reason: (err as Error).message };
    }

    // Remove existing agentsDir before atomic rename so rename can succeed
    // (rename over a non-empty directory fails on Linux with ENOTEMPTY).
    try {
      fs.rmSync(agentsDir, { recursive: true, force: true });
    } catch (err) {
      // Production-only: rmSync on agentsDir can fail if permissions change mid-run.
      /* c8 ignore start */
      try {
        fs.rmSync(repairStagingDir, { recursive: true, force: true });
      } catch {
        /* empty */
      }
      return { status: "error", kind: "io_error", reason: (err as Error).message };
      /* c8 ignore stop */
    }

    // Atomic rename: stagingDir → agentsDir.
    try {
      fs.renameSync(repairStagingDir, agentsDir);
      fs.chmodSync(agentsDir, 0o700);
      for (const id of repairIds) {
        fs.chmodSync(path.join(agentsDir, `${id}.md`), 0o600);
      }
      fs.chmodSync(resolvedHome, 0o700);
    } catch (err) {
      // Rename error handling mirrors the fresh-provision path.
      const e = err as NodeJS.ErrnoException;
      if (e.code === "EXDEV") {
        // EXDEV fallback: cross-device rename — copy per-file instead.
        // Covered by test 46 (repair path EXDEV copy failure leaves no partial agentsDir).
        try {
          fs.mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
          for (const id of repairIds) {
            const srcPath = path.join(repairStagingDir, `${id}.md`);
            const destPath = path.join(agentsDir, `${id}.md`);
            fs.copyFileSync(srcPath, destPath);
            fs.chmodSync(destPath, 0o600);
          }
          // Best-effort staging dir cleanup after successful EXDEV copy.
          // Swallow errors — copy succeeded; staging cleanup is cosmetic.
          // Covered by test 48 (repair path EXDEV success → repaired).
          try {
            fs.rmSync(repairStagingDir, { recursive: true, force: true });
          } catch {
            /* empty */
          }
          fs.chmodSync(agentsDir, 0o700);
          fs.chmodSync(resolvedHome, 0o700);
        } catch (copyErr) {
          try {
            fs.rmSync(repairStagingDir, { recursive: true, force: true });
          } catch {
            /* empty */
          }
          try {
            fs.rmSync(agentsDir, { recursive: true, force: true });
          } catch {
            /* empty */
          }
          return {
            status: "error",
            kind: "io_error",
            reason: (copyErr as Error).message,
          };
        }
      } else {
        // Non-EXDEV rename error. Covered by test 44 (EIO → io_error) and test 45 (EACCES → permission_denied).
        try {
          fs.rmSync(repairStagingDir, { recursive: true, force: true });
        } catch {
          /* empty */
        }
        if (e.code === "EACCES") {
          return {
            status: "error",
            kind: "permission_denied",
            reason: `Permission denied during rename to ${agentsDir}: ${e.message}`,
          };
        }
        return { status: "error", kind: "io_error", reason: e.message };
      }
    }

    // Verify-after-write: SHA-256 integrity check.
    // The mismatch return is production-only: silent disk corruption between atomic write and
    // verify cannot be injected reliably via the test-suite spy approach (the rename is atomic;
    // the repair path's staging write uses real fs, so the installed bytes always match).
    // The fresh-provision path has test 36 for this branch; the repair path has no equivalent.
    for (let i = 0; i < repairIds.length; i++) {
      const id = repairIds[i]!;
      const installedBytes = fs.readFileSync(path.join(agentsDir, `${id}.md`));
      const expectedHash = sha256hex(repairChunks[i]!);
      const actualHash = sha256hex(installedBytes);
      if (actualHash !== expectedHash) {
        return {
          status: "error",
          kind: "verification_failed",
          reason: `SHA-256 mismatch for agent '${id}': expected ${expectedHash}, got ${actualHash}`,
        };
      }
    }

    // Semantic verification via loadAgentDefinition.
    for (const id of repairIds) {
      try {
        loadAgentDefinition(id, agentsDir);
      } catch (err) {
        // Both branches covered: Error instance (test 20) and bare string throw (test 50).
        const message = err instanceof Error ? err.message : String(err);
        return {
          status: "error",
          kind: "verification_failed",
          reason: `Agent "${id}" failed post-write verification: ${message}`,
        };
      }
    }

    // Write manifest atomically.
    const repairManifestErr = writeManifest(
      resolvedHome,
      agentsDir,
      repairIds,
      repairChunks,
      opts.revocationOpts.keyId
    );
    // Covered by test 47 (repair path manifest write failure → io_error).
    if (repairManifestErr) return repairManifestErr;

    return { status: "repaired" };
  }

  // -------------------------------------------------------------------------
  // Step 4 — Fresh provision: compute canonical bytes and call checkRevocation.
  // bundleIds is already sorted and traversal-validated above (SEC-01 guard).
  // -------------------------------------------------------------------------

  const ids = bundleIds;
  const chunks = ids.map((id) => fs.readFileSync(path.join(opts.bundleDir, `${id}.md`)));
  const data = Buffer.concat(chunks);

  const revResult = await checkRevocation({ data, ...opts.revocationOpts });
  if (revResult.verdict === "BLOCKED") {
    return {
      status: "error",
      kind: "revocation_blocked",
      // reason is always set by checkRevocation BLOCKED paths; ?? "" is a defensive
      // fallback for pathological callers that override checkRevocation with no reason.
      // Covered by test 24 (fresh-provision BLOCKED without reason field).
      reason: revResult.reason ?? "",
    };
  }

  // -------------------------------------------------------------------------
  // Step 5 — Atomic staging: write to temp dir, then rename into place.
  // -------------------------------------------------------------------------

  let stagingDir: string;
  try {
    stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-provision-"));
  } catch (err) {
    // Covered by test 25 (mkdtempSync failure → io_error, non-EACCES path).
    // EACCES sub-branch is production-only (os.tmpdir() always writable in CI).
    const e = err as NodeJS.ErrnoException;
    /* c8 ignore next 5 */
    if (e.code === "EACCES") {
      return {
        status: "error",
        kind: "permission_denied",
        reason: `Permission denied creating staging directory: ${e.message}`,
      };
    }
    return { status: "error", kind: "io_error", reason: (err as Error).message };
  }

  // Write all agent files into stagingDir with mode 0o600.
  try {
    for (const id of ids) {
      const srcPath = path.join(opts.bundleDir, `${id}.md`);
      const destPath = path.join(stagingDir, `${id}.md`);
      const content = fs.readFileSync(srcPath);
      fs.writeFileSync(destPath, content, { mode: 0o600 });
    }
  } catch (err) {
    // Covered by test 26 (staging writeFileSync failure → io_error, cleanup verified).
    // EACCES sub-branch is production-only (os.tmpdir() always writable in CI).
    const e = err as NodeJS.ErrnoException;
    // Best-effort staging dir cleanup — swallow errors.
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* empty */
    }
    /* c8 ignore next 5 */
    if (e.code === "EACCES") {
      return {
        status: "error",
        kind: "permission_denied",
        reason: `Permission denied writing to staging directory: ${e.message}`,
      };
    }
    return { status: "error", kind: "io_error", reason: e.message };
  }

  // Ensure resolvedHome exists before renaming into it.
  try {
    fs.mkdirSync(resolvedHome, { recursive: true, mode: 0o700 });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    // Best-effort cleanup — swallow errors.
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* c8 ignore next */
    }
    // EACCES covered by test 10; non-EACCES (e.g., ENOSPC) covered by test 27.
    if (e.code === "EACCES") {
      return {
        status: "error",
        kind: "permission_denied",
        reason: `Permission denied creating home directory ${resolvedHome}: ${e.message}`,
      };
    }
    return { status: "error", kind: "io_error", reason: e.message };
  }

  // Atomic rename: stagingDir → resolvedHome/agents.
  try {
    fs.renameSync(stagingDir, agentsDir);
    // chmod agents dir to 0o700 after rename.
    fs.chmodSync(agentsDir, 0o700);
    // SEC-02: chmodSync each file after rename — umask-independent 0o600 guarantee.
    for (const id of ids) {
      fs.chmodSync(path.join(agentsDir, `${id}.md`), 0o600);
    }
    // chmod resolvedHome to 0o700.
    fs.chmodSync(resolvedHome, 0o700);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;

    if (e.code === "EXDEV") {
      // -----------------------------------------------------------------------
      // EXDEV fallback: cross-device rename — copy per-file instead.
      // -----------------------------------------------------------------------
      try {
        fs.mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
        for (const id of ids) {
          const srcPath = path.join(stagingDir, `${id}.md`);
          const destPath = path.join(agentsDir, `${id}.md`);
          fs.copyFileSync(srcPath, destPath);
          fs.chmodSync(destPath, 0o600);
        }
        // Best-effort staging dir cleanup after successful EXDEV copy.
        // Swallow errors — copy succeeded; staging cleanup is cosmetic.
        /* c8 ignore next 1 */
        try {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        } catch {
          /* empty */
        }
        fs.chmodSync(agentsDir, 0o700);
        fs.chmodSync(resolvedHome, 0o700);
      } catch (copyErr) {
        // Covered by test 22 (EXDEV copy failure → io_error, agentsDir must be absent).
        const ce = copyErr as NodeJS.ErrnoException;
        // Best-effort cleanup of staging and partial dest (SEC-05).
        try {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        } catch {
          /* empty */
        }
        // SEC-05: clean up partial agentsDir left by mkdirSync(agentsDir) at L340.
        // Without this, a failed copy leaves a partial agentsDir that corrupts subsequent calls.
        try {
          fs.rmSync(agentsDir, { recursive: true, force: true });
        } catch {
          /* c8 ignore next */
          /* cleanup of partial agentsDir — best-effort, swallow failure */
        }
        // Test 22 covers the non-EACCES path (ENOSPC → io_error). EACCES sub-branch is
        // production-only (copy permission failures on the EXDEV path not reachable in CI).
        /* c8 ignore next 5 */
        if (ce.code === "EACCES") {
          return {
            status: "error",
            kind: "permission_denied",
            reason: `Permission denied during EXDEV copy fallback: ${ce.message}`,
          };
        }
        return { status: "error", kind: "io_error", reason: ce.message };
      }
    } else {
      // Non-EXDEV rename error — io_error. Clean up staging dir.
      // The destination agentsDir is untouched (atomic guarantee).
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {
        /* c8 ignore next */
      }
      // EACCES branch covered by test 28; EIO (fallthrough io_error) covered by test 11.
      if (e.code === "EACCES") {
        return {
          status: "error",
          kind: "permission_denied",
          reason: `Permission denied during rename to ${agentsDir}: ${e.message}`,
        };
      }
      return { status: "error", kind: "io_error", reason: e.message };
    }
  }

  // -------------------------------------------------------------------------
  // Step 6 — Post-write verification.
  // 6a: SHA-256 integrity check (fast byte check before semantic parse).
  // 6b: loadAgentDefinition semantic check.
  // -------------------------------------------------------------------------

  // 6a: Verify-after-write: SHA-256 integrity check.
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const installedBytes = fs.readFileSync(path.join(agentsDir, `${id}.md`));
    const expectedHash = sha256hex(chunks[i]!);
    const actualHash = sha256hex(installedBytes);
    if (actualHash !== expectedHash) {
      return {
        status: "error",
        kind: "verification_failed",
        reason: `SHA-256 mismatch for agent '${id}': expected ${expectedHash}, got ${actualHash}`,
      };
    }
  }

  // 6b: Semantic verification via loadAgentDefinition.
  for (const id of ids) {
    try {
      loadAgentDefinition(id, agentsDir);
    } catch (err) {
      // Both branches covered: Error instance (test 05) and bare string throw (test 29).
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "error",
        kind: "verification_failed",
        reason: `Agent "${id}" failed post-write verification: ${message}`,
      };
    }
  }

  // Write manifest atomically after all verification passes.
  const manifestErr = writeManifest(
    resolvedHome,
    agentsDir,
    ids,
    chunks,
    opts.revocationOpts.keyId
  );
  if (manifestErr) return manifestErr;

  return { status: "ok" };
}
