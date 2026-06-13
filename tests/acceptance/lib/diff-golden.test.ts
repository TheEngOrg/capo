import { describe, expect, it } from "vitest";
import { diffGolden, formatDiff } from "./diff-golden.js";

/** A minimal bundle: events[] + finance + runResult + status. */
function bundle(overrides: Record<string, unknown> = {}) {
  return {
    events: [
      { seq: 1, phase: "RUN", verdict: "n/a", detail: { tasks: 1 } },
      { seq: 2, phase: "TASK_OUTPUT", verdict: "pass", detail: { exit_code: 0, kind: "script" } },
      { seq: 3, phase: "GATE", verdict: "pass", signature: "<sig>", detail: { constraints: 1 } },
    ],
    finance: { total: { cost_usd: 0, tokens_in: 0, tokens_out: 0 }, llm_calls: { total: 0, byActor: {} } },
    runResult: { plan_id: "p", status: "pending-human", tasks: [] },
    status: "pending-human",
    ...overrides,
  };
}

describe("diffGolden", () => {
  it("returns no diffs for identical bundles", () => {
    expect(diffGolden(bundle(), bundle())).toHaveLength(0);
  });

  it("flags a flipped verdict at the right seq with a semantic path", () => {
    const actual = bundle();
    actual.events[2].verdict = "fail";
    const diffs = diffGolden(actual, bundle());
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ seq: 3, phase: "GATE", path: "verdict", expected: "pass", actual: "fail" });
  });

  it("flags an event-count mismatch (the seq-count regression signal)", () => {
    const actual = bundle();
    actual.events.pop(); // drop the GATE event
    const diffs = diffGolden(actual, bundle());
    expect(diffs.some((d) => d.path === "events.length" && d.expected === 3 && d.actual === 2)).toBe(true);
  });

  it("flags a finance drift (e.g. an unexpected LLM call in a SCRIPT demo)", () => {
    const actual = bundle();
    actual.finance.llm_calls.total = 1;
    const diffs = diffGolden(actual, bundle());
    expect(diffs.some((d) => d.path === "finance.llm_calls.total")).toBe(true);
  });

  it("flags a status drift (e.g. closed vs reopened)", () => {
    const actual = bundle({ status: "reopened" });
    const diffs = diffGolden(actual, bundle());
    expect(diffs.some((d) => d.path === "status" && d.actual === "reopened")).toBe(true);
  });
});

describe("formatDiff", () => {
  it("renders a readable semantic diff with the regenerate hint", () => {
    const actual = bundle();
    actual.events[2].verdict = "fail";
    const text = formatDiff(diffGolden(actual, bundle()), "demo-planned.accept");
    expect(text).toContain("demo-planned.accept");
    expect(text).toContain("seq 3 (GATE)");
    expect(text).toContain("verdict");
    expect(text).toContain("GOLDEN_UPDATE");
  });

  it("returns an empty string when there are no diffs", () => {
    expect(formatDiff([], "x")).toBe("");
  });
});
