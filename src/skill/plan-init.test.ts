// =============================================================================
// plan-init.test.ts — WS-01: plan-init CLI command tests (FAILING specs)
//
// STATUS: GREEN — plan-init command implemented in teo-run-entry.ts (WS-01).
// handlePlanInit() and the "plan-init" switch case added; describes un-skipped.
//
// CONTRACT (CLI arg protocol):
//   node bin/teo-run.js plan-init '<json-string>'
//
//   Input: { session_id: string, project_id: string, directive?: string }
//
//   Success (exit 0):
//     { ok: true, session_id, plan_id, initialized_at }
//     - plan_id contains session_id as a substring
//     - initialized_at is a valid ISO 8601 string
//
//   Error (exit 1):
//     { error: string }
//     - missing session_id  → exit 1
//     - missing project_id  → exit 1
//     - empty session_id    → exit 1
//     - invalid directive   → exit 1
//
// Ordering: misuse → boundary → golden path (ADR-064 adversarial-first policy)
// =============================================================================

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// CLI resolution — mirrors the pattern in teo-run.test.ts
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../");
const BIN_PATH = path.join(REPO_ROOT, "bin", "teo-run.js");
const ENTRY_PATH = path.join(REPO_ROOT, "src", "skill", "teo-run-entry.ts");

function buildCliArgs(command: string, jsonArg: string): { cmd: string; args: string[] } {
  if (fs.existsSync(BIN_PATH)) {
    return { cmd: "node", args: [BIN_PATH, command, jsonArg] };
  }
  return { cmd: "node", args: ["--import", "tsx/esm", ENTRY_PATH, command, jsonArg] };
}

function runCli(
  command: string,
  jsonArg: string
): { exitCode: number; stdout: unknown; stdoutRaw: string; stderr: string } {
  const { cmd, args } = buildCliArgs(command, jsonArg);
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env },
  });

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const stdoutRaw = result.stdout ?? "";
  let stdout: unknown = stdoutRaw;
  try {
    stdout = JSON.parse(stdoutRaw.trim());
  } catch {
    // stdout is not JSON — keep raw string
  }

  return {
    exitCode: result.status ?? 1,
    stdout,
    stdoutRaw,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    stderr: result.stderr ?? "",
  };
}

// =============================================================================
// MISUSE: Required-field violations and invalid values
// =============================================================================

describe("plan-init CLI — misuse: missing required fields and invalid values", () => {
  // M-1: session_id absent — required field missing
  it("M-1. missing session_id → exit 1, stdout JSON { error: string }", () => {
    const input = JSON.stringify({ project_id: "proj-abc" });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({ error: expect.any(String) });
    const err = (stdout as Record<string, unknown>)["error"] as string;
    expect(err.length).toBeGreaterThan(0);
  });

  // M-2: project_id absent — required field missing
  it("M-2. missing project_id → exit 1, stdout JSON { error: string }", () => {
    const input = JSON.stringify({ session_id: "sess-001" });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({ error: expect.any(String) });
    const err = (stdout as Record<string, unknown>)["error"] as string;
    expect(err.length).toBeGreaterThan(0);
  });

  // M-3: both required fields absent
  it("M-3. missing both session_id and project_id → exit 1, stdout JSON { error: string }", () => {
    const input = JSON.stringify({});

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({ error: expect.any(String) });
  });

  // M-4: invalid directive value — not one of BUILD/FIX/REVIEW/PLAN/ARCHITECTURAL
  it("M-4. directive 'INVALID' → exit 1, stdout JSON { error: string }", () => {
    const input = JSON.stringify({
      session_id: "sess-001",
      project_id: "proj-abc",
      directive: "INVALID",
    });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({ error: expect.any(String) });
  });

  // M-5: directive 'build' (wrong case) — only uppercase enum values are valid
  it("M-5. directive 'build' (lowercase) → exit 1, stdout JSON { error: string }", () => {
    const input = JSON.stringify({
      session_id: "sess-001",
      project_id: "proj-abc",
      directive: "build",
    });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({ error: expect.any(String) });
  });

  // M-7: session_id is a non-string type (number) — must be rejected
  it("M-7. session_id as number (42) → exit 1, stdout JSON { error: string }", () => {
    const input = JSON.stringify({ session_id: 42, project_id: "proj-abc" });
    const { exitCode, stdout } = runCli("plan-init", input);
    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({ error: expect.stringContaining("session_id") });
  });

  // M-8: project_id is a non-string type (number) — must be rejected
  it("M-8. project_id as number (99) → exit 1, stdout JSON { error: string }", () => {
    const input = JSON.stringify({ session_id: "sess-001", project_id: 99 });
    const { exitCode, stdout } = runCli("plan-init", input);
    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({ error: expect.stringContaining("project_id") });
  });

  // M-6: directive empty string — not a valid enum member
  it("M-6. directive '' (empty string) → exit 1, stdout JSON { error: string }", () => {
    const input = JSON.stringify({
      session_id: "sess-001",
      project_id: "proj-abc",
      directive: "",
    });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({ error: expect.any(String) });
  });
});

// =============================================================================
// BOUNDARY: Edge cases just inside and outside the valid range
// =============================================================================

