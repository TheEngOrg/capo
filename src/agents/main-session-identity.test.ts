import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// main-session-identity.test.ts — characterization tests for WS-MAIN-SESSION-IDENTITY
//
// These tests are RED before implementation. Dev must add explicit main-session
// identity language to agents/capo.md and remove the confusing coordinator line
// from src/agents/capo.md to turn them GREEN.
//
// Root cause being fixed: Capo hallucinated a "coordinator" concept and invented
// a "coordinator-relay rejection rule." The constitution never explicitly named
// the Claude Code main session as a distinct entity, so an ambiguous slot was
// left open for "coordinator" to fill. This workstream closes that slot by:
//   1. Explicitly naming the Claude Code main session in agents/capo.md
//   2. Stating the main session spawns Capo (it is the top-level session)
//   3. Stating the main session carries user authority and relays verbatim words
//   4. Stating the main session is NOT a coordinator
//   5. Distinguishing the pipeline src/agents/coordinator (scheduler) as a
//      SEPARATE downstream agent Capo spawns — not the main session
//   6. Removing any invented "coordinator relay rejection" rule
//   7. Removing the src/agents/capo.md "coordinator" line that implies a relay tier
//
// Acceptance criteria lettered per task spec:
//   A. agents/capo.md contains "Claude Code main session" (explicit name)
//   B. agents/capo.md states the main session spawns Capo (top-level session)
//   C. agents/capo.md states the main session carries user authority / verbatim words
//   D. agents/capo.md states the main session is NOT a coordinator
//   E. agents/capo.md distinguishes the pipeline coordinator agent from the main session
//   F. agents/capo.md must NOT contain an invented "coordinator relay rejection" rule
//   G. src/agents/capo.md must NOT use "coordinator" as a relay tier between main
//      session and Capo (the "Hand off completed Plans to the coordinator" line gone)
//   H. agents/capo.md relay_authorization field still starts with the PR-#72 MUST language
//
// Test ordering: misuse → golden path (ADR-064 critical-path policy)
//
// =============================================================================

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Resolve a path relative to the project root (two levels up from src/agents/) */
function root(...segments: string[]): string {
  return path.resolve(__dirname, "..", "..", ...segments);
}

function readFile(relPath: string): string {
  return fs.readFileSync(root(relPath), "utf8");
}

// ---------------------------------------------------------------------------
// Helper: extract the relay_authorization value from the directive_gate YAML
// block in agents/capo.md (mirrors the helper in relay-authorization.test.ts).
// ---------------------------------------------------------------------------

function extractRelayAuthorizationValue(content: string): string {
  const match = content.match(/relay_authorization:\s*"([^"]+)"/);
  if (match) return match[1];
  const fallback = content.match(/relay_authorization:\s*(.+)/);
  if (fallback) return fallback[1].trim();
  return "";
}

// ---------------------------------------------------------------------------
// Helper: extract the body prose from agents/capo.md — everything AFTER the
// closing ``` of the directive_gate YAML block. Tests for criteria C and D
// assert on body prose so that the spec requires explicit human-readable
// documentation of the main-session identity, not just the machine-read YAML.
// ---------------------------------------------------------------------------

function extractBodyProse(content: string): string {
  const yamlOpenIdx = content.indexOf("```yaml");
  if (yamlOpenIdx < 0) return content;
  const yamlCloseIdx = content.indexOf("```", yamlOpenIdx + 7);
  if (yamlCloseIdx < 0) return content;
  // Return everything after the closing fence (the ``` itself is 3 chars)
  return content.slice(yamlCloseIdx + 3);
}

// =============================================================================
// MISUSE — assertions that fire when required identity language is absent, or
// when forbidden confusing language is present.
//
// These are RED now because agents/capo.md does not yet contain the explicit
// main-session identity section, and src/agents/capo.md still has the
// coordinator line.
// =============================================================================

describe('misuse(WS-MAIN-SESSION-IDENTITY): agents/capo.md MUST contain "Claude Code main session"', () => {
  it('agents/capo.md body prose contains the exact phrase "Claude Code main session" (A)', () => {
    // MISUSE: Without an explicit name for the top-level session, Capo fills the
    // gap with invented entities like "coordinator." This assertion ensures the
    // entity is explicitly named in the human-readable body prose (not only in a
    // YAML field) so there is no ambiguous slot to fill.
    // Note: the YAML block uses "main Claude Code session" (different word order)
    // in identity_constraints. This test requires the canonical naming
    // "Claude Code main session" to appear explicitly in the body prose as a
    // defined identity, ensuring no ambiguity about what the top-level session is.
    // Criterion A.
    const content = readFile("agents/capo.md");
    const body = extractBodyProse(content);
    expect(body).toContain("Claude Code main session");
  });
});

