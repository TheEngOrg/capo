// WS-SYNC-01 — failing (gate-1 spec; fails until dev syncs .claude/hooks/ to hooks/)

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// pre-edit-write-guard-sync.test.ts — WS-SYNC-01 sync-state guard
//
// CONTEXT
//   .claude/hooks/pre-edit-write-guard.sh is what Claude Code ACTUALLY loads.
//   hooks/pre-edit-write-guard.sh is the canonical authoritative source.
//   These two files are out of sync: the deployed copy (.claude/hooks/) is
//   missing 5 PROTECTED_PREFIXES entries that exist in the canonical copy:
//
//     package.json    tsconfig.json    vitest.config.ts    .eslintrc    .eslintrc.json
//
//   Without these, an agent can directly Edit/Write root config files like
//   package.json without triggering the teo-apply-edit bypass flow. The guard
//   runs but silently allows those writes because the allowlist is incomplete.
//
// CI / GITIGNORE CONSTRAINT
//   .claude/ is listed in .gitignore (line 11). The memory rule
//   "Tests only assert on TRACKED files" exists because asserting on gitignored
//   paths produces false-green locally (the file is on disk) and false-red in
//   CI on a fresh checkout (the file is absent). These tests therefore split
//   into two groups:
//
//   GROUP A — tracked files only (always run, safe in CI):
//     Assert that hooks/pre-edit-write-guard.sh (tracked, canonical) contains
//     each of the 5 missing entries. These pass today (canonical is correct) and
//     serve as: (a) regression guards against accidental removal from canonical,
//     (b) spec for what dev must also place in .claude/hooks/.
//
//   GROUP B — local-only (.claude/hooks/ assertions):
//     Guarded by LOCAL_ONLY_TESTS=1. Set this env var in your local shell to
//     run the tests that directly assert the deployed .claude/hooks/ copy. NEVER
//     set this in CI — the file is gitignored and will be absent, causing
//     false-red failures. The deployed file MUST be verified locally by the dev
//     who performs the sync, then confirmed by QA before story sign-off.
//
//   GROUP C — identity test (local-only):
//     Asserts that .claude/hooks/pre-edit-write-guard.sh is byte-for-byte
//     identical to hooks/pre-edit-write-guard.sh. This is the definitive PASS
//     signal for WS-SYNC-01. Also LOCAL_ONLY_TESTS=1 gated.
//
//   GROUP D — block-no-verify regression guard (tracked files only, always run):
//     hooks/block-no-verify.sh is already correctly synced. Assert the canonical
//     file is present and well-formed as a regression guard against future drift.
//
// HOW TO RUN THE FULL SUITE LOCALLY
//   LOCAL_ONLY_TESTS=1 npx vitest run src/hooks/pre-edit-write-guard-sync.test.ts
//
// WHAT "PASS" MEANS FOR WS-SYNC-01
//   All tests in Group B (failing now) and Group C (identity) must pass with
//   LOCAL_ONLY_TESTS=1. Group A and Group D must continue to pass in CI.
//
// TEST ORDERING: misuse → boundary → golden path (ADR-064)
// =============================================================================

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CANONICAL_GUARD = path.join(REPO_ROOT, "hooks", "pre-edit-write-guard.sh");
const DEPLOYED_GUARD = path.join(REPO_ROOT, ".claude", "hooks", "pre-edit-write-guard.sh");
const CANONICAL_BLOCK_NO_VERIFY = path.join(REPO_ROOT, "hooks", "block-no-verify.sh");
const DEPLOYED_BLOCK_NO_VERIFY = path.join(REPO_ROOT, ".claude", "hooks", "block-no-verify.sh");

/**
 * Helper: parse the PROTECTED_PREFIXES array from a hook script.
 * Extracts quoted entries from the bash array literal — does not execute the script.
 * Returns the list of extracted prefix strings.
 */
