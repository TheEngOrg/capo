// WS-SEC-03 — passing (post-impl, CAD gate 2)
// WS-SEC-05 — passing (post-impl, CAD gate 2)

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as path from "node:path";

// =============================================================================
// pre-edit-write-guard.test.ts — path traversal bypass fix (WS-SEC-03)
//
// Bug: the hook normalizes FILE_PATH with a simple string-prefix strip (./,
// PROJECT_ROOT/), but does NOT call realpath. A path like
// `tests/../src/core/sign.ts` never matches the "src" protected prefix because
// the raw string still starts with "tests/". The guard is bypassed.
//
// Fix: call `realpath --canonicalize-missing` on FILE_PATH_NORM before the
// is_protected() check. This resolves any .. segments so that a traversal path
// that lands inside a protected directory is correctly caught.
//
// HOW THE SCRIPT IS INVOKED
//   Claude Code passes tool input as JSON on stdin. The hook reads it via `cat`,
//   extracts `.tool_input.file_path` via jq, normalises the path, and either
//   exits 0 (allow) or 2 (block + deny JSON).
//
//   We replicate this by piping a JSON payload into the script via stdin.
//   TEO_PROJECT_ROOT is set to a stable temp dir so the absolute-path strip
//   and realpath resolution work deterministically without a git repo.
//
//   Exit code: 0 = allowed, 2 = blocked.
//
// TEST ORDERING: misuse → boundary → golden path (ADR-064 critical-path policy)
// =============================================================================

const SCRIPT = path.join(__dirname, "../../hooks/pre-edit-write-guard.sh");

// Stable project root — does NOT need to exist on disk; realpath
// --canonicalize-missing resolves paths even when targets are absent.
const TEO_PROJECT_ROOT = "/tmp/teo-test-project";

/**
 * Build the stdin JSON payload for an Edit tool invocation.
 */
function makeEditPayload(filePath: string): string {
  return JSON.stringify({
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: "x", new_string: "y" },
  });
}

/**
 * Build the stdin JSON payload for a Write tool invocation.
 */
function makeWritePayload(filePath: string): string {
  return JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "x" },
  });
}

/**
 * Run the hook script with the given payload on stdin, with TEO_PROJECT_ROOT
 * set to the stable test root. Returns the exit code (0 = allow, 2 = block).
 * Never throws — we capture the exit code explicitly.
 */
