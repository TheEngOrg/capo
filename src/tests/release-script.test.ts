// src/tests/release-script.test.ts
// WS-RELEASE-SCRIPT — Gate 1 QA spec (pre-impl)
// Status: passing — implementation complete (WS-RELEASE-SCRIPT)
//
// PURPOSE
//   Structural assertions on scripts/release.sh and the package.json "release"
//   script entry. Tests do NOT execute the script. They read source with
//   fs.readFileSync and assert required behaviors via string/pattern checks.
//
// DESIGN
//   - No subprocess execution. No mocks. Pure fs.readFileSync + string search.
//   - All paths are absolute, derived from REPO_ROOT at test-run time.
//   - Wrapped in describe.skip — stays green (pending) until implementation exists.
//
// ORDERING: misuse → boundary → golden path (ADR-064 critical-path policy)
// TOOL: vitest. node:fs + node:path only.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE_SCRIPT = path.join(REPO_ROOT, "scripts", "release.sh");
const PACKAGE_JSON = path.join(REPO_ROOT, "package.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read scripts/release.sh as a string. Throws if the file does not exist. */
function readScript(): string {
  return fs.readFileSync(RELEASE_SCRIPT, "utf8");
}

/** Read package.json, parse it, and return the parsed object. */
function readPackageJson(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8")) as Record<string, unknown>;
}

// =============================================================================
// MISUSE — things that must NOT be true / guards that must be present
// =============================================================================

describe("release-script — misuse: required guards must exist in the script source", () => {
  it("script must reject a missing version argument — source must contain a $1 empty-check guard", () => {
    // If $1 is not checked, a bare `bash scripts/release.sh` would proceed with
    // an empty VERSION variable, creating a tag named "v" and corrupting the repo.
    const src = readScript();
    // Guard forms: [ -z "$1" ], [ "$1" = "" ], ${1:?...}, -z "${1}", etc.
    const hasMissingArgGuard =
      src.includes('[ -z "$1"') ||
      src.includes('[ -z "${1}') ||
      src.includes('[ -z "${VERSION}') ||
      src.includes("${1:?") ||
      src.includes('[ "$1" = ""');
    expect(
      hasMissingArgGuard,
      'release.sh must guard against a missing $1 version argument (e.g. [ -z "$1" ])'
    ).toBe(true);
  });

  it("script must reject a malformed version — source must contain an X.Y.Z pattern check", () => {
    // Without format validation, a caller passing "v1.0.3" or "latest" would
    // create a malformed tag or fail silently during the push step.
    const src = readScript();
    // Acceptable patterns: grep/=~ regex matching digits.digits.digits
    const hasFormatGuard =
      src.includes("[0-9]") ||
      src.includes("[[:digit:]]") ||
      src.match(/\^?\\?d\+\\.\\?d\+\\.\\?d\+\$?/) !== null ||
      src.includes("^[0-9]") ||
      src.includes("^[[:digit:]]") ||
      src.match(/\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/) !== null ||
      src.match(/\^\[0-9\]/) !== null ||
      // bash =~ regex check for semver
      src.match(/=~.*[0-9].*\.[0-9].*\.[0-9]/) !== null ||
      src.match(/=~.*\\d/) !== null;
    expect(
      hasFormatGuard,
      "release.sh must validate that $VERSION matches an X.Y.Z (digits-only) pattern before proceeding"
    ).toBe(true);
  });

  it("script must reject an already-existing tag — source must check git tag -l output", () => {
    // If the tag already exists, `git tag -a` will fail with a non-zero exit but
    // by then the commit and push may have already happened. The guard must come
    // before any mutating steps.
    const src = readScript();
    expect(
      src.includes("git tag -l"),
      'release.sh must check "git tag -l" to detect a pre-existing tag before creating a new one'
    ).toBe(true);
  });

  it("script must NOT proceed on a dirty working tree — source must check git status --porcelain", () => {
    // A dirty tree means the version bump commit would silently bundle unrelated
    // staged changes into the release commit.
    const src = readScript();
    expect(
      src.includes("git status --porcelain"),
      'release.sh must run "git status --porcelain" and exit if the tree is not clean'
    ).toBe(true);
  });

  it("script must NOT proceed when not on main — source must check the current branch", () => {
    // Tagging and pushing from a feature branch would push a release tag that
    // doesn't reflect main, breaking the delivery contract.
    const src = readScript();
    // Acceptable checks: git branch --show-current, git rev-parse --abbrev-ref HEAD,
    // $GITHUB_REF, etc. All must mention "main" somewhere nearby.
    const hasBranchCheck =
      src.includes("git branch --show-current") ||
      src.includes("git rev-parse --abbrev-ref HEAD") ||
      src.includes("git symbolic-ref") ||
      src.includes("$(git branch");
    expect(
      hasBranchCheck,
      "release.sh must check that the current branch is main before proceeding"
    ).toBe(true);
  });

  it("script must reference 'main' as the required branch name in its branch guard", () => {
    const src = readScript();
    // The guard must specifically name "main" — not just detect "any branch" check.
    expect(
      src.includes('"main"') || src.includes("= main") || src.includes("!= main"),
      'release.sh branch guard must reference the string "main" as the required branch'
    ).toBe(true);
  });
});

// =============================================================================
// BOUNDARY — file existence, execute permissions, and edge-case behaviors
// =============================================================================

describe("release-script — boundary: file existence and execute permissions", () => {
  it("scripts/release.sh exists on disk", () => {
    expect(
      fs.existsSync(RELEASE_SCRIPT),
      "scripts/release.sh does not exist — implementation not yet written"
    ).toBe(true);
  });

  it("scripts/release.sh has execute permission set (mode includes 0o111)", () => {
    // A script that exists but is not executable will fail with EACCES when
    // bash tries to run it directly. The execute bit must be set.
    const mode = fs.statSync(RELEASE_SCRIPT).mode;
    expect(
      mode & 0o111,
      `scripts/release.sh mode ${(mode & 0o777).toString(8)} does not include execute bits — run chmod +x scripts/release.sh`
    ).toBeGreaterThan(0);
  });

  it("scripts/release.sh must guard exit on any step failure — source must contain 'set -e' or equivalent", () => {
    // Without set -e or explicit error checks after each command, the script
    // will continue executing past a failed npm run bundle / test:cov / typecheck,
    // silently creating a release tag from broken code.
    const src = readScript();
    const hasExitOnError =
      src.includes("set -e") || src.includes("set -euo pipefail") || src.includes("set -eu");
    expect(
      hasExitOnError,
      "release.sh must include 'set -e' (or equivalent) to halt on any step failure"
    ).toBe(true);
  });

  it("package.json exists at the expected path", () => {
    expect(fs.existsSync(PACKAGE_JSON), `package.json not found at ${PACKAGE_JSON}`).toBe(true);
  });

  it("package.json is valid JSON", () => {
    expect(() => readPackageJson()).not.toThrow();
  });
});

// =============================================================================
// GOLDEN PATH — all required behaviors must be present in the script source
// =============================================================================

describe("release-script — golden: package.json version bump is present", () => {
  it("script source references package.json version field update", () => {
    // The bumping mechanism (jq, sed, node -e, etc.) must reference package.json.
    const src = readScript();
    expect(
      src.includes("package.json"),
      "release.sh must reference package.json when bumping the version field"
    ).toBe(true);
  });
});

describe("release-script — golden: plugin.json version bump is present", () => {
  it("script source references .claude-plugin/plugin.json version field update", () => {
    // Both files must be bumped atomically in the same release commit.
    // Missing this bump means the plugin manifest ships an old version number.
    const src = readScript();
    expect(
      src.includes(".claude-plugin/plugin.json"),
      "release.sh must reference .claude-plugin/plugin.json when bumping the version field"
    ).toBe(true);
  });
});

describe("release-script — golden: npm pipeline steps are invoked", () => {
  it("script source contains 'npm run bundle'", () => {
    const src = readScript();
    expect(
      src.includes("npm run bundle"),
      "release.sh must run 'npm run bundle' as part of the release pipeline"
    ).toBe(true);
  });

  it("script source contains 'npm run test:cov'", () => {
    // test:cov (not just test) is required — test alone does not enforce coverage
    // thresholds. This is the exact failure mode from WS-REVOKE-01.
    const src = readScript();
    expect(
      src.includes("npm run test:cov"),
      "release.sh must run 'npm run test:cov' (not just 'npm test') to enforce coverage thresholds"
    ).toBe(true);
  });

  it("script source contains 'npm run typecheck'", () => {
    const src = readScript();
    expect(
      src.includes("npm run typecheck"),
      "release.sh must run 'npm run typecheck' to catch type errors before tagging"
    ).toBe(true);
  });
});

describe("release-script — golden: git operations are present", () => {
  it("script source contains a 'git commit' step for the version bump", () => {
    const src = readScript();
    expect(
      src.includes("git commit"),
      "release.sh must commit the version bump with a git commit step"
    ).toBe(true);
  });

  it("script commit message contains the version bump pattern", () => {
    const src = readScript();
    // The commit message must be consistent so CI/changelog tooling can parse it.
    // Required format: "chore: bump version to v$VERSION"
    const hasCommitMsg =
      src.includes("chore: bump version to v") ||
      src.includes("bump version to v$VERSION") ||
      src.includes('bump version to v${VERSION}"');
    expect(
      hasCommitMsg,
      'release.sh commit message must follow the pattern "chore: bump version to v$VERSION"'
    ).toBe(true);
  });

  it("script source contains 'git tag -a' for an annotated tag", () => {
    // Lightweight tags (git tag v1.0.3) do not carry a message. GitHub releases
    // and many tooling integrations require annotated tags.
    const src = readScript();
    expect(
      src.includes("git tag -a"),
      'release.sh must create an annotated tag with "git tag -a" (not a lightweight tag)'
    ).toBe(true);
  });

  it("script source contains 'git push' for both the commit and the tag", () => {
    const src = readScript();
    // Check for at least one git push — specific push-count is validated by
    // the separate origin+tag push test below.
    expect(
      src.includes("git push"),
      'release.sh must push the release commit and tag with "git push"'
    ).toBe(true);
  });

  it("script pushes origin main AND the version tag — source must reference both", () => {
    const src = readScript();
    // Push of main commit:
    const pushesMain = src.includes("git push origin main") || src.includes("push origin main");
    // Push of the version tag:
    const pushesTag =
      src.includes('git push origin "v$VERSION"') ||
      src.includes("git push origin v$VERSION") ||
      src.includes('git push origin "v${VERSION}"') ||
      src.includes("git push origin v${VERSION}");
    expect(
      pushesMain,
      'release.sh must push the commit to origin main via "git push origin main"'
    ).toBe(true);
    expect(
      pushesTag,
      'release.sh must push the version tag to origin via "git push origin \\"v$VERSION\\""'
    ).toBe(true);
  });
});

describe("release-script — golden: manual gate reminder is printed", () => {
  it("script source prints the verify-plugin-install.sh reminder in an echo/print statement", () => {
    // After pushing, the script must remind the operator to run the real-install
    // gate. Agents cannot run it (requires a live claude plugin install).
    // This reminder must be present — a silent release is a release without a gate.
    const src = readScript();
    expect(
      src.includes("verify-plugin-install.sh"),
      'release.sh must print a reminder containing "verify-plugin-install.sh" as the required manual gate'
    ).toBe(true);
  });

  it("the verify-plugin-install.sh reminder appears inside an echo or printf statement", () => {
    const src = readScript();
    // Check that the reminder is on the same line as echo/printf — not just a comment.
    const lines = src.split("\n");
    const reminderLine = lines.find((l) => l.includes("verify-plugin-install.sh"));
    expect(
      reminderLine,
      "verify-plugin-install.sh was not found in any line of release.sh"
    ).toBeDefined();
    const isInPrintStatement =
      reminderLine !== undefined &&
      (reminderLine.includes("echo") ||
        reminderLine.includes("printf") ||
        reminderLine.includes("print"));
    expect(
      isInPrintStatement,
      `The verify-plugin-install.sh reminder must appear inside an echo/printf statement. Found line: "${reminderLine}"`
    ).toBe(true);
  });
});

describe("release-script — golden: package.json scripts.release entry is present", () => {
  it('package.json scripts.release equals "bash scripts/release.sh"', () => {
    // The npm run release entry must point to the script with the correct invocation.
    // Using 'bash scripts/release.sh' (not './scripts/release.sh') is required for
    // cross-platform consistency and explicit interpreter binding.
    const pkg = readPackageJson();
    const scripts = pkg.scripts as Record<string, string> | undefined;
    expect(scripts, 'package.json must have a "scripts" object').toBeDefined();
    expect(
      scripts?.release,
      "package.json scripts.release must be defined — run npm run release should invoke the script"
    ).toBeDefined();
    expect(scripts?.release).toBe("bash scripts/release.sh");
  });
});
