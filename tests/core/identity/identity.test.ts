import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureTeoHome, resolveTeoHome, type TeoHome } from "../../../src/core/home/home.js";
import {
  AGENT_TYPES,
  issueAgent,
  lookupAgent,
  listAgents,
  humanId,
  isValidAgentId,
  type AgentRecord,
} from "../../../src/core/identity/identity.js";

let sandbox: string;
let home: TeoHome;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "teo-identity-test-"));
  home = resolveTeoHome({ TEO_HOME: sandbox });
  ensureTeoHome(home);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("issueAgent", () => {
  it("issues a typed id with a zero-padded sequence", () => {
    const rec = issueAgent(home, { agent_type: "ENGINEER", issued_at: "2026-06-11T00:00:00Z" });
    expect(rec.agent_id).toBe("eng-001");
    expect(rec.agent_type).toBe("ENGINEER");
    expect(rec.active).toBe(true);
  });

  it("increments the sequence per type", () => {
    issueAgent(home, { agent_type: "ENGINEER", issued_at: "2026-06-11T00:00:00Z" });
    const second = issueAgent(home, { agent_type: "ENGINEER", issued_at: "2026-06-11T00:00:01Z" });
    expect(second.agent_id).toBe("eng-002");
  });

  it("keeps sequences independent across types", () => {
    issueAgent(home, { agent_type: "ENGINEER", issued_at: "2026-06-11T00:00:00Z" });
    const qa = issueAgent(home, { agent_type: "QA", issued_at: "2026-06-11T00:00:01Z" });
    expect(qa.agent_id).toBe("qa-001");
  });

  it("persists each record as one JSONL line, append-only", () => {
    issueAgent(home, { agent_type: "ENGINEER", issued_at: "2026-06-11T00:00:00Z" });
    issueAgent(home, { agent_type: "SAGE", issued_at: "2026-06-11T00:00:01Z" });
    const lines = readFileSync(home.registryPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).agent_id).toBe("eng-001");
    expect(JSON.parse(lines[1]).agent_id).toBe("sage-001");
  });

  it("recovers the next sequence from an existing registry (survives restart)", () => {
    issueAgent(home, { agent_type: "ENGINEER", issued_at: "2026-06-11T00:00:00Z" });
    // Fresh handle to the same registry file — simulates a new process.
    const home2 = resolveTeoHome({ TEO_HOME: sandbox });
    const rec = issueAgent(home2, { agent_type: "ENGINEER", issued_at: "2026-06-11T00:00:02Z" });
    expect(rec.agent_id).toBe("eng-002");
  });

  it("rejects an unknown agent type", () => {
    // @ts-expect-error — deliberately invalid type
    expect(() => issueAgent(home, { agent_type: "WIZARD", issued_at: "2026-06-11T00:00:00Z" })).toThrow(
      /unknown agent type/i,
    );
  });

  it("covers every declared agent type with a prefix", () => {
    for (const t of AGENT_TYPES) {
      const rec = issueAgent(home, { agent_type: t, issued_at: "2026-06-11T00:00:00Z" });
      expect(rec.agent_id).toMatch(/^[a-z]+-\d{3}$/);
    }
  });
});

describe("lookupAgent", () => {
  it("finds an issued agent by id", () => {
    issueAgent(home, { agent_type: "QA", issued_at: "2026-06-11T00:00:00Z" });
    const found = lookupAgent(home, "qa-001");
    expect(found?.agent_type).toBe("QA");
  });

  it("returns null for an unknown id", () => {
    expect(lookupAgent(home, "eng-999")).toBeNull();
  });

  it("returns null when the registry file does not exist yet", () => {
    const fresh = resolveTeoHome({ TEO_HOME: join(sandbox, "empty") });
    expect(lookupAgent(fresh, "eng-001")).toBeNull();
  });

  it("accepts a human id as always-valid without a registry entry", () => {
    const found = lookupAgent(home, "human:byazaki");
    expect(found?.agent_type).toBe("HUMAN");
    expect(found?.agent_id).toBe("human:byazaki");
  });
});

describe("listAgents", () => {
  it("returns all issued agents in order", () => {
    issueAgent(home, { agent_type: "ENGINEER", issued_at: "2026-06-11T00:00:00Z" });
    issueAgent(home, { agent_type: "QA", issued_at: "2026-06-11T00:00:01Z" });
    const all: AgentRecord[] = listAgents(home);
    expect(all.map((a) => a.agent_id)).toEqual(["eng-001", "qa-001"]);
  });

  it("returns an empty array when no registry exists", () => {
    const fresh = resolveTeoHome({ TEO_HOME: join(sandbox, "empty") });
    expect(listAgents(fresh)).toEqual([]);
  });

  it("skips blank lines defensively", () => {
    issueAgent(home, { agent_type: "ENGINEER", issued_at: "2026-06-11T00:00:00Z" });
    // append a stray blank line
    const { appendFileSync } = require("node:fs");
    appendFileSync(home.registryPath, "\n\n");
    expect(listAgents(home)).toHaveLength(1);
  });
});

describe("humanId", () => {
  it("builds a human: prefixed id from a handle", () => {
    expect(humanId("byazaki")).toBe("human:byazaki");
  });

  it("rejects an empty handle", () => {
    expect(() => humanId("")).toThrow();
  });
});

describe("isValidAgentId", () => {
  it("accepts a well-formed agent id", () => {
    expect(isValidAgentId("eng-003")).toBe(true);
  });

  it("accepts a human id", () => {
    expect(isValidAgentId("human:byazaki")).toBe(true);
  });

  it("rejects garbage", () => {
    expect(isValidAgentId("not an id")).toBe(false);
    expect(isValidAgentId("")).toBe(false);
  });
});
