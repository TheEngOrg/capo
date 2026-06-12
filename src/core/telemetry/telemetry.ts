/**
 * telemetry — the append-only event ledger. THE AUDIT TRUTH.
 *
 * Every step and handoff appends one immutable JSONL line to
 * events/<plan_id>.jsonl. Nothing is ever mutated or deleted. seq is monotonic
 * per plan; a gap is a tamper signal. Finance rollups read this ledger.
 * See TEO-5.md §4.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ProjectPaths } from "../home/home.js";

export type Phase =
  | "PLAN"
  | "RUN"
  | "TASK_START"
  | "TASK_OUTPUT"
  | "MECH_VERIFY"
  | "RETRY"
  | "AGENT_VERIFY"
  | "GATE"
  | "DELIVER"
  | "HUMAN_GATE"
  | "CLOSE"
  | "ERROR";

export type Verdict = "pass" | "fail" | "block" | "accept" | "reject" | "n/a";

export type ActorType = "SAGE" | "ENGINEER" | "QA" | "CREATE" | "COORD" | "HUMAN" | "SYSTEM";

export interface TelemetryEvent {
  event_id: string;
  plan_id: string;
  task_id: string | null;
  seq: number;
  ts: string;
  phase: Phase;
  actor_id: string;
  actor_type: ActorType;
  verdict: Verdict;
  // finance — present on LLM-backed steps, absent/zero for SCRIPT + system.
  tokens_in?: number;
  tokens_out?: number;
  model?: string;
  cost_usd?: number;
  duration_ms?: number;
  detail: Record<string, unknown>;
  signature: string | null;
}

/** An event to append — seq and event_id are assigned by appendEvent. */
export type DraftEvent = Omit<TelemetryEvent, "seq" | "event_id">;

function eventsFile(paths: ProjectPaths, planId: string): string {
  return join(paths.eventsDir, `${planId}.jsonl`);
}

/** All events for a plan, in written order. Empty if none. */
export function readEvents(paths: ProjectPaths, planId: string): TelemetryEvent[] {
  const file = eventsFile(paths, planId);
  if (!existsSync(file)) return [];
  const out: TelemetryEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    out.push(JSON.parse(trimmed) as TelemetryEvent);
  }
  return out;
}

/** The seq the next appended event of this plan will receive. */
export function nextSeq(paths: ProjectPaths, planId: string): number {
  const events = readEvents(paths, planId);
  let max = 0;
  for (const e of events) {
    if (e.seq > max) max = e.seq;
  }
  return max + 1;
}

/**
 * Append an event. Assigns a monotonic per-plan seq (recovered from disk) and a
 * unique event_id. Returns the fully-formed event that was written.
 */
export function appendEvent(paths: ProjectPaths, draft: DraftEvent): TelemetryEvent {
  const event: TelemetryEvent = {
    ...draft,
    event_id: randomUUID(),
    seq: nextSeq(paths, draft.plan_id),
  };
  appendFileSync(eventsFile(paths, draft.plan_id), `${JSON.stringify(event)}\n`);
  return event;
}

export interface FinanceTotals {
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
}

/** How many LLM calls a plan made — the headline "agent is last resort" number. */
export interface LlmCallCount {
  byActor: Record<string, number>;
  total: number;
}

export interface FinanceRollup {
  byActor: Record<string, FinanceTotals>;
  total: FinanceTotals;
  /** Count of LLM-backed events (those carrying a model): Sage PLAN + AGENT tasks. */
  llm_calls: LlmCallCount;
}

function zero(): FinanceTotals {
  return { cost_usd: 0, tokens_in: 0, tokens_out: 0 };
}

/**
 * Sum cost + tokens for a plan, grouped by actor_id, plus a grand total, and
 * count the LLM calls. An LLM call is any event carrying a `model` — the planner
 * PLAN event and every AGENT task's TASK_OUTPUT set it; SCRIPT/system events do
 * not. So a well-planned (mostly-SCRIPT) run shows a small llm_calls.total.
 */
export function financeRollup(paths: ProjectPaths, planId: string): FinanceRollup {
  const byActor: Record<string, FinanceTotals> = {};
  const total = zero();
  const llmByActor: Record<string, number> = {};
  let llmTotal = 0;
  for (const e of readEvents(paths, planId)) {
    if (!byActor[e.actor_id]) byActor[e.actor_id] = zero();
    const bucket = byActor[e.actor_id];
    const cost = e.cost_usd ?? 0;
    const tin = e.tokens_in ?? 0;
    const tout = e.tokens_out ?? 0;
    bucket.cost_usd += cost;
    bucket.tokens_in += tin;
    bucket.tokens_out += tout;
    total.cost_usd += cost;
    total.tokens_in += tin;
    total.tokens_out += tout;
    if (e.model !== undefined) {
      llmByActor[e.actor_id] = (llmByActor[e.actor_id] ?? 0) + 1;
      llmTotal += 1;
    }
  }
  return { byActor, total, llm_calls: { byActor: llmByActor, total: llmTotal } };
}
