// =============================================================================
// run-receipt.ts — run receipt signing (WS-RUN-RECEIPT-01)
//
// Emits a signed run receipt proving the CLI actually ran a command.
// An agent claiming "I ran the gate" must produce the run_id.
//
// RECEIPT FORMAT:
//   { run_id, command, args_hash, actor_id, ts, outcome, exit_code, sig }
//
// CANONICAL STRING (pipe-joined, no length prefixing):
//   run_id|command|args_hash|actor_id|ts|outcome|exit_code
//
// SIG: HMAC-SHA-256 of the canonical string, 64 lowercase hex characters.
//
// ATOMIC WRITE: written to <baseDir>/receipts/<uuid>.json.tmp then renamed.
//
// ZERO-FOOTPRINT TESTS: baseDir is always injected — never reads os.homedir().
// =============================================================================

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { HmacSigner } from "./sign.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Input required to build a run receipt. */
export interface RunReceiptInput {
  /** The CLI command that was executed (e.g. "ledger-append"). */
  command: string;
  /** The raw JSON arg string passed to the command. */
  argsRaw: string;
  /** The actor that invoked the command (e.g. "teo-run"). */
  actor_id: string;
  /** Whether the command succeeded or failed. */
  outcome: "OK" | "FAIL";
  /** Process exit code: 0 for success, non-zero for failure. */
  exit_code: number;
  /** Base directory for the keyring and receipts. Injected — never os.homedir(). */
  baseDir: string;
}

/** A signed run receipt proving the CLI executed a command. */
export interface RunReceipt {
  /** URN-formatted unique run identifier: urn:teo:run:<uuid-v4>. */
  run_id: string;
  /** The CLI command that was executed. */
  command: string;
  /** SHA-256 of the raw args string: "sha256:<64-hex-lowercase>". */
  args_hash: string;
  /** The actor that invoked the command. */
  actor_id: string;
  /** ISO-8601 UTC timestamp when the receipt was built. */
  ts: string;
  /** Whether the command succeeded or failed. */
  outcome: "OK" | "FAIL";
  /** Process exit code. */
  exit_code: number;
  /** HMAC-SHA-256 of the canonical string, 64 lowercase hex characters. */
  sig: string;
}

// ---------------------------------------------------------------------------
// computeArgsHash
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 of the raw args string.
 *
 * Returns a string in the format "sha256:<64-hex-lowercase>".
 *
 * @param argsRaw - The raw JSON arg string passed to the CLI command.
 */
export function computeArgsHash(argsRaw: string): string {
  const hex = crypto.createHash("sha256").update(argsRaw).digest("hex");
  return `sha256:${hex}`;
}

// ---------------------------------------------------------------------------
// buildReceiptCanonical
// ---------------------------------------------------------------------------

/**
 * Build the canonical string for a run receipt (without the sig field).
 *
 * Format: run_id|command|args_hash|actor_id|ts|outcome|exit_code
 * (pipe-joined, seven fields in exactly this order)
 *
 * @param receipt - The receipt without the sig field.
 */
export function buildReceiptCanonical(receipt: Omit<RunReceipt, "sig">): string {
  return [
    receipt.run_id,
    receipt.command,
    receipt.args_hash,
    receipt.actor_id,
    receipt.ts,
    receipt.outcome,
    String(receipt.exit_code),
  ].join("|");
}

// ---------------------------------------------------------------------------
// buildRunReceipt
// ---------------------------------------------------------------------------

/**
 * Build a signed run receipt from the given input.
 *
 * Validates that command and actor_id are non-empty, and that outcome is
 * "OK" or "FAIL". Throws if any validation fails.
 *
 * @param input - RunReceiptInput with all required fields.
 * @returns A fully signed RunReceipt.
 */
