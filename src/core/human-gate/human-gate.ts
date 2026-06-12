/**
 * human-gate — the async FINAL GATE.
 *
 * After runPlan parks a stream at `pending-human`, a human reviews the delivered
 * goods and, in a *separate* invocation, accepts (-> closed) or rejects
 * (-> reopened). The verdict is its own signed telemetry event, attributed to a
 * human:<handle> id, so the final sign-off is as unforgeable and traceable as a
 * gate signoff. This is never a blocking prompt. See TEO-5.md §1.
 */
import type { ProjectPaths, TeoHome } from "../home/home.js";
import { sign } from "../signing/signing.js";
import { appendEvent, nextSeq } from "../telemetry/telemetry.js";

export interface HumanGateRequest {
  plan_id: string;
  decision: "accept" | "reject";
  /** human:<handle> id of the deciding human. */
  human: string;
  ts: string;
  /** Optional rejection reason (or context on accept). */
  reason?: string;
}

export interface HumanGateResult {
  status: "closed" | "reopened";
  verdict: "accept" | "reject";
  seq: number;
  signature: string;
}

const GATE_TASK_ID = "human-gate";

/** Record a human accept/reject as a signed HUMAN_GATE event and return the outcome. */
export function humanGate(home: TeoHome, paths: ProjectPaths, req: HumanGateRequest): HumanGateResult {
  const verdict = req.decision;
  // Compute the seq the event will get, sign over it, then append the event
  // carrying its own signature (the append-only line is never mutated after).
  const seq = nextSeq(paths, req.plan_id);
  const signature = sign(home, {
    plan_id: req.plan_id,
    task_id: GATE_TASK_ID,
    actor_id: req.human,
    verdict,
    ts: req.ts,
    seq,
  });

  appendEvent(paths, {
    plan_id: req.plan_id,
    task_id: GATE_TASK_ID,
    ts: req.ts,
    phase: "HUMAN_GATE",
    actor_id: req.human,
    actor_type: "HUMAN",
    verdict,
    detail: { reason: req.reason ?? "" },
    signature,
  });

  return {
    status: verdict === "accept" ? "closed" : "reopened",
    verdict,
    seq,
    signature,
  };
}