function parseProtectedPrefixes(scriptContent: string): string[] {
  // Match the PROTECTED_PREFIXES=( ... ) block (possibly multiline).
  const blockMatch = scriptContent.match(/PROTECTED_PREFIXES=\(([\s\S]*?)\)/);
  if (!blockMatch) return [];
  const block = blockMatch[1];
  // Extract each quoted string token (handles both single and double quotes).
  const entries: string[] = [];
  const quotePattern = /["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = quotePattern.exec(block)) !== null) {
    entries.push(m[1]);
  }
  return entries;
}

// Guard: skip local-only tests when running in CI (no LOCAL_ONLY_TESTS=1).
// See CI CONSTRAINT section in the file header above.
const itLocal = process.env.LOCAL_ONLY_TESTS === "1" ? it : it.skip;

// =============================================================================
// GROUP A — MISUSE GUARDS (tracked canonical; always run, CI-safe)
//
// These PASS today and must continue to pass after WS-SYNC-01.
// They spec the correct allowlist so dev knows exactly what to copy to .claude/hooks/.
// =============================================================================

describe("WS-SYNC-01 — misuse: canonical hooks/pre-edit-write-guard.sh has all required PROTECTED_PREFIXES", () => {
  // Read the canonical (tracked) script once for this group.
  let canonicalPrefixes: string[];
  try {
    canonicalPrefixes = parseProtectedPrefixes(fs.readFileSync(CANONICAL_GUARD, "utf8"));
  } catch {
    canonicalPrefixes = [];
  }

  it("canonical hooks/pre-edit-write-guard.sh contains 'package.json' in PROTECTED_PREFIXES", () => {
    // Regression guard: dev must not accidentally remove this entry from the canonical file.
    // This entry is ABSENT from .claude/hooks/pre-edit-write-guard.sh (the sync gap).
    expect(canonicalPrefixes).toContain("package.json");
  });

  it("canonical hooks/pre-edit-write-guard.sh contains 'tsconfig.json' in PROTECTED_PREFIXES", () => {
    expect(canonicalPrefixes).toContain("tsconfig.json");
  });

  it("canonical hooks/pre-edit-write-guard.sh contains 'vitest.config.ts' in PROTECTED_PREFIXES", () => {
    expect(canonicalPrefixes).toContain("vitest.config.ts");
  });

  it("canonical hooks/pre-edit-write-guard.sh contains '.eslintrc' in PROTECTED_PREFIXES", () => {
    expect(canonicalPrefixes).toContain(".eslintrc");
  });

  it("canonical hooks/pre-edit-write-guard.sh contains '.eslintrc.json' in PROTECTED_PREFIXES", () => {
    expect(canonicalPrefixes).toContain(".eslintrc.json");
  });

  it("canonical hooks/pre-edit-write-guard.sh PROTECTED_PREFIXES has at least 12 entries (the full allowlist)", () => {
    // The canonical file has 12 entries (7 existing + 5 config entries).
    // ws-delete-mirror removed ".claude/agents" (mirror deleted); count updated from 13 to 12.
    // Failing to reach 12 means an entry was removed — catch it early.
    expect(canonicalPrefixes.length).toBeGreaterThanOrEqual(12);
  });
});

// =============================================================================
// GROUP B — FAILING (local-only; MUST FAIL TODAY on .claude/hooks/ deployed copy)
//
// These assert the deployed .claude/hooks/pre-edit-write-guard.sh is missing
// the 5 entries. They are written as "should contain X" assertions so that
// once dev syncs the file, they flip to green — no test edits required.
//
// To run: LOCAL_ONLY_TESTS=1 npx vitest run src/hooks/pre-edit-write-guard-sync.test.ts
// =============================================================================

