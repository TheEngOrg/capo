// =============================================================================
// ws-delete-mirror.test.ts — QA spec for ws-delete-mirror workstream
//
// WORKSTREAM SUMMARY:
//   Delete the hand-maintained .claude/agents/, .claude/skills/, .claude/shared/
//   mirror directories (gitignored, never in CI). Update hooks and tests that
//   referenced the mirror paths. Add local-dev-install tooling so devs can
//   reinstall the plugin from source instead of maintaining the mirror manually.
//
// WHAT THESE TESTS VERIFY:
//   T-01 (misuse):    capo-activation.sh must NOT reference .claude/agents/capo.md
//   T-02 (misuse):    pre-edit-write-guard.sh must NOT list ".claude/agents" in PROTECTED_PREFIXES
//   T-03 (boundary):  capo-activation.sh DOES reference agents/capo.md (canonical path)
//   T-04 (boundary):  ws-00-pre-relay-kill.test.ts T-02 describe block is deleted/cleaned up
//   T-05 (golden):    package.json has a dev:install script
//   T-06 (golden):    scripts/local-dev-install.sh exists and contains "claude plugin"
//   T-07 (golden):    .gitignore still contains the .claude entry (regression guard)
//
// IMPLEMENTATION STATUS (ws-delete-mirror complete):
//   T-01: PASSES — hooks/capo-activation.sh updated to reference "agents/capo.md"
//   T-02: PASSES — ".claude/agents" removed from PROTECTED_PREFIXES in pre-edit-write-guard.sh
//   T-03: PASSES — hook contains "agents/capo.md" (canonical plugin source path, no .claude/ prefix)
//   T-04: PASSES — T-02 mirror-parity describe block removed from ws-00-pre-relay-kill.test.ts
//   T-05: PASSES — package.json scripts["dev:install"] added
//   T-06: PASSES — scripts/local-dev-install.sh created with "claude plugin" commands
//   T-07: PASSES — .gitignore has `.claude/agents/` + `.claude/skills/` (blanket replaced by ws-clean-claude-mirrors)
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
// This file lives at tests/ws-delete-mirror.test.ts.
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, "..");

const CAPO_ACTIVATION_PATH = path.join(REPO_ROOT, "hooks", "capo-activation.sh");
const PRE_EDIT_GUARD_PATH = path.join(REPO_ROOT, "hooks", "pre-edit-write-guard.sh");
const RELAY_KILL_TEST_PATH = path.join(REPO_ROOT, "tests", "ws-00-pre-relay-kill.test.ts");
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, "package.json");
const LOCAL_DEV_INSTALL_PATH = path.join(REPO_ROOT, "scripts", "local-dev-install.sh");
const GITIGNORE_PATH = path.join(REPO_ROOT, ".gitignore");

