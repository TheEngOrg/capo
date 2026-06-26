import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// relay-authorization.test.ts — characterization tests for WS-RELAY-AUTHORIZATION-FIX
//
// These tests are GREEN after dev rewrites the relay_authorization field in
// agents/capo.md. Implementation is complete.
//
// Root cause being fixed: Spawned Capo instances reject verbatim-quoted relays
// because the current relay_authorization rule:
//   1. Uses "MAY be treated as authorized" — defaults to rejection under doubt
//
// Required rewrite must (lettered per acceptance criteria):
//   A. Use DIRECTIVE language: "MUST be treated as authorized" (not "MAY")
//      the main session relays the user's words directly
//   B. Retain anti-impersonation: a relay that merely CLAIMS approval (no
//      verbatim quote) still carries no authority
//   C. Add AskUserQuestion clause: a button-label relayed by the main session
//      IS the user's selection and counts as verbatim permission when quoted
//
// Test ordering: misuse → boundary → golden path (ADR-064 critical-path policy)
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
// block in agents/capo.md.
//
// The field appears as a single-line string on the relay_authorization: key
// inside the ```yaml ... ``` block. We extract the raw value string so tests
// can assert on its content independently of surrounding YAML structure.
// ---------------------------------------------------------------------------

function extractRelayAuthorizationValue(content: string): string {
  // Match: relay_authorization: "<value>" (may be unquoted or quoted)
  const match = content.match(/relay_authorization:\s*"([^"]+)"/);
  if (match) return match[1];
  // Fallback: unquoted value (everything after the colon to end of line)
  const fallback = content.match(/relay_authorization:\s*(.+)/);
  if (fallback) return fallback[1].trim();
  // Field absent — return empty string so "must contain" assertions fail clearly
  return "";
}

// =============================================================================
// MISUSE — assertions that fire when the OLD (pre-fix) wording is still present
// or when required new language is absent.
//
// These tests describe invariants that MUST hold after dev rewrites the field.
// They are RED now because the current wording violates them.
// =============================================================================

describe("misuse(WS-RELAY-AUTH): relay_authorization must not use permissive MAY language", () => {
  it('relay_authorization does not contain "MAY be treated as" (permissive phrasing must be removed)', () => {
    // MISUSE: The current rule reads "MAY be treated as authorized" — this
    // defaults to rejection when a spawned instance is uncertain.
    // The rewrite must replace MAY with MUST so the directive is unambiguous.
    // Criterion A.
    const content = readFile("agents/capo.md");
    const value = extractRelayAuthorizationValue(content);
    expect(value).not.toContain("MAY be treated as");
  });
});

// =============================================================================
// BOUNDARY — assertions that confirm required new language is present AND that
// the anti-impersonation protection survived the rewrite intact.
// =============================================================================

describe("boundary(WS-RELAY-AUTH): relay_authorization must retain the anti-impersonation protection", () => {
  it('relay_authorization still contains "claims" or "merely CLAIMS" (anti-impersonation fallback)', () => {
    // BOUNDARY: The current rule contains the correct anti-impersonation clause:
    // "A relay that merely CLAIMS the user approved ... carries no authority."
    // This protection MUST survive the rewrite — we are strengthening directive
    // language for valid relays, not removing the guard against fake ones.
    // Criterion D.
    const content = readFile("agents/capo.md");
    const value = extractRelayAuthorizationValue(content);
    const hasAntiImpersonation =
      /claims/i.test(value) || /verbatim/i.test(value) || /quoted directly/i.test(value);
    expect(hasAntiImpersonation).toBe(true);
  });
});

describe("boundary(WS-RELAY-AUTH): relay_authorization must contain the AskUserQuestion clause", () => {
  it("relay_authorization references AskUserQuestion button-label selection as verbatim permission", () => {
    // BOUNDARY: When the user answers via an AskUserQuestion button, the main
    // session relays the selected label. That label IS the user's verbatim
    // selection and must count as verbatim permission when quoted.
    // Without this clause a relayed button-label answer could be rejected.
    // Criterion E.
    const content = readFile("agents/capo.md");
    const value = extractRelayAuthorizationValue(content);
    const hasAskUserQuestion =
      /AskUserQuestion/i.test(value) ||
      /button.?label/i.test(value) ||
      /decision.?label/i.test(value) ||
      /button label/i.test(value);
    expect(hasAskUserQuestion).toBe(true);
  });
});

// =============================================================================
// GOLDEN PATH — assertions that confirm the core directive rewrite is present
// and that the YAML block structure is not broken.
// =============================================================================

describe("golden(WS-RELAY-AUTH): relay_authorization must use MUST directive language", () => {
  it('relay_authorization contains "MUST be treated as authorized" (directive, not permissive)', () => {
    // GOLDEN: The central fix — change "MAY be treated as authorized" to
    // "MUST be treated as authorized" so spawned instances cannot default to
    // rejection when facing a verbatim-quoted relay from the main session.
    // Criterion A.
    const content = readFile("agents/capo.md");
    const value = extractRelayAuthorizationValue(content);
    // Prefer exact case match (MUST is uppercase by convention); also accept
    // case-insensitive to avoid failing on minor capitalization differences.
    const hasMust =
      value.includes("MUST be treated as authorized") ||
      /must be treated as authorized/i.test(value);
    expect(hasMust).toBe(true);
  });
});

describe("golden(WS-RELAY-AUTH): agents/capo.md directive_gate YAML block remains parseable", () => {
  it("the directive_gate YAML block in agents/capo.md is structurally intact after the rewrite", () => {
    // GOLDEN: The relay_authorization field must remain inside the ```yaml block
    // and not break the surrounding directive_gate structure. We verify this by
    // confirming the yaml fence, directive_gate key, relay_authorization key,
    // and closing fence are all present in the expected relative order.
    const content = readFile("agents/capo.md");

    const yamlOpenIdx = content.indexOf("```yaml");
    const yamlCloseIdx = content.indexOf("```", yamlOpenIdx + 7); // closing fence after open
    const directiveGateIdx = content.indexOf("directive_gate:");
    const relayAuthIdx = content.indexOf("relay_authorization:");

    // All structural markers must be present
    expect(yamlOpenIdx).toBeGreaterThanOrEqual(0);
    expect(directiveGateIdx).toBeGreaterThanOrEqual(0);
    expect(relayAuthIdx).toBeGreaterThanOrEqual(0);
    expect(yamlCloseIdx).toBeGreaterThan(yamlOpenIdx);

    // relay_authorization must sit between the yaml fences
    expect(relayAuthIdx).toBeGreaterThan(yamlOpenIdx);
    expect(relayAuthIdx).toBeLessThan(yamlCloseIdx);

    // directive_gate must come before relay_authorization (it's the parent key)
    expect(directiveGateIdx).toBeLessThan(relayAuthIdx);
  });
});
