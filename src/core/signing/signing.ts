/**
 * signing — HMAC-SHA256 over the canonical signoff message.
 *
 * This is the layer that makes a gate/verification signoff unforgeable and
 * non-replayable. Every field that identifies *what* is being signed off on is
 * inside the signed message, so a captured signature cannot be reused on a
 * different task, seq, or actor. See TEO-5.md §5.
 *
 * Key: ~/.teo/keyring/signing.key (0600), generated on first use. The key never
 * leaves this directory and is never committed to any repo.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureTeoHome, type TeoHome } from "../home/home.js";

/** The fields bound into a signoff signature, in canonical order. */
export interface SignoffFields {
  plan_id: string;
  task_id: string;
  actor_id: string;
  verdict: string;
  ts: string;
  seq: number;
}

/** Build the canonical message string. Order is part of the contract. */
export function canonicalMessage(f: SignoffFields): string {
  return [f.plan_id, f.task_id, f.actor_id, f.verdict, f.ts, String(f.seq)].join("|");
}

/** Generate the signing key on first use. Idempotent; never overwrites. 0600. */
export function ensureSigningKey(home: TeoHome): Buffer {
  ensureTeoHome(home);
  if (!existsSync(home.signingKeyPath)) {
    writeFileSync(home.signingKeyPath, randomBytes(32), { mode: 0o600 });
  }
  // Enforce 0600 even if umask widened the create mode.
  chmodSync(home.signingKeyPath, 0o600);
  return readFileSync(home.signingKeyPath);
}

/** Sign a signoff. Returns a 64-char hex HMAC-SHA256. */
export function sign(home: TeoHome, fields: SignoffFields): string {
  const key = ensureSigningKey(home);
  return createHmac("sha256", key).update(canonicalMessage(fields)).digest("hex");
}

/**
 * Verify a signature against the fields. Returns false (never throws) on any
 * mismatch — wrong key, tampered field, replayed signoff, or malformed input.
 * Uses a constant-time compare to avoid leaking via timing.
 */
export function verify(home: TeoHome, fields: SignoffFields, signature: string): boolean {
  const expected = sign(home, fields);
  // timingSafeEqual requires equal-length buffers; a length mismatch is an
  // immediate, safe "false".
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
