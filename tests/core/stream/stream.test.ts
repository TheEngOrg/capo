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
import { appendEvent } from "../../../src/core/telemetry/telemetry.js";
import { deriveStreamState, type StreamState } from "../../../src/core/stream/stream.js";

let sandbox: string;
let home: TeoHome;
let paths: ProjectPaths;
const PLAN = "plan-1";

function ev(phase: string, verdict = "n/a") {
  appendEvent(paths, {
    plan_id: PLAN,
    task_id: null,
    ts: "2026-06-11T00:00:00Z",
    phase: phase as never,
    actor_id: "system",
    actor_type: "SYSTEM",
    verdict: verdict as never,
    detail: {},
    signature: null,
  });
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-stream-test-"));
  home = resolveTeoHome({ TEO_HOME: join(sandbox, "teohome") });
  ensureTeoHome(home);
  paths = projectPaths(home, "proj-1");
  paths.ensure();
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("deriveStreamState", () => {
  it("is 'unknown' for a plan with no events", () => {
    expect(deriveStreamState(paths, "nope").status).toBe("unknown");
  });

  it("is 'running' after RUN with no terminal event", () => {
    ev("RUN");
    ev("TASK_START");
    const s: StreamState = deriveStreamState(paths, PLAN);
    expect(s.status).toBe("running");
  });

  it("is 'pending-human' after a DELIVER event", () => {
    ev("RUN");
    ev("DELIVER");
    expect(deriveStreamState(paths, PLAN).status).toBe("pending-human");
  });

  it("is 'error' after an ERROR event", () => {
    ev("RUN");
    ev("ERROR", "fail");
    expect(deriveStreamState(paths, PLAN).status).toBe("error");
  });

  it("is 'closed' after a HUMAN_GATE accept", () => {
    ev("RUN");
    ev("DELIVER");
    ev("HUMAN_GATE", "accept");
    expect(deriveStreamState(paths, PLAN).status).toBe("closed");
  });

  it("is 'reopened' after a HUMAN_GATE reject", () => {
    ev("RUN");
    ev("DELIVER");
    ev("HUMAN_GATE", "reject");
    expect(deriveStreamState(paths, PLAN).status).toBe("reopened");
  });

  it("reflects the latest terminal event when the stream is reopened then rerun", () => {
    ev("RUN");
    ev("DELIVER");
    ev("HUMAN_GATE", "reject"); // reopened
    ev("RUN"); // rerun
    ev("DELIVER"); // delivered again
    expect(deriveStreamState(paths, PLAN).status).toBe("pending-human");
  });

  it("reports the last event seq and total event count", () => {
    ev("RUN");
    ev("DELIVER");
    const s = deriveStreamState(paths, PLAN);
    expect(s.last_seq).toBe(2);
    expect(s.event_count).toBe(2);
  });
});
