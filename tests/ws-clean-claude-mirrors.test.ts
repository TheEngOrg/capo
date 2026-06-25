// =============================================================================
// ws-clean-claude-mirrors.test.ts — QA spec for ws-clean-claude-mirrors workstream
//
// WORKSTREAM SUMMARY:
//   PR #71 (ws-delete-mirror) deleted the hand-maintained .claude/agents/,
//   .claude/skills/, and .claude/shared/ mirror directories and added a blanket
//   `.claude` entry to .gitignore to cover the removal.
//
//   The blanket `.claude` rule is too broad: gitignore treats a pattern with no
//   trailing slash as matching BOTH files and directories of that name. This
//   accidentally makes `.claude/settings.json`, `.claude/hooks/`, `.claude/shared/`,
//   `.claude/config/`, `.claude/memory/`, and `.claude/agent-memory-local/`
//   impossible to track in git without `git add -f`. Those paths are legitimate
//   project source/config that should remain trackable.
//
//   This workstream replaces the blanket `.claude` line with precise, scoped entries:
//     .claude/agents/   — plugin install cache (claude plugin install drops files here)
//     .claude/skills/   — plugin install cache (claude plugin install drops dirs here)
//   All other .claude sub-paths become trackable again. The existing specific entries
//   (.claude/memory/traces/, .claude/memory/pipeline/, etc.) are preserved because
//   the blanket that previously covered them is now gone.
//
// WHAT THESE TESTS VERIFY:
//   T-01 (misuse):    .gitignore must NOT contain a bare `.claude` line (blanket rule)
//   T-02 (misuse):    .gitignore must NOT accidentally gitignore .claude/settings.json
//                     — no overly-broad rule should match a file under .claude/
//   T-03 (misuse):    .gitignore must NOT accidentally gitignore .claude/hooks/
//                     — same check for a directory under .claude/
//   T-04 (boundary):  .gitignore MUST contain `.claude/agents/` (with trailing slash)
//   T-05 (boundary):  .gitignore MUST contain `.claude/skills/` (with trailing slash)
//   T-06 (boundary):  .gitignore MUST still contain `.claude/memory/traces/`
//                     — specific entry must be preserved now that the blanket is gone
//   T-07 (golden):    .gitignore MUST still contain `.claude/memory/pipeline/`
//   T-08 (golden):    .gitignore MUST still contain `.claude/agent-memory/`
//   T-09 (golden):    .gitignore must NOT contain `.claude/settings.v4-snapshot.json`
//                     as a specific line — the entry is redundant and should be removed
//                     now that we have precise rules instead of a blanket
//
// IMPLEMENTATION STATUS (all PASSING — post-impl):
//   T-01: PASSES — bare `.claude` line removed; blanket rule no longer present in .gitignore
//   T-02: PASSES — blanket rule removed; `.claude/settings.json` is trackable again
//   T-03: PASSES — blanket rule removed; `.claude/hooks/` is trackable again
//   T-04: PASSES — `.claude/agents/` added as explicit scoped entry (plugin install cache)
//   T-05: PASSES — `.claude/skills/` added as explicit scoped entry (plugin install cache)
//   T-06: PASSES — `.claude/memory/traces/` preserved as a specific entry
//   T-07: PASSES — `.claude/memory/pipeline/` preserved as a specific entry
//   T-08: PASSES — `.claude/agent-memory/` preserved as a specific entry
//   T-09: PASSES — `.claude/settings.v4-snapshot.json` line removed from .gitignore
//
// Test order: misuse-first → boundary → golden-path  (QA ADR-064 policy)
// All tests wrapped in describe.skip — standard QA pre-impl pattern for this repo.
// Remove skip when dev signals implementation complete.
// =============================================================================

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Path resolution — always from repo root; never hardcoded /tmp or /Users
// This file lives at tests/ws-clean-claude-mirrors.test.ts.
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, "..");

const GITIGNORE_PATH = path.join(REPO_ROOT, ".gitignore");

