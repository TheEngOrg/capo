import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureTeoHome, resolveTeoHome, type TeoHome } from "../../../src/core/home/home.js";
import {
  ensureSigningKey,
  sign,
  verify,
  canonicalMessage,
  type SignoffFields,
} from "../../../src/core/signing/signing.js";

let sandbox: string;
let home: TeoHome;

const fields: SignoffFields = {
  plan_id: "plan-abc",
  task_id: "task-xyz",
  actor_id: "qa-002",
  verdict: "pass",
  ts: "2026-06-11T00:00:00Z",
  seq: 42,
};

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-signing-test-"));
  home = resolveTeoHome({ TEO_HOME: sandbox });
  ensureTeoHome(home);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("ensureSigningKey", () => {
  it("generates a key on first use", () => {
    expect(existsSync(home.signingKeyPath)).toBe(false);
    ensureSigningKey(home);
    expect(existsSync(home.signingKeyPath)).toBe(true);
  });

  it("writes the key file with 0600 permissions", () => {
    ensureSigningKey(home);
    const mode = statSync(home.signingKeyPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("does not overwrite an existing key (stable across calls)", () => {
    ensureSigningKey(home);
    const first = readFileSync(home.signingKeyPath);
    ensureSigningKey(home);
    const second = readFileSync(home.signingKeyPath);
    expect(second.equals(first)).toBe(true);
  });

  it("generates a key of meaningful length (>= 32 bytes)", () => {
    ensureSigningKey(home);
    expect(readFileSync(home.signingKeyPath).length).toBeGreaterThanOrEqual(32);
  });
});

describe("canonicalMessage", () => {
  it("joins the signed fields in the documented order", () => {
    expect(canonicalMessage(fields)).toBe("plan-abc|task-xyz|qa-002|pass|2026-06-11T00:00:00Z|42");
  });

  it("changes when any field changes (binds every field)", () => {
    const base = canonicalMessage(fields);
    expect(canonicalMessage({ ...fields, verdict: "fail" })).not.toBe(base);
    expect(canonicalMessage({ ...fields, seq: 43 })).not.toBe(base);
    expect(canonicalMessage({ ...fields, task_id: "other" })).not.toBe(base);
  });
});

describe("sign / verify round-trip", () => {
  it("a freshly signed signoff verifies", () => {
    const sig = sign(home, fields);
    expect(verify(home, fields, sig)).toBe(true);
  });

  it("produces a hex signature", () => {
    expect(sign(home, fields)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same fields + key", () => {
    expect(sign(home, fields)).toBe(sign(home, fields));
  });
});

describe("no forgery", () => {
  it("rejects a signature not produced by the key", () => {
    const forged = "0".repeat(64);
    expect(verify(home, fields, forged)).toBe(false);
  });

  it("rejects a signature produced under a different key", () => {
    const sig = sign(home, fields);
    // New home/key — different secret.
    const other = resolveTeoHome({ TEO_HOME: join(sandbox, "other") });
    ensureTeoHome(other);
    ensureSigningKey(other);
    expect(verify(other, fields, sig)).toBe(false);
  });
});

describe("no replay", () => {
  it("a signature for one task does not verify against another", () => {
    const sig = sign(home, fields);
    expect(verify(home, { ...fields, task_id: "different-task" }, sig)).toBe(false);
  });

  it("a signature for one seq does not verify against another", () => {
    const sig = sign(home, fields);
    expect(verify(home, { ...fields, seq: 99 }, sig)).toBe(false);
  });

  it("a signature for one actor does not verify as another actor", () => {
    const sig = sign(home, fields);
    expect(verify(home, { ...fields, actor_id: "eng-001" }, sig)).toBe(false);
  });
});

describe("verify is constant-time-safe on length mismatch", () => {
  it("returns false for a malformed (short) signature without throwing", () => {
    expect(verify(home, fields, "abc")).toBe(false);
  });
});
