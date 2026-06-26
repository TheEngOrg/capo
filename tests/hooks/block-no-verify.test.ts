// WS-SEC-02 — passing (post-impl, CAD gate 2)

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as path from "node:path";

// =============================================================================
// block-no-verify.test.ts — tests for hooks/block-no-verify.sh
//
// WS-SEC-02 Fracture B: extend block-no-verify.sh to also block:
//   - git commit -n            (short form of --no-verify)
//   - git config core.hooksPath (overrides the hooks dir, bypassing all hooks)
//
// Current state: the script blocks --no-verify and --no-gpg-sign / -c
// commit.gpgsign=false. The -n and core.hooksPath patterns are NOT yet blocked.
// Tests for those patterns will FAIL until dev extends the script.
//
// Ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
//
// HOW THE SCRIPT IS INVOKED
//   Claude Code passes tool input as JSON on stdin. The script reads it via
//   `cat`, extracts `.tool_input.command` via jq, then checks for blocked flags.
//   We replicate this by piping a JSON payload into the script via stdin.
//   Exit code 2 = blocked. Exit code 0 = allowed.
// =============================================================================

const SCRIPT = path.join(__dirname, "../../src/plugin/hooks/block-no-verify.sh");

/**
 * Build the JSON payload that Claude Code's PreToolUse hook receives.
 * The script extracts `.tool_input.command` from this structure.
 */
function makePayload(command: string): string {
  return JSON.stringify({ tool_input: { command } });
}

/**
 * Run the hook script with the given command string as the tool input.
 * Returns the exit code (0 = allowed, 2 = blocked).
 * Never throws — we capture the exit code explicitly.
 */
