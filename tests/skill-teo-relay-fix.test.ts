// =============================================================================
// skill-teo-relay-fix.test.ts — characterization tests for SKILL.md content fix
//
// WHAT THESE TESTS VERIFY:
//   1. Source copy (skills/teo/SKILL.md) has the directive_gate YAML block removed.
//   2. Source copy replaces the old Dispatcher sentence with the new relay sentence.
//
// INTENTIONAL FAILURE STATE:
//   All tests in this file FAIL against the current file content. They will PASS
//   only after the fix is applied. Do NOT modify test assertions to make them pass
//   prematurely — that defeats the characterization purpose.
//
// AFFECTED FILES:
//   Source: skills/teo/SKILL.md  (directive_gate block present + old sentence)
//
// NOTE: Mirror path (.claude/skills/teo/SKILL.md) is gitignored and absent from
//   fresh checkouts — tests for that path (formerly T-03/T-05/T-06) have been
//   removed to prevent CI failures. Only the tracked source file is asserted here.
//
// Test order: misuse → golden path  (QA ADR-064 policy)
// =============================================================================

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Resolve absolute paths from the repo root.
// This file lives at tests/skill-teo-relay-fix.test.ts.
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, "..");

const SOURCE_PATH = path.join(REPO_ROOT, "skills", "teo", "SKILL.md");

// ---------------------------------------------------------------------------
// Load file content once. If the file is missing the test will fail naturally
// with a clear ENOENT rather than a confusing "undefined" error.
// ---------------------------------------------------------------------------
const sourceContent = fs.readFileSync(SOURCE_PATH, "utf8");

// ---------------------------------------------------------------------------
// The exact strings the fix must remove / add.
// ---------------------------------------------------------------------------
const OLD_SENTENCE =
  "The main session is a **Dispatcher** — its only job is routing. Capo runs as a spawned subagent (ADR-037), registered as the `teo:capo` plugin agent. Invoke it directly via the Task tool.";

const NEW_SENTENCE =
  "Pass requests to Capo verbatim — do not rewrite, pre-classify, or pre-filter the user's input before invoking the Task tool. Capo applies its own classification protocol. Invoke Capo directly via the Task tool with subagent_type: teo:capo.";

// ---------------------------------------------------------------------------
// MISUSE / NEGATIVE-PATH TESTS
// These assert the broken state is currently present (proving the fix is needed)
// and will PASS (content no longer present) after the fix is applied.
// ---------------------------------------------------------------------------
describe("skill-teo-relay-fix — source copy cleanup", () => {
  it("T-01: source copy does NOT contain directive_gate", () => {
    // FAILS NOW:  the block is present in skills/teo/SKILL.md lines 11-23
    // PASSES AFTER: the block is deleted
    expect(sourceContent).not.toContain("directive_gate");
  });

  it("T-02: source copy does NOT contain the old Dispatcher sentence", () => {
    // FAILS NOW:  old sentence is on line 29 of source
    // PASSES AFTER: sentence is replaced
    expect(sourceContent).not.toContain(OLD_SENTENCE);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN-PATH TESTS
// These assert the desired post-fix state and will PASS after the fix.
// ---------------------------------------------------------------------------
describe("skill-teo-relay-fix — source copy post-fix content", () => {
  it("T-04: source copy CONTAINS the new relay sentence", () => {
    // FAILS NOW:  new sentence not present
    // PASSES AFTER: old sentence replaced with new
    expect(sourceContent).toContain(NEW_SENTENCE);
  });
});