describe("plan-init CLI — boundary: empty strings and optional fields", () => {
  // B-1: session_id is an empty string — should be rejected (required = non-empty)
  it("B-1. session_id '' (empty string) → exit 1, stdout JSON { error: string }", () => {
    const input = JSON.stringify({ session_id: "", project_id: "proj-abc" });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({ error: expect.any(String) });
  });

  // B-2: project_id is an empty string — should be rejected (required = non-empty)
  it("B-2. project_id '' (empty string) → exit 1, stdout JSON { error: string }", () => {
    const input = JSON.stringify({ session_id: "sess-001", project_id: "" });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(1);
    expect(stdout).toMatchObject({ error: expect.any(String) });
  });

  // B-3: directive absent entirely — it's optional, so this must succeed
  it("B-3. directive absent (optional field omitted) → exit 0, { ok: true }", () => {
    const input = JSON.stringify({ session_id: "sess-001", project_id: "proj-abc" });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ ok: true });
  });

  // B-4: extra unknown fields in input — should be tolerated (not break init)
  it("B-4. extra unknown field in input → exit 0, { ok: true } (unknown fields ignored)", () => {
    const input = JSON.stringify({
      session_id: "sess-001",
      project_id: "proj-abc",
      unexpected_field: "some-value",
    });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ ok: true });
  });
});

// =============================================================================
// GOLDEN PATH: Valid inputs return full success shape
// =============================================================================

describe("plan-init CLI — golden path: valid inputs return ok:true with required fields", () => {
  // G-1: minimal valid input (no directive)
  it("G-1. valid session_id + project_id → exit 0, { ok: true, session_id, plan_id, initialized_at }", () => {
    const sessionId = "sess-golden-001";
    const input = JSON.stringify({ session_id: sessionId, project_id: "proj-abc" });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(0);

    const result = stdout as Record<string, unknown>;
    expect(result["ok"]).toBe(true);
    expect(result["session_id"]).toBe(sessionId);
    expect(typeof result["plan_id"]).toBe("string");
    expect(typeof result["initialized_at"]).toBe("string");
  });

  // G-2: plan_id must contain the session_id (format: plan_<session_id>_<timestamp>)
  it("G-2. plan_id contains session_id as a substring", () => {
    const sessionId = "sess-id-embed-check";
    const input = JSON.stringify({ session_id: sessionId, project_id: "proj-abc" });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    expect(result["plan_id"] as string).toContain(sessionId);
  });

  // G-3: initialized_at is a valid ISO 8601 timestamp string
  it("G-3. initialized_at is a valid ISO 8601 date string", () => {
    const input = JSON.stringify({ session_id: "sess-ts-check", project_id: "proj-abc" });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(0);
    const result = stdout as Record<string, unknown>;
    const ts = result["initialized_at"] as string;
    expect(typeof ts).toBe("string");
    const parsed = new Date(ts);
    expect(isNaN(parsed.getTime())).toBe(false); // valid date
    // ISO 8601 format — should contain 'T' separator
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // G-4: with directive BUILD — one of the valid enum members
  it("G-4. directive BUILD → exit 0, { ok: true }", () => {
    const input = JSON.stringify({
      session_id: "sess-build",
      project_id: "proj-abc",
      directive: "BUILD",
    });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ ok: true });
  });

  // G-5: with directive FIX
  it("G-5. directive FIX → exit 0, { ok: true }", () => {
    const input = JSON.stringify({
      session_id: "sess-fix",
      project_id: "proj-abc",
      directive: "FIX",
    });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ ok: true });
  });

  // G-6: with directive REVIEW
  it("G-6. directive REVIEW → exit 0, { ok: true }", () => {
    const input = JSON.stringify({
      session_id: "sess-review",
      project_id: "proj-abc",
      directive: "REVIEW",
    });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ ok: true });
  });

  // G-7: with directive PLAN
  it("G-7. directive PLAN → exit 0, { ok: true }", () => {
    const input = JSON.stringify({
      session_id: "sess-plan",
      project_id: "proj-abc",
      directive: "PLAN",
    });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ ok: true });
  });

  // G-8: with directive ARCHITECTURAL
  it("G-8. directive ARCHITECTURAL → exit 0, { ok: true }", () => {
    const input = JSON.stringify({
      session_id: "sess-arch",
      project_id: "proj-abc",
      directive: "ARCHITECTURAL",
    });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchObject({ ok: true });
  });

  // G-9: stdout is valid JSON (not just a raw string)
  it("G-9. stdout is parseable JSON (not raw string)", () => {
    const input = JSON.stringify({ session_id: "sess-json-check", project_id: "proj-abc" });
    const { exitCode, stdoutRaw } = runCli("plan-init", input);

    expect(exitCode).toBe(0);
    expect(() => JSON.parse(stdoutRaw.trim())).not.toThrow();
  });

  // G-10: response has no unexpected top-level fields beyond ok, session_id, plan_id, initialized_at
  it("G-10. response shape has exactly: ok, session_id, plan_id, initialized_at", () => {
    const input = JSON.stringify({ session_id: "sess-shape", project_id: "proj-abc" });

    const { exitCode, stdout } = runCli("plan-init", input);

    expect(exitCode).toBe(0);
    const keys = Object.keys(stdout as Record<string, unknown>).sort();
    expect(keys).toEqual(["initialized_at", "ok", "plan_id", "session_id"].sort());
  });
});