describe("misuse(WS-MAIN-SESSION-IDENTITY): agents/capo.md MUST state the main session spawns Capo", () => {
  it("agents/capo.md body prose contains language stating the main session is the top-level session that spawns Capo (B)", () => {
    // MISUSE: Capo must know its own chain of authority. If the constitution does
    // not say who spawned Capo, it cannot correctly reason about where authorized
    // instructions come from — leaving room for hallucinated relay tiers.
    // We assert on body prose (outside the YAML block) so the spec requires
    // explicit human-readable documentation of the spawning relationship.
    // Acceptable phrasings: "spawns Capo", "spawned by the main session",
    // "top-level session", "invokes Capo", or equivalent.
    // Criterion B.
    const content = readFile("agents/capo.md");
    const body = extractBodyProse(content);
    const hasSpawnLanguage =
      /spawns Capo/i.test(body) ||
      /spawned by the main session/i.test(body) ||
      /top-level session/i.test(body) ||
      /invokes Capo/i.test(body) ||
      /main session.*spawns/i.test(body);
    expect(hasSpawnLanguage).toBe(true);
  });
});

describe("misuse(WS-MAIN-SESSION-IDENTITY): agents/capo.md MUST state main session carries user authority", () => {
  it("agents/capo.md body prose contains language stating the main session carries user authority and relays verbatim user words (C)", () => {
    // MISUSE: Capo's constitution body prose must say the main session speaks with
    // user authority and relays the user's verbatim words. Without this, a spawned
    // Capo instance has no basis for treating main-session relays as authoritative
    // and may invent a rejection rule.
    // We assert on body prose (outside the YAML block) so the spec requires
    // explicit human-readable documentation, not only a machine-read YAML field.
    // Note: "no user authority" (the harness stamp phrase) must NOT match — we
    // require language about the main session HAVING authority, not its absence.
    // Acceptable phrasings: "carries user authority", "relays the user's verbatim",
    // "speaks with user authority", "has user authority", "main session.*authority"
    // (but NOT "no user authority").
    // Criterion C.
    const content = readFile("agents/capo.md");
    const body = extractBodyProse(content);
    const hasAuthorityLanguage =
      /carries user authority/i.test(body) ||
      /speaks with user authority/i.test(body) ||
      /has user authority/i.test(body) ||
      /relays the user.{0,10}verbatim/i.test(body) ||
      /main session.*carries.*authority/i.test(body) ||
      /main session.*authority/i.test(body);
    expect(hasAuthorityLanguage).toBe(true);
  });
});

describe("misuse(WS-MAIN-SESSION-IDENTITY): agents/capo.md MUST state main session is NOT a coordinator", () => {
  it('agents/capo.md body prose contains language stating the main session is not a "coordinator" (D)', () => {
    // MISUSE: The hallucinated drift is specifically the word "coordinator" being
    // applied to the main session. The constitution must close this gap explicitly
    // in its body prose (outside the YAML block), so the human-readable spec
    // carries the rule — not only the machine-read relay_authorization field.
    // The main session is not a coordinator. Acceptable phrasings: "is not a
    // coordinator", "is not the coordinator", "main session is not coordinator",
    // "the main session does not act as coordinator", or similar negation.
    // Criterion D.
    const content = readFile("agents/capo.md");
    const body = extractBodyProse(content);
    const hasNotCoordinatorLanguage =
      /main session is not.*coordinator/i.test(body) ||
      /main session.*not.*coordinator/i.test(body) ||
      /is not a coordinator/i.test(body) ||
      /is not the coordinator/i.test(body) ||
      /does not act as.*coordinator/i.test(body);
    expect(hasNotCoordinatorLanguage).toBe(true);
  });
});