describe("WS-SYNC-01 — misuse: deployed .claude/hooks/pre-edit-write-guard.sh is missing PROTECTED_PREFIXES (FAILS NOW — LOCAL_ONLY_TESTS required)", () => {
  // Read the deployed (gitignored) script for this group.
  let deployedPrefixes: string[];
  try {
    deployedPrefixes = parseProtectedPrefixes(fs.readFileSync(DEPLOYED_GUARD, "utf8"));
  } catch {
    deployedPrefixes = [];
  }

  itLocal(
    "deployed .claude/hooks/pre-edit-write-guard.sh contains 'package.json' in PROTECTED_PREFIXES (FAILS UNTIL SYNCED)",
    () => {
      // BUG: .claude/hooks/pre-edit-write-guard.sh PROTECTED_PREFIXES stops at
      // "packages" — the 5 config-file entries are absent. This test FAILS until
      // dev copies those entries from hooks/pre-edit-write-guard.sh.
      expect(deployedPrefixes).toContain("package.json");
    }
  );

  itLocal(
    "deployed .claude/hooks/pre-edit-write-guard.sh contains 'tsconfig.json' in PROTECTED_PREFIXES (FAILS UNTIL SYNCED)",
    () => {
      expect(deployedPrefixes).toContain("tsconfig.json");
    }
  );

  itLocal(
    "deployed .claude/hooks/pre-edit-write-guard.sh contains 'vitest.config.ts' in PROTECTED_PREFIXES (FAILS UNTIL SYNCED)",
    () => {
      expect(deployedPrefixes).toContain("vitest.config.ts");
    }
  );

  itLocal(
    "deployed .claude/hooks/pre-edit-write-guard.sh contains '.eslintrc' in PROTECTED_PREFIXES (FAILS UNTIL SYNCED)",
    () => {
      expect(deployedPrefixes).toContain(".eslintrc");
    }
  );

  itLocal(
    "deployed .claude/hooks/pre-edit-write-guard.sh contains '.eslintrc.json' in PROTECTED_PREFIXES (FAILS UNTIL SYNCED)",
    () => {
      expect(deployedPrefixes).toContain(".eslintrc.json");
    }
  );

  itLocal(
    "deployed .claude/hooks/pre-edit-write-guard.sh PROTECTED_PREFIXES has at least 13 entries (FAILS UNTIL SYNCED)",
    () => {
      // Deployed file currently has 8 entries (missing the 5 config entries).
      // This fails until dev adds all 5, bringing the count to at least 13.
      expect(deployedPrefixes.length).toBeGreaterThanOrEqual(13);
    }
  );
});

// =============================================================================
// GROUP C — IDENTITY TEST (local-only; MUST FAIL TODAY)
//
// The definitive PASS signal for WS-SYNC-01: deployed == canonical, byte for byte.
// Fails today because the files differ (8 vs 13 PROTECTED_PREFIXES entries).
// Passes after dev syncs .claude/hooks/pre-edit-write-guard.sh to hooks/.
// =============================================================================

describe("WS-SYNC-01 — golden: .claude/hooks/pre-edit-write-guard.sh is byte-for-byte identical to hooks/pre-edit-write-guard.sh (FAILS NOW — LOCAL_ONLY_TESTS required)", () => {
  itLocal(".claude/hooks/pre-edit-write-guard.sh exists on disk (prerequisite for sync)", () => {
    // If the file is absent, the sync has not happened at all.
    expect(fs.existsSync(DEPLOYED_GUARD)).toBe(true);
  });

  itLocal(
    ".claude/hooks/pre-edit-write-guard.sh is byte-for-byte identical to hooks/pre-edit-write-guard.sh (FAILS UNTIL SYNCED)",
    () => {
      // The definitive WS-SYNC-01 acceptance gate.
      // Fails today because .claude/hooks/ has 8 PROTECTED_PREFIXES, canonical has 13.
      // Once dev runs: cp hooks/pre-edit-write-guard.sh .claude/hooks/pre-edit-write-guard.sh
      // (or equivalent), this test passes.
      const canonical = fs.readFileSync(CANONICAL_GUARD);
      const deployed = fs.readFileSync(DEPLOYED_GUARD);
      expect(deployed.equals(canonical)).toBe(true);
    }
  );
});

