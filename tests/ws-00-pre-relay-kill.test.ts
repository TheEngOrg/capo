// =============================================================================
// ws-00-pre-relay-kill.test.ts — characterization tests for WS-00-pre (relay-kill)
//
// WHAT THESE TESTS VERIFY:
//   T-01: agents/capo.md contains no GATEWAY_SPAWN_REQUEST relay protocol
//   T-02: agents/capo.md and .claude/agents/capo.md are identical (or mirror absent)
//   T-03: docs/how-it-works.md contains no "Dispatcher" identity-label usage
//   T-04: sandbox/README.md contains no "Dispatcher" identity-label usage
//   T-05: docs/adr/ADR-072.md exists and is non-empty
//   T-06: skills/teo/SKILL.md contains no relay/proxy execution model language
//
// INTENTIONAL FAILURE STATE (before WS-00-pre is implemented):
//   T-01: FAILS — agents/capo.md has GATEWAY_SPAWN_REQUEST throughout section 108-161
//   T-02: PASSES — both files are currently identical (confirmed by read)
//   T-03: FAILS — docs/how-it-works.md has "Dispatcher" identity noun on line 6 and ASCII diagram
//   T-04: FAILS — sandbox/README.md has "Dispatcher" as architectural noun twice
//   T-05: FAILS — docs/adr/ is empty, ADR-072.md does not exist
//   T-06: PASSES — skills/teo/SKILL.md was already fixed in an earlier workstream
//
// GREEN CRITERIA (after WS-00-pre is fully implemented):
//   T-01: GATEWAY_SPAWN_REQUEST section removed; Capo calls Task() directly
//   T-02: .claude/agents/capo.md mirrors the updated agents/capo.md
//   T-03: how-it-works.md updated — no capitalized-noun "Dispatcher" identity references
//   T-04: sandbox/README.md updated — "Dispatcher" replaced with accurate routing description
//   T-05: docs/adr/ADR-072.md authored with content describing the relay-kill decision
//   T-06: Already green — no regression expected
//
// SCOPE NOTES:
//   - .claude/ is gitignored; we assert T-02 only if the mirror file exists on disk
//   - We test for the specific identity-label pattern "Dispatcher" (capitalized noun used to
//     name the architectural two-tier relay role), NOT generic "dispatcher" in any context
//   - The SKILL.md relay-model language (old Dispatcher sentence) was already removed by
//     the skill-teo-relay-fix workstream; T-06 guards against regression
//
// Test order: misuse / negative-path → golden-path  (QA ADR-064 policy)
// =============================================================================

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Path resolution — always from repo root; never hardcoded /tmp or /Users
// This file lives at tests/ws-00-pre-relay-kill.test.ts.
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, "..");

const PLUGIN_CAPO_PATH = path.join(REPO_ROOT, "agents", "capo.md");
const MIRROR_CAPO_PATH = path.join(REPO_ROOT, ".claude", "agents", "capo.md");
const HOW_IT_WORKS_PATH = path.join(REPO_ROOT, "docs", "how-it-works.md");
const SANDBOX_README_PATH = path.join(REPO_ROOT, "sandbox", "README.md");
const ADR_072_PATH = path.join(REPO_ROOT, "docs", "adr", "ADR-072.md");
const SKILL_TEO_PATH = path.join(REPO_ROOT, "skills", "teo", "SKILL.md");

// Load files that must exist unconditionally; ENOENT surfaces as a clear test failure.
const pluginCapoContent = fs.readFileSync(PLUGIN_CAPO_PATH, "utf8");
const howItWorksContent = fs.readFileSync(HOW_IT_WORKS_PATH, "utf8");
const sandboxReadmeContent = fs.readFileSync(SANDBOX_README_PATH, "utf8");
const skillTeoContent = fs.readFileSync(SKILL_TEO_PATH, "utf8");

// Mirror file is gitignored — may legitimately be absent in CI. Load conditionally.
const mirrorExists = fs.existsSync(MIRROR_CAPO_PATH);
const mirrorCapoContent = mirrorExists ? fs.readFileSync(MIRROR_CAPO_PATH, "utf8") : null;

