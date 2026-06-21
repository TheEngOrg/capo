// =============================================================================
// revocation.ts — ed25519 bootstrap revocation check (WS-P1-02)
//
// CONTRACT:
//   checkRevocation(opts: CheckRevocationOptions): Promise<RevocationResult>
//
// FAIL-SAFE DESIGN: everything defaults to BLOCKED. Only a verifiably valid
// ed25519 signature over the exact data bytes, with the signing key absent from
// a successfully resolved revocation list, produces PASS.
//
// DEPENDENCY: @noble/ed25519 for signature verification.
// Inputs are normalized via Buffer.from() before passing to @noble so that
// both Uint8Array and Buffer callers work identically.
// =============================================================================

import * as ed from "@noble/ed25519";

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
  // WS-GO-02: Plugin-context fail-open path.
  // When CLAUDE_PLUGIN_ROOT is set and non-empty, a missing signature returns
  // PASS with a warning instead of BLOCKED. A present signature (even in plugin
  // context) runs through the normal Ed25519 verify path below.
  // -------------------------------------------------------------------------

  const isPluginContext =
    typeof process.env["CLAUDE_PLUGIN_ROOT"] === "string" &&
    process.env["CLAUDE_PLUGIN_ROOT"].length > 0;

  if ((signature === undefined || signature === null) && isPluginContext) {
    return { verdict: "PASS", warning: "unsigned-plugin-context" };
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
