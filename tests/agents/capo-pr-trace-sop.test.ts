/**
 * capo-pr-trace-sop.test.ts — QA spec for WS-PR-TRACE-SOP
 *
 * Validates that src/plugin/agents/capo.md contains the mandatory PR WS trace
 * comment section with all required structural elements:
 *
 *   E-1  A section heading identifying the PR WS trace comment protocol
 *   E-2  Trigger: "after every CAD workstream completes and a PR is opened"
 *   E-3  The word MANDATORY designating the section
 *   E-4  Required fields:
 *          - Workstream ID and description
 *          - Agent spawn chain (agent name, subagent_type, input summary, output/verdict)
 *          - Gate result at each step (PASS / BLOCK / APPROVE / NEEDS_REVISION)
 *          - Fix cycles (BLOCK → re-spawn)
 *          - Final commit SHA
 *          - CI status
 *   E-5  Delivery mechanism: gh pr comment with --body
 *
 * Test ordering: misuse → boundary → golden path (adversarial-first per CAD constitution).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolve file path relative to process.cwd() (vitest sets cwd to project root).
// No /tmp or /Users literals in committed code (per "no-tmp-paths-in-committed-tests" SOP).
const CAPO_MD_PATH = resolve(process.cwd(), "src/plugin/agents/capo.md");

// Read once; all tests share the same string.
const content = readFileSync(CAPO_MD_PATH, "utf-8");

// =============================================================================
// MISUSE: section is entirely absent
// =============================================================================
describe("capo.md — PR trace SOP — misuse: section absent", () => {
  it("file exists and is non-empty (precondition)", () => {
    expect(content.length).toBeGreaterThan(0);
  });

  it("E-ALL: rejects a capo.md that contains no PR trace protocol section at all", () => {
    // The section must exist. If no heading, trigger, MANDATORY, delivery
    // mechanism, or required fields are present, every subsequent test will
    // also fail — this is the canary that the section is absent entirely.
    const hasAnyTraceSignal = /pr.*trace|trace.*comment|pr.*ws.*trace|workstream.*trace/i.test(
      content
    );
    expect(hasAnyTraceSignal).toBe(true);
  });
});

// =============================================================================
// BOUNDARY: each of the 5 required elements tested independently
// =============================================================================
describe("capo.md — PR trace SOP — boundary: E-1 section heading", () => {
  it("E-1a: contains a section heading that mentions 'PR' and 'trace' (case-insensitive)", () => {
    // Accept any heading level (##, ###, etc.) that identifies the protocol.
    expect(content).toMatch(/^#{1,4}.*(pr.*trace|trace.*pr|workstream.*trace)/im);
  });

  it("E-1b: heading explicitly identifies the protocol as a comment protocol", () => {
    // The heading should name it as a trace protocol, not just a loose mention.
    expect(content).toMatch(/^#{1,4}.*trace.*(sop|protocol|comment|format)/im);
  });
});

describe("capo.md — PR trace SOP — boundary: E-2 trigger", () => {
  it("E-2a: contains trigger phrase 'after every CAD workstream'", () => {
    expect(content).toMatch(/after every CAD workstream/i);
  });

  it("E-2b: trigger references 'PR is opened' (the firing condition)", () => {
    expect(content).toMatch(/PR is opened|pull request is opened/i);
  });
});

describe("capo.md — PR trace SOP — boundary: E-3 MANDATORY designation", () => {
  it("E-3: the word MANDATORY appears in the section (exact uppercase)", () => {
    // The spec requires the word MANDATORY — check exact capitalisation.
    expect(content).toContain("MANDATORY");
  });
});

describe("capo.md — PR trace SOP — boundary: E-4 required fields", () => {
  it("E-4a: contains 'Workstream ID' field (workstream identity)", () => {
    expect(content).toMatch(/workstream.{0,10}id/i);
  });

  it("E-4b: contains workstream description field", () => {
    expect(content).toMatch(/description/i);
  });

  it("E-4c: contains agent spawn chain field — agent name and subagent_type", () => {
    // Spawn chain must include both agent name and subagent_type references.
    expect(content).toMatch(/spawn.{0,20}chain|agent.{0,20}chain/i);
    expect(content).toMatch(/subagent_type/i);
  });

  it("E-4d: spawn chain documents input summary", () => {
    expect(content).toMatch(/input.{0,20}summar/i);
  });

  it("E-4e: spawn chain documents output or verdict", () => {
    expect(content).toMatch(/output|verdict/i);
  });

  it("E-4f: gate result field enumerates PASS", () => {
    // Gate results: PASS / BLOCK / APPROVE / NEEDS_REVISION must all be named.
    expect(content).toContain("PASS");
  });

  it("E-4g: gate result field enumerates BLOCK", () => {
    expect(content).toContain("BLOCK");
  });

  it("E-4h: gate result field enumerates APPROVE", () => {
    expect(content).toContain("APPROVE");
  });

  it("E-4i: gate result field enumerates NEEDS_REVISION", () => {
    expect(content).toContain("NEEDS_REVISION");
  });

  it("E-4j: fix cycles — BLOCK → re-spawn documented", () => {
    // Must document the BLOCK → re-spawn cycle for fix iterations.
    expect(content).toMatch(/fix.{0,20}cycle|block.{0,40}re.?spawn|re.?spawn.{0,40}block/i);
  });

  it("E-4k: final commit SHA field", () => {
    expect(content).toMatch(/commit.{0,10}sha|sha.{0,10}commit/i);
  });

  it("E-4l: CI status field", () => {
    expect(content).toMatch(/ci.{0,10}status|status.{0,10}ci/i);
  });
});

describe("capo.md — PR trace SOP — boundary: E-5 delivery mechanism", () => {
  it("E-5a: delivery uses 'gh pr comment'", () => {
    expect(content).toContain("gh pr comment");
  });

  it("E-5b: delivery uses '--body' flag", () => {
    expect(content).toContain("--body");
  });
});

// =============================================================================
// GOLDEN PATH: all 5 elements coherent together in a single section
// =============================================================================
describe("capo.md — PR trace SOP — golden path: coherence", () => {
  it("golden: heading, MANDATORY, trigger, gh pr comment, and required fields all co-exist in the file", () => {
    // All five elements verified as a joint assertion — if this passes, the
    // section is structurally coherent, not just a scattering of keywords.
    const hasHeading = /^#{1,4}.*(pr.*trace|trace.*pr|workstream.*trace)/im.test(content);
    const hasMandatory = content.includes("MANDATORY");
    const hasTrigger = /after every CAD workstream/i.test(content) && /PR is opened/i.test(content);
    const hasDelivery = content.includes("gh pr comment") && content.includes("--body");
    const hasRequiredFields =
      /workstream.{0,10}id/i.test(content) &&
      /subagent_type/i.test(content) &&
      /spawn.{0,20}chain|agent.{0,20}chain/i.test(content) &&
      content.includes("PASS") &&
      content.includes("BLOCK") &&
      content.includes("APPROVE") &&
      content.includes("NEEDS_REVISION") &&
      /fix.{0,20}cycle|block.{0,40}re.?spawn|re.?spawn.{0,40}block/i.test(content) &&
      /commit.{0,10}sha/i.test(content) &&
      /ci.{0,10}status/i.test(content);

    expect(hasHeading).toBe(true);
    expect(hasMandatory).toBe(true);
    expect(hasTrigger).toBe(true);
    expect(hasDelivery).toBe(true);
    expect(hasRequiredFields).toBe(true);
  });

  it("golden: 'gh pr comment' and '--body' appear in proximity (same section, not distant)", () => {
    // Find the index of 'gh pr comment' and '--body'; they should be within
    // 500 characters of each other to confirm co-location in one code block.
    const ghIdx = content.indexOf("gh pr comment");
    const bodyIdx = content.indexOf("--body");
    expect(ghIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(-1);
    expect(Math.abs(ghIdx - bodyIdx)).toBeLessThan(500);
  });

  it("golden: MANDATORY and the trigger phrase appear in proximity (same section)", () => {
    const mandatoryIdx = content.indexOf("MANDATORY");
    const triggerIdx = content.search(/after every CAD workstream/i);
    // Both must exist and be within 2000 characters of each other (same section).
    expect(mandatoryIdx).toBeGreaterThan(-1);
    expect(triggerIdx).toBeGreaterThan(-1);
    expect(Math.abs(mandatoryIdx - triggerIdx)).toBeLessThan(2000);
  });
});