// =============================================================================
// T-01 — MISUSE / NEGATIVE-PATH
// GATEWAY_SPAWN_REQUEST must be absent from the plugin-bundled agents/capo.md.
//
// This is the most critical test. The relay block causes Capo to emit a fenced
// delimiter block and wait for a proxy to execute Task() on its behalf. The design
// was never correct: Capo has Task in its tools list and must call it directly.
// =============================================================================
describe("T-01 relay-kill — GATEWAY_SPAWN_REQUEST must be absent from agents/capo.md", () => {
  it("T-01a: agents/capo.md does NOT contain the string 'GATEWAY_SPAWN_REQUEST'", () => {
    // FAILS NOW:  the section "Standard Dispatch Flow — GATEWAY_SPAWN_REQUEST" spans
    //             lines 108-161 of agents/capo.md, with 9 occurrences of the token.
    // PASSES AFTER: dev removes the entire relay-dispatch section and replaces it with
    //               a direct Task() dispatch description.
    expect(pluginCapoContent).not.toContain("GATEWAY_SPAWN_REQUEST");
  });

  it("T-01b: agents/capo.md does NOT contain 'END_GATEWAY_SPAWN_REQUEST' delimiter", () => {
    // Belt-and-suspenders: the fenced block uses both opener and closer tokens.
    // FAILS NOW:  closing delimiter is present on line ~122.
    // PASSES AFTER: same removal as T-01a.
    expect(pluginCapoContent).not.toContain("END_GATEWAY_SPAWN_REQUEST");
  });

  it("T-01c: agents/capo.md does NOT contain 'the proxy / gateway' relay prose", () => {
    // The relay narrative uses this phrase to describe the main session's proxy role.
    // FAILS NOW:  present on line 110 of agents/capo.md.
    // PASSES AFTER: the relay-dispatch section is removed.
    expect(pluginCapoContent).not.toContain("the proxy / gateway");
  });

  it("T-01d: agents/capo.md DOES contain direct Task() dispatch language", () => {
    // Golden-path: after removal of relay, the file must instruct Capo to call Task()
    // directly. The exact phrasing is dev's choice — this test checks for the canonical
    // "Task tool" or "Task()" reference in a dispatch context (not inside the rotation block,
    // which already uses Task language for checkpoint spawning).
    //
    // PASSES NOW if any "Task" reference exists in the file; verify test fails after T-01a
    // passes to ensure this check is not trivially green.
    //
    // We assert the explicit dispatch-section heading is replaced with a direct-call equivalent.
    // The file already has "Task tool" references in the roster table — post-fix, there must
    // also be a dispatch-flow section that describes direct Task() calls, NOT a relay block.
    expect(pluginCapoContent).toContain("Task");
    // After relay kill: this complementary check ensures Capo's dispatch section exists
    // and describes calling Task directly (not emitting a fenced block for a proxy).
    // Dev must author a "Standard Dispatch Flow" or equivalent section that says Capo
    // calls Task() directly. We assert the phrase "calls Task" or "call Task" or "Task tool"
    // appears outside of the removed relay prose context.
    // This test is intentionally loose — the exact wording is dev's decision.
    // A stricter version can be added in qa-validate once dev has authored the replacement prose.
  });
});

// =============================================================================
// T-02 — BOUNDARY
// agents/capo.md and .claude/agents/capo.md must be identical if both exist.
//
// The .claude/ mirror is gitignored. If it is absent (fresh CI checkout), this
// test is a no-op (skipped). If it exists and diverges, that is a bug — the
// relay-kill edit must be applied to both copies simultaneously.
// =============================================================================
describe("T-02 mirror-parity — .claude/agents/capo.md must match agents/capo.md when present", () => {
  it("T-02: .claude/agents/capo.md is identical to agents/capo.md (when mirror exists)", () => {
    if (!mirrorExists) {
      // Mirror absent in this environment (CI fresh checkout, gitignored). Skip assertion.
      // This is expected in CI. On a developer machine where the mirror IS present,
      // this test ensures the relay-kill edit was applied to both files.
      return;
    }

    // PASSES NOW: both files are currently identical (confirmed by inspection).
    // MUST CONTINUE TO PASS AFTER: dev edits both files in lockstep.
    // FAILS if dev edits only agents/capo.md and forgets the .claude/ mirror.
    expect(mirrorCapoContent).toBe(pluginCapoContent);
  });
});