// =============================================================================
// GROUP D — REGRESSION GUARDS: block-no-verify.sh sync (tracked files only)
//
// block-no-verify.sh is already synced — canonical and deployed are identical.
// These tests assert the canonical file is well-formed and stays that way.
// They must pass today and must continue to pass after WS-SYNC-01 changes.
// =============================================================================

describe("WS-SYNC-01 — regression: hooks/block-no-verify.sh canonical file is well-formed", () => {
  let blockNoVerifyContent: string;
  try {
    blockNoVerifyContent = fs.readFileSync(CANONICAL_BLOCK_NO_VERIFY, "utf8");
  } catch {
    blockNoVerifyContent = "";
  }

  it("canonical hooks/block-no-verify.sh exists", () => {
    expect(fs.existsSync(CANONICAL_BLOCK_NO_VERIFY)).toBe(true);
  });

  it("canonical hooks/block-no-verify.sh has shebang #!/usr/bin/env bash", () => {
    expect(blockNoVerifyContent.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("canonical hooks/block-no-verify.sh contains --no-verify blocking logic", () => {
    expect(blockNoVerifyContent).toContain("--no-verify");
  });

  it("canonical hooks/block-no-verify.sh contains core.hooksPath blocking logic", () => {
    // Added during WS-HOOKS-02 — must not be accidentally removed.
    expect(blockNoVerifyContent).toContain("core.hooksPath");
  });
});

describe("WS-SYNC-01 — regression: .claude/hooks/block-no-verify.sh is identical to canonical (LOCAL_ONLY_TESTS required)", () => {
  itLocal(
    ".claude/hooks/block-no-verify.sh is byte-for-byte identical to hooks/block-no-verify.sh",
    () => {
      // block-no-verify.sh is already correctly synced (no diff found during WS-SYNC-01 analysis).
      // This test guards against future accidental drift — must pass today and after the WS.
      const canonical = fs.readFileSync(CANONICAL_BLOCK_NO_VERIFY);
      const deployed = fs.readFileSync(DEPLOYED_BLOCK_NO_VERIFY);
      expect(deployed.equals(canonical)).toBe(true);
    }
  );
});

// =============================================================================
// GROUP E — BOUNDARY: PROTECTED_PREFIXES structural validity (canonical; tracked)
// =============================================================================

describe("WS-SYNC-01 — boundary: hooks/pre-edit-write-guard.sh PROTECTED_PREFIXES structure", () => {
  let prefixes: string[];
  try {
    prefixes = parseProtectedPrefixes(fs.readFileSync(CANONICAL_GUARD, "utf8"));
  } catch {
    prefixes = [];
  }

  it("canonical PROTECTED_PREFIXES contains no empty strings", () => {
    // An empty string in the allowlist would prefix-match every path — a guard-bypass.
    const empty = prefixes.filter((p) => p.trim() === "");
    expect(empty).toEqual([]);
  });

  it("canonical PROTECTED_PREFIXES contains no entries with path traversal (../)", () => {
    // Path traversal in the allowlist entries is not a protection entry — it is a bug.
    const traversal = prefixes.filter((p) => p.includes("../"));
    expect(traversal).toEqual([]);
  });

  it("canonical PROTECTED_PREFIXES contains the core infrastructure paths (.claude/scripts, .claude/hooks, .claude/shared, docs, src, packages)", () => {
    // These 6 entries form the base allowlist that existed before WS-SYNC-01.
    // Verify they remain present alongside the 5 new config entries.
    const required = [
      ".claude/scripts",
      ".claude/hooks",
      ".claude/shared",
      "docs",
      "src",
      "packages",
    ];
    for (const entry of required) {
      expect(prefixes, `entry "${entry}" must remain in PROTECTED_PREFIXES`).toContain(entry);
    }
  });

  it("canonical PROTECTED_PREFIXES PROTECTED_PREFIXES block is parseable (contains at least one entry)", () => {
    expect(prefixes.length).toBeGreaterThan(0);
  });
});