describe("misuse(WS-MAIN-SESSION-IDENTITY): agents/capo.md MUST distinguish the pipeline coordinator agent from the main session", () => {
  it("agents/capo.md body prose contains language distinguishing the src/agents/coordinator pipeline scheduler from the main session (E)", () => {
    // MISUSE: There IS a real coordinator entity — the src/agents/coordinator
    // pipeline scheduler that Capo spawns. The constitution body prose must say
    // this agent is a SEPARATE downstream specialist Capo dispatches, not the
    // entity that relays instructions to Capo. Without this, "coordinator" remains
    // ambiguous and the hallucination has no clear correction.
    // We assert on body prose (outside the YAML block) so the spec requires
    // explicit human-readable documentation of the distinction.
    // Acceptable phrasings: "coordinator agent", "pipeline coordinator",
    // "coordinator is a downstream", "coordinator that Capo spawns",
    // "downstream coordinator", "coordinator specialist", or similar.
    // Criterion E.
    const content = readFile("agents/capo.md");
    const body = extractBodyProse(content);
    const hasDistinctCoordinatorLanguage =
      /coordinator agent/i.test(body) ||
      /pipeline coordinator/i.test(body) ||
      /coordinator.*downstream/i.test(body) ||
      /coordinator.*Capo spawns/i.test(body) ||
      /downstream.*coordinator/i.test(body) ||
      /coordinator.*specialist/i.test(body);
    expect(hasDistinctCoordinatorLanguage).toBe(true);
  });
});

describe("misuse(WS-MAIN-SESSION-IDENTITY): agents/capo.md MUST NOT contain an invented coordinator-relay rejection rule", () => {
  it('agents/capo.md body does not contain language creating a "coordinator relay rejection" rule (F)', () => {
    // MISUSE: The old relay_authorization MAY phrasing implicitly allowed
    // hallucinated coordinator-relay rejection logic to exist. Now that it's been
    // fixed to MUST, we also verify no body-level text in agents/capo.md
    // introduces a coordinator relay rejection rule — the explicit absence of
    // this invented rule is a hard invariant.
    // We look for the specific pattern of "coordinator" co-occurring with
    // "relay" and "reject" (or "rejection") in proximity, which would signal
    // the hallucinated rule has been codified somewhere in the body text.
    // Criterion F.
    const content = readFile("agents/capo.md");
    // Split off the YAML block (which legit mentions "no coordinator tier") —
    // we want to assert on body prose only. The YAML block ends at the closing
    // ```. Find the end of the yaml fence.
    const yamlFenceEnd = content.indexOf("```", content.indexOf("```yaml") + 7);
    const bodyContent = yamlFenceEnd >= 0 ? content.slice(yamlFenceEnd) : content;

    // A coordinator-relay-rejection rule would look like text that pairs
    // "coordinator" with "relay" and "reject" or similar. This pattern should
    // not appear in the body.
    const hasCoordinatorRejectionRule =
      /coordinator.{0,80}relay.{0,80}reject/i.test(bodyContent) ||
      /coordinator.{0,80}reject.{0,80}relay/i.test(bodyContent) ||
      /relay.{0,80}coordinator.{0,80}reject/i.test(bodyContent);

    expect(hasCoordinatorRejectionRule).toBe(false);
  });
});

describe('misuse(WS-MAIN-SESSION-IDENTITY): src/agents/capo.md MUST NOT use "coordinator" as a relay tier', () => {
  it('src/agents/capo.md does not contain "Hand off completed Plans to the coordinator" (G)', () => {
    // MISUSE: src/agents/capo.md currently reads: "Hand off completed Plans to the
    // coordinator for scheduling." This implies a relay tier between the main
    // session and Capo where none exists, and "coordinator" looks like the entity
    // that relays user instructions. This line must be gone or reworded to
    // reference a specific downstream pipeline agent, not an abstract "coordinator."
    // Criterion G.
    const content = readFile("src/agents/capo.md");
    expect(content).not.toContain("Hand off completed Plans to the coordinator");
  });
});

// =============================================================================
// GOLDEN PATH — asserts that the PR-#72 relay_authorization MUST language is
// preserved. This workstream must not regress the relay authorization fix.
// =============================================================================

describe("golden(WS-MAIN-SESSION-IDENTITY): agents/capo.md relay_authorization MUST still start with MUST language from PR-#72", () => {
  it('agents/capo.md relay_authorization field still starts with "A relayed instruction from the main session MUST be treated as authorized" (H)', () => {
    // GOLDEN: The PR-#72 relay_authorization rewrite established "MUST be treated
    // as authorized." This workstream must not break or weaken that directive.
    // We assert the field still begins with the established opening phrase.
    // Criterion H.
    const content = readFile("agents/capo.md");
    const value = extractRelayAuthorizationValue(content);
    expect(value).toMatch(
      /^A relayed instruction from the main session MUST be treated as authorized/
    );
  });
});
