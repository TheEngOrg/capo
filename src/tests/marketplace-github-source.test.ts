import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// marketplace-github-source.test.ts — QA spec for WS-GO-07-swap
//
// Change under test: switch .claude-plugin/marketplace.json and
// scripts/verify-plugin-install.sh from local-source form to GitHub-source form.
// No src/ or test/ logic is involved — these are config + shell-script changes.
//
// WHY THESE TESTS CANNOT SUBPROCESS
//   The `claude plugin install` command can only be run by a human operator
//   (Brodie). CI does not have the claude binary on PATH. The real-install gate
//   lives in scripts/verify-plugin-install.sh and is run manually before tagging.
//   These tests verify the FILE CONTENT of the two artifacts that WS-GO-07-swap
//   must change. They use node:fs only — no subprocesses, no mocks, no network.
//
// ORDERING: misuse → boundary → golden path (ADR-064 critical-path policy)
//   "Misuse" here means the OLD (pre-swap) patterns that must be ABSENT after
//   the change lands. Boundary cases cover structural well-formedness. Golden
//   path cases assert the new GitHub-source contract is fully present.
//
// FILES UNDER TEST
//   MARKETPLACE_JSON : <repo>/.claude-plugin/marketplace.json
//   VERIFY_SCRIPT    : <repo>/scripts/verify-plugin-install.sh
// =============================================================================

// ---------------------------------------------------------------------------
// Absolute paths — resolved from this file's location up to repo root
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MARKETPLACE_JSON = path.join(REPO_ROOT, ".claude-plugin", "marketplace.json");
const VERIFY_SCRIPT = path.join(REPO_ROOT, "scripts", "verify-plugin-install.sh");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readMarketplace(): string {
  return fs.readFileSync(MARKETPLACE_JSON, "utf8");
}

function parseMarketplace(): unknown {
  return JSON.parse(readMarketplace());
}

function readVerifyScript(): string {
  return fs.readFileSync(VERIFY_SCRIPT, "utf8");
}

// =============================================================================
// MISUSE — old local-source patterns that MUST NOT appear after the swap
// =============================================================================

describe("marketplace.json — misuse: local source form must be absent after swap", () => {
  it('source field must not be the bare string "./"', () => {
    // Pre-swap form: "source": "./" — this is the dogfood/local form.
    // After WS-GO-07-swap it must be gone. A bare string source that points
    // to "./" would resolve to the operator's local checkout, not GitHub.
    const raw = readMarketplace();
    // Match the JSON literal — a string value of "./" assigned to "source"
    expect(raw).not.toMatch(/"source"\s*:\s*"\.\/"/);
  });

  it("source field as a bare string of any local-path form must be absent", () => {
    // Guard against partial fixes that swap "./" to "." or "./." etc.
    // The post-swap source MUST be an object, never a bare string.
    const parsed = parseMarketplace() as { plugins?: Array<{ source?: unknown }> };
    const plugins = parsed.plugins ?? [];
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.length).toBeGreaterThan(0);
    for (const plugin of plugins) {
      expect(typeof plugin.source).not.toBe("string");
    }
  });
});

describe("verify-plugin-install.sh — misuse: local-marketplace registration command must be absent", () => {
  it('must not contain the local marketplace-add invocation "marketplace add ./"', () => {
    // Pre-swap Step 2 called: claude plugin marketplace add ./
    // This command registers the local directory as a marketplace source.
    // After the swap it must be replaced with the GitHub repo form.
    const script = readVerifyScript();
    expect(script).not.toContain("marketplace add ./");
  });

  it('must not contain the raw string "source: \\".\\/"" in any comment or note', () => {
    // The pre-swap header block and trailing NOTE quoted the old source value.
    // After the swap those references must be gone — a stale comment describing
    // the old form would contradict the live gate and mislead future readers.
    const script = readVerifyScript();
    // Match the quoted JSON form as it appears in shell comments/echo strings
    expect(script).not.toMatch(/source.*"\.\/"/);
  });

  it("must not tell the operator to swap marketplace.json before public release", () => {
    // The trailing NOTE in the pre-swap script ends with an instruction to
    // "swap marketplace.json source to: { ... github ... } and re-run".
    // WS-GO-07-swap IS that swap — once done, the NOTE must no longer instruct
    // the operator to do what is already done.
    const script = readVerifyScript();
    // The pre-swap text: "swap marketplace.json source to:"
    expect(script).not.toMatch(/swap marketplace\.json source to/i);
  });

  it('must not describe the verified form as "LOCAL" in the trailing NOTE', () => {
    // Pre-swap NOTE: "This verified the LOCAL marketplace.json (source: \"./\")."
    // Post-swap the NOTE must confirm PUBLIC / github was verified instead.
    // We cannot assert on exact wording (dev has latitude) but the word LOCAL
    // in the NOTE section must be gone. We check the line that starts the NOTE.
    const script = readVerifyScript();
    // Extract the NOTE block — lines after the PASS echo near the end of the file
    const noteIdx = script.indexOf("NOTE:");
    expect(noteIdx).toBeGreaterThan(-1); // NOTE block must still exist
    const noteBlock = script.slice(noteIdx);
    expect(noteBlock).not.toMatch(/LOCAL marketplace/i);
  });

  it('Step 2 section header echo must not say "local marketplace"', () => {
    // Pre-swap: echo "[2/5] Registering/updating local marketplace..."
    // The echo label must not name it "local" after the swap.
    const script = readVerifyScript();
    expect(script).not.toMatch(/\[2\/5\].*local marketplace/i);
  });

  it('Step 4 echo must not say "local marketplace"', () => {
    // Pre-swap: echo "[4/5] Installing teo from local marketplace..."
    const script = readVerifyScript();
    expect(script).not.toMatch(/\[4\/5\].*local marketplace/i);
  });
});

