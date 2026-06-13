/**
 * normalize — canonicalize a demo run's outputs so they're byte-stable for
 * golden diffing. Strips the non-deterministic fields (event_id, duration_ms,
 * HUMAN_GATE wall-clock ts) and shape-asserts-then-redacts HMAC signatures (the
 * demo signing key is gitignored / per-machine, so we never golden an exact
 * signature). For the live (agent) tier, token/cost values and LLM output are
 * blurred too; the deterministic spine (seq/phase/actor/verdict/detail/
 * model-presence) is what survives into the golden. See
 * docs/specs/TEO-5-demo-suite.md §4.
 */
import type { FinanceRollup, TelemetryEvent } from "../../../src/core/telemetry/telemetry.js";

export type Tier = "script" | "agent";

const HEX64 = /^[0-9a-f]{64}$/;

/** A normalized event: the golden spine plus placeholder-redacted volatiles. */
export interface NormalizedEvent {
  event_id: "<uuid>";
  seq: number;
  ts: string | "<ts>";
  phase: string;
  task_id: string | null;
  actor_id: string;
  actor_type: string;
  verdict: string;
  signature: "<sig>" | null;
  /** model-presence is a spine fact; the model string itself never is. */
  model_present: boolean;
  detail: Record<string, unknown>;
  duration_ms?: "<duration_ms>";
  tokens_in?: number | "<n>";
  tokens_out?: number | "<n>";
  cost_usd?: number | "<n>";
}

/** Assert a signature is well-formed (catches key/format drift), then redact. */
function redactSignature(sig: string, label: string): "<sig>" {
  if (!HEX64.test(sig)) {
    throw new Error(`${label}: signature is not 64-hex: ${sig}`);
  }
  return "<sig>";
}

function normalizeDetail(detail: Record<string, unknown>, tier: Tier): Record<string, unknown> {
  if (tier !== "agent") return detail;
  const copy = { ...detail };
  if ("model" in copy) copy.model = "<model>";
  if ("output" in copy) copy.output = "<output>";
  return copy;
}

/** Canonicalize one telemetry event. */
export function normalizeEvent(e: TelemetryEvent, tier: Tier): NormalizedEvent {
  const out: NormalizedEvent = {
    event_id: "<uuid>",
    seq: e.seq,
    ts: e.ts,
    phase: e.phase,
    task_id: e.task_id,
    actor_id: e.actor_id,
    actor_type: e.actor_type,
    verdict: e.verdict,
    signature:
      e.signature === null ? null : redactSignature(e.signature, `seq ${e.seq} (${e.phase})`),
    model_present: e.model !== undefined,
    detail: normalizeDetail(e.detail, tier),
  };

  if (e.duration_ms !== undefined) out.duration_ms = "<duration_ms>";

  // HUMAN_GATE stamps a wall-clock ts (CLI nowIso), unlike orchestrator events
  // which use the plan's fixed created_at. Scrub it.
  if (e.phase === "HUMAN_GATE") out.ts = "<ts>";

  // Finance fields: SCRIPT tier keeps the 0/absent values exact (a non-zero
  // value in a SCRIPT run is itself a regression). Agent tier blurs them.
  if (tier === "agent") {
    if (e.tokens_in !== undefined) out.tokens_in = "<n>";
    if (e.tokens_out !== undefined) out.tokens_out = "<n>";
    if (e.cost_usd !== undefined) out.cost_usd = "<n>";
  } else {
    if (e.tokens_in !== undefined) out.tokens_in = e.tokens_in;
    if (e.tokens_out !== undefined) out.tokens_out = e.tokens_out;
    if (e.cost_usd !== undefined) out.cost_usd = e.cost_usd;
  }

  return out;
}

type Totals = { cost_usd: number | "<n>"; tokens_in: number | "<n>"; tokens_out: number | "<n>" };

export interface NormalizedFinance {
  byActor: Record<string, Totals>;
  total: Totals;
  llm_calls: { byActor: Record<string, number>; total: number };
}

const blurTotals = (): Totals => ({ cost_usd: "<n>", tokens_in: "<n>", tokens_out: "<n>" });

/** Canonicalize a finance rollup. Script tier keeps it exact (all-zero). */
export function normalizeFinance(rollup: FinanceRollup, tier: Tier): NormalizedFinance {
  if (tier !== "agent") return rollup as NormalizedFinance;
  const byActor: Record<string, Totals> = {};
  for (const id of Object.keys(rollup.byActor)) byActor[id] = blurTotals();
  return { byActor, total: blurTotals(), llm_calls: rollup.llm_calls };
}

interface RunTask {
  task_id: string;
  verdict: string;
  signed_by?: string;
  signature?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  detail?: unknown;
}
interface RunResult {
  plan_id: string;
  status: string;
  tasks: RunTask[];
}

export interface NormalizedRunResult {
  plan_id: string;
  status: string;
  tasks: Array<Record<string, unknown>>;
}

/** Canonicalize the `teo run` RunResult: redact gate signatures, drop detail. */
export function normalizeRunResult(result: RunResult, tier: Tier): NormalizedRunResult {
  return {
    plan_id: result.plan_id,
    status: result.status,
    tasks: result.tasks.map((t) => {
      const out: Record<string, unknown> = { task_id: t.task_id, verdict: t.verdict };
      if (t.signed_by !== undefined) out.signed_by = t.signed_by;
      if (t.signature !== undefined) {
        out.signature = redactSignature(t.signature, `task ${t.task_id}`);
      }
      if (tier === "agent") {
        if (t.tokens_in !== undefined) out.tokens_in = "<n>";
        if (t.tokens_out !== undefined) out.tokens_out = "<n>";
        if (t.cost_usd !== undefined) out.cost_usd = "<n>";
      }
      return out;
    }),
  };
}
