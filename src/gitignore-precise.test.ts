/**
 * fix/ws-gitignore-precise — QA spec
 *
 * Validates three precise .gitignore changes:
 *   AC-1  .claude/agent-memory-local/ is explicitly in repo .gitignore
 *   AC-2  .claude/settings.local.json is explicitly in repo .gitignore
 *   AC-3  HANDOFF pattern is root-anchored (/HANDOFF-*.md) so
 *          .claude/shared/handoff-protocol.md is NOT matched
 *   AC-4  Root-level HANDOFF files (e.g. HANDOFF-2026-06-24.md) ARE
 *          still matched after the anchor is applied (regression guard)
 *
 * Test ordering: misuse/negative paths first, then golden-path.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolve worktree root relative to this test file so no /tmp or /Users literals
// appear in committed code. process.cwd() in vitest is the project root.
const REPO_ROOT = process.cwd();
const GITIGNORE_PATH = resolve(REPO_ROOT, ".gitignore");

/**
 * Run `git check-ignore` for the given path and return the exit code.
 * Exit 0 = path IS ignored; exit 1 = path is NOT ignored.
 *
 * noIndex: pass true to use --no-index, which tests the pattern against the
 * path name regardless of whether the file is tracked in the index. Required
 * for AC-4 where the HANDOFF files are already committed/tracked — git
 * check-ignore skips tracked files without --no-index.
 */
function gitCheckIgnoreExitCode(
  repoRelativePath: string,
  noIndex = false,
): number {
  const flag = noIndex ? "--no-index" : "";
  try {
    execSync(`git check-ignore --quiet ${flag} "${repoRelativePath}"`, {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
    return 0;
  } catch (err: unknown) {
    const spawnErr = err as { status?: number };
    return spawnErr.status ?? 1;
  }
}

/**
 * Return the source file that matched the given path via git check-ignore -v.
 * Returns an empty string if the path is not ignored.
 * We parse the first field (source:line:pattern) from the verbose output.
 *
 * noIndex: pass true to use --no-index (see gitCheckIgnoreExitCode).
 */
function gitCheckIgnoreSource(
  repoRelativePath: string,
  noIndex = false,
): string {
  const flag = noIndex ? "--no-index" : "";
  try {
    const output = execSync(
      `git check-ignore -v ${flag} "${repoRelativePath}"`,
      {
        cwd: REPO_ROOT,
        stdio: "pipe",
      },
    ).toString();
    // Format: <source>:<linenum>:<pattern>\t<pathname>
    return output.trim().split(":")[0] ?? "";
  } catch {
    return "";
  }
}

describe("fix/ws-gitignore-precise", () => {
  // ------------------------------------------------------------------
  // AC-3 (misuse / negative path first): unanchored HANDOFF-*.md must NOT
  // match files inside .claude/shared/ — the bug we are fixing.
  // ------------------------------------------------------------------
  describe("AC-3: HANDOFF pattern is root-anchored (misuse/negative)", () => {
    it("does NOT match .claude/shared/handoff-protocol.md via any ignore rule", () => {
      // Post-fix: this path must be completely unignored.
      const exitCode = gitCheckIgnoreExitCode(
        ".claude/shared/handoff-protocol.md",
      );
      expect(exitCode).toBe(1); // 1 = not ignored
    });

    it(".gitignore does NOT contain an unanchored HANDOFF-*.md pattern", () => {
      const content = readFileSync(GITIGNORE_PATH, "utf-8");
      // The bare pattern (no leading slash) must not appear.
      // We check each line so we don't false-positive on a comment.
      const lines = content.split("\n");
      const unanchoredLine = lines.find(
        (line) =>
          line.trim() === "HANDOFF-*.md" || line.trim() === "HANDOFF*.md",
      );
      expect(unanchoredLine).toBeUndefined();
    });

    it(".gitignore DOES contain the anchored /HANDOFF-*.md pattern", () => {
      const content = readFileSync(GITIGNORE_PATH, "utf-8");
      const lines = content.split("\n");
      const anchoredLine = lines.find((line) => line.trim() === "/HANDOFF-*.md");
      expect(anchoredLine).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // AC-4 (regression guard): anchored pattern must still match root-level
  // HANDOFF files — confirming the fix didn't break the intended coverage.
  //
  // We use --no-index here because HANDOFF-*.md files are committed/tracked
  // in this worktree. git check-ignore silently skips tracked files without
  // --no-index, making exit code 1 for any tracked path regardless of pattern.
  // --no-index tests the pattern match directly, which is what AC-4 needs.
  // ------------------------------------------------------------------
  describe("AC-4: root-level HANDOFF files are still ignored (regression guard)", () => {
    it("HANDOFF-2026-06-24.md at repo root IS matched by .gitignore (--no-index)", () => {
      const exitCode = gitCheckIgnoreExitCode("HANDOFF-2026-06-24.md", true);
      expect(exitCode).toBe(0); // 0 = ignored
    });

    it("HANDOFF.md at repo root IS matched by .gitignore (--no-index)", () => {
      const exitCode = gitCheckIgnoreExitCode("HANDOFF.md", true);
      expect(exitCode).toBe(0); // 0 = ignored (separate HANDOFF.md pattern)
    });

    it("the rule matching HANDOFF-2026-06-24.md comes from .gitignore, not global config (--no-index)", () => {
      const source = gitCheckIgnoreSource("HANDOFF-2026-06-24.md", true);
      // Source path ends with ".gitignore" (the repo-local file), NOT a global path
      expect(source).toMatch(/\.gitignore$/);
    });
  });

  // ------------------------------------------------------------------
  // AC-1: .claude/agent-memory-local/ must be in the repo .gitignore
  // ------------------------------------------------------------------
  describe("AC-1: .claude/agent-memory-local/ is in repo .gitignore", () => {
    it(".gitignore file content includes .claude/agent-memory-local/ entry", () => {
      const content = readFileSync(GITIGNORE_PATH, "utf-8");
      // Must appear as its own line (with or without trailing slash variant)
      expect(content).toContain(".claude/agent-memory-local/");
    });

    it("the rule matching .claude/agent-memory-local/ comes from .gitignore, not .git/info/exclude or global config", () => {
      const source = gitCheckIgnoreSource(".claude/agent-memory-local/");
      // Source must be the repo .gitignore, not the per-repo exclude or user global config.
      // Per-repo excludes resolve to an absolute path containing ".git/info/exclude".
      // Global config resolves to a path NOT ending in ".gitignore".
      expect(source).toMatch(/\.gitignore$/);
    });

    it(".claude/agent-memory-local/ IS ignored (exit 0) after rule is added", () => {
      const exitCode = gitCheckIgnoreExitCode(".claude/agent-memory-local/");
      expect(exitCode).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  // AC-2: .claude/settings.local.json must be in the repo .gitignore
  // ------------------------------------------------------------------
  describe("AC-2: .claude/settings.local.json is in repo .gitignore", () => {
    it(".gitignore file content includes .claude/settings.local.json entry", () => {
      const content = readFileSync(GITIGNORE_PATH, "utf-8");
      expect(content).toContain(".claude/settings.local.json");
    });

    it("the rule matching .claude/settings.local.json comes from .gitignore, not global git config", () => {
      const source = gitCheckIgnoreSource(".claude/settings.local.json");
      // Must be .gitignore, not ~/.config/git/ignore or similar.
      expect(source).toMatch(/\.gitignore$/);
    });

    it(".claude/settings.local.json IS ignored (exit 0) after rule is added", () => {
      const exitCode = gitCheckIgnoreExitCode(".claude/settings.local.json");
      expect(exitCode).toBe(0);
    });
  });
});
