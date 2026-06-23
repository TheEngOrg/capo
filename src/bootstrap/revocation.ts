// =============================================================================
// revocation.ts — ed25519 bootstrap revocation check (WS-P1-02, WS-REVOKE-01)
//
// CONTRACT:
//   checkRevocation(opts: CheckRevocationOptions): Promise<RevocationResult>
//
// FAIL-SAFE DESIGN: everything defaults to BLOCKED. Only a verifiably valid
// ed25519 signature over the exact data bytes, with the signing key absent from
// a successfully resolved revocation list, produces PASS.
//
// PLUGIN CONTEXT (WS-REVOKE-01): When CLAUDE_PLUGIN_ROOT is set and `signature`
// is absent, checkRevocation() attempts to auto-verify via the install-time
// signature file ($CLAUDE_PLUGIN_ROOT/.teo-install-sig). If the file is absent,
// unreadable, or the sig is invalid → BLOCKED. There is NO fail-open escape
// hatch for unsigned plugins; the old WS-GO-02 bypass has been removed.
//
// DEPENDENCY: @noble/ed25519 for signature verification.
// Inputs are normalized via Buffer.from() before passing to @noble so that
// both Uint8Array and Buffer callers work identically.
// =============================================================================

import * as ed from "@noble/ed25519";
import { readInstallSig, verifyInstallSig } from "./install-sig.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RevokedKey {
  key_id: string;
  reason?: string;
}

export interface RevocationList {
  revoked_keys: RevokedKey[];
}

export type RevocationVerdict = "PASS" | "BLOCKED";

export interface RevocationResult {
  verdict: RevocationVerdict;
  reason?: string;
  warning?: string;
}

export interface CheckRevocationOptions {
  /** The raw bytes that were signed (e.g. tarball content). */
  data: Uint8Array | Buffer;
  /** Detached ed25519 signature over `data`. May be undefined or null for the missing-sig misuse case. */
  signature: Uint8Array | Buffer | undefined | null;
  /** ed25519 public key (32 bytes raw). */
  publicKey: Uint8Array | Buffer;
  /** Stable identifier for the signing key — checked against the revocation list. */
  keyId: string;
  /**
   * Injected revocation list (offline / test mode).
   * Provide EITHER revocationList OR revocationListFetcher, not both.
   */
  revocationList?: RevocationList;
  /**
   * Async fetcher for the revocation list.
   * If the fetcher throws or returns a non-conforming shape → BLOCKED (fail-safe).
   */
  revocationListFetcher?: () => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Blocked result helper — reason is always required on BLOCKED. */
function blocked(reason: string): RevocationResult {
  return { verdict: "BLOCKED", reason };
}

/** Type-guard: checks that the value conforms to RevocationList shape. */
function isRevocationList(value: unknown): value is RevocationList {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj["revoked_keys"]);
}

// ---------------------------------------------------------------------------
// checkRevocationListOnly — resolve list + check keyId (no sig verification)
//
// Used by the install-sig path: the signature has already been verified by
// verifyInstallSig(). This function handles only the revocation list steps.
// ---------------------------------------------------------------------------

async function checkRevocationListOnly(
  keyId: string,
  revocationList: RevocationList | undefined,
  revocationListFetcher: (() => Promise<unknown>) | undefined
): Promise<RevocationResult> {
  /* c8 ignore next 6 */
  if (revocationList === undefined && revocationListFetcher === undefined) {
    return blocked(
      "No revocation list source provided. " +
        "Provide either revocationList or revocationListFetcher to verify the key."
    );
  }

  let resolvedList: RevocationList;

  if (revocationList !== undefined) {
    resolvedList = revocationList;
  } else {
    let fetched: unknown;
    try {
      fetched = await revocationListFetcher!();
    } catch (err) {
      /* c8 ignore next */
      const message = err instanceof Error ? err.message : String(err);
      return blocked(`Revocation list fetch failed: ${message}`);
    }

    if (!isRevocationList(fetched)) {
      const fetchedType = typeof fetched;
      const fetchedDesc =
        fetchedType === "object" && fetched !== null
          ? `object with keys: [${Object.keys(fetched as Record<string, unknown>).join(", ")}]`
          : String(fetched);
      return blocked(
        `Revocation list has invalid shape: expected { revoked_keys: Array }, got ${fetchedDesc}.`
      );
    }

    resolvedList = fetched;
  }

  const revokedEntry = resolvedList.revoked_keys.find((entry) => entry.key_id === keyId);
  if (revokedEntry !== undefined) {
    const detail = revokedEntry.reason ? `: ${revokedEntry.reason}` : "";
    return blocked(`Key "${keyId}" has been revoked${detail}.`);
  }

  return { verdict: "PASS" };
}

// ---------------------------------------------------------------------------
// checkRevocation
// ---------------------------------------------------------------------------

/**
 * Verify an ed25519 signature over `data` and check that the signing key is
 * not on the revocation list.
 *
 * Returns PASS only when ALL of the following are true:
 *   1. signature is present, 64 bytes, and cryptographically valid over data
 *      with publicKey.
 *   2. A revocation list was successfully resolved (injected or fetched).
 *   3. keyId is NOT present in the resolved revocation list.
 *
 * All other paths return BLOCKED with a non-empty, diagnosable reason string.
 */
