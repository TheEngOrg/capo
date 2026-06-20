// =============================================================================
// live-runner.ts — LiveAgentRunner: real Claude Code CLI AgentRunner
//
// Spawns the `claude` binary as a subprocess for the Sage planning loop.
// Used only in live/integration tests — never in the normal test suite.
//
// SECURITY: ANTHROPIC_API_KEY is passed to the subprocess via inherited
// process environment only. It is NEVER concatenated into a string, logged,
// or included in any error message.
// =============================================================================

import * as cp from "node:child_process";
import { execFileSync } from "node:child_process";
import * as readline from "node:readline";
import type {
  AgentRunner,
  AgentRunnerOpts,
  ToolCall,
  ToolResult,
} from "../../../src/adapters/claude-code.js";

// ---------------------------------------------------------------------------
// Binary check helper
// ---------------------------------------------------------------------------

function assertClaudeBinary(): void {
  try {
    execFileSync("claude", ["--version"], { stdio: "pipe" });
  } catch {
    throw new Error("LiveAgentRunner: 'claude' binary not found in PATH. Install Claude Code CLI.");
  }
}

// ---------------------------------------------------------------------------
// LiveAgentRunner
// ---------------------------------------------------------------------------

/**
 * AgentRunner that delegates to the real `claude` CLI subprocess.
 *
 * Protocol:
 *   - Spawns `claude` with `--output-format stream-json --print` so the CLI
 *     emits newline-delimited JSON events on stdout.
 *   - System prompt + tools are passed via stdin as a JSON envelope.
 *   - Each tool_use event in the stream is yielded as a ToolCall.
 *   - ToolResult values fed back via next() are written to the subprocess stdin
 *     as tool_result JSON lines.
 *   - On non-zero exit the generator throws with exit code + stderr.
 *
 * SECURITY: ANTHROPIC_API_KEY is inherited from process.env automatically.
 * It is NEVER passed as a CLI argument or included in any string.
 */
export class LiveAgentRunner implements AgentRunner {
  constructor() {
    assertClaudeBinary();
  }

  async *run(opts: AgentRunnerOpts): AsyncGenerator<ToolCall, void, ToolResult> {
    const { systemPrompt, tools } = opts;

    // Spawn `claude` with stream-json output and pipe for stdin/stdout communication.
    // --print: non-interactive mode (reads from stdin, outputs to stdout)
    // --output-format stream-json: newline-delimited JSON stream
    // Tool definitions and system prompt go via --system-prompt and --tools flags.
    //
    // We encode tools as JSON and pass them; the system prompt is passed directly.
    const toolsJson = JSON.stringify(tools);

    const child = cp.spawn(
      "claude",
      [
        "--output-format",
        "stream-json",
        "--print",
        "--system-prompt",
        systemPrompt,
        "--tools",
        toolsJson,
      ],
      {
        // Inherit env so ANTHROPIC_API_KEY flows through automatically.
        // SECURITY: never log env or expose it in error messages.
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    // stdio streams are guaranteed non-null when spawn() is called with stdio:"pipe".
    // TypeScript types them as possibly null for the general case — assert here.
    if (!child.stdout || !child.stderr || !child.stdin) {
      throw new Error("LiveAgentRunner: subprocess stdio streams unavailable");
    }

    let stderrOutput = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

    // Accumulate lines — we process them as tool_use events arrive.
    const lineQueue: string[] = [];
    let resolveNextLine: (() => void) | null = null;
    let streamDone = false;

    rl.on("line", (line: string) => {
      lineQueue.push(line);
      if (resolveNextLine) {
        const r = resolveNextLine;
        resolveNextLine = null;
        r();
      }
    });

    const closedPromise = new Promise<void>((resolve) => {
      rl.on("close", () => {
        streamDone = true;
        if (resolveNextLine) {
          const r = resolveNextLine;
          resolveNextLine = null;
          r();
        }
        resolve();
      });
    });

    const nextLine = (): Promise<string | null> =>
      new Promise((resolve) => {
        if (lineQueue.length > 0) {
          resolve(lineQueue.shift()!);
          return;
        }
        if (streamDone) {
          resolve(null);
          return;
        }
        resolveNextLine = () => {
          if (lineQueue.length > 0) {
            resolve(lineQueue.shift()!);
          } else {
            resolve(null);
          }
        };
      });

    try {
      // Process stream-json events line by line.
      while (true) {
        const line = await nextLine();
        if (line === null) break;
        if (!line.trim()) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          // Skip non-JSON lines (e.g. debug output)
          continue;
        }

        // stream-json format: each event has a `type` field.
        // tool_use events look like: { type: "tool_use", name: "...", input: {...} }
        if (event["type"] === "tool_use") {
          const toolCall: ToolCall = {
            name: event["name"] as ToolCall["name"],
            input: (event["input"] as Record<string, unknown>) ?? {},
          };

          // Yield the tool call; receive the tool result back via next().
          const toolResult: ToolResult = yield toolCall;

          // Send tool result back to the subprocess stdin as JSON.
          const resultLine =
            JSON.stringify({
              type: "tool_result",
              tool_use_id: event["id"],
              content: JSON.stringify(toolResult),
            }) + "\n";

          await new Promise<void>((resolve, reject) => {
            child.stdin.write(resultLine, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }

        // Other event types (text, system, end, etc.) are intentionally ignored.
      }
    } finally {
      // Close stdin to signal end of input to the subprocess.
      child.stdin.end();
      await closedPromise;
    }

    // Wait for the subprocess to exit.
    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 0));
      // If already closed
      if (child.exitCode !== null) resolve(child.exitCode);
    });

    if (exitCode !== 0) {
      // SECURITY: never include env vars or API key in error messages.
      throw new Error(
        `LiveAgentRunner: claude subprocess exited with code ${exitCode}. ` +
          `stderr: ${stderrOutput.slice(0, 500)}`
      );
    }
  }
}