export function buildRunReceipt(input: RunReceiptInput): RunReceipt {
  if (!input.command || input.command.length === 0) {
    throw new Error("RunReceiptInput.command must not be empty.");
  }
  if (!input.actor_id || input.actor_id.length === 0) {
    throw new Error("RunReceiptInput.actor_id must not be empty.");
  }
  if ((input.outcome as string) !== "OK" && (input.outcome as string) !== "FAIL") {
    throw new Error(
      `RunReceiptInput.outcome must be "OK" or "FAIL", got "${input.outcome as string}".`
    );
  }

  const run_id = `urn:teo:run:${crypto.randomUUID()}`;
  const ts = new Date().toISOString();
  const args_hash = computeArgsHash(input.argsRaw);

  const unsignedReceipt: Omit<RunReceipt, "sig"> = {
    run_id,
    command: input.command,
    args_hash,
    actor_id: input.actor_id,
    ts,
    outcome: input.outcome,
    exit_code: input.exit_code,
  };

  const canonical = buildReceiptCanonical(unsignedReceipt);
  const signer = new HmacSigner({ baseDir: input.baseDir });
  const sig = signer.signRaw(canonical);

  return { ...unsignedReceipt, sig };
}

// ---------------------------------------------------------------------------
// writeRunReceipt
// ---------------------------------------------------------------------------

/**
 * Atomically write a run receipt to <baseDir>/receipts/<uuid>.json.
 *
 * Creates the receipts directory if it does not exist.
 * Writes to a .tmp file first, then renames to the final path (atomic).
 *
 * @param receipt - The RunReceipt to persist.
 * @param baseDir - The base directory under which to write the receipts/ subdirectory.
 */
export function writeRunReceipt(receipt: RunReceipt, baseDir: string): void {
  const uuid = receipt.run_id.slice("urn:teo:run:".length);
  const receiptsDir = path.join(baseDir, "receipts");

  fs.mkdirSync(receiptsDir, { recursive: true });

  const finalPath = path.join(receiptsDir, `${uuid}.json`);
  const tmpPath = `${finalPath}.tmp`;

  fs.writeFileSync(tmpPath, JSON.stringify(receipt));
  fs.renameSync(tmpPath, finalPath);
}

// ---------------------------------------------------------------------------
// verifyRunReceipt
// ---------------------------------------------------------------------------

/**
 * Verify a run receipt by run_id.
 *
 * Reads the receipt file from <baseDir>/receipts/<uuid>.json, rebuilds the
 * canonical string, re-signs it, and compares the signatures using constant-
 * time comparison.
 *
 * Returns { valid: true } on success.
 * Returns { valid: false, reason: string } on any failure.
 *
 * @param opts.run_id  - The URN run identifier (urn:teo:run:<uuid>).
 * @param opts.baseDir - The base directory containing the receipts/ subdirectory.
 */
export function verifyRunReceipt(opts: { run_id: string; baseDir: string }): {
  valid: boolean;
  reason?: string;
} {
  const uuid = opts.run_id.slice("urn:teo:run:".length);
  const receiptPath = path.join(opts.baseDir, "receipts", `${uuid}.json`);

  if (!fs.existsSync(receiptPath)) {
    return { valid: false, reason: "receipt not found" };
  }

  let stored: RunReceipt;
  try {
    stored = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as RunReceipt;
  } catch {
    return { valid: false, reason: "receipt not found" };
  }

  // Quick length check before constant-time comparison
  if (typeof stored.sig !== "string" || stored.sig.length !== 64) {
    return { valid: false, reason: "signature invalid" };
  }

  const unsignedReceipt: Omit<RunReceipt, "sig"> = {
    run_id: stored.run_id,
    command: stored.command,
    args_hash: stored.args_hash,
    actor_id: stored.actor_id,
    ts: stored.ts,
    outcome: stored.outcome,
    exit_code: stored.exit_code,
  };

  const canonical = buildReceiptCanonical(unsignedReceipt);
  const signer = new HmacSigner({ baseDir: opts.baseDir });
  const expectedSig = signer.signRaw(canonical);

  // Constant-time comparison to prevent timing side-channels
  const expectedBuf = Buffer.from(expectedSig, "hex");
  const actualBuf = Buffer.from(stored.sig, "hex");

  if (expectedBuf.length !== actualBuf.length) {
    return { valid: false, reason: "signature invalid" };
  }

  try {
    if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return { valid: false, reason: "signature invalid" };
    }
  } catch /* c8 ignore start */ {
    // timingSafeEqual can only throw if buffer lengths differ, but line 234 already
    // guards that. This catch is an unreachable defensive path — annotated accordingly.
    return { valid: false, reason: "signature invalid" };
  } /* c8 ignore stop */

  return { valid: true };
}
