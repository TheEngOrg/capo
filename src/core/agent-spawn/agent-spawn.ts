/**
 * agent-spawn — the ONE place an LLM is invoked. Everything else is deterministic.
 *
 * The model is reached through a pluggable SpawnRunner so the engine is not tied
 * to a single backend: the default is the `claude` CLI (uses the user's existing
 * Claude Code auth), with an Anthropic API SDK runner as a supported alternative,
 * and a fake runner for tests. agent-spawn itself only selects a runner, hands it
 * the request, and normalizes the result — including wrapping any thrown error so
 * the orchestrator always gets a deterministic {ok:false} rather than an
 * exception. See TEO-5.md §6 and §5a.
 */
import { claudeCliRunner } from "./runners/claude-cli.js";
import { anthropicApiRunner } from "./runners/anthropic-api.js";

export interface SpawnRequest {
  agent_id: string;
  agent_type: string;
  task_id: string;
  prompt: string;
  /** Model id; defaults are the runner's concern. */
  model?: string;
  cwd?: string;
}

export interface SpawnResult {
  output: string;
  tokens_in: number;
  tokens_out: number;
  model: string;
  cost_usd: number;
  duration_ms: number;
  ok: boolean;
  error?: string;
}

/** A backend that actually talks to a model. */
export interface SpawnRunner {
  name: string;
  run: (req: SpawnRequest) => Promise<SpawnResult>;
}

export type RunnerKind = "claude-cli" | "anthropic-api";

export interface RunnerSelection {
  /** Explicit runner instance — wins over kind. Used for tests + injection. */
  runner?: SpawnRunner;
  kind?: RunnerKind;
}

/** Select a runner: injected instance > kind > default (claude CLI). */
export function resolveRunner(sel: RunnerSelection): SpawnRunner {
  if (sel.runner) return sel.runner;
  const kind = sel.kind ?? "claude-cli";
  switch (kind) {
    case "claude-cli":
      return claudeCliRunner;
    case "anthropic-api":
      return anthropicApiRunner;
    default:
      throw new Error(`unknown runner kind: ${String(kind)}`);
  }
}

/**
 * Spawn an agent for a task. Always resolves to a SpawnResult — a runner that
 * throws is caught and reported as {ok:false} so the orchestrator stays
 * deterministic.
 */
export async function spawnAgent(req: SpawnRequest, sel: RunnerSelection): Promise<SpawnResult> {
  const runner = resolveRunner(sel);
  try {
    return await runner.run(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: "",
      tokens_in: 0,
      tokens_out: 0,
      model: req.model ?? "unknown",
      cost_usd: 0,
      duration_ms: 0,
      ok: false,
      error: message,
    };
  }
}
