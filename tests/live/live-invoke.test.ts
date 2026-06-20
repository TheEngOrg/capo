// =============================================================================
// live-invoke.test.ts — Live integration test for invokeSkill()
//
// REQUIRES:
//   INTEGRATION_TESTS=1    — opt-in guard (suite is entirely skipped without it)
//   ANTHROPIC_API_KEY=...  — real API key for Claude Code CLI
//   `claude` binary in PATH — Claude Code CLI must be installed
//
// Run with:
//   INTEGRATION_TESTS=1 ANTHROPIC_API_KEY=<key> npm run test:live
//
// Temp dirs are intentionally NOT cleaned up automatically.
// Their paths are logged after each test so the user can delete them manually.
//
// SECURITY: ANTHROPIC_API_KEY is passed to subprocesses via inherited env only.
// It is NEVER logged, concatenated into strings, or included in error messages.
// =============================================================================

import { describe, it, expect, vi, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ed from "@noble/ed25519";
import { execFileSync } from "node:child_process";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code.js";
import { invokeSkill } from "../../src/skill/skill.js";
import { LiveAgentRunner } from "./support/live-runner.js";
import { LiveAgentSpawner } from "./support/live-spawner.js";

// ---------------------------------------------------------------------------
// Suite-level guard: skip everything if INTEGRATION_TESTS is not set
// ---------------------------------------------------------------------------

describe.skipIf(!process.env["INTEGRATION_TESTS"])("live invokeSkill integration", () => {
  // -------------------------------------------------------------------------
  // Inner guards — checked at describe-body evaluation time (before beforeAll).
  // These throw immediately if the environment is not properly configured.
  // -------------------------------------------------------------------------

  if (!process.env["ANTHROPIC_API_KEY"]) {
    throw new Error("ANTHROPIC_API_KEY is required for live tests");
  }

  // Verify `claude` binary is available.
  try {
    execFileSync("claude", ["--version"], { stdio: "pipe" });
  } catch {
    throw new Error("Live tests require the `claude` binary in PATH. Install Claude Code CLI.");
  }

  // -------------------------------------------------------------------------
  // Shared setup — runs once for the entire suite
  // -------------------------------------------------------------------------

  // Shared across Test 1 and Test 2 (same keypair).
  let privateKey: Uint8Array;
  let publicKey: Uint8Array;
  let signature: Uint8Array;
  // Bundle bytes computed from the real src/agents/ directory.
  let bundleBytes: Uint8Array;
  // bundleDir = absolute path to src/agents/
  let bundleDir: string;
  // Temp dir for Test 1
  let tmpDir: string;
  // Adapter shared across tests
  let adapter: ClaudeCodeAdapter;

  beforeAll(async () => {
    // -------------------------------------------------------------------------
    // 1. Generate ephemeral Ed25519 keypair.
    // -------------------------------------------------------------------------
    // Note: @noble/ed25519 v3 uses randomSecretKey (not randomPrivateKey).
    privateKey = ed.utils.randomSecretKey();
    publicKey = await ed.getPublicKeyAsync(privateKey);

    // -------------------------------------------------------------------------
    // 2. Create temp dir for Test 1.
    // -------------------------------------------------------------------------
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-live-"));

    // -------------------------------------------------------------------------
    // 3. Locate bundleDir at src/agents/ relative to this file.
    //    import.meta.dirname = tests/live/
    //    src/agents/ is ../../src/agents/ from here
    // -------------------------------------------------------------------------
    bundleDir = path.resolve(import.meta.dirname, "../../src/agents");

    // -------------------------------------------------------------------------
    // 4. Compute canonical bundle bytes (sorted agent .md files concatenated).
    //    Matches the exact order provision.ts uses: listAgentIds().sort()
    //    followed by fs.readFileSync per id.
    //
    //    listAgentIds() returns the base names (without .md) of all .md files
    //    in bundleDir. We replicate that logic here to avoid importing provision
    //    internals.
    // -------------------------------------------------------------------------
    const agentIds = fs
      .readdirSync(bundleDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3)) // strip .md
      .sort();

    const chunks = agentIds.map((id) => fs.readFileSync(path.join(bundleDir, `${id}.md`)));
    bundleBytes = Buffer.concat(chunks);

    // -------------------------------------------------------------------------
    // 5. Sign bundle bytes with ephemeral private key.
    // -------------------------------------------------------------------------
    signature = await ed.signAsync(bundleBytes, privateKey);

    // -------------------------------------------------------------------------
    // 6. Construct ClaudeCodeAdapter with live runner + spawner.
    // -------------------------------------------------------------------------
    adapter = new ClaudeCodeAdapter({
      runner: new LiveAgentRunner(),
      spawner: new LiveAgentSpawner(),
      agentsDir: bundleDir,
    });
  });

  // -------------------------------------------------------------------------
  // Test 1 — Golden path
  // -------------------------------------------------------------------------

  it("golden path — invokeSkill returns ok with PASS for a trivial task", async () => {
    const revocationOpts = {
      signature,
      publicKey,
      keyId: "live-test-key-v1",
      revocationList: { revoked_keys: [] },
    };

    const result = await invokeSkill({
      adapter,
      description: "Write a one-sentence README for an empty project.",
      project_id: "live-test-proj",
      bundleDir,
      homeDir: tmpDir,
      revocationOpts,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return; // narrow type for assertions below

    expect(result.result.overallStatus).toBe("PASS");
    expect(result.result.steps.length).toBeGreaterThanOrEqual(1);

    // -------------------------------------------------------------------------
    // Write markdown report to tmpDir.
    // -------------------------------------------------------------------------
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = path.join(tmpDir, `live-run-${timestamp}.md`);

    const report = [
      `# TEO Live Run Report`,
      ``,
      `**Timestamp:** ${new Date().toISOString()}`,
      `**Status:** ok`,
      `**Overall:** ${result.result.overallStatus}`,
      `**Steps:** ${result.result.steps.length}`,
      ``,
      `## Steps`,
      ...result.result.steps.map(
        (s, i) =>
          `${i + 1}. Task \`${s.taskId}\` — **${s.status}**${s.detail ? `: ${s.detail}` : ""}`
      ),
      ``,
      `## Notes`,
      `- Temp dir intentionally NOT cleaned up — delete manually: \`${tmpDir}\``,
    ].join("\n");

    fs.writeFileSync(reportPath, report, "utf8");

    // Log structured summary for CI visibility.
    console.log(`\n=== TEO Live Run Report ===`);
    console.log(`Status: ok`);
    console.log(`Overall: PASS`);
    console.log(`Steps: ${result.result.steps.length}`);
    console.log(`Report: ${reportPath}`);
    console.log(`===========================\n`);

    // NOTE: temp dir is intentionally NOT cleaned up — user must delete manually.
    // Path is logged above.
  }, 120_000); // 2-minute timeout for real LLM call

  // -------------------------------------------------------------------------
  // Test 2 — Revoked key (zero LLM calls)
  // -------------------------------------------------------------------------

  it("revoked key — invokeSkill returns provision_error before any LLM call", async () => {
    // Separate temp dir for this test.
    const revokedTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-live-revoked-"));

    const revocationOpts = {
      signature,
      publicKey,
      keyId: "live-test-key-v1",
      revocationList: {
        revoked_keys: [{ key_id: "live-test-key-v1", reason: "test revocation" }],
      },
    };

    // Spy on adapter.sagePlan to verify it is never called.
    const sagePlanSpy = vi.spyOn(adapter, "sagePlan");

    const result = await invokeSkill({
      adapter,
      description: "Write a one-sentence README for an empty project.",
      project_id: "live-test-proj",
      bundleDir,
      homeDir: revokedTmpDir,
      revocationOpts,
    });

    expect(result.status).toBe("provision_error");
    if (result.status !== "provision_error") return;

    expect(result.kind).toBe("revocation_blocked");
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);

    // sagePlan must NOT have been called — revocation check blocks before any LLM call.
    expect(sagePlanSpy).not.toHaveBeenCalled();

    // NOTE: revokedTmpDir is intentionally NOT cleaned up.
    console.log(`\nRevoked-key test temp dir (not cleaned up): ${revokedTmpDir}`);
  }, 30_000); // 30-second timeout (no LLM calls — just provision + revocation check)
});