// =============================================================================
// T-01 — MISUSE / NEGATIVE-PATH
// capo-activation.sh must NOT reference the deleted mirror path.
//
// The mirror .claude/agents/capo.md is being deleted. If the hook continues to
// instruct the session to read from the mirror path, the SessionStart hook will
// point at a non-existent file, silently degrading Capo's persona load on every
// session start. This is the highest-priority fix in the workstream.
// =============================================================================
describe("ws-delete-mirror", () => {
  describe("T-01 misuse — capo-activation.sh must NOT reference .claude/agents/capo.md", () => {
    it("T-01: hooks/capo-activation.sh does NOT contain the string '.claude/agents/capo.md'", () => {
      // PASSES: line 4 of capo-activation.sh now references "agents/capo.md" (canonical
      //   plugin source path). Updated by ws-delete-mirror — mirror path removed.
      const content = fs.readFileSync(CAPO_ACTIVATION_PATH, "utf8");
      expect(content).not.toContain(".claude/agents/capo.md");
    });
  });

  // =============================================================================
  // T-02 — MISUSE / NEGATIVE-PATH
  // pre-edit-write-guard.sh must NOT list ".claude/agents" in PROTECTED_PREFIXES.
  //
  // After mirror deletion, .claude/agents/ no longer exists on disk. Keeping it in
  // PROTECTED_PREFIXES is misleading: the guard would block writes to a path that
  // can never be written to (the dir is gone), and it implies the mirror is still
  // a maintained artifact. The entry must be removed.
  // =============================================================================
  describe('T-02 misuse — pre-edit-write-guard.sh must NOT list ".claude/agents" in PROTECTED_PREFIXES', () => {
    it('T-02: hooks/pre-edit-write-guard.sh PROTECTED_PREFIXES does NOT contain ".claude/agents"', () => {
      // PASSES: ".claude/agents" removed from PROTECTED_PREFIXES in pre-edit-write-guard.sh
      //   by ws-delete-mirror — the mirror directory no longer exists on disk.
      //   Note: ".claude/scripts", ".claude/hooks", ".claude/shared", and ".claude/settings.json"
      //   may legitimately remain — only ".claude/agents" is being removed because the mirror
      //   directory is deleted. The assertion is scoped to the exact string '".claude/agents"'
      //   (with surrounding quotes as it appears in the bash array literal) to avoid false
      //   positives on ".claude/agents/" or the hook comment prose.
      const content = fs.readFileSync(PRE_EDIT_GUARD_PATH, "utf8");
      // Match the bash array element form — either quoted standalone or with trailing whitespace
      // The exact line is:  `  ".claude/agents"`
      // We check for the string with surrounding quotes to avoid matching the script's own
      // comment lines that mention the protected paths in prose.
      expect(content).not.toMatch(/^\s*"\.claude\/agents"\s*$/m);
    });
  });

  // =============================================================================
  // T-03 — BOUNDARY
  // capo-activation.sh MUST reference the canonical source path agents/capo.md.
  //
  // After fixing T-01, the hook must actively point at the right file. It is not
  // sufficient to merely remove the bad path — if dev accidentally removes the
  // read instruction entirely, T-01 passes but Capo's persona is never loaded.
  // This test ensures the replacement canonical path is present.
  // =============================================================================
  describe("T-03 boundary — capo-activation.sh MUST reference agents/capo.md (canonical path)", () => {
    it("T-03: hooks/capo-activation.sh DOES contain 'agents/capo.md' without the .claude/ prefix", () => {
      // PASSES: the hook now contains "agents/capo.md" (canonical path, no .claude/ prefix).
      //   Updated by ws-delete-mirror. T-01 asserts the mirror path is absent; this test
      //   asserts the canonical replacement is present — together they pin exactly one path.
      const content = fs.readFileSync(CAPO_ACTIVATION_PATH, "utf8");
      expect(content).toContain("agents/capo.md");

      // Belt-and-suspenders: confirm we're not just matching the mirror path again.
      // If .claude/agents/capo.md is still present, T-01 catches it. This expect is
      // a readability aid — makes the intent explicit in the test output.
      const occurrences = content.split("agents/capo.md").length - 1;
      const mirrorOccurrences = content.split(".claude/agents/capo.md").length - 1;
      const canonicalOnlyOccurrences = occurrences - mirrorOccurrences;
      expect(
        canonicalOnlyOccurrences,
        'capo-activation.sh must contain "agents/capo.md" without a ".claude/" prefix — ' +
          "found only mirror-path occurrences or none at all"
      ).toBeGreaterThanOrEqual(1);
    });
  });

  // =============================================================================
  // T-04 — BOUNDARY
  // ws-00-pre-relay-kill.test.ts T-02 describe block must be deleted or renamed.
  //
  // The existing T-02 mirror-parity block in ws-00-pre-relay-kill.test.ts tests
  // that .claude/agents/capo.md is identical to agents/capo.md when the mirror
  // is present. After mirror deletion, the mirror will never exist, so the describe
  // block is permanently a no-op. Keeping the dead describe block misleads future
  // readers into thinking mirror-parity is still being enforced.
  //
  // Dev must either delete the block entirely or replace it with a comment explaining
  // that the mirror was deleted as part of ws-delete-mirror. The assertion is that
  // the exact describe label "T-02 mirror-parity" no longer appears in the file.
  // =============================================================================
  describe("T-04 boundary — ws-00-pre-relay-kill.test.ts T-02 mirror-parity block must be removed", () => {
    it("T-04: tests/ws-00-pre-relay-kill.test.ts does NOT contain 'T-02 mirror-parity'", () => {
      // PASSES: the "T-02 mirror-parity" describe block has been removed from
      //   ws-00-pre-relay-kill.test.ts as part of ws-delete-mirror.
      const content = fs.readFileSync(RELAY_KILL_TEST_PATH, "utf8");
      expect(content).not.toContain("T-02 mirror-parity");
    });
  });

  // =============================================================================
  // T-05 — GOLDEN-PATH
  // package.json must have a dev:install script for local plugin reinstall.
  //
  // With the mirror gone, devs who want to test Capo persona changes locally need
  // a way to reinstall the plugin from source. The dev:install npm script provides
  // a one-command workflow that replaces the manual mirror-sync step.
  // =============================================================================
  describe("T-05 golden-path — package.json has a dev:install script", () => {
    it('T-05a: package.json scripts["dev:install"] exists', () => {
      // PASSES: package.json now has "dev:install" in scripts, added by ws-delete-mirror.
      const raw = fs.readFileSync(PACKAGE_JSON_PATH, "utf8");
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
      expect(pkg.scripts, "package.json must have a scripts object").toBeDefined();
      expect(
        pkg.scripts!["dev:install"],
        'package.json must have a "dev:install" key in scripts'
      ).toBeDefined();
    });

    it('T-05b: package.json scripts["dev:install"] is non-empty', () => {
      // PASSES: dev:install is "bash scripts/local-dev-install.sh" — non-empty string.
      const raw = fs.readFileSync(PACKAGE_JSON_PATH, "utf8");
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
      const devInstall = pkg.scripts?.["dev:install"];
      expect(
        typeof devInstall === "string" && devInstall.trim().length > 0,
        'package.json scripts["dev:install"] must be a non-empty string'
      ).toBe(true);
    });
  });

  // =============================================================================
  // T-06 — GOLDEN-PATH
  // scripts/local-dev-install.sh must exist and contain a real plugin install command.
  //
  // The dev:install npm script (T-05) should delegate to this shell script so devs
  // can also run it directly. The presence of "claude plugin" in the script body
  // confirms it is a real install script and not a placeholder or empty file.
  // =============================================================================
  describe("T-06 golden-path — scripts/local-dev-install.sh exists and is a real install script", () => {
    it("T-06a: scripts/local-dev-install.sh exists on disk", () => {
      // PASSES: scripts/local-dev-install.sh created by ws-delete-mirror.
      const exists = fs.existsSync(LOCAL_DEV_INSTALL_PATH);
      expect(exists, `scripts/local-dev-install.sh must exist at ${LOCAL_DEV_INSTALL_PATH}`).toBe(
        true
      );
    });

    it("T-06b: scripts/local-dev-install.sh contains 'claude plugin'", () => {
      // PASSES: scripts/local-dev-install.sh contains "claude plugin marketplace add" and
      //   "claude plugin install" invocations — a real install script, not a placeholder.
      if (!fs.existsSync(LOCAL_DEV_INSTALL_PATH)) {
        throw new Error(
          `scripts/local-dev-install.sh does not exist at ${LOCAL_DEV_INSTALL_PATH}. ` +
            "Create the file as part of ws-delete-mirror before this test can pass."
        );
      }
      const content = fs.readFileSync(LOCAL_DEV_INSTALL_PATH, "utf8");
      expect(
        content,
        'scripts/local-dev-install.sh must contain "claude plugin" — confirms it is a real install script'
      ).toContain("claude plugin");
    });
  });

  // =============================================================================
  // T-07 — GOLDEN-PATH (regression guard)
  // .gitignore must still protect .claude/ plugin cache dirs after this workstream.
  //
  // ws-clean-claude-mirrors (a later workstream) replaced the blanket `.claude` rule
  // with precise scoped entries `.claude/agents/` and `.claude/skills/`. The intent
  // of the original T-07 guard (don't accidentally make .claude/ trackable) is
  // preserved by those explicit cache-dir entries. This test now asserts the precise
  // entries are present rather than the blanket — matching the post-ws-clean state.
  // =============================================================================
  describe("T-07 golden-path — .gitignore still ignores .claude plugin cache dirs (regression guard)", () => {
    it("T-07: .gitignore contains '.claude/agents/' and '.claude/skills/' as precise cache-dir entries", () => {
      // UPDATED (ws-clean-claude-mirrors): the blanket `.claude` rule was replaced with
      //   precise `.claude/agents/` and `.claude/skills/` entries. The guard intent is
      //   preserved — plugin cache dirs are still ignored — but now via scoped rules.
      const content = fs.readFileSync(GITIGNORE_PATH, "utf8");
      expect(content).toContain(".claude/agents/");
      expect(content).toContain(".claude/skills/");
    });
  });
});
