// =============================================================================
// sign.ts — HmacSigner + keyring (WS-CORE-06)
//
// ADR-059 (ratified 2026-06-18): HMAC-SHA-256 using Node's built-in crypto.
// ZERO external crypto dependency.
//
// CONTRACT (read this before changing anything):
//
//   1. CANONICAL PAYLOAD FORMAT
//      Signed string: plan_id|task_id|actor_id|verdict|ts|seq|content_hash
//      Seven fields, pipe-delimited in exactly that order (WS-SEC-01 added
//      content_hash as the 7th field — SHA-256 of target_dir tree, or "" for null).
//
//      Null task_id — some events are plan-scoped (no task). null serializes
//      as the empty string "". This is explicit and deterministic:
//        - null → ""  (sentinel; unambiguous because non-null task_ids must be
//          non-empty strings, enforced by callers — document + test this)
//        - The result: null task_id produces the literal "||" between plan_id
//          and actor_id, e.g. "plan-1||agent-1|PASS|2026-06-18T…|1"
//
//   2. DELIMITER-COLLISION DEFENSE (pipe-injection)
//      Fields that contain the pipe character "|" would shift field boundaries
//      and allow forgery (attacker crafts plan_id "a|b" to alias plan_id "a"
//      with task_id "b"). Defense: every field value is LENGTH-PREFIXED before
//      joining. The canonical payload becomes:
//
//        <len(plan_id)>:<plan_id>|<len(task_id_str)>:<task_id_str>|…
//
//      Example — {plan_id:"a|b", task_id:"c"} → "3:a|b|1:c|…"
//               vs {plan_id:"a", task_id:"b|c"} → "1:a|3:b|c|…"
//
//      These two produce DIFFERENT canonical strings → different signatures.
//      No attacker can shift field boundaries by injecting "|" into values.
//      Tested explicitly (see sign.test.ts pipe-injection test).
//
//   3. CONSTANT-TIME COMPARISON (timing-attack resistance)
//      verify() uses crypto.timingSafeEqual — NOT string ===. This prevents
//      timing side-channels that could leak information about the correct
//      signature one byte at a time.
//
//      timingSafeEqual throws if buffers have unequal length (it does not
//      short-circuit to false — it throws). Guard: if the hex strings differ in
//      length, return false immediately WITHOUT calling timingSafeEqual. This is
//      safe because differing lengths are publicly observable from the signature
//      format (always 64 hex chars); no secret is leaked by the length check.
//
//   4. KEY MANAGEMENT
//      - Key lives at <baseDir>/keyring/<keyring_id>.key (default baseDir:
//        os.homedir()/.teo/). Injectable for tests — NEVER a hardcoded literal.
//      - Key is 32 cryptographically-random bytes (crypto.randomBytes(32)).
//        Generated on first use if absent. File created with mode 0o600;
//        directory created with mode 0o700. Enforced on every load.
//      - Key is NEVER read from environment variables. NEVER stored in project
//        tree. NEVER inside .claude/.
//      - keyring_id is validated against path traversal ("../", "/", "\\").
//        Invalid ids throw SignKeyringError.
//
//   5. CORRUPT / WRONG-LENGTH KEY FILES
//      If the key file exists but is not exactly 32 bytes, HmacSigner throws
//      SignKeyError on construction. Silent weak-key signing is forbidden.
//
//   6. NON-REPLAYABLE
//      Because ts and seq are inside the signed payload, any two ledger events
//      that differ in EITHER field produce different signatures. A signature
//      captured for one event cannot be verified against another.
//
// =============================================================================

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LedgerVerdict } from "./ledger.js";

// ---------------------------------------------------------------------------
// Public error classes
// ---------------------------------------------------------------------------

/** Thrown when the keyring_id is invalid (empty, contains path separators/traversal). */
export class SignKeyringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignKeyringError";
  }
}

/**
 * Thrown when the key file exists but is corrupt, empty, or the wrong length.
 * Prevents silent weak-key signing.
 */
export class SignKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignKeyError";
  }
}

// ---------------------------------------------------------------------------
// SignPayload — the seven fields that form the canonical signed string
// ---------------------------------------------------------------------------

