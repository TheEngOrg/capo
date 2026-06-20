// =============================================================================
// provision.ts — TEO agent roster provisioner (WS-P1-04)
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
// PERMISSIONS: resolvedHome 0o700, agents/ 0o700, each .md file 0o600.
//
// DEPENDENCY: checkRevocation() from ./revocation.ts; listAgentIds() and
// loadAgentDefinition() from ../agents/load.ts.
// =============================================================================

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
  | { status: "repaired"; repairedFiles: string[] }
  | { status: "error"; kind: ProvisionErrorKind; reason: string };

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
  // Step 3 — Idempotency check (already_provisioned fast path).
  // NOT called on this path: checkRevocation() is a write-gate, not a read-gate.
  // -------------------------------------------------------------------------

  if (fs.existsSync(agentsDir) && fs.statSync(agentsDir).isDirectory()) {
    const expectedIds = bundleIds;
    const actualFiles = fs
      .readdirSync(agentsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort();

    const actualSet = new Set(actualFiles);

    const allPresent =
      expectedIds.length === actualFiles.length && expectedIds.every((id) => actualSet.has(id));

    if (allPresent) {
      // Check that all files are non-zero byte.
      const allNonZero = expectedIds.every((id) => {
        const stat = fs.statSync(path.join(agentsDir, `${id}.md`));
        return stat.size > 0;
      });

      if (allNonZero) {
        return { status: "already_provisioned" };
      }
    }

    // -----------------------------------------------------------------------
    // Step 3b — Repair path: some files are missing or zero-byte.
    // Only repair the broken ids; leave valid files untouched.
    // -----------------------------------------------------------------------

    const missingIds = expectedIds.filter((id) => !actualSet.has(id));
    const zeroByte = expectedIds.filter((id) => {
      if (!actualSet.has(id)) return false; // already in missingIds
      const stat = fs.statSync(path.join(agentsDir, `${id}.md`));
      return stat.size === 0;
    });
    const idsToRepair = [...missingIds, ...zeroByte].sort();

    // Compute canonical bytes for the revocation check.
    // AC-09/OQ-07: sorted concatenation of ALL agent bytes (not just repair set).
    // bundleIds is already sorted and traversal-validated above.
    const chunks = bundleIds.map((id) => fs.readFileSync(path.join(opts.bundleDir, `${id}.md`)));
    const data = Buffer.concat(chunks);

    // Revocation check — required before any write.
    const revResult = await checkRevocation({ data, ...opts.revocationOpts });
    // SEC-03: covered by test 19 — annotation removed.
    if (revResult.verdict === "BLOCKED") {
      return {
        status: "error",
        kind: "revocation_blocked",
        // reason is always set by checkRevocation BLOCKED paths; ?? "" is a defensive
        // fallback for pathological callers that override checkRevocation with no reason.
        // Covered by test 23 (repair-path BLOCKED without reason field).
        reason: revResult.reason ?? "",
      };
    }

    // Write only the repair ids directly into agentsDir (no full atomic rename —
    // we must not disturb the valid existing files).
    for (const id of idsToRepair) {
      const srcPath = path.join(opts.bundleDir, `${id}.md`);
      const destPath = path.join(agentsDir, `${id}.md`);
      const content = fs.readFileSync(srcPath);
      fs.writeFileSync(destPath, content, { mode: 0o600 });
      // SEC-02: chmodSync is umask-independent; mirrors EXDEV path.
      fs.chmodSync(destPath, 0o600);
    }

    // Post-write verification for repaired ids only.
    for (const id of idsToRepair) {
      try {
        loadAgentDefinition(id, agentsDir);
      } catch (err) {
        // SEC-04: covered by test 20 — annotations removed.
        // The non-Error branch of err instanceof Error is production-only.
        /* c8 ignore next 1 */
        const message = err instanceof Error ? err.message : String(err);
        return {
          status: "error",
          kind: "verification_failed",
          reason: `Agent "${id}" failed post-write verification: ${message}`,
        };
      }
    }

    return { status: "repaired", repairedFiles: idsToRepair };
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
  // Step 6 — Post-write verification: loadAgentDefinition for every written id.
  // -------------------------------------------------------------------------

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

  return { status: "ok" };
}