// =============================================================================
// BOUNDARY — structural well-formedness of both files
// =============================================================================

describe("marketplace.json — boundary: structural validity", () => {
  it("file exists at .claude-plugin/marketplace.json", () => {
    expect(fs.existsSync(MARKETPLACE_JSON)).toBe(true);
  });

  it("file is valid JSON (does not throw on parse)", () => {
    expect(() => parseMarketplace()).not.toThrow();
  });

  it('top-level object has a "name" string field', () => {
    const parsed = parseMarketplace() as Record<string, unknown>;
    expect(typeof parsed.name).toBe("string");
    expect((parsed.name as string).trim().length).toBeGreaterThan(0);
  });

  it('top-level object has a "plugins" array with at least one entry', () => {
    const parsed = parseMarketplace() as { plugins?: unknown[] };
    expect(Array.isArray(parsed.plugins)).toBe(true);
    expect((parsed.plugins as unknown[]).length).toBeGreaterThan(0);
  });

  it("the teo plugin entry exists in plugins[]", () => {
    const parsed = parseMarketplace() as { plugins?: Array<{ name?: string }> };
    const teo = (parsed.plugins ?? []).find((p) => p.name === "teo");
    expect(teo).toBeDefined();
  });

  it('the teo plugin entry has a "source" field that is an object (not a string)', () => {
    const parsed = parseMarketplace() as { plugins?: Array<{ name?: string; source?: unknown }> };
    const teo = (parsed.plugins ?? []).find((p) => p.name === "teo");
    expect(teo).toBeDefined();
    // Must be an object — a bare string would be the pre-swap local form
    expect(typeof teo!.source).toBe("object");
    expect(teo!.source).not.toBeNull();
    expect(Array.isArray(teo!.source)).toBe(false);
  });
});