/**
 * The seven fields signed by HmacSigner (WS-SEC-01 added content_hash as 7th).
 *
 * These align with LedgerEvent fields so callers can pass ledger events
 * directly (after extracting the relevant fields).
 *
 * - plan_id: the plan / workflow identifier
 * - task_id: the task identifier, or null for plan-scoped events (→ "" in payload)
 * - actor_id: the actor that produced this event
 * - verdict: the gate verdict (aligns with LedgerVerdict — null for non-gate events)
 * - ts: ISO-8601 UTC timestamp (from the ledger event; assigned by the ledger)
 * - seq: monotonically increasing sequence number (from the ledger; starts at 1)
 * - content_hash: SHA-256 hex of the full target_dir tree, or null if no target_dir
 *   (→ "" in payload; optional field — absent callers get "" serialization)
 */
export interface SignPayload {
  plan_id: string;
  task_id: string | null;
  actor_id: string;
  verdict: LedgerVerdict;
  ts: string;
  seq: number;
  /** SHA-256 hex of the full target_dir tree, or null if no target_dir. */
  content_hash?: string | null;
}

// ---------------------------------------------------------------------------
// HmacSigner constructor options
// ---------------------------------------------------------------------------

export interface HmacSignerOptions {
  /**
   * The keyring identifier — becomes the key filename (<keyring_id>.key).
   * Must not be empty or contain path separators (/, \) or traversal sequences.
   * Defaults to "default".
   */
  keyring_id?: string;

  /**
   * Override the base directory (default: os.homedir()/.teo/).
   * Tests MUST inject a temp dir here. Never omit this in test code.
   * When omitted in production, resolves to os.homedir()/.teo/.
   */
  baseDir?: string;
}

// ---------------------------------------------------------------------------
// HmacSigner
// ---------------------------------------------------------------------------

/** Key size in bytes — 32 bytes = 256 bits, matching HMAC-SHA-256 block size. */
const KEY_BYTES = 32;

/** Expected signature length: HMAC-SHA-256 produces 32 bytes = 64 hex characters. */
const SIG_HEX_LENGTH = 64;

export class HmacSigner {
  private readonly key: Buffer;

