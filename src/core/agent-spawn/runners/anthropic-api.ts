/**
 * anthropic-api runner — SUPPORTED ALTERNATIVE to the claude CLI. Calls the
 * Anthropic Messages API directly via @anthropic-ai/sdk for precise token/cost
 * telemetry. Needs ANTHROPIC_API_KEY. The SDK is imported lazily so the CLI
 * default has no hard dependency on it. Live I/O — excluded from the unit
 * coverage gate (see vitest.config.ts).
 */
import type { SpawnRequest, SpawnResult, SpawnRunner } from "../agent-spawn.js";

const DEFAULT_MODEL = "claude-opus-4-8";

// Per-MTok pricing for cost computation when the API doesn't return a dollar cost.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

function costUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model] ?? PRICING[DEFAULT_MODEL];
  return (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out;
}

export const anthropicApiRunner: SpawnRunner = {
  name: "anthropic-api",
  run: async (req: SpawnRequest): Promise<SpawnResult> => {
    const model = req.model ?? DEFAULT_MODEL;
    const start = process.hrtime.bigint();
    let Anthropic: typeof import("@anthropic-ai/sdk").default;
    try {
      Anthropic = (await import("@anthropic-ai/sdk")).default;
    } catch {
      return failure(model, start, "@anthropic-ai/sdk is not installed (anthropic-api runner)");
    }

    try {
      const client = new Anthropic();
      const message = await client.messages.create({
        model,
        max_tokens: 16000,
        messages: [{ role: "user", content: req.prompt }],
      });
      const output = message.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      const tokensIn = message.usage.input_tokens;
      const tokensOut = message.usage.output_tokens;
      return {
        output,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        model,
        cost_usd: costUsd(model, tokensIn, tokensOut),
        duration_ms: Number((process.hrtime.bigint() - start) / 1000000n),
        ok: true,
      };
    } catch (err) {
      return failure(model, start, err instanceof Error ? err.message : String(err));
    }
  },
};

function failure(model: string, start: bigint, error: string): SpawnResult {
  return {
    output: "",
    tokens_in: 0,
    tokens_out: 0,
    model,
    cost_usd: 0,
    duration_ms: Number((process.hrtime.bigint() - start) / 1000000n),
    ok: false,
    error,
  };
}
