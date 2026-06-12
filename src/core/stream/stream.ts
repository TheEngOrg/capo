/**
 * stream — work-stream state, derived from the telemetry ledger.
 *
 * The ledger is the source of truth; stream state is a projection. Rather than
 * mutate a status file, we replay events and read the latest terminal signal.
 * This makes state tamper-evident (it must agree with the append-only events)
 * and rebuildable at any time. See TEO-5.md §2, §6.
 */
import type { ProjectPaths } from "../home/home.js";
import { readEvents } from "../telemetry/telemetry.js";

export type StreamStatus =
  | "unknown"
  | "running"
  | "pending-human"
  | "closed"
  | "reopened"
  | "error";

export interface StreamState {
  plan_id: string;
  status: StreamStatus;
  last_seq: number;
  event_count: number;
}

/**
 * Derive the current state of a work stream by replaying its events. The latest
 * status-bearing event wins, so a reopened-then-rerun stream reflects its most
 * recent phase.
 */
export function deriveStreamState(paths: ProjectPaths, planId: string): StreamState {
  const events = readEvents(paths, planId);
  if (events.length === 0) {
    return { plan_id: planId, status: "unknown", last_seq: 0, event_count: 0 };
  }

  let status: StreamStatus = "running";
  for (const e of events) {
    switch (e.phase) {
      case "RUN":
        status = "running";
        break;
      case "DELIVER":
        status = "pending-human";
        break;
      case "ERROR":
        status = "error";
        break;
      case "HUMAN_GATE":
        status = e.verdict === "accept" ? "closed" : "reopened";
        break;
      default:
        // Non-terminal step events (TASK_*, MECH_VERIFY, GATE) don't change the
        // top-level stream status.
        break;
    }
  }

  const last = events[events.length - 1];
  return { plan_id: planId, status, last_seq: last.seq, event_count: events.length };
}