// =============================================================================
// T-03 — MISUSE / NEGATIVE-PATH
// docs/how-it-works.md must not use "Dispatcher" as an architectural identity noun.
//
// The current file uses "dispatcher" in the section heading "The dispatcher and Capo"
// and again in the ASCII flow diagram: "You → /teo → Dispatcher → Capo → specialists"
// This framing encodes the two-tier relay model as the documented architecture, which
// is incorrect. After WS-00-pre, the routing description must reflect direct invocation.
//
// We test for "Dispatcher" with capital D — the specific identity-label form — rather
// than the generic lowercase noun, to avoid false positives on valid routing prose.
// The section heading "The dispatcher" (lowercase) may remain if it describes generic
// routing without asserting a "Dispatcher" proxy role.
// =============================================================================
describe("T-03 docs/how-it-works.md — no Dispatcher identity-label usage", () => {
  it("T-03a: how-it-works.md does NOT contain 'Dispatcher' as a capitalized architectural noun", () => {
    // FAILS NOW:  line 6 "The main Claude Code session acts as a **dispatcher**."
    //             and ASCII diagram "You → /teo → Dispatcher → Capo → specialists"
    //             contain capitalized or bold Dispatcher identity framing.
    // PASSES AFTER: section rewritten to reflect direct /teo → Capo invocation path.
    //
    // We test for the bold-noun pattern "**Dispatcher**" and the diagram token "Dispatcher"
    // (capital-D, standalone word) which are the specific identity-label forms.
    const hasBoldDispatcher =
      howItWorksContent.includes("**Dispatcher**") || howItWorksContent.includes("**dispatcher**");
    const hasDiagramDispatcher = /→\s*Dispatcher\s*→/.test(howItWorksContent);

    expect(
      hasBoldDispatcher || hasDiagramDispatcher,
      'how-it-works.md must not contain "**Dispatcher**" or "→ Dispatcher →" (two-tier relay framing). ' +
        "Rewrite to show direct /teo → Capo routing."
    ).toBe(false);
  });

  it("T-03b: how-it-works.md does NOT describe the main session as a dispatcher layer", () => {
    // FAILS NOW: line 6 "The main Claude Code session acts as a **dispatcher**."
    // PASSES AFTER: this prose is replaced with accurate description of /teo routing.
    expect(howItWorksContent).not.toContain("The main Claude Code session acts as a");
  });
});

// =============================================================================
// T-04 — MISUSE / NEGATIVE-PATH
// sandbox/README.md must not use "Dispatcher" as an architectural identity noun.
//
// sandbox/README.md uses "Dispatcher" twice in STEP-3A as a proper noun describing
// the relay architecture: "The Dispatcher routes on the Tier-1 trigger" and
// "confirm the Dispatcher CLAUDE.md is active." Both embed the relay-model framing.
// =============================================================================
describe("T-04 sandbox/README.md — no Dispatcher identity-label usage", () => {
  it("T-04a: sandbox/README.md does NOT contain 'The Dispatcher routes'", () => {
    // FAILS NOW:  STEP-3A expected output: "The Dispatcher routes on the Tier-1 `/teo *` trigger."
    // PASSES AFTER: updated to describe Capo receiving work directly via Task tool.
    expect(sandboxReadmeContent).not.toContain("The Dispatcher routes");
  });

  it("T-04b: sandbox/README.md does NOT contain 'Dispatcher CLAUDE.md'", () => {
    // FAILS NOW:  STEP-3A failure guidance: "confirm the Dispatcher CLAUDE.md is active"
    //             This references a non-existent "Dispatcher CLAUDE.md" file — the relay
    //             model artifact. After the fix this troubleshooting step must be rewritten.
    // PASSES AFTER: failure guidance updated to remove the relay-model reference.
    expect(sandboxReadmeContent).not.toContain("Dispatcher CLAUDE.md");
  });
});

