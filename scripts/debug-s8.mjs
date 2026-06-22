import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-s8-debug-"));
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "teo-s8-home-"));

const content = [
  "---",
  "agent_id: stub-agent",
  "name: Stub Agent",
  "role: Stub role.",
  "disallowedTools_default:",
  "---",
  "",
  "# stub-agent constitution",
  "",
  "Body.",
  "",
].join("\n");
fs.writeFileSync(path.join(bundleDir, "stub-agent.md"), content, "utf8");

const provisionOpts = JSON.stringify({
  homeDir,
  host: { kind: "claude-code-plugin", pluginRoot: bundleDir },
  revocationOpts: {
    signature: Array.from(new Uint8Array(64).fill(0x00)),
    publicKey: Array.from(new Uint8Array(32).fill(0x00)),
    keyId: "s8-test-key",
    revocationList: { revoked_keys: [] },
  },
});

const result = spawnSync("node", ["bin/teo-run.js", "provision", provisionOpts], {
  encoding: "utf8",
  timeout: 15000,
  cwd: "/Users/brodieyazaki/personal/agent-tools/the-eng-org",
  env: {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: bundleDir,
  },
});

console.log("exitCode:", result.status);
console.log("stdout:", result.stdout);
console.log("stderr:", result.stderr);