describe("verify-plugin-install.sh — boundary: structural validity", () => {
  it("file exists at scripts/verify-plugin-install.sh", () => {
    expect(fs.existsSync(VERIFY_SCRIPT)).toBe(true);
  });

  it("file is non-empty", () => {
    const content = readVerifyScript();
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it("file starts with a bash shebang", () => {
    const content = readVerifyScript();
    expect(content.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it('Step 2 section marker "[2/5]" is still present', () => {
    // The overall 5-step structure must be preserved — dev must not drop steps
    expect(readVerifyScript()).toContain("[2/5]");
  });

  it('Step 4 section marker "[4/5]" is still present', () => {
    expect(readVerifyScript()).toContain("[4/5]");
  });

  it("teo@teo-marketplace install command is still present (install target unchanged)", () => {
    // The install command itself — teo@teo-marketplace — is unchanged by the swap.
    // Only the marketplace registration command in Step 2 changes.
    expect(readVerifyScript()).toContain("claude plugin install teo@teo-marketplace");
  });

  it("trailing NOTE block is still present after the PASS echo", () => {
    // The NOTE must survive the rewrite — it just changes what it says.
    // A developer who deleted the NOTE entirely would pass the misuse tests
    // above but silently remove important operator guidance.
    expect(readVerifyScript()).toContain("NOTE:");
  });
});

// =============================================================================
// GOLDEN PATH — new GitHub-source form must be fully present
// =============================================================================

describe("marketplace.json — golden: GitHub source object is correct", () => {
  it('teo plugin source.source field equals "github"', () => {
    const parsed = parseMarketplace() as {
      plugins?: Array<{ name?: string; source?: { source?: string; repo?: string } }>;
    };
    const teo = (parsed.plugins ?? []).find((p) => p.name === "teo");
    expect(teo?.source?.source).toBe("github");
  });

  it('teo plugin source.repo field equals "TheEngOrg/capo"', () => {
    const parsed = parseMarketplace() as {
      plugins?: Array<{ name?: string; source?: { source?: string; repo?: string } }>;
    };
    const teo = (parsed.plugins ?? []).find((p) => p.name === "teo");
    expect(teo?.source?.repo).toBe("TheEngOrg/capo");
  });

  it('source object has exactly the two expected fields: "source" and "repo"', () => {
    // Guard against extra fields that might confuse the marketplace parser.
    const parsed = parseMarketplace() as {
      plugins?: Array<{ name?: string; source?: Record<string, unknown> }>;
    };
    const teo = (parsed.plugins ?? []).find((p) => p.name === "teo");
    const sourceObj = teo?.source as Record<string, unknown> | undefined;
    expect(sourceObj).toBeDefined();
    const keys = Object.keys(sourceObj!).sort();
    expect(keys).toEqual(["repo", "source"]);
  });

  it("full marketplace.json round-trips through JSON.parse → JSON.stringify cleanly", () => {
    // Catches BOM, trailing garbage, or encoding issues that would break
    // the claude CLI JSON parser at install time.
    const raw = readMarketplace();
    const parsed: unknown = JSON.parse(raw);
    const reparsed: unknown = JSON.parse(JSON.stringify(parsed));
    expect(reparsed).toEqual(parsed);
  });
});

describe("verify-plugin-install.sh — golden: GitHub marketplace registration is present", () => {
  it('Step 2 contains the GitHub repo form "marketplace add TheEngOrg/capo"', () => {
    // The post-swap registration command: claude plugin marketplace add TheEngOrg/capo
    // This is the GitHub-source equivalent of the old "marketplace add ./"
    const script = readVerifyScript();
    expect(script).toContain("marketplace add TheEngOrg/capo");
  });

  it('Step 2 update command "marketplace update teo-marketplace" is still present', () => {
    // The update half of the registration flow is unchanged — only the add command changes.
    expect(readVerifyScript()).toContain("marketplace update teo-marketplace");
  });

  it('Step 2 echo label references "github" or "public" (case-insensitive), not "local"', () => {
    // The [2/5] echo header must describe the source as github or public.
    const script = readVerifyScript();
    const step2EchoMatch = script.match(/echo "\[2\/5\][^"]*"/);
    expect(step2EchoMatch).not.toBeNull();
    const step2Echo = step2EchoMatch![0].toLowerCase();
    const mentionsGithubOrPublic = step2Echo.includes("github") || step2Echo.includes("public");
    expect(mentionsGithubOrPublic).toBe(true);
  });

  it('Step 4 echo label references "github" or "public" (case-insensitive)', () => {
    const script = readVerifyScript();
    const step4EchoMatch = script.match(/echo "\[4\/5\][^"]*"/);
    expect(step4EchoMatch).not.toBeNull();
    const step4Echo = step4EchoMatch![0].toLowerCase();
    const mentionsGithubOrPublic = step4Echo.includes("github") || step4Echo.includes("public");
    expect(mentionsGithubOrPublic).toBe(true);
  });

  it("trailing NOTE confirms this verified the PUBLIC or GitHub source", () => {
    // Post-swap the NOTE must say something like:
    //   "This verified the PUBLIC github-sourced marketplace."
    // or any wording that includes PUBLIC or github (case-insensitive).
    const script = readVerifyScript();
    const noteIdx = script.indexOf("NOTE:");
    expect(noteIdx).toBeGreaterThan(-1);
    const noteBlock = script.slice(noteIdx).toLowerCase();
    const mentionsGithubOrPublic = noteBlock.includes("github") || noteBlock.includes("public");
    expect(mentionsGithubOrPublic).toBe(true);
  });

  it("trailing NOTE confirms this gate is the canonical pre-tag gate", () => {
    // The NOTE must still communicate that this is the gate to run before tagging.
    // Pre-swap it said "before public release ... re-run this gate" — we need
    // the post-swap NOTE to affirm the gate's role without telling the operator
    // to do a swap that is already done.
    const script = readVerifyScript();
    const noteIdx = script.indexOf("NOTE:");
    const noteBlock = script.slice(noteIdx).toLowerCase();
    // Must mention tagging, release, or pre-tag in the NOTE context
    const mentionsReleaseGate =
      noteBlock.includes("tag") || noteBlock.includes("release") || noteBlock.includes("pre-tag");
    expect(mentionsReleaseGate).toBe(true);
  });

  it("header comment block references GitHub source (not just local/dogfood form)", () => {
    // The pre-swap header warned: "FOR PUBLIC RELEASE, source must be swapped to: { github... }"
    // Post-swap the header must not frame the GitHub source as a future todo.
    // It should describe the current committed form (github) as authoritative.
    const script = readVerifyScript();
    // Header block is the comment section before the first non-comment executable line.
    // We extract everything before "set -euo pipefail"
    const headerEnd = script.indexOf("set -euo pipefail");
    expect(headerEnd).toBeGreaterThan(-1);
    const header = script.slice(0, headerEnd).toLowerCase();
    // Header must reference the GitHub repo somewhere — either in prose or example
    expect(header).toContain("theengorg/capo");
  });
});