function runHook(payload: string): number {
  const escaped = payload.replace(/'/g, "'\\''");
  try {
    execSync(`echo '${escaped}' | TEO_PROJECT_ROOT='${TEO_PROJECT_ROOT}' bash "${SCRIPT}"`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return 0;
  } catch (err: unknown) {
    const e = err as { status?: number };
    return e.status ?? 1;
  }
}

// =============================================================================
// MISUSE — paths that MUST be blocked (exit 2)
// =============================================================================

describe("pre-edit-write-guard.sh — misuse: path traversal into protected dirs (WS-SEC-03)", () => {
  it("blocks: tests/../src/core/sign.ts (traversal from tests/ into src/)", () => {
    // THE KEY FIX TEST.
    // Current code: FILE_PATH_NORM = "tests/../src/core/sign.ts"
    //   is_protected("tests/../src/core/sign.ts") → no prefix match → exits 0 (BYPASS)
    // After fix: realpath resolves to "src/core/sign.ts"
    //   is_protected("src/core/sign.ts") → matches "src" prefix → exits 2 (BLOCKED)
    expect(runHook(makeEditPayload("tests/../src/core/sign.ts"))).toBe(2);
  });

  it("blocks: docs/../src/core/sign.ts (traversal from docs/ into src/) [PASSES pre-fix — wrong reason]", () => {
    // A traversal starting from docs/ (which IS in PROTECTED_PREFIXES) and
    // escaping into src/ (also protected). Pre-fix, the raw string
    // "docs/../src/core/sign.ts" prefix-matches "docs/" → blocked exit 2.
    // The block fires for the wrong reason (docs/ match, not src/ match), but
    // the result is correct. After the fix, realpath resolves to "src/core/sign.ts"
    // and it is correctly blocked because src/ is protected.
    // This is a regression guard: must remain blocked before and after the fix.
    expect(runHook(makeEditPayload("docs/../src/core/sign.ts"))).toBe(2);
  });

  it("blocks: absolute path /tmp/teo-test-project/src/core/sign.ts [regression guard — PASSES pre-fix]", () => {
    // This absolute-path bypass was already fixed (FU-18 Bug A).
    // The hook strips the PROJECT_ROOT prefix before prefix matching.
    // Must remain blocked after the traversal fix is applied.
    // Uses our TEO_PROJECT_ROOT (/tmp/teo-test-project) so the strip fires.
    expect(runHook(makeEditPayload(`${TEO_PROJECT_ROOT}/src/core/sign.ts`))).toBe(2);
  });
});

describe("pre-edit-write-guard.sh — misuse: Write tool traversal bypass (WS-SEC-03)", () => {
  it("blocks: Write tests/../src/core/sign.ts (traversal via Write tool)", () => {
    // Validates that the traversal fix applies equally to Write tool payloads,
    // not just Edit. Both tool names share the same normalization code path.
    expect(runHook(makeWritePayload("tests/../src/core/sign.ts"))).toBe(2);
  });
});

// =============================================================================
// BOUNDARY — edge cases that clarify exact scope of protection
// All boundary tests PASS on current code (they do not depend on realpath).
// =============================================================================

describe("pre-edit-write-guard.sh — boundary: direct protected path (regression)", () => {
  it("blocks: src/core/sign.ts (direct path, no traversal) [PASSES pre-fix]", () => {
    // Golden-path regression for the existing guard.
    // A direct path into src/ must remain blocked regardless of the traversal fix.
    expect(runHook(makeEditPayload("src/core/sign.ts"))).toBe(2);
  });
});

describe("pre-edit-write-guard.sh — boundary: .git/config edge case", () => {
  it("allows: .git/config (NOT in PROTECTED_PREFIXES) [PASSES pre-fix]", () => {
    // .git is NOT listed in PROTECTED_PREFIXES (only .claude/scripts, .claude/hooks,
    // .claude/shared, .claude/agents, .claude/settings.json, docs, src, packages,
    // package.json, tsconfig.json, vitest.config.ts, .eslintrc, .eslintrc.json).
    // This test documents that .git writes are ALLOWED by the guard as-is.
    // If .git protection is ever added, this expectation must flip to 2.
    expect(runHook(makeEditPayload(".git/config"))).toBe(0);
  });
});

describe("pre-edit-write-guard.sh — boundary: traversal OUT of protected dir", () => {
  it("allows: src/../tests/some-test.ts (traversal out of src/ into unprotected tests/)", () => {
    // A traversal that starts inside a protected-looking prefix but resolves
    // to an unprotected path must be ALLOWED — over-blocking is as harmful as
    // under-blocking for developer workflow.
    // Resolved path: tests/some-test.ts → does not match any protected prefix → allow.
    // NOTE: on current code this exits 2 (false-positive block) because the raw
    // string "src/../tests/some-test.ts" string-prefix-matches "src/" in
    // is_protected(). After the fix, realpath resolves it to "tests/some-test.ts"
    // which does NOT match any protected prefix → correctly exits 0.
    expect(runHook(makeEditPayload("src/../tests/some-test.ts"))).toBe(0);
  });
});

// =============================================================================
// GOLDEN PATH — unprotected paths that must always pass through (exit 0)
// All golden-path tests PASS on current code.
// =============================================================================

describe("pre-edit-write-guard.sh — golden path: unprotected paths always allowed", () => {
  it("allows: tests/my.test.ts (test file, no bypass needed) [PASSES pre-fix]", () => {
    // tests/ is not in PROTECTED_PREFIXES — agents write test files freely.
    expect(runHook(makeEditPayload("tests/my.test.ts"))).toBe(0);
  });

  it("allows: dist/output.js (build artifact, unprotected output dir) [PASSES pre-fix]", () => {
    // dist/ is not protected — build outputs may be freely modified.
    expect(runHook(makeEditPayload("dist/output.js"))).toBe(0);
  });

  it("allows: README.md (root-level doc file, unprotected) [PASSES pre-fix]", () => {
    // README.md at repo root is not under any protected prefix.
    expect(runHook(makeEditPayload("README.md"))).toBe(0);
  });

  it("allows: Write dist/output.js (Write tool, unprotected) [PASSES pre-fix]", () => {
    // Write tool on an unprotected path must exit 0, same as Edit.
    expect(runHook(makeWritePayload("dist/output.js"))).toBe(0);
  });
});

// =============================================================================
// WS-SEC-05 — root-level build config protection
//
// Security gap: root-level config files (package.json, tsconfig.json,
// vitest.config.ts, .eslintrc*) are NOT in PROTECTED_PREFIXES. A subagent
// could directly rewrite build config without triggering the guard.
//
// Fix: add "package.json", "tsconfig.json", "vitest.config.ts", ".eslintrc",
// ".eslintrc.json" (and other .eslintrc.* variants) to PROTECTED_PREFIXES.
//
// MISUSE tests below FAIL until dev adds those entries. Existing tests above
// are regression guards that must stay green before and after the fix.
//
// TEST ORDERING: misuse → boundary → golden path (ADR-064 critical-path policy)
// =============================================================================

describe("pre-edit-write-guard.sh — misuse: root-level build config writes blocked (WS-SEC-05)", () => {
  it("blocks: Write package.json (root build config — FAILS until WS-SEC-05 fix)", () => {
    // package.json is the root of all dependency and script configuration.
    // A subagent silently rewriting it could inject malicious dependencies or
    // override build scripts. Must be blocked (exit 2) after the fix.
    // Currently exits 0 (allowed) because "package.json" is not in PROTECTED_PREFIXES.
    expect(runHook(makeWritePayload("package.json"))).toBe(2);
  });

  it("blocks: Edit package.json (root build config — FAILS until WS-SEC-05 fix)", () => {
    // Covers the Edit tool path as well — same guard, same fix required.
    expect(runHook(makeEditPayload("package.json"))).toBe(2);
  });

  it("blocks: Write tsconfig.json (TypeScript compiler config — FAILS until WS-SEC-05 fix)", () => {
    // tsconfig.json controls compilation targets, strict mode, path aliases.
    // A subagent weakening strictness or aliasing paths is a silent integrity risk.
    expect(runHook(makeWritePayload("tsconfig.json"))).toBe(2);
  });

  it("blocks: Edit tsconfig.json (TypeScript compiler config — FAILS until WS-SEC-05 fix)", () => {
    expect(runHook(makeEditPayload("tsconfig.json"))).toBe(2);
  });

  it("blocks: Write vitest.config.ts (test runner config — FAILS until WS-SEC-05 fix)", () => {
    // vitest.config.ts controls coverage thresholds, test include patterns, reporters.
    // A subagent lowering the coverage gate or excluding test dirs defeats QA enforcement.
    expect(runHook(makeWritePayload("vitest.config.ts"))).toBe(2);
  });

  it("blocks: Edit vitest.config.ts (test runner config — FAILS until WS-SEC-05 fix)", () => {
    expect(runHook(makeEditPayload("vitest.config.ts"))).toBe(2);
  });

  it("blocks: Write .eslintrc (base ESLint config — FAILS until WS-SEC-05 fix)", () => {
    // .eslintrc (no extension) is a valid ESLint config format.
    // Silently disabling lint rules undermines code quality gates.
    expect(runHook(makeWritePayload(".eslintrc"))).toBe(2);
  });

  it("blocks: Write .eslintrc.json (ESLint JSON config — FAILS until WS-SEC-05 fix)", () => {
    // .eslintrc.json is the most common variant in this repo.
    // Requires a separate PROTECTED_PREFIXES entry (prefix-match on ".eslintrc"
    // does NOT catch ".eslintrc.json" via startsWith — no trailing slash).
    expect(runHook(makeWritePayload(".eslintrc.json"))).toBe(2);
  });
});

describe("pre-edit-write-guard.sh — boundary: existing src/ protection unaffected by WS-SEC-05", () => {
  it("blocks: src/some-file.ts (regression — must remain blocked after WS-SEC-05 fix)", () => {
    // Verifies that adding new entries to PROTECTED_PREFIXES does not accidentally
    // break the existing "src" prefix protection.
    expect(runHook(makeWritePayload("src/some-file.ts"))).toBe(2);
  });
});

describe("pre-edit-write-guard.sh — golden path: non-config files not false-positived (WS-SEC-05)", () => {
  it("allows: Write some-output.txt (arbitrary root file, not a build config)", () => {
    // An unrelated root-level file that shares no prefix with any protected entry
    // must still exit 0. Confirms the new entries don't over-block.
    expect(runHook(makeWritePayload("some-output.txt"))).toBe(0);
  });
});