// ---------------------------------------------------------------------------
// Helper: parse .gitignore lines into an array of non-comment, non-blank patterns.
// Preserves trailing-slash semantics as-is (e.g. ".claude/agents/" stays whole).
// ---------------------------------------------------------------------------
function readGitignoreLines(): string[] {
  const content = fs.readFileSync(GITIGNORE_PATH, "utf8");
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

// ---------------------------------------------------------------------------
// Helper: returns true if ANY .gitignore pattern would match `filePath` under
// the semantics relevant to the blanket `.claude` rule.
//
// Gitignore matching rules for the blanket `.claude` pattern (no slash):
//   - A pattern with NO slash matches the file/dir name anywhere in the tree.
//   - `.claude` (no trailing slash) matches both a file named ".claude" AND a
//     directory named ".claude" — and when a directory matches, git ignores
//     everything inside it, making .claude/settings.json, .claude/hooks/, etc.
//     all untrackable.
//
// This helper checks whether any line in .gitignore is a bare `.claude` token
// (i.e., matches the directory as a whole, not a scoped sub-path) so that T-02
// and T-03 can assert no such over-broad rule exists.
// ---------------------------------------------------------------------------
function hasBlanketClaudeRule(lines: string[]): boolean {
  return lines.some((line) => {
    // A blanket rule is one that:
    //   (a) is exactly ".claude" with no trailing slash — matches the dir + all contents
    //   (b) is exactly ".claude/" with trailing slash — same effect: ignores everything inside
    // Both forms make .claude/settings.json untrackable.
    return line === ".claude" || line === ".claude/";
  });
}

// =============================================================================
// T-01 — MISUSE / NEGATIVE-PATH
// .gitignore must NOT contain a bare `.claude` line.
//
// The blanket `.claude` rule (no trailing slash, no sub-path) matches both the
// directory itself and any file at the top level named ".claude". When a directory
// matches, git ignores ALL of its contents — including .claude/settings.json,
// .claude/hooks/, .claude/shared/, and every other legitimate project-config file
// stored under .claude/.
//
// The fix is to replace this blanket with precise, scoped entries for the specific
// plugin-install-cache directories that actually need ignoring (.claude/agents/ and
// .claude/skills/). Everything else under .claude/ becomes trackable again.
// =============================================================================
describe("ws-clean-claude-mirrors", () => {
  describe("T-01 misuse — .gitignore must NOT contain a bare `.claude` blanket rule", () => {
    it("T-01: .gitignore does NOT contain `.claude` as a standalone (non-scoped) line", () => {
      // FAILS NOW:  line 11 of .gitignore is exactly `.claude` — the blanket rule added by
      //             PR #71. This pattern gitignores the entire .claude/ directory tree,
      //             making settings.json, hooks/, etc. untrackable.
      // PASSES AFTER: the `.claude` line is removed and replaced with `.claude/agents/`
      //               and `.claude/skills/` scoped entries.
      const lines = readGitignoreLines();
      const hasBlanket = hasBlanketClaudeRule(lines);
      expect(
        hasBlanket,
        ".gitignore must not contain `.claude` or `.claude/` as a blanket rule — " +
          "these patterns gitignore the entire .claude/ tree including legitimate source files. " +
          "Use `.claude/agents/` and `.claude/skills/` instead."
      ).toBe(false);
    });
  });

  // =============================================================================
  // T-02 — MISUSE / NEGATIVE-PATH
  // .gitignore must NOT accidentally gitignore `.claude/settings.json`.
  //
  // `.claude/settings.json` is a project-config file that should remain trackable.
  // Under the blanket `.claude` rule, git treats the entire .claude/ directory as
  // ignored — so this file cannot be committed without `git add -f`. The test asserts
  // that no line in .gitignore is an over-broad pattern that covers this path.
  //
  // Scope of check: we test for the two forms of the blanket rule identified in T-01.
  // A correctly fixed .gitignore uses `.claude/agents/` and `.claude/skills/` — neither
  // of those patterns matches `.claude/settings.json` because they scope to specific
  // subdirectories with a different name. We do NOT need a full gitignore-rules engine
  // here; the only over-broad rules that could match this file are the blanket forms
  // identified in hasBlanketClaudeRule. Scoped entries like `.claude/memory/traces/`
  // are fine — they cannot match `.claude/settings.json`.
  // =============================================================================
  describe("T-02 misuse — .gitignore must NOT accidentally exclude `.claude/settings.json`", () => {
    it("T-02: no .gitignore pattern matches `.claude/settings.json` via a blanket `.claude` rule", () => {
      // FAILS NOW:  the blanket `.claude` rule (line 11) causes git to ignore the entire
      //             .claude/ directory, which includes .claude/settings.json.
      //             When git sees `.claude` as an ignored directory entry, it stops descending
      //             into it — making .claude/settings.json untrackable.
      // PASSES AFTER: the blanket rule is removed. The precise entries `.claude/agents/`
      //               and `.claude/skills/` do not match `.claude/settings.json`.
      const lines = readGitignoreLines();
      const hasBlanket = hasBlanketClaudeRule(lines);
      expect(
        hasBlanket,
        "`.claude/settings.json` is a trackable project-config file, but a blanket `.claude` " +
          "rule in .gitignore makes it untrackable. Remove the blanket and use scoped entries " +
          "`.claude/agents/` and `.claude/skills/` for the plugin install cache only."
      ).toBe(false);
    });
  });

  // =============================================================================
  // T-03 — MISUSE / NEGATIVE-PATH
  // .gitignore must NOT accidentally gitignore `.claude/hooks/`.
  //
  // `.claude/hooks/` may contain project hook scripts that a team wants to track.
  // The blanket `.claude` rule ignores the parent directory, preventing any file
  // inside .claude/ — including hooks — from being committed. Same root cause as
  // T-02; tested separately because it covers a directory path (not a file path)
  // which exercises the directory-matching branch of gitignore semantics.
  // =============================================================================
  describe("T-03 misuse — .gitignore must NOT accidentally exclude `.claude/hooks/`", () => {
    it("T-03: no .gitignore pattern matches `.claude/hooks/` via a blanket `.claude` rule", () => {
      // FAILS NOW:  the blanket `.claude` rule ignores the .claude/ parent directory,
      //             which transitively ignores .claude/hooks/ and all its contents.
      // PASSES AFTER: blanket rule removed; `.claude/agents/` and `.claude/skills/`
      //               are scoped entries that do not affect `.claude/hooks/`.
      const lines = readGitignoreLines();
      const hasBlanket = hasBlanketClaudeRule(lines);
      expect(
        hasBlanket,
        "`.claude/hooks/` is a trackable project-config directory, but a blanket `.claude` " +
          "rule in .gitignore makes it and its contents untrackable. Remove the blanket."
      ).toBe(false);
    });
  });

  // =============================================================================
  // T-04 — BOUNDARY
  // .gitignore MUST contain `.claude/agents/` with a trailing slash.
  //
  // `.claude/agents/` is where `claude plugin install` drops installed agent .md files.
  // This is plugin install cache — generated, not authored — and must never be committed.
  // The trailing slash is required: without it, `.claude/agents` would match a FILE named
  // "agents" in the .claude/ directory (which is not the intent). The trailing slash
  // scopes the rule strictly to the directory.
  //
  // Before PR #71, this was implicitly covered by the blanket `.claude` rule. After
  // the blanket is removed, an explicit `.claude/agents/` entry is required.
  // =============================================================================
  describe("T-04 boundary — .gitignore MUST contain `.claude/agents/` (plugin install cache)", () => {
    it("T-04: .gitignore contains `.claude/agents/` as an exact line (with trailing slash)", () => {
      // FAILS NOW:  `.claude/agents/` is NOT in .gitignore as a specific line; it was covered
      //             only by the blanket `.claude` rule which is being removed.
      // PASSES AFTER: `.claude/agents/` is added as an explicit entry to replace the blanket.
      const lines = readGitignoreLines();
      expect(
        lines,
        ".gitignore must contain `.claude/agents/` (with trailing slash) to ignore the plugin " +
          "agent install cache. Add it as an explicit entry when removing the blanket `.claude` rule."
      ).toContain(".claude/agents/");
    });
  });

  // =============================================================================
  // T-05 — BOUNDARY
  // .gitignore MUST contain `.claude/skills/` with a trailing slash.
  //
  // `.claude/skills/` is where `claude plugin install` drops installed skill directories.
  // Same rationale as T-04 — generated plugin install cache, not authored source. The
  // trailing slash is required to scope the rule to the directory only (not a hypothetical
  // file named "skills" under .claude/).
  // =============================================================================
  describe("T-05 boundary — .gitignore MUST contain `.claude/skills/` (plugin install cache)", () => {
    it("T-05: .gitignore contains `.claude/skills/` as an exact line (with trailing slash)", () => {
      // FAILS NOW:  `.claude/skills/` is NOT in .gitignore as a specific line; it was covered
      //             only by the blanket `.claude` rule which is being removed.
      // PASSES AFTER: `.claude/skills/` is added as an explicit entry to replace the blanket.
      const lines = readGitignoreLines();
      expect(
        lines,
        ".gitignore must contain `.claude/skills/` (with trailing slash) to ignore the plugin " +
          "skill install cache. Add it as an explicit entry when removing the blanket `.claude` rule."
      ).toContain(".claude/skills/");
    });
  });

  // =============================================================================
  // T-06 — BOUNDARY
  // .gitignore MUST still contain `.claude/memory/traces/`.
  //
  // This specific entry was already in .gitignore before PR #71 (line 25). When the
  // blanket `.claude` rule was added, it became redundant — but now that the blanket
  // is being removed, this entry is load-bearing again. Without it, .claude/memory/traces/
  // (session-local runtime traces) would become trackable and could be accidentally committed.
  //
  // This test verifies the specific entry is preserved during the cleanup — it must not
  // be accidentally deleted when dev removes the blanket line.
  // =============================================================================
  describe("T-06 boundary — .gitignore MUST still contain `.claude/memory/traces/`", () => {
    it("T-06: .gitignore contains `.claude/memory/traces/` (specific entry preserved)", () => {
      // PASSES NOW:  `.claude/memory/traces/` is already present on line 25.
      // MUST CONTINUE TO PASS AFTER: this entry becomes load-bearing once the blanket `.claude`
      //   rule is removed. Dev must NOT delete it during the cleanup.
      const lines = readGitignoreLines();
      expect(
        lines,
        ".gitignore must contain `.claude/memory/traces/` — this specific entry becomes " +
          "load-bearing once the blanket `.claude` rule is removed. Do not delete it."
      ).toContain(".claude/memory/traces/");
    });
  });

  // =============================================================================
  // T-07 — GOLDEN-PATH
  // .gitignore MUST still contain `.claude/memory/pipeline/`.
  //
  // Same rationale as T-06. The `.claude/memory/pipeline/` entry (line 26) was present
  // before the blanket and must be preserved after it is removed. It covers pipeline-local
  // memory state that should never be committed.
  // =============================================================================
  describe("T-07 golden-path — .gitignore MUST still contain `.claude/memory/pipeline/`", () => {
    it("T-07: .gitignore contains `.claude/memory/pipeline/` (specific entry preserved)", () => {
      // PASSES NOW:  `.claude/memory/pipeline/` is already present on line 26.
      // MUST CONTINUE TO PASS AFTER: becomes load-bearing without the blanket. Preserve it.
      const lines = readGitignoreLines();
      expect(
        lines,
        ".gitignore must contain `.claude/memory/pipeline/` — specific entry becomes " +
          "load-bearing once the blanket `.claude` rule is removed."
      ).toContain(".claude/memory/pipeline/");
    });
  });

  // =============================================================================
  // T-08 — GOLDEN-PATH
  // .gitignore MUST still contain `.claude/agent-memory/`.
  //
  // `.claude/agent-memory/` is session-local agent memory (already had a specific entry
  // on line 29 before PR #71). It must remain explicitly gitignored after the blanket
  // is removed — without this entry, agent memory files would become trackable.
  // =============================================================================
  describe("T-08 golden-path — .gitignore MUST still contain `.claude/agent-memory/`", () => {
    it("T-08: .gitignore contains `.claude/agent-memory/` (specific entry preserved)", () => {
      // PASSES NOW:  `.claude/agent-memory/` is already present on line 29.
      // MUST CONTINUE TO PASS AFTER: preserved without the blanket rule. Do not delete.
      const lines = readGitignoreLines();
      expect(
        lines,
        ".gitignore must contain `.claude/agent-memory/` — specific entry is load-bearing " +
          "once the blanket `.claude` rule is removed."
      ).toContain(".claude/agent-memory/");
    });
  });

  // =============================================================================
  // T-09 — GOLDEN-PATH
  // .gitignore must NOT contain `.claude/settings.v4-snapshot.json` as a specific line.
  //
  // The entry `.claude/settings.v4-snapshot.json` on line 57 is a leftover from when
  // this file was being selectively excluded before the blanket rule was added. Now that
  // we are moving to a clean, precise gitignore for .claude/, this specific-file entry
  // is dead weight:
  //   - It is a single-file path that no longer warrants its own ignore rule.
  //   - Keeping one-off file ignores under .claude/ while removing the blanket creates
  //     an inconsistent, confusing .gitignore where some .claude/ files are explicitly
  //     listed and others are expected to be tracked by default.
  //   - If this file truly should not be committed, the team should handle it via a
  //     local gitignore (~/.gitignore_global) or ensure it is never created in the
  //     first place, not by cluttering the project .gitignore.
  //
  // Note: `settings.v4-snapshot.json` (the non-.claude/ form on line 56) is a separate
  // entry and is NOT in scope for this test — only the `.claude/`-prefixed form is removed.
  // =============================================================================
  describe("T-09 golden-path — .gitignore must NOT contain `.claude/settings.v4-snapshot.json`", () => {
    it("T-09: .gitignore does NOT contain `.claude/settings.v4-snapshot.json` as a specific line", () => {
      // FAILS NOW:  `.claude/settings.v4-snapshot.json` is present on line 57 — a redundant
      //             specific-file entry that should be removed during this cleanup.
      // PASSES AFTER: the line is deleted as part of the .gitignore precision cleanup.
      //               Note: `settings.v4-snapshot.json` (no .claude/ prefix, line 56) is
      //               out of scope — only the .claude/-prefixed form is being removed here.
      const lines = readGitignoreLines();
      expect(
        lines,
        ".gitignore must not contain `.claude/settings.v4-snapshot.json` — this is a dead-weight " +
          "specific-file entry. Remove it as part of the .gitignore precision cleanup."
      ).not.toContain(".claude/settings.v4-snapshot.json");
    });
  });
});