function runHook(command: string): number {
  try {
    execSync(`echo '${makePayload(command).replace(/'/g, "'\\''")}' | bash "${SCRIPT}"`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return 0;
  } catch (err: unknown) {
    const e = err as { status?: number };
    return e.status ?? 1;
  }
}

// =============================================================================
// MISUSE — commands that MUST be blocked (exit 2)
// =============================================================================

// WS-SEC-04: absolute git path bypass — implementation complete.
// The script normalizes absolute git paths to `git` before running flag checks.
describe("block-no-verify.sh — WS-SEC-04: absolute git path bypass must be blocked", () => {
  it("blocks: /usr/bin/git commit -n (absolute path short-form bypass)", () => {
    // Currently exits 0 — the regex sees `/usr/bin/git`, not `git`, so it passes.
    // After fix: normalize `/usr/bin/git` → `git` before regex; must exit 2.
    expect(runHook("/usr/bin/git commit -n")).toBe(2);
  });

  it("blocks: /usr/bin/git commit --no-verify (absolute path long-form bypass)", () => {
    // Currently exits 0. The `(^|[[:space:]])git[[:space:]]` anchor does not match
    // a command that starts with `/usr/bin/git`.
    expect(runHook("/usr/bin/git commit --no-verify")).toBe(2);
  });

  it("blocks: /usr/bin/git config core.hooksPath /dev/null (absolute path hooksPath bypass)", () => {
    // Currently exits 0. Routing all hooks to /dev/null via absolute-path git
    // is a full bypass vector that the current script misses.
    expect(runHook("/usr/bin/git config core.hooksPath /dev/null")).toBe(2);
  });

  it("blocks: /usr/local/bin/git commit --no-verify (/usr/local/bin variant)", () => {
    // Common on systems where git is installed via package manager to /usr/local/bin.
    expect(runHook("/usr/local/bin/git commit --no-verify")).toBe(2);
  });

  it("blocks: /opt/homebrew/bin/git commit --no-verify (Homebrew macOS path)", () => {
    // macOS Homebrew installs git to /opt/homebrew/bin/git — another absolute-path
    // bypass vector on developer machines.
    expect(runHook("/opt/homebrew/bin/git commit --no-verify")).toBe(2);
  });

  // --- Regression guards: these must pass through (exit 0) even after the fix ---

  it("allows: git log -n 5 (the -n flag means 'number of commits', not --no-verify) [must stay 0]", () => {
    // The -n block is scoped to `git commit` only. `git log -n 5` must never be
    // blocked. This is a regression guard against over-broad normalization.
    expect(runHook("git log -n 5")).toBe(0);
  });

  it("allows: /usr/bin/git log -n 5 (absolute path log with count flag must pass through) [must stay 0]", () => {
    // After normalization, `/usr/bin/git log -n 5` becomes `git log -n 5`.
    // The -n commit-block must not fire on log subcommand — same guard as above
    // but exercising the normalization path explicitly.
    expect(runHook("/usr/bin/git log -n 5")).toBe(0);
  });
});

describe("block-no-verify.sh — misuse: git commit -n must be blocked (WS-SEC-02)", () => {
  it("blocks: git commit -n (bare short form)", () => {
    // FAILS until dev adds -n detection to the script.
    // git commit -n is the documented short alias for --no-verify.
    expect(runHook("git commit -n")).toBe(2);
  });

  it("blocks: git commit -n -m 'msg' (short form with message)", () => {
    // FAILS until dev adds -n detection to the script.
    // -n as a flag preceding the message is equivalent to --no-verify.
    expect(runHook("git commit -n -m 'msg'")).toBe(2);
  });

  it("blocks: git commit -am 'msg' -n (short form after message flag)", () => {
    // FAILS until dev adds -n detection to the script.
    // Flag order variations — -n may appear in any position.
    expect(runHook("git commit -am 'msg' -n")).toBe(2);
  });

  it("blocks: git config core.hooksPath /custom (overrides hooks dir)", () => {
    // FAILS until dev adds core.hooksPath detection to the script.
    // Setting core.hooksPath redirects git to a different hooks directory,
    // bypassing all hook enforcement. This is a full-bypass attack vector.
    expect(runHook("git config core.hooksPath /custom/hooks")).toBe(2);
  });

  it("blocks: git config --global core.hooksPath /tmp/hooks (global form)", () => {
    // FAILS until dev adds core.hooksPath detection to the script.
    // --global is even more dangerous — it persists across all repos.
    expect(runHook("git config --global core.hooksPath /tmp/hooks")).toBe(2);
  });

  it("blocks: git config --local core.hooksPath .git/safe-hooks (local form)", () => {
    // FAILS until dev adds core.hooksPath detection to the script.
    // --local is the default scope — still a bypass.
    expect(runHook("git config --local core.hooksPath .git/safe-hooks")).toBe(2);
  });

  it("blocks: git config core.hooksPath '' (empty-string clears hooks dir)", () => {
    // FAILS until dev adds core.hooksPath detection to the script.
    // Setting core.hooksPath to an empty string effectively disables all hooks.
    expect(runHook("git config core.hooksPath ''")).toBe(2);
  });
});

describe("block-no-verify.sh — misuse: existing blocked patterns still blocked (regression)", () => {
  it("still blocks: git commit --no-verify (long form)", () => {
    // This must continue to pass after WS-SEC-02 changes.
    expect(runHook("git commit --no-verify")).toBe(2);
  });

  it("still blocks: git commit --no-verify -m 'refactor: skip hooks'", () => {
    expect(runHook("git commit --no-verify -m 'refactor: skip hooks'")).toBe(2);
  });

  it("still blocks: git commit --no-gpg-sign", () => {
    expect(runHook("git commit --no-gpg-sign")).toBe(2);
  });

  it("still blocks: git commit -c commit.gpgsign=false", () => {
    expect(runHook("git commit -c commit.gpgsign=false")).toBe(2);
  });
});

// =============================================================================
// BOUNDARY — edge cases that must NOT be blocked
// =============================================================================

describe("block-no-verify.sh — boundary: -n inside quoted message must NOT be blocked", () => {
  it("allows: git commit -m '-n is not a flag' (flag lookalike inside message)", () => {
    // The script strips quoted strings before checking for flags.
    // After stripping the quoted message, "-n" is gone and must not trigger.
    // This tests the quote-strip logic against short-form flags.
    expect(runHook(`git commit -m "-n is not a flag"`)).toBe(0);
  });

  it("allows: git commit -m 'use -n for dry-run' (single-quoted)", () => {
    // Single-quoted strings must also be stripped before flag detection.
    expect(runHook(`git commit -m 'use -n for dry-run'`)).toBe(0);
  });

  it("allows: git commit -m 'see core.hooksPath docs' (config key in message)", () => {
    // core.hooksPath appearing only inside a commit message must not be blocked.
    // The intent check must operate on the unquoted portion of the command only.
    expect(runHook(`git commit -m 'see core.hooksPath docs'`)).toBe(0);
  });
});

describe("block-no-verify.sh — boundary: -n in non-git commands must not be blocked", () => {
  it("allows: echo -n hello (non-git command with -n flag)", () => {
    // -n must only be blocked when it is a git commit flag,
    // not when it appears on unrelated commands.
    expect(runHook("echo -n hello")).toBe(0);
  });

  it("allows: grep -n pattern file.txt (grep's line-number flag)", () => {
    expect(runHook("grep -n pattern file.txt")).toBe(0);
  });
});

// =============================================================================
// GOLDEN PATH — commands that must pass through (exit 0)
// =============================================================================

describe("block-no-verify.sh — golden path: allowed git commands pass through", () => {
  it("allows: git commit -m 'valid commit message'", () => {
    expect(runHook("git commit -m 'valid commit message'")).toBe(0);
  });

  it("allows: git commit -m 'feat: add feature' --signoff", () => {
    // --signoff is a legitimate flag, not a bypass.
    expect(runHook("git commit -m 'feat: add feature' --signoff")).toBe(0);
  });

  it("allows: git push origin main", () => {
    expect(runHook("git push origin main")).toBe(0);
  });

  it("allows: git status", () => {
    expect(runHook("git status")).toBe(0);
  });

  it("allows: git config user.email brodie@example.com (non-hookspath config)", () => {
    // git config is not blocked in general — only core.hooksPath is the attack vector.
    expect(runHook("git config user.email brodie@example.com")).toBe(0);
  });

  it("allows: git config core.autocrlf input (unrelated core. config key)", () => {
    // Only core.hooksPath must be blocked — other core.* keys are allowed.
    expect(runHook("git config core.autocrlf input")).toBe(0);
  });

  it("allows: git config --list (read-only config listing)", () => {
    // Listing all config is read-only and must never be blocked.
    expect(runHook("git config --list")).toBe(0);
  });

  it("allows: git log --oneline -n 10 (log flag that happens to include -n)", () => {
    // git log -n <number> means "show N commits" — it is not a verify-bypass flag.
    // The block must be scoped to git commit -n only, not all git subcommands.
    expect(runHook("git log --oneline -n 10")).toBe(0);
  });
});
