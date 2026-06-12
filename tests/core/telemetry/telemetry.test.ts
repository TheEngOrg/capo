import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureTeoHome,
  projectId,
  projectPaths,
  resolveTeoHome,
  type ProjectPaths,
  type TeoHome,
} from "../../../src/core/home/home.js";
import {
  appendEvent,
  readEvents,
  nextSeq,
  financeRollup,
  type TelemetryEvent,
} from "../../../src/core/telemetry/telemetry.js";

let sandbox: string;
let home: TeoHome;
let paths: ProjectPaths;
const PLAN = "plan-001";

function ev(partial: Partial<TelemetryEvent>): Omit<TelemetryEvent, "seq" | "event_id"> {
  return {
    plan_id: PLAN,
    task_id: null,
    ts: "2026-06-11T00:00:00Z",
    phase: "RUN",
    actor_id: "system",
    actor_type: "SYSTEM",
    verdict: "n/a",
    detail: {},
    signature: null,
    ...partial,
  };
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-telemetry-test-"));
  home = resolveTeoHome({ TEO_HOME: sandbox });
  ensureTeoHome(home);
  paths = projectPaths(home, projectId({ absPath: "/p" }));
  paths.ensure();
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("appendEvent", () => {
  it("assigns seq 1 to the first event of a plan", () => {
    const written = appendEvent(paths, ev({ phase: "PLAN" }));
    expect(written.seq).toBe(1);
  });

  it("assigns a monotonic seq within a plan", () => {
    appendEvent(paths, ev({ phase: "PLAN" }));
    const second = appendEvent(paths, ev({ phase: "RUN" }));
    const third = appendEvent(paths, ev({ phase: "DELIVER" }));
    expect(second.seq).toBe(2);
    expect(third.seq).toBe(3);
  });

  it("stamps a unique event_id on each event", () => {
    const a = appendEvent(paths, ev({}));
    const b = appendEvent(paths, ev({}));
    expect(a.event_id).not.toBe(b.event_id);
    expect(a.event_id).toMatch(/[0-9a-f-]{36}/);
  });

  it("writes one JSONL line per event to events/<plan_id>.jsonl", () => {
    appendEvent(paths, ev({ phase: "PLAN" }));
    appendEvent(paths, ev({ phase: "RUN" }));
    const file = join(paths.eventsDir, `${PLAN}.jsonl`);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).phase).toBe("PLAN");
    expect(JSON.parse(lines[1]).phase).toBe("RUN");
  });

  it("keeps seq independent across plans", () => {
    appendEvent(paths, ev({ plan_id: "plan-A" }));
    const b1 = appendEvent(paths, ev({ plan_id: "plan-B" }));
    expect(b1.seq).toBe(1);
  });

  it("recovers seq from disk (survives restart)", () => {
    appendEvent(paths, ev({ phase: "PLAN" }));
    // Fresh ProjectPaths handle — simulates a new process.
    const paths2 = projectPaths(home, projectId({ absPath: "/p" }));
    const next = appendEvent(paths2, ev({ phase: "RUN" }));
    expect(next.seq).toBe(2);
  });
});

describe("nextSeq", () => {
  it("is 1 for a plan with no events", () => {
    expect(nextSeq(paths, "fresh-plan")).toBe(1);
  });

  it("is one past the highest written seq", () => {
    appendEvent(paths, ev({}));
    appendEvent(paths, ev({}));
    expect(nextSeq(paths, PLAN)).toBe(3);
  });
});

describe("readEvents", () => {
  it("returns events in written order", () => {
    appendEvent(paths, ev({ phase: "PLAN" }));
    appendEvent(paths, ev({ phase: "CLOSE" }));
    const events = readEvents(paths, PLAN);
    expect(events.map((e) => e.phase)).toEqual(["PLAN", "CLOSE"]);
  });

  it("returns an empty array for an unknown plan", () => {
    expect(readEvents(paths, "nope")).toEqual([]);
  });

  it("skips blank lines defensively", () => {
    appendEvent(paths, ev({}));
    const { appendFileSync } = require("node:fs");
    appendFileSync(join(paths.eventsDir, `${PLAN}.jsonl`), "\n\n");
    expect(readEvents(paths, PLAN)).toHaveLength(1);
  });
});

describe("financeRollup", () => {
  it("sums cost and tokens grouped by actor_id", () => {
    appendEvent(
      paths,
      ev({ actor_id: "eng-001", cost_usd: 0.02, tokens_in: 100, tokens_out: 50 }),
    );
    appendEvent(
      paths,
      ev({ actor_id: "eng-001", cost_usd: 0.03, tokens_in: 200, tokens_out: 80 }),
    );
    appendEvent(
      paths,
      ev({ actor_id: "qa-001", cost_usd: 0.01, tokens_in: 40, tokens_out: 10 }),
    );
    const roll = financeRollup(paths, PLAN);
    expect(roll.byActor["eng-001"].cost_usd).toBeCloseTo(0.05);
    expect(roll.byActor["eng-001"].tokens_in).toBe(300);
    expect(roll.byActor["eng-001"].tokens_out).toBe(130);
    expect(roll.byActor["qa-001"].cost_usd).toBeCloseTo(0.01);
  });

  it("reports a total across all actors", () => {
    appendEvent(paths, ev({ actor_id: "eng-001", cost_usd: 0.02 }));
    appendEvent(paths, ev({ actor_id: "qa-001", cost_usd: 0.03 }));
    expect(financeRollup(paths, PLAN).total.cost_usd).toBeCloseTo(0.05);
  });

  it("treats missing finance fields as zero (SCRIPT/system events)", () => {
    appendEvent(paths, ev({ actor_id: "system", phase: "MECH_VERIFY" }));
    const roll = financeRollup(paths, PLAN);
    expect(roll.total.cost_usd).toBe(0);
    expect(roll.total.tokens_in).toBe(0);
  });

  it("returns a zero rollup for an unknown plan", () => {
    const roll = financeRollup(paths, "nope");
    expect(roll.total.cost_usd).toBe(0);
    expect(Object.keys(roll.byActor)).toHaveLength(0);
  });
});
