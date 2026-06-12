/**
 * identity — the agent registry and ID issuance.
 *
 * Every task_actor, gate_owner, and telemetry actor_id references a stable id
 * issued here. Records are append-only in ~/.teo/registry/agents.jsonl, so the
 * registry is itself an audit trail of who was ever issued. See TEO-5.md §5.
 *
 * Agent ids:  <type-prefix>-<NNN>   e.g. eng-003, qa-001, sage-001
 * Human ids:  human:<handle>        e.g. human:byazaki (never registered)
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { ensureTeoHome, type TeoHome } from "../home/home.js";

/** The closed set of agent roles. */
export const AGENT_TYPES = ["SAGE", "ENGINEER", "QA", "CREATE", "COORD"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

/** id prefix per type — kept short and greppable. */
const PREFIX: Record<AgentType, string> = {
  SAGE: "sage",
  ENGINEER: "eng",
  QA: "qa",
  CREATE: "create",
  COORD: "coord",
};

export interface AgentRecord {
  agent_id: string;
  agent_type: AgentType | "HUMAN";
  issued_at: string;
  active: boolean;
}

export interface IssueRequest {
  agent_type: AgentType;
  /** ISO-8601 UTC. Injected (no Date.now in core) for deterministic tests. */
  issued_at: string;
}

const AGENT_ID_RE = /^[a-z]+-\d{3}$/;
const HUMAN_ID_RE = /^human:[A-Za-z0-9._-]+$/;

/** Read all registry records (skips blank lines). Empty if no registry yet. */
export function listAgents(home: TeoHome): AgentRecord[] {
  if (!existsSync(home.registryPath)) return [];
  const raw = readFileSync(home.registryPath, "utf8");
  const out: AgentRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    out.push(JSON.parse(trimmed) as AgentRecord);
  }
  return out;
}

/**
 * Issue a new agent id of the given type. Sequence is per-type and recovered
 * from the existing registry, so it survives process restarts.
 */
export function issueAgent(home: TeoHome, req: IssueRequest): AgentRecord {
  const prefix = PREFIX[req.agent_type];
  if (!prefix) {
    throw new Error(`unknown agent type: ${String(req.agent_type)}`);
  }
  ensureTeoHome(home);

  const existing = listAgents(home);
  let maxSeq = 0;
  for (const rec of existing) {
    if (rec.agent_id.startsWith(`${prefix}-`)) {
      const seq = Number.parseInt(rec.agent_id.slice(prefix.length + 1), 10);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  const next = maxSeq + 1;
  const record: AgentRecord = {
    agent_id: `${prefix}-${String(next).padStart(3, "0")}`,
    agent_type: req.agent_type,
    issued_at: req.issued_at,
    active: true,
  };
  appendFileSync(home.registryPath, `${JSON.stringify(record)}\n`);
  return record;
}

/**
 * Look up an agent by id. Human ids always resolve (they are not registered).
 * Returns null for an unknown agent id or a missing registry.
 */
export function lookupAgent(home: TeoHome, agentId: string): AgentRecord | null {
  if (HUMAN_ID_RE.test(agentId)) {
    return { agent_id: agentId, agent_type: "HUMAN", issued_at: "", active: true };
  }
  for (const rec of listAgents(home)) {
    if (rec.agent_id === agentId) return rec;
  }
  return null;
}

/** Build a human id from a handle. */
export function humanId(handle: string): string {
  if (handle.length === 0) throw new Error("humanId requires a non-empty handle");
  return `human:${handle}`;
}

/** Shape check for any actor id (agent or human). Does not hit the registry. */
export function isValidAgentId(id: string): boolean {
  return AGENT_ID_RE.test(id) || HUMAN_ID_RE.test(id);
}