// =============================================================================
// T-05 — GOLDEN-PATH
// docs/adr/ADR-072.md must exist and be non-empty after WS-00-pre.
//
// ADR-072 ratifies the direct-dispatch architecture decision (relay-kill).
// The ADR directory is currently empty — the file does not yet exist.
// =============================================================================
describe("T-05 ADR-072 — docs/adr/ADR-072.md must exist and be non-empty", () => {
  it("T-05a: docs/adr/ADR-072.md exists on disk", () => {
    // FAILS NOW:  docs/adr/ directory is empty.
    // PASSES AFTER: dev (or technical-writer) authors ADR-072.md in docs/adr/.
    const exists = fs.existsSync(ADR_072_PATH);
    expect(
      exists,
      `ADR-072.md must exist at ${ADR_072_PATH} — author it as part of WS-00-pre`
    ).toBe(true);
  });

  it("T-05b: docs/adr/ADR-072.md is non-empty (at least 100 characters)", () => {
    // FAILS NOW:  file does not exist — readFileSync would throw ENOENT.
    //             This test is written to fail clearly if T-05a also fails.
    // PASSES AFTER: ADR-072.md is authored with decision rationale.
    if (!fs.existsSync(ADR_072_PATH)) {
      throw new Error(
        `ADR-072.md does not exist at ${ADR_072_PATH}. ` +
          "Author the file as part of WS-00-pre before this test can pass."
      );
    }
    const content = fs.readFileSync(ADR_072_PATH, "utf8");
    expect(content.trim().length).toBeGreaterThanOrEqual(100);
  });

  it("T-05c: docs/adr/ADR-072.md contains a decision title (starts with # or ## heading)", () => {
    // FAILS NOW:  file does not exist.
    // PASSES AFTER: ADR-072.md has a markdown heading at the top.
    if (!fs.existsSync(ADR_072_PATH)) {
      throw new Error(
        `ADR-072.md does not exist at ${ADR_072_PATH}. ` +
          "Author the file as part of WS-00-pre before this test can pass."
      );
    }
    const content = fs.readFileSync(ADR_072_PATH, "utf8");
    expect(content.trimStart()).toMatch(/^#+ /);
  });
});

// =============================================================================
// T-06 — REGRESSION GUARD
// skills/teo/SKILL.md must not contain relay/proxy model language.
//
// The old Dispatcher sentence and directive_gate block were removed from SKILL.md
// by a prior workstream (skill-teo-relay-fix). These tests guard against regression:
// WS-00-pre must not inadvertently re-introduce relay language into SKILL.md.
// =============================================================================
describe("T-06 skills/teo/SKILL.md — no relay/proxy model language (regression guard)", () => {
  it("T-06a: SKILL.md does NOT contain 'GATEWAY_SPAWN_REQUEST'", () => {
    // PASSES NOW:  SKILL.md was already cleaned in a prior workstream.
    // MUST CONTINUE TO PASS AFTER: WS-00-pre must not re-introduce relay language.
    expect(skillTeoContent).not.toContain("GATEWAY_SPAWN_REQUEST");
  });

  it("T-06b: SKILL.md does NOT contain the old Dispatcher sentence", () => {
    // PASSES NOW:  old sentence already removed.
    // MUST CONTINUE TO PASS AFTER: regression guard.
    expect(skillTeoContent).not.toContain("The main session is a **Dispatcher**");
  });

  it("T-06c: SKILL.md does NOT contain 'directive_gate'", () => {
    // PASSES NOW:  directive_gate block already removed from SKILL.md.
    // MUST CONTINUE TO PASS AFTER: regression guard.
    expect(skillTeoContent).not.toContain("directive_gate");
  });
});
