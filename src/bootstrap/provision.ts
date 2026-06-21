// =============================================================================
// provision.ts — TEO data-dir provisioner (WS-P1-04 + WS-P1-04a + WS-GO-02)
//
// CONTRACT:
//   provision(opts: ProvisionOptions): Promise<ProvisionResult>
//
// DESIGN: Fail-safe, idempotent. Creates ledger/ and keyring/ directories under
// resolvedHome/. checkRevocation() is called exactly once before any filesystem
// write. No import-time side effects.
//
// WS-GO-02: Role-shift from agent-file-copy to data-dir bootstrap.
//   - Idempotency trigger: ledger/ AND keyring/ both present.
//   - bundleDir optional in plugin context (defaults to ${pluginRoot}/agents).
//   - manifest.json schema: no agents_dir, no files.
//   - ProvisionResult ok/already_provisioned arms gain optional warning?.
//
// DEPENDENCY: checkRevocation() from ./revocation.ts; detectHost() from ./host.ts.
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { checkRevocation } from "./revocation.js";
import type { CheckRevocationOptions } from "./revocation.js";
import { detectHost } from "./host.js";
import type { HostContext } from "./host.js";
import { listAgentIds } from "../agents/load.js";

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
  | { status: "ok"; warning?: string }
  | { status: "already_provisioned"; warning?: string }
  | { status: "repaired"; warning?: string }
  | { status: "error"; kind: ProvisionErrorKind; reason: string };

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ManifestFile {
  schema_version: "1";
  teo_version: string;
  provisioned_at: string;
  bundle_signature_key_id: string;
}

