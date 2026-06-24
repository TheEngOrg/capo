// =============================================================================
// normalize.ts — Strip non-deterministic fields from ledger event streams
//
// Golden snapshots must be stable across runs. These fields vary per run:
//   - event_id (UUID v4 — random)
//   - ts (ISO-8601 timestamp — current time)
//   - detail.timestamp (registry timestamps in records)
//
// HMAC signatures are not in the ledger events themselves; they are in
// DemoResult.signatures. We normalize those separately to a shape assertion
// placeholder so goldens can assert the pattern without capturing the value.
//
// Fields that MUST be stable (golden-compared):
//   seq, verdict, phase, actor_id, actor_type, session_id, workflow_id,
//   task_id, turn_id, detail (except timestamps inside it)
// =============================================================================

export interface NormalizedEvent {
  seq: number;
  session_id: string;
  workflow_id: string;
  task_id: string | null;
  turn_id: string | null;
  actor_id: string;
  actor_type: "SCRIPT" | "AGENT" | "SYSTEM";
  phase: string;
  verdict: "PASS" | "FAIL" | "BLOCKED" | "SKIPPED" | null;
  detail: Record<string, unknown> | null;
  // Normalized placeholders (not the real values)
  event_id: "<uuid>";
  ts: "<timestamp>";
}

export interface SignatureRecord {
  seq: number;
  task_id: string | null;
  signatureFormat: "<hmac-sha256-hex-64>";
  verified: boolean;
}

export interface NormalizedDemoResult {
  scenarioId: string;
  planId: string;
  overallStatus: "PASS" | "FAILED";
  events: NormalizedEvent[];
  signatures: SignatureRecord[];
  validationWarnings: string[];
}

/**
 * Normalize a raw ledger event for golden comparison.
 * Strips event_id and ts; replaces with placeholders.
 * Recursively removes timestamp fields from detail objects.
 */
export function normalizeEvent(event: Record<string, unknown>): NormalizedEvent {
  const detail = event["detail"] as Record<string, unknown> | null;
  const normalizedDetail = detail ? normalizeDetail(detail) : null;

  return {
    seq: event["seq"] as number,
    session_id: event["session_id"] as string,
    workflow_id: event["workflow_id"] as string,
    task_id: (event["task_id"] as string | null) ?? null,
    turn_id: (event["turn_id"] as string | null) ?? null,
    actor_id: event["actor_id"] as string,
    actor_type: event["actor_type"] as "SCRIPT" | "AGENT" | "SYSTEM",
    phase: event["phase"] as string,
    verdict: (event["verdict"] as "PASS" | "FAIL" | "BLOCKED" | "SKIPPED" | null) ?? null,
    detail: normalizedDetail,
    event_id: "<uuid>",
    ts: "<timestamp>",
  };
}

/**
 * Normalize a detail object: remove any timestamp fields that vary per run.
 */
function normalizeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(detail)) {
    // Skip fields that are timestamps (ISO-8601 pattern or known timestamp keys)
    if (
      key === "timestamp" ||
      key === "ts" ||
      key === "created_at" ||
      (typeof val === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val))
    ) {
      result[key] = "<timestamp>";
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Validate that a string looks like a 64-char hex HMAC-SHA-256 signature.
 */
export function isValidHmacHex(sig: string): boolean {
  return /^[0-9a-f]{64}$/.test(sig);
}
