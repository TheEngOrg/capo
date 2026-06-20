// =============================================================================
// live-spawner.ts — LiveAgentSpawner: real Claude Code CLI AgentSpawner
//
// Spawns the `claude` binary as a subprocess for agent task execution.
// Used only in live/integration tests — never in the normal test suite.
//
// SECURITY: ANTHROPIC_API_KEY is passed to the subprocess via inherited
// process environment only. It is NEVER concatenated into a string, logged,
// or included in any error message.
// =============================================================================

import * as cp from "node:child_process";
import { execFileSync } from "node:child_process";
import type {
  AgentSpawner,
  AgentSpawnRequest,
  AgentSpawnRaw,
} from "../../../src/adapters/claude-code.js";

// ---------------------------------------------------------------------------
// Binary check helper
// ---------------------------------------------------------------------------

function assertClaudeBinary(): void {
  try {
    execFileSync("claude", ["--version"], { stdio: "pipe" });
  } catch {
    throw new Error(
      "LiveAgentSpawner: 'claude' binary not found in PATH. Install Claude Code CLI."
    );
  }
}

// ---------------------------------------------------------------------------
// LiveAgentSpawner
// ---------------------------------------------------------------------------

/**
 * AgentSpawner that delegates to the real `claude` CLI subprocess.
 *
 * - Spawns `claude --print` with the agent definition body as the system prompt
 *   and the task as the user prompt.
 * - Passes disallowedTools via CLI flags.
 * - Enforces req.timeoutMs: kills the subprocess and returns errored if exceeded.
 * - On non-zero exit or spawn error: returns { output: <partial stdout>, errored: true }.
 * - Never throws — all error conditions produce a return value.
 *
 * SECURITY: ANTHROPIC_API_KEY is inherited from process.env automatically.
 * It is NEVER passed as a CLI argument or included in any string.
 */
export class LiveAgentSpawner implements AgentSpawner {
  constructor() {
    assertClaudeBinary();
  }

  async spawn(req: AgentSpawnRequest): Promise<AgentSpawnRaw> {
    const { agentDefinition, prompt, disallowedTools, timeoutMs } = req;

    // Build CLI args.
    const args: string[] = ["--print", "--system-prompt", agentDefinition.body];

    // Pass disallowedTools if any.
    for (const tool of disallowedTools) {
      args.push("--disallow-tool", tool);
    }

    let child: cp.ChildProcess;
    try {
      child = cp.spawn("claude", args, {
        // Inherit env so ANTHROPIC_API_KEY flows through automatically.
        // SECURITY: never log env or expose it in error messages.
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (spawnErr) {
      // Spawn error (e.g. binary not found at runtime, permissions issue).
      // SECURITY: never include env in error detail.
      return { output: "", errored: true };
    }

    // stdio streams are guaranteed non-null when spawn() is called with stdio:"pipe".
    // TypeScript types them as possibly null for the general case — assert here.
    if (!child.stdout || !child.stderr || !child.stdin) {
      return { output: "", errored: true };
    }

    let stdoutOutput = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutOutput += chunk.toString();
    });
    child.stderr.on("data", (_chunk: Buffer) => {
      // stderr intentionally discarded.
      // SECURITY: never log stderr — may contain key material in some environments.
    });

    // Write prompt to stdin and close it.
    child.stdin.write(prompt);
    child.stdin.end();

    // Race subprocess completion against timeout.
    const exitCode = await new Promise<number | null>((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          // Kill the subprocess on timeout.
          try {
            child.kill("SIGTERM");
          } catch {
            /* best-effort */
          }
          resolve(null); // null signals timeout
        }
      }, timeoutMs);

      child.on("close", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(code);
        }
      });

      child.on("error", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(-1);
        }
      });
    });

    // Timeout: return errored with whatever partial output we have.
    if (exitCode === null) {
      return { output: stdoutOutput, errored: true };
    }

    // Non-zero exit: return errored with partial stdout.
    if (exitCode !== 0) {
      return { output: stdoutOutput, errored: true };
    }

    return { output: stdoutOutput };
  }
}