export interface ProvisionOptions {
  bundleDir?: string;
  /**
   * TEO home directory.  Resolution order: homeDir arg > TEO_HOME env > os.homedir()+'/.teo'.
   */
  homeDir?: string;
  /**
   * Host context. When absent, auto-detected via detectHost().
   * WS-GO-02: allows callers to inject the host context for testability.
   */
  host?: HostContext;
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
// teo_version reader — reads process.env.TEO_VERSION (set by esbuild --define)
// ---------------------------------------------------------------------------

function readTeoVersion(): string {
  /* c8 ignore next */ // "unknown" fallback is production-only; TEO_VERSION is always set in CI and in the esbuild bundle
  return process.env["TEO_VERSION"] ?? "unknown";
}

// ---------------------------------------------------------------------------
// writeManifest helper — atomic tmp → rename (new schema, no agents_dir/files)
// ---------------------------------------------------------------------------

function writeManifest(
  resolvedHome: string,
  keyId: string
): Extract<ProvisionResult, { status: "error" }> | null {
  const manifestPath = path.join(resolvedHome, "manifest.json");
  const tmpPath = manifestPath + ".tmp";

  const manifest: ManifestFile = {
    schema_version: "1",
    teo_version: readTeoVersion(),
    provisioned_at: new Date().toISOString(),
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
 * Provisions TEO data directories (ledger/, keyring/) under resolvedHome/.
 *
 * WS-GO-02: Replaces agent-file-copy with data-dir bootstrap.
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

  // -------------------------------------------------------------------------
  // Step 2 — Resolve host context and bundleDir.
  // -------------------------------------------------------------------------

  const host = opts.host ?? detectHost();

  let bundleDir = opts.bundleDir;
  if (!bundleDir) {
    if (host.kind === "claude-code-plugin" && host.pluginRoot) {
      bundleDir = host.pluginRoot;
    } else {
      return {
        status: "error",
        kind: "io_error",
        reason: "bundleDir is required in standalone context",
      };
    }
  }

  // -------------------------------------------------------------------------
  // S3: pluginRoot containment check — bundleDir must not escape pluginRoot.
  // This check fires before any filesystem operations (before listAgentIds()).
  // -------------------------------------------------------------------------

  if (host.kind === "claude-code-plugin" && host.pluginRoot) {
    const resolvedBundleDir = path.resolve(bundleDir);
    const resolvedPluginRoot = path.resolve(host.pluginRoot);
    if (
      !resolvedBundleDir.startsWith(resolvedPluginRoot + path.sep) &&
      resolvedBundleDir !== resolvedPluginRoot
    ) {
      return {
        status: "error",
        kind: "io_error",
        reason: "pluginRoot containment check failed: bundleDir escapes plugin root",
      };
    }
  }

  // -------------------------------------------------------------------------
  // Step 3 — Conflict detection (before any staging).
  // -------------------------------------------------------------------------

  if (fs.existsSync(resolvedHome) && !fs.statSync(resolvedHome).isDirectory()) {
    return {
      status: "error",
      kind: "conflict",
      reason: `Conflict: ${resolvedHome} exists as a file but a directory is required.`,
    };
  }

  // -------------------------------------------------------------------------
  // SEC-01: Path-traversal guard — validate bundle ids before any path use.
  // -------------------------------------------------------------------------

  const bundleIds = listAgentIds(bundleDir).sort();
  const traversalErr = checkIds(bundleIds);
  if (traversalErr) return traversalErr;

  // -------------------------------------------------------------------------
  // Step 4 — Idempotency hot path.
  // New trigger (WS-GO-02): both ledger/ AND keyring/ present → already_provisioned.
  // NOT called on this path: checkRevocation() is a write-gate, not a read-gate.
  // -------------------------------------------------------------------------

  const ledgerDir = path.join(resolvedHome, "ledger");
  const keyringDir = path.join(resolvedHome, "keyring");

  if (fs.existsSync(ledgerDir) && fs.existsSync(keyringDir)) {
    return { status: "already_provisioned" };
  }

  // -------------------------------------------------------------------------
  // Step 5 — Compute canonical bytes from bundleDir for revocation check.
  // -------------------------------------------------------------------------

  // bundleDir is guaranteed non-empty here: Step 2 either set it to the plugin default
  // or returned an error. TypeScript cannot prove this narrowing across conditionals.
  const chunks = bundleIds.map((id) => fs.readFileSync(path.join(String(bundleDir), `${id}.md`)));
  const data = Buffer.concat(chunks);

  // -------------------------------------------------------------------------
  // Step 6 — Revocation check: gate before any writes.
  // -------------------------------------------------------------------------

  const revResult = await checkRevocation({ data, ...opts.revocationOpts });
  if (revResult.verdict === "BLOCKED") {
    return {
      status: "error",
      kind: "revocation_blocked",
      // reason is always set by checkRevocation BLOCKED paths; ?? "" is a defensive
      // fallback for pathological callers that override checkRevocation with no reason.
      reason: revResult.reason ?? "",
    };
  }

  // Capture any warning from the revocation result (e.g. "unsigned-plugin-context").
  const revocationWarning = revResult.warning;

  // -------------------------------------------------------------------------
  // Step 7 — Ensure resolvedHome exists.
  // -------------------------------------------------------------------------

  try {
    fs.mkdirSync(resolvedHome, { recursive: true, mode: 0o700 });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EACCES") {
      return {
        status: "error",
        kind: "permission_denied",
        reason: `Permission denied creating home directory ${resolvedHome}: ${e.message}`,
      };
    }
    return { status: "error", kind: "io_error", reason: e.message };
  }

  // -------------------------------------------------------------------------
  // Step 8 — Create ledger/ and keyring/ directories (mode 0o700).
  // -------------------------------------------------------------------------

  try {
    fs.mkdirSync(ledgerDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EACCES") {
      return {
        status: "error",
        kind: "permission_denied",
        reason: `Permission denied creating ledger directory: ${e.message}`,
      };
    }
    return { status: "error", kind: "io_error", reason: e.message };
  }

  try {
    fs.mkdirSync(keyringDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EACCES") {
      return {
        status: "error",
        kind: "permission_denied",
        reason: `Permission denied creating keyring directory: ${e.message}`,
      };
    }
    return { status: "error", kind: "io_error", reason: e.message };
  }

  // Enforce permissions on resolvedHome.
  fs.chmodSync(resolvedHome, 0o700);

  // -------------------------------------------------------------------------
  // Step 9 — Write manifest.json (new schema).
  // -------------------------------------------------------------------------

  const manifestErr = writeManifest(resolvedHome, opts.revocationOpts.keyId);
  if (manifestErr) return manifestErr;

  return { status: "ok", ...(revocationWarning ? { warning: revocationWarning } : {}) };
}
