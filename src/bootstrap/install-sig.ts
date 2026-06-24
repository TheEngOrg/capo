// =============================================================================
// install-sig.ts — Plugin install-time signing and load-time verification (WS-REVOKE-01)
//
// Option B: sign the plugin root path at install time; verify on load.
//
// DESIGN:
//   - Install time: `signPluginRoot()` writes `$CLAUDE_PLUGIN_ROOT/.teo-install-sig`
//     containing { key_id, signature } where signature covers the canonicalized
//     (realpathSync) plugin root path as UTF-8 bytes, signed with ed25519.
//
//   - Load time: `readInstallSig()` reads the sig file and `verifyInstallSig()`
//     verifies the signature over fs.realpathSync(pluginRootPath) using the
//     caller-provided ed25519 public key.
//
//   - Failure semantics: FAIL-CLOSED. Missing file, bad JSON, wrong-length sig,
//     or invalid signature all produce a diagnosable error — never silent PASS.
//
// DEPENDENCY: @noble/ed25519 for signing and verification.
// =============================================================================

import * as ed from "@noble/ed25519";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Shape of the .teo-install-sig JSON file written at install time. */
export interface InstallSigFile {
  /** Stable identifier for the install signing key (checked against revocation list). */
  key_id: string;
  /** Base64-encoded ed25519 signature over the UTF-8 bytes of the canonicalized plugin root path. */
  signature: string;
}

/** Result of readInstallSig() — either the parsed file or a diagnosable error. */
export type ReadInstallSigResult =
  | { ok: true; file: InstallSigFile }
  | { ok: false; reason: string };

/** Result of verifyInstallSig() — either valid or a diagnosable error. */
export type VerifyInstallSigResult = { ok: true } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Filename of the install-time signature file inside CLAUDE_PLUGIN_ROOT. */
export const INSTALL_SIG_FILENAME = ".teo-install-sig";

// ---------------------------------------------------------------------------
// signPluginRoot — install-time signer
// ---------------------------------------------------------------------------

/**
 * Sign the plugin root path at install time and write the signature to
 * `$pluginRootPath/.teo-install-sig`.
 *
 * The signed payload is the UTF-8 bytes of `fs.realpathSync(pluginRootPath)`.
 * This canonicalizes symlinks so that verification works consistently
 * regardless of the path form used at install vs. load time.
 *
 * The sig file is written with mode 0o600 (owner read/write only).
 *
 * @param pluginRootPath - Absolute path to the plugin root directory.
 * @param keyId          - Stable identifier for the signing key (included in sig file).
 * @param signerKey      - Raw 32-byte ed25519 private key scalar (Uint8Array).
 *                         NEVER store or log this — discard immediately after use.
 */
export async function signPluginRoot(
  pluginRootPath: string,
  keyId: string,
  signerKey: Uint8Array
): Promise<void> {
  // Canonicalize the path to resolve symlinks.
  const canonicalPath = fs.realpathSync(pluginRootPath);
  const payloadBytes = new Uint8Array(Buffer.from(canonicalPath, "utf8"));

  // Sign using @noble/ed25519.
  const sigBytes = await ed.signAsync(payloadBytes, signerKey);
  const sigBase64 = Buffer.from(sigBytes).toString("base64");

  const sigFile: InstallSigFile = { key_id: keyId, signature: sigBase64 };
  const sigFilePath = path.join(pluginRootPath, INSTALL_SIG_FILENAME);

  // Write with mode 0o600 (owner-only read/write).
  fs.writeFileSync(sigFilePath, JSON.stringify(sigFile, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// readInstallSig — load-time sig file reader
// ---------------------------------------------------------------------------

/**
 * Read and parse the install-time signature file from `$pluginRootPath/.teo-install-sig`.
 *
 * Returns { ok: true, file } on success, or { ok: false, reason } on any failure
 * (file absent, unreadable, bad JSON, wrong shape). Never throws.
 *
 * @param pluginRootPath - Absolute path to the plugin root directory.
 */
export function readInstallSig(pluginRootPath: string): ReadInstallSigResult {
  const sigFilePath = path.join(pluginRootPath, INSTALL_SIG_FILENAME);

  let raw: string;
  try {
    raw = fs.readFileSync(sigFilePath, "utf8");
  } catch (err) {
    /* c8 ignore next */
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `Install signature file not found or unreadable at "${sigFilePath}": ${message}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: `Install signature file at "${sigFilePath}" contains invalid JSON.`,
    };
  }

  if (!isInstallSigFile(parsed)) {
    return {
      ok: false,
      reason:
        `Install signature file at "${sigFilePath}" has invalid shape: ` +
        `expected { key_id: string, signature: string }.`,
    };
  }

  return { ok: true, file: parsed };
}

// ---------------------------------------------------------------------------
// verifyInstallSig — load-time signature verifier
// ---------------------------------------------------------------------------

/**
 * Verify the install-time ed25519 signature over the plugin root path.
 *
 * The signed payload is the UTF-8 bytes of `fs.realpathSync(pluginRootPath)`.
 * The signature in the sig file must be a valid ed25519 signature over those
 * bytes using the provided public key.
 *
 * Returns { ok: true } on success, or { ok: false, reason } on any failure.
 * Never throws.
 *
 * @param pluginRootPath - Absolute path to the plugin root directory (used to derive payload).
 * @param sigFile        - Parsed contents of .teo-install-sig.
 * @param publicKey      - Raw 32-byte ed25519 public key (Uint8Array or Buffer).
 */
export async function verifyInstallSig(
  pluginRootPath: string,
  sigFile: InstallSigFile,
  publicKey: Uint8Array | Buffer
): Promise<VerifyInstallSigResult> {
  // Canonicalize to match what was signed at install time.
  let canonicalPath: string;
  try {
    canonicalPath = fs.realpathSync(pluginRootPath);
  } catch (err) {
    /* c8 ignore next */
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `Cannot resolve real path of plugin root "${pluginRootPath}": ${message}`,
    };
  }

  const payloadBytes = new Uint8Array(Buffer.from(canonicalPath, "utf8"));

  // Decode base64 signature.
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(sigFile.signature, "base64");
  } catch /* c8 ignore next */ {
    // Node's Buffer.from(str, "base64") never throws — invalid chars are silently dropped.
    // This defensive catch is retained for non-Node runtimes. Production-only path.
    /* c8 ignore next */
    return { ok: false, reason: "Install signature is not valid base64." };
  }

  if (sigBytes.length !== 64) {
    return {
      ok: false,
      reason:
        `Install signature has wrong length: expected 64 bytes, got ${sigBytes.length} bytes. ` +
        `ed25519 signatures are always exactly 64 bytes.`,
    };
  }

  const pubKeyBytes = Buffer.from(publicKey);

  let valid: boolean;
  try {
    valid = await ed.verifyAsync(
      new Uint8Array(sigBytes),
      payloadBytes,
      new Uint8Array(pubKeyBytes)
    );
  } catch (err) /* c8 ignore start */ {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Install signature verification error: ${message}` };
  } /* c8 ignore stop */

  if (!valid) {
    return {
      ok: false,
      reason:
        "Install signature verification failed: the signature does not match the plugin root path " +
        `"${canonicalPath}" with the provided public key.`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Type-guard: checks that value conforms to InstallSigFile shape. */
function isInstallSigFile(value: unknown): value is InstallSigFile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj["key_id"] === "string" && typeof obj["signature"] === "string";
}
