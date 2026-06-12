/**
 * claude-cli runner — DEFAULT. Shells out to the `claude` binary, using the
 * user's existing Claude Code auth (no API key management). The actual
 * subprocess call is live I/O and is exercised by integration tests against a
 * real (or stubbed) binary, not unit coverage — hence this file is excluded from
 * the 100% core gate. See vitest.config.ts.
 */
import { spawnSync } from "node:child_process";
import type { SpawnRequest, SpawnResult, SpawnRunner } from "../agent-spawn.js";

const DEFAULT_MODEL = "claude-opus-4-8";

export const claudeCliRunner: SpawnRunner = {
  name: "claude-cli",
  run: async (req: SpawnRequest): Promise<SpawnResult> => {
    const model = req.model ?? DEFAULT_MODEL;
    const start = process.hrtime.bigint();
    // `claude -p` runs a single headless prompt and emits JSON with usage.
    const proc = spawnSync(
      "claude",
      ["-p", "--output-format", "json", "--model", model, req.prompt],
      { cwd: req.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const duration_ms = Number((process.hrtime.bigint() - start) / 1000000n);

    if (proc.error || proc.status !== 0) {
      return {
        output: proc.stdout ?? "",
        tokens_in: 0,
        tokens_out: 0,
        model,
        cost_usd: 0,
        duration_ms,
        ok: false,
        error: proc.error?.message ?? (proc.stderr || `claude exited ${proc.status}`),
      };
    }

    // Parse the JSON envelope claude -p emits: { result, total_cost_usd, usage }.
    try {
      const parsed = JSON.parse(proc.stdout) as {
        result?: string;
        total_cost_usd?: number;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      return {
        output: parsed.result ?? "",
        tokens_in: parsed.usage?.input_tokens ?? 0,
        tokens_out: parsed.usage?.output_tokens ?? 0,
        model,
        cost_usd: parsed.total_cost_usd ?? 0,
        duration_ms,
        ok: true,
      };
    } catch (err) {
      return {
        output: proc.stdout,
        tokens_in: 0,
        tokens_out: 0,
        model,
        cost_usd: 0,
        duration_ms,
        ok: false,
        error: `failed to parse claude output: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