  /**
   * Construct an HmacSigner.
   *
   * On first use the keyring directory is created (0700) and the key file is
   * generated (32 random bytes, 0600). On subsequent construction the key is
   * loaded from disk.
   *
   * Throws SignKeyringError if keyring_id is invalid.
   * Throws SignKeyError if the key file exists but is corrupt/wrong length.
   *
   * @param options - Injectable baseDir (required for tests); optional keyring_id.
   */
  constructor(options: HmacSignerOptions = {}) {
    const keyring_id = options.keyring_id ?? "default";

    // Validate keyring_id — must be non-empty, no path separators or traversal.
    if (!keyring_id || keyring_id.length === 0) {
      throw new SignKeyringError("keyring_id must not be empty.");
    }
    if (
      keyring_id.includes("/") ||
      keyring_id.includes("\\") ||
      keyring_id.includes("..") ||
      keyring_id.includes("\0")
    ) {
      throw new SignKeyringError(
        `keyring_id "${keyring_id}" contains path separators or traversal sequences. ` +
          `Use a plain identifier with no slashes, backslashes, or dots.`
      );
    }

    // Resolve the base directory. Production: os.homedir()/.teo/. Tests: injected.
    /* c8 ignore next */
    const resolvedBase = options.baseDir ?? path.join(os.homedir(), ".teo");
    const keyringDir = path.join(resolvedBase, "keyring");
    const keyPath = path.join(keyringDir, `${keyring_id}.key`);

    this.key = HmacSigner.loadOrGenerateKey(keyringDir, keyPath);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Sign a payload using HMAC-SHA-256.
   *
   * Builds the canonical length-prefixed pipe-delimited string:
   *   <len(plan_id)>:<plan_id>|<len(task_id_str)>:<task_id_str>|<len(actor_id)>:<actor_id>|<len(verdict_str)>:<verdict_str>|<len(ts)>:<ts>|<len(seq_str)>:<seq_str>|<len(content_hash_str)>:<content_hash_str>
   *
   * where null task_id → "", null verdict → "", null/absent content_hash → "".
   *
   * Returns 64 lowercase hex characters.
   *
   * @param payload - The seven fields to sign.
   * @returns Hex-encoded HMAC-SHA-256 (64 chars).
   */
  sign(payload: SignPayload): string {
    const canonical = HmacSigner.buildCanonical(payload);
    return crypto.createHmac("sha256", this.key).update(canonical).digest("hex");
  }

  /**
   * Verify a signature against a payload using constant-time comparison.
   *
   * Uses crypto.timingSafeEqual to prevent timing side-channels.
   * A wrong-length signature returns false without calling timingSafeEqual
   * (length difference is public information from the fixed 64-char format).
   *
   * @param payload - The payload to verify against.
   * @param signature - The hex-encoded signature to check.
   * @returns true if the signature is valid; false otherwise. Never throws.
   */
  verify(payload: SignPayload, signature: string): boolean {
    // Guard: timingSafeEqual throws on unequal buffer lengths. Return false early.
    // Length mismatch reveals nothing secret — signatures are always 64 hex chars.
    if (signature.length !== SIG_HEX_LENGTH) {
      return false;
    }

    const expected = this.sign(payload);

    // Both buffers are always SIG_HEX_LENGTH bytes at this point.
    const expectedBuf = Buffer.from(expected, "hex");
    const actualBuf = Buffer.from(signature, "hex");

    // Use constant-time comparison — NOT === — to prevent timing attacks.
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the canonical signed string from a SignPayload.
   *
   * Delimiter-collision defense: each field value is LENGTH-PREFIXED.
   * Format: "<len>:<value>" for each field, joined with "|".
   *
   * null task_id → "" (empty string sentinel, length 0).
   * null verdict → "" (empty string sentinel, length 0).
   *
   * This ensures {plan_id:"a|b", task_id:"c"} and {plan_id:"a", task_id:"b|c"}
   * produce different canonical strings and thus different signatures.
   */
  static buildCanonical(payload: SignPayload): string {
    const task_id_str = payload.task_id ?? "";
    const verdict_str = payload.verdict ?? "";
    const seq_str = String(payload.seq);
    const content_hash_str = payload.content_hash ?? "";

    const fields = [
      payload.plan_id,
      task_id_str,
      payload.actor_id,
      verdict_str,
      payload.ts,
      seq_str,
      content_hash_str,
    ];

    return fields.map((f) => `${f.length}:${f}`).join("|");
  }

  /**
   * Load the key from disk, or generate and persist a new one.
   *
   * - Creates the keyring directory at mode 0700 if absent.
   * - Generates 32 cryptographically-random bytes and writes them at mode 0600
   *   if the key file is absent.
   * - If the key file exists but is not exactly KEY_BYTES (32) bytes, throws
   *   SignKeyError (corrupt/wrong-length key — never sign with a bad key).
   * - Enforces 0600 on the key file and 0700 on the keyring directory after loading.
   */
  private static loadOrGenerateKey(keyringDir: string, keyPath: string): Buffer {
    // Ensure keyring directory exists at mode 0700.
    if (!fs.existsSync(keyringDir)) {
      fs.mkdirSync(keyringDir, { recursive: true, mode: 0o700 });
    }

    if (!fs.existsSync(keyPath)) {
      // Generate 32 cryptographically-random bytes and persist at 0600.
      const key = crypto.randomBytes(KEY_BYTES);
      fs.writeFileSync(keyPath, key, { mode: 0o600 });
      // Enforce directory permissions (mkdirSync mode is masked by process umask).
      fs.chmodSync(keyringDir, 0o700);
      return key;
    }

    // Key file exists — load it.
    const raw = fs.readFileSync(keyPath);

    if (raw.length !== KEY_BYTES) {
      throw new SignKeyError(
        `Key file at "${keyPath}" is ${raw.length} bytes; expected exactly ${KEY_BYTES} bytes. ` +
          `The file may be corrupt or empty. Delete it to regenerate.`
      );
    }

    // Enforce permissions after loading (in case the file was created externally).
    fs.chmodSync(keyPath, 0o600);
    fs.chmodSync(keyringDir, 0o700);

    return raw;
  }
}
