import { describe, expect, it, vi } from "vitest";
import {
  spawnAgent,
  resolveRunner,
  type SpawnRequest,
  type SpawnRunner,
  type SpawnResult,
} from "../../../src/core/agent-spawn/agent-spawn.js";

const baseRequest: SpawnRequest = {
  agent_id: "eng-003",
  agent_type: "ENGINEER",
  task_id: "t-1",
  prompt: "write the thing",
  model: "claude-opus-4-8",
};

function fakeRunner(over: Partial<SpawnResult> = {}): SpawnRunner {
  return {
    name: "fake",
    run: async () => ({
      output: "done",
      tokens_in: 100,
      tokens_out: 40,
      model: "claude-opus-4-8",
      cost_usd: 0.01,
      duration_ms: 5,
      ok: true,
      ...over,
    }),
  };
}

describe("spawnAgent", () => {
  it("returns the runner's normalized result", async () => {
    const res = await spawnAgent(baseRequest, { runner: fakeRunner() });
    expect(res.ok).toBe(true);
    expect(res.output).toBe("done");
    expect(res.tokens_in).toBe(100);
    expect(res.tokens_out).toBe(40);
    expect(res.cost_usd).toBeCloseTo(0.01);
  });

  it("passes the request through to the runner", async () => {
    const run = vi.fn(async () => ({
      output: "x",
      tokens_in: 1,
      tokens_out: 1,
      model: "m",
      cost_usd: 0,
      duration_ms: 1,
      ok: true,
    }));
    await spawnAgent(baseRequest, { runner: { name: "spy", run } });
    expect(run).toHaveBeenCalledWith(baseRequest);
  });

  it("surfaces a runner failure as ok:false without throwing", async () => {
    const failing: SpawnRunner = {
      name: "boom",
      run: async () => ({
        output: "",
        tokens_in: 0,
        tokens_out: 0,
        model: "m",
        cost_usd: 0,
        duration_ms: 0,
        ok: false,
        error: "model unavailable",
      }),
    };
    const res = await spawnAgent(baseRequest, { runner: failing });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unavailable/);
  });

  it("wraps a thrown runner error into an ok:false result", async () => {
    const thrower: SpawnRunner = {
      name: "throws",
      run: async () => {
        throw new Error("network down");
      },
    };
    const res = await spawnAgent(baseRequest, { runner: thrower });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/network down/);
  });

  it("wraps a thrown non-Error value (string) into an ok:false result", async () => {
    const thrower: SpawnRunner = {
      name: "throws-string",
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      run: async () => {
        throw "raw string failure";
      },
    };
    const res = await spawnAgent(baseRequest, { runner: thrower });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("raw string failure");
    expect(res.model).toBe(baseRequest.model);
  });

  it("falls back to model 'unknown' when the request omits a model and the runner throws", async () => {
    const thrower: SpawnRunner = {
      name: "throws",
      run: async () => {
        throw new Error("boom");
      },
    };
    const { model: _drop, ...noModel } = baseRequest;
    const res = await spawnAgent(noModel, { runner: thrower });
    expect(res.model).toBe("unknown");
  });
});

describe("resolveRunner", () => {
  it("defaults to the claude CLI runner", () => {
    const runner = resolveRunner({});
    expect(runner.name).toBe("claude-cli");
  });

  it("selects the claude CLI runner explicitly", () => {
    expect(resolveRunner({ kind: "claude-cli" }).name).toBe("claude-cli");
  });

  it("selects the anthropic API runner", () => {
    expect(resolveRunner({ kind: "anthropic-api" }).name).toBe("anthropic-api");
  });

  it("returns an injected runner verbatim", () => {
    const injected = fakeRunner();
    expect(resolveRunner({ runner: injected })).toBe(injected);
  });

  it("throws on an unknown runner kind", () => {
    // @ts-expect-error — deliberately invalid kind
    expect(() => resolveRunner({ kind: "telepathy" })).toThrow(/unknown runner/i);
  });
});