export async function checkRevocation(opts: CheckRevocationOptions): Promise<RevocationResult> {
  const { data, signature, publicKey, keyId, revocationList, revocationListFetcher } = opts;

  // -------------------------------------------------------------------------
  // Step 0 — Plugin-context install-sig path (WS-REVOKE-01).
  //
  // When CLAUDE_PLUGIN_ROOT is set and no explicit signature is provided,
  // attempt to auto-verify via the install-time sig file
  // ($CLAUDE_PLUGIN_ROOT/.teo-install-sig). This lets the load path verify
  // a plugin without the caller constructing the sig/data explicitly.
  //
  // FAIL-CLOSED: if the file is absent, unreadable, or sig is invalid → BLOCKED.
  // There is no "unsigned-plugin-context" escape hatch.
  //
  // When an explicit signature IS provided (even in plugin context), skip this
  // path and fall through to Step 1 (normal Ed25519 verify path).
  // -------------------------------------------------------------------------

  const pluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];
  const isPluginContext = typeof pluginRoot === "string" && pluginRoot.length > 0;

  if ((signature === undefined || signature === null) && isPluginContext) {
    // Try to read the install-time sig file.
    const readResult = readInstallSig(pluginRoot);
    if (!readResult.ok) {
      return blocked(readResult.reason);
    }

    // Verify the install sig over the canonicalized plugin root path.
    const verifyResult = await verifyInstallSig(pluginRoot, readResult.file, publicKey);
    if (!verifyResult.ok) {
      return blocked(verifyResult.reason);
    }

    // Install sig is valid — use the key_id from the sig file for revocation check.
    // Continue to Step 2 (revocation list resolution) and Step 3 (revocation check)
    // using the install sig's key_id. Skip Steps 1 and 4 (handled above).
    const installKeyId = readResult.file.key_id;
    return checkRevocationListOnly(installKeyId, revocationList, revocationListFetcher);
  }

  // -------------------------------------------------------------------------
  // Step 1 — Validate signature presence and length before doing any crypto.
  // -------------------------------------------------------------------------

  if (signature === undefined || signature === null) {
    return blocked("Signature is missing (undefined or null). Cannot verify without a signature.");
  }

  const sigBytes = Buffer.from(signature);

  if (sigBytes.length === 0) {
    return blocked("Signature is empty (zero bytes). Cannot verify without a signature.");
  }

  if (sigBytes.length !== 64) {
    return blocked(
      `Signature has wrong length: expected 64 bytes, got ${sigBytes.length} bytes. ` +
        `ed25519 signatures are always exactly 64 bytes.`
    );
  }

  // -------------------------------------------------------------------------
  // Step 2 — Resolve the revocation list.
  // Neither list nor fetcher → BLOCKED (can't verify without a list).
  // -------------------------------------------------------------------------

  // Guard: require at least one list source. Production-only path — tests always
  // inject one of the two. Annotated so coverage tooling skips the unreachable branch.
  /* c8 ignore next 6 */
  if (revocationList === undefined && revocationListFetcher === undefined) {
    return blocked(
      "No revocation list source provided. " +
        "Provide either revocationList or revocationListFetcher to verify the key."
    );
  }

  let resolvedList: RevocationList;

  if (revocationList !== undefined) {
    // Injected list — use directly.
    resolvedList = revocationList;
  } else {
    // Fetcher path — revocationListFetcher is defined here (guard above ensures it).
    let fetched: unknown;
    try {
      fetched = await revocationListFetcher!();
    } catch (err) {
      /* c8 ignore next */
      const message = err instanceof Error ? err.message : String(err);
      return blocked(`Revocation list fetch failed: ${message}`);
    }

    if (!isRevocationList(fetched)) {
      const fetchedType = typeof fetched;
      const fetchedDesc =
        fetchedType === "object" && fetched !== null
          ? `object with keys: [${Object.keys(fetched as Record<string, unknown>).join(", ")}]`
          : String(fetched);
      return blocked(
        `Revocation list has invalid shape: expected { revoked_keys: Array }, got ${fetchedDesc}.`
      );
    }

    resolvedList = fetched;
  }

  // -------------------------------------------------------------------------
  // Step 3 — Check revocation list before verifying the signature.
  // Revocation takes precedence over signature validity.
  // -------------------------------------------------------------------------

  const revokedEntry = resolvedList.revoked_keys.find((entry) => entry.key_id === keyId);
  if (revokedEntry !== undefined) {
    const detail = revokedEntry.reason ? `: ${revokedEntry.reason}` : "";
    return blocked(`Key "${keyId}" has been revoked${detail}.`);
  }

  // -------------------------------------------------------------------------
  // Step 4 — Verify the ed25519 signature cryptographically.
  // @noble/ed25519 verifyAsync returns false for invalid sigs and absorbs
  // malformed input internally. It only throws when crypto.subtle is absent.
  // -------------------------------------------------------------------------

  const dataBytes = Buffer.from(data);
  const pubKeyBytes = Buffer.from(publicKey);

  let valid: boolean;
  try {
    valid = await ed.verifyAsync(sigBytes, dataBytes, pubKeyBytes);
  } catch (err) /* c8 ignore start */ {
    // @noble/ed25519 throws when the WebCrypto API (crypto.subtle) is absent —
    // not on malformed input (wrong key length etc. returns false, not a throw).
    // Tests run under Node with crypto.subtle available, so this path is
    // production-only (e.g., restricted runtime without WebCrypto support).
    const message = err instanceof Error ? err.message : String(err);
    return blocked(`Signature verification error: ${message}`);
  } /* c8 ignore stop */

  if (!valid) {
    return blocked(
      "Signature verification failed: the signature does not match the provided data and public key."
    );
  }

  // -------------------------------------------------------------------------
  // All checks passed — PASS.
  // -------------------------------------------------------------------------

  return { verdict: "PASS" };
}
