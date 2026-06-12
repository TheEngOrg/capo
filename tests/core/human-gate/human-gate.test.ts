import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureTeoHome,
  projectPaths,
  resolveTeoHome,
  type ProjectPaths,
  type TeoHome,
} from "../../../src/core/home/home.js";
import { humanId } from "../../../src/core/identity/identity.js";
import { readEvents } from "../../../src/core/telemetry/telemetry.js";
import { verify } from "../../../src/core/signing/signing.js";
import { humanGate, type HumanGateResult } from "../../../src/core/human-gate/human-gate.js";

let sandbox: string;
let home: TeoHome;
let paths: ProjectPaths;
const PLAN = "plan-1";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-humangate-test-"));
  home = resolveTeoHome({ TEO_HOME: join(sandbox, "teohome") });
  ensureTeoHome(home);
  paths = projectPaths(home, "proj-1");
  paths.ensure();
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("humanGate — accept", () => {
  it("accepting closes the stream", () => {
    const res: HumanGateResult = humanGate(home, paths, {
      plan_id: PLAN,
      decision: "accept",
      human: humanId("byazaki"),
      ts: "2026-06-11T01:00:00Z",
    });
    expect(res.status).toBe("closed");
    expect(res.verdict).toBe("accept");
  });

  it("emits a signed HUMAN_GATE accept event attributed to the human", () => {
    humanGate(home, paths, {
      plan_id: PLAN,
      decision: "accept",
      human: humanId("byazaki"),
      ts: "2026-06-11T01:00:00Z",
    });
    const events = readEvents(paths, PLAN);
    const gate = events.find((e) => e.phase === "HUMAN_GATE");
    expect(gate?.verdict).toBe("accept");
    expect(gate?.actor_id).toBe("human:byazaki");
    expect(gate?.actor_type).toBe("HUMAN");
    expect(gate?.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the accept signature verifies against the canonical message", () => {
    const res = humanGate(home, paths, {
      plan_id: PLAN,
      decision: "accept",
      human: humanId("byazaki"),
      ts: "2026-06-11T01:00:00Z",
    });
    const ok = verify(
      home,
      {
        plan_id: PLAN,
        task_id: "human-gate",
        actor_id: "human:byazaki",
        verdict: "accept",
        ts: "2026-06-11T01:00:00Z",
        seq: res.seq,
      },
      res.signature,
    );
    expect(ok).toBe(true);
  });
});

describe("humanGate — reject", () => {
  it("rejecting reopens the stream", () => {
    const res = humanGate(home, paths, {
      plan_id: PLAN,
      decision: "reject",
      human: humanId("byazaki"),
      ts: "2026-06-11T01:00:00Z",
      reason: "tests are flaky",
    });
    expect(res.status).toBe("reopened");
    expect(res.verdict).toBe("reject");
  });

  it("records the rejection reason in the event detail", () => {
    humanGate(home, paths, {
      plan_id: PLAN,
      decision: "reject",
      human: humanId("byazaki"),
      ts: "2026-06-11T01:00:00Z",
      reason: "missing migration",
    });
    const gate = readEvents(paths, PLAN).find((e) => e.phase === "HUMAN_GATE");
    expect(gate?.detail.reason).toBe("missing migration");
  });

  it("a reject with no reason still records an empty reason", () => {
    humanGate(home, paths, {
      plan_id: PLAN,
      decision: "reject",
      human: humanId("byazaki"),
      ts: "2026-06-11T01:00:00Z",
    });
    const gate = readEvents(paths, PLAN).find((e) => e.phase === "HUMAN_GATE");
    expect(gate?.detail.reason).toBe("");
  });
});
