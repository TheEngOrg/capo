import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../../../src/core/telemetry/telemetry.js";
import { normalizeEvent, normalizeFinance, normalizeRunResult } from "./normalize.js";

const HEX64 = "a".repeat(64);

/** A minimal valid event with overridable fields. */
function ev(partial: Partial<TelemetryEvent>): TelemetryEvent {
  return {
    event_id: "11111111-1111-1111-1111-111111111111",
    plan_id: "p",
    task_id: null,
    seq: 1,
    ts: "2026-06-12T00:00:00.000Z",
    phase: "RUN",
    actor_id: "system",
    actor_type: "SYSTEM",
    verdict: "n/a",
    detail: {},
    signature: null,
    ...partial,
  };
}

describe("normalizeEvent — always-scrubbed fields", () => {
  it("scrubs event_id to <uuid> and keeps the spine", () => {
    const out = normalizeEvent(ev({ seq: 3, phase: "TASK_START", task_id: "t1" }), "script");
    expect(out.event_id).toBe("<uuid>");
    expect(out.seq).toBe(3);
    expect(out.phase).toBe("TASK_START");
    expect(out.task_id).toBe("t1");
    expect(out.actor_id).toBe("system");
    expect(out.actor_type).toBe("SYSTEM");
    expect(out.verdict).toBe("n/a");
    expect(out.ts).toBe("2026-06-12T00:00:00.000Z"); // deterministic clock kept
  });

  it("scrubs duration_ms when present", () => {
    const out = normalizeEvent(ev({ duration_ms: 1234 }), "script");
    expect(out.duration_ms).toBe("<duration_ms>");
  });

  it("records model presence as a boolean and never leaks the model string", () => {
    const withModel = normalizeEvent(ev({ phase: "TASK_OUTPUT", model: "claude-opus-4-8" }), "agent");
    expect(withModel.model_present).toBe(true);
    expect((withModel as unknown as Record<string, unknown>).model).toBeUndefined();
    const noModel = normalizeEvent(ev({ phase: "TASK_OUTPUT" }), "script");
    expect(noModel.model_present).toBe(false);
  });
});

describe("normalizeEvent — signatures", () => {
  it("keeps null signatures as null (SCRIPT/system events)", () => {
    expect(normalizeEvent(ev({ signature: null }), "script").signature).toBeNull();
  });

  it("shape-asserts a valid 64-hex signature then redacts to <sig>", () => {
    const out = normalizeEvent(ev({ phase: "GATE", actor_type: "QA", signature: HEX64 }), "script");
    expect(out.signature).toBe("<sig>");
  });

  it("throws on a malformed signature (regression: caught key/format drift)", () => {
    expect(() => normalizeEvent(ev({ phase: "GATE", signature: "not-hex" }), "script")).toThrow(
      /signature/i,
    );
  });
});

describe("normalizeEvent — HUMAN_GATE real clock", () => {
  it("scrubs the wall-clock ts to <ts> for HUMAN_GATE only", () => {
    const out = normalizeEvent(
      ev({
        phase: "HUMAN_GATE",
        actor_id: "human:byazaki",
        actor_type: "HUMAN",
        verdict: "accept",
        ts: "2026-06-12T14:45:10.522Z",
        signature: HEX64,
        detail: { reason: "ship it" },
      }),
      "script",
    );
    expect(out.ts).toBe("<ts>");
    expect(out.signature).toBe("<sig>");
    expect(out.verdict).toBe("accept");
    expect(out.detail).toEqual({ reason: "ship it" }); // reason is deterministic
  });
});

describe("normalizeEvent — tier branch", () => {
  it("script tier keeps SCRIPT detail + zero/absent token fields exact", () => {
    const out = normalizeEvent(
      ev({ phase: "TASK_OUTPUT", verdict: "pass", task_id: "deploy", detail: { exit_code: 0, kind: "script" } }),
      "script",
    );
    expect(out.detail).toEqual({ exit_code: 0, kind: "script" });
  });

  it("agent tier blurs tokens/cost and redacts detail.model + detail.output", () => {
    const out = normalizeEvent(
      ev({
        phase: "TASK_OUTPUT",
        actor_id: "eng-002",
        actor_type: "ENGINEER",
        verdict: "pass",
        tokens_in: 800,
        tokens_out: 300,
        cost_usd: 0.04,
        model: "claude-opus-4-8",
        detail: { kind: "agent", model: "claude-opus-4-8", output: "some llm prose" },
      }),
      "agent",
    );
    expect(out.tokens_in).toBe("<n>");
    expect(out.tokens_out).toBe("<n>");
    expect(out.cost_usd).toBe("<n>");
    expect(out.model_present).toBe(true);
    expect(out.detail).toEqual({ kind: "agent", model: "<model>", output: "<output>" });
  });
});

describe("normalizeFinance", () => {
  const zeroRollup = {
    byActor: { system: { cost_usd: 0, tokens_in: 0, tokens_out: 0 } },
    total: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    llm_calls: { byActor: {}, total: 0 },
  };

  it("script tier keeps the all-zero rollup exact (the 0-token regression signal)", () => {
    expect(normalizeFinance(zeroRollup, "script")).toEqual(zeroRollup);
  });

  it("agent tier blurs cost/token values but keeps llm_calls counts + actor keys", () => {
    const agentRollup = {
      byActor: { "eng-002": { cost_usd: 0.04, tokens_in: 800, tokens_out: 300 } },
      total: { cost_usd: 0.51, tokens_in: 17881, tokens_out: 493 },
      llm_calls: { byActor: { "eng-002": 1, "coord-001": 1, "qa-005": 1 }, total: 3 },
    };
    const out = normalizeFinance(agentRollup, "agent");
    expect(out.total).toEqual({ cost_usd: "<n>", tokens_in: "<n>", tokens_out: "<n>" });
    expect(out.byActor["eng-002"]).toEqual({ cost_usd: "<n>", tokens_in: "<n>", tokens_out: "<n>" });
    expect(out.llm_calls).toEqual({ byActor: { "eng-002": 1, "coord-001": 1, "qa-005": 1 }, total: 3 });
  });
});

describe("normalizeRunResult", () => {
  it("redacts gate signature + drops task detail, keeps status/verdicts", () => {
    const result = {
      plan_id: "p",
      status: "pending-human",
      tasks: [
        { task_id: "deploy", verdict: "pass", detail: { exit_code: 0, kind: "script" } },
        { task_id: "qa-gate", verdict: "pass", signed_by: "qa-005", signature: HEX64 },
      ],
    };
    const out = normalizeRunResult(result, "script");
    expect(out.status).toBe("pending-human");
    expect(out.tasks[0]).toEqual({ task_id: "deploy", verdict: "pass" });
    expect(out.tasks[1]).toEqual({ task_id: "qa-gate", verdict: "pass", signed_by: "qa-005", signature: "<sig>" });
  });
});
