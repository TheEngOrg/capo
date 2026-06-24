// =============================================================================
// ledger.ts — AppendOnlyLedger (WS-CORE-05)
//
// Writes OTEL-compatible JSONL events to ~/.teo/ledger/<session_id>.jsonl
// (or an injected base dir for tests — zero footprint in the project dir).
//
// CONTRACT (read this before changing anything):
//
//   1. ZERO-FOOTPRINT — the ledger writes ONLY under ~/.teo/ (resolved from
//      os.homedir()) or the injected baseDir. It NEVER writes to the user's
//      project directory. Tests MUST inject baseDir; they MUST NOT rely on
//      the real ~/.teo/.
//
//   2. APPEND-ONLY — existing lines are NEVER rewritten or truncated.
//      append() opens the file with the 'a' flag on every call (atomic-ish
//      for single-process sequential use). The file grows monotonically.
//
//   3. SEQ OWNERSHIP — seq is assigned and auto-incremented by the ledger,
//      not by the caller. This guarantees strict monotonicity within a session.
//      seq starts at 1 for the first event. The caller provides all semantic
//      fields (session_id, workflow_id, phase, verdict, detail, etc.) but NOT
//      seq, event_id, or ts — the ledger assigns all three.
//
//   4. POST-CLOSE THROWS — after close() is called, any subsequent call to
//      append() or close() throws an error. This enforces the one-and-done
//      semantics of the CLOSE event; callers must not attempt further writes.
//
//   5. NON-SERIALIZABLE DETAIL — if detail contains a value that cannot be
//      serialized (BigInt, circular reference, etc.), append() throws a clear
//      LedgerSerializeError BEFORE writing anything. A corrupt/partial line
//      is never written to the file.
//
//   6. SESSION_ID SANITIZATION — session_id is validated at construction.
//      Any session_id containing path separators (/, \) or traversal sequences
//      (..) is rejected with a clear LedgerPathError. This prevents path
//      traversal out of ~/.teo/ledger/.
//
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Public error classes
// ---------------------------------------------------------------------------

/** Thrown when the ledger is used after it has been closed. */
export class LedgerClosedError extends Error {
  constructor(message: string = "Ledger is closed — no further events may be appended.") {
    super(message);
    this.name = "LedgerClosedError";
  }
}

/** Thrown when the event detail cannot be serialized to JSON. */
export class LedgerSerializeError extends Error {
  constructor(cause: string) {
    super(`Cannot serialize event detail to JSON: ${cause}`);
    this.name = "LedgerSerializeError";
  }
}

/** Thrown when the session_id is invalid (empty, contains path separators). */
export class LedgerPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerPathError";
  }
}

// ---------------------------------------------------------------------------
// LedgerEvent — the canonical JSONL record (OTEL-compatible hierarchy)
//
// Hierarchy: Session → Workflow → Task → Turn → Event
// Every event carries all 4 ancestor IDs; null where not yet applicable.
//
// verdict aligns with gate.ts GateVerdict values (PASS / FAIL / BLOCKED)
// plus SKIPPED for skipped pipeline steps. null is used for events that
// do not carry a gate verdict (e.g. PLAN, CLOSE phase events).
// ---------------------------------------------------------------------------

export type LedgerVerdict = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED" | null;

export interface LedgerEvent {
  /** UUID v4 assigned by the ledger — unique per event. */
  event_id: string;

  /** Session identifier (1:1 with JSONL file). Sanitized against traversal. */
  session_id: string;

  /** Workflow ID within the session (always present). */
  workflow_id: string;

  /** Task ID within the workflow, or null if not task-scoped. */
  task_id: string | null;

  /** Turn ID within the task, or null if not turn-scoped. */
  turn_id: string | null;

  /** The actor that produced this event. */
  actor_id: string;

  /** Category of the actor. SCRIPT = shell command, AGENT = LLM agent, SYSTEM = TEO runtime. */
  actor_type: "SCRIPT" | "AGENT" | "SYSTEM";

  /**
   * Phase label for this event. Common values: "PLAN" | "EXECUTE" | "GATE" | "SIGN" | "CLOSE".
   * Not an enum so new phases can be added without a schema migration.
   */
  phase: string;

  /**
   * Gate verdict for this event.
   * Aligns with gate.ts GateVerdict (PASS / FAIL / BLOCKED) + SKIPPED.
   * null for events that do not carry a gate outcome.
   */
  verdict: LedgerVerdict;

  /** Structured payload for this event, or null. Must be JSON-serializable. */
  detail: Record<string, unknown> | null;

  /** ISO-8601 UTC timestamp assigned by the ledger at write time. */
  ts: string;

  /**
   * Monotonically increasing sequence number within a session.
   * Starts at 1. Assigned by the ledger (NOT the caller).
   */
  seq: number;
}

// ---------------------------------------------------------------------------
// WorkflowSummary — payload for the CLOSE event
// ---------------------------------------------------------------------------

/** Summary data written as the `detail` of the final CLOSE-phase event. */
export interface WorkflowSummary {
  /** Total task count for this workflow. */
  task_count: number;
  /** Number of tasks with PASS verdict. */
  pass: number;
  /** Number of tasks with FAIL verdict. */
  fail: number;
  /** Number of tasks that were SKIPPED. */
  skipped: number;
  /** Total LLM tokens consumed. 0 for SCRIPT-only workflows. */
  tokens: number;
  /** Estimated cost in USD. 0 for SCRIPT-only workflows. */
  cost_usd: number;
  /**
   * True when the workflow was aborted mid-run (a task failed and one or more
   * independent tasks were skipped as a result). Absent or false for clean runs.
   */
  torn?: boolean;
}

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface AppendOnlyLedgerOptions {
  /**
   * Session identifier — becomes the JSONL filename (<session_id>.jsonl).
   * Must not be empty or contain path separators (/, \) or traversal sequences.
   */
  session_id: string;

  /**
   * Override the base directory (default: os.homedir()/.teo/).
   * Tests MUST inject a temp dir here. Never omit this in test code.
   * When omitted in production, resolves to os.homedir()/.teo/.
   */
  baseDir?: string;
}

// ---------------------------------------------------------------------------
// AppendOnlyLedger
// ---------------------------------------------------------------------------

export class AppendOnlyLedger {
  private readonly session_id: string;
  private readonly ledgerDir: string;
  private readonly filePath: string;
  private seq: number = 0;
  private closed: boolean = false;

  constructor(options: AppendOnlyLedgerOptions) {
    const { session_id, baseDir } = options;

    // Validate session_id: must be non-empty and contain no path separators.
    if (!session_id || session_id.length === 0) {
      throw new LedgerPathError("session_id must not be empty.");
    }
    if (session_id.includes("/") || session_id.includes("\\") || session_id.includes("..")) {
      throw new LedgerPathError(
        `session_id "${session_id}" contains path separators or traversal sequences. ` +
          `Use a plain identifier with no slashes or dots.`
      );
    }

    this.session_id = session_id;

    // Resolve the base directory. Production: os.homedir()/.teo/. Tests: injected.
    // The right-hand side of ?? is only reached in production (tests always inject baseDir).
    /* c8 ignore next */
    const resolvedBase = baseDir ?? path.join(os.homedir(), ".teo");
    this.ledgerDir = path.join(resolvedBase, "ledger");
    this.filePath = path.join(this.ledgerDir, `${this.session_id}.jsonl`);
  }

  /**
   * Append one event to the session JSONL file.
   *
   * - Assigns event_id (UUID v4), seq (auto-incremented), and ts (ISO-8601 UTC).
   * - Creates <baseDir>/ledger/ if it does not exist.
   * - Opens the file with the 'a' flag (creates if absent; never truncates).
   * - Throws LedgerClosedError if the ledger is closed.
   * - Throws LedgerSerializeError if `detail` is not JSON-serializable.
   *
   * @param input - The caller-provided semantic fields (no seq/event_id/ts).
   * @returns The assigned seq (monotonically increasing sequence number) and ts
   *   (ISO-8601 UTC timestamp) for this event. Callers that need to sign the event
   *   (e.g. HmacSigner) must use these values to reproduce the canonical payload.
   */
  append(input: Omit<LedgerEvent, "event_id" | "seq" | "ts">): { seq: number; ts: string } {
    if (this.closed) {
      throw new LedgerClosedError();
    }

    // Serialize detail eagerly — before incrementing seq or touching the file.
    // If it throws, we haven't written anything yet (no partial corruption).
    const detailJson = this.serializeDetail(input.detail);

    // Assign ledger-managed fields.
    this.seq += 1;
    const event: LedgerEvent = {
      event_id: this.generateUuidV4(),
      seq: this.seq,
      ts: new Date().toISOString(),
      session_id: input.session_id,
      workflow_id: input.workflow_id,
      task_id: input.task_id,
      turn_id: input.turn_id,
      actor_id: input.actor_id,
      actor_type: input.actor_type,
      phase: input.phase,
      verdict: input.verdict,
      detail: input.detail,
    };

    // Build the JSONL line. We replace the detail portion with our pre-serialized
    // value to avoid double-serialization, but it's simpler and safer to just
    // serialize the whole event — we already validated detail above.
    // Use the pre-built event object; detail was already validated as serializable.
    void detailJson; // consumed during validation; event uses input.detail directly
    const line = JSON.stringify(event) + "\n";

    // Ensure directory exists (idempotent).
    if (!fs.existsSync(this.ledgerDir)) {
      fs.mkdirSync(this.ledgerDir, { recursive: true });
    }

    // Append — 'a' flag: creates if absent, never truncates.
    fs.appendFileSync(this.filePath, line, "utf8");

    return { seq: this.seq, ts: event.ts };
  }

  /**
   * Append the final CLOSE-phase event with a workflow summary, then seal the ledger.
   *
   * After close():
   * - No further calls to append() or close() are permitted (both throw LedgerClosedError).
   * - The CLOSE event is always the last line in the file.
   *
   * @param summary - Token/cost/step-count rollup for the workflow.
   */
  close(summary: WorkflowSummary): void {
    if (this.closed) {
      throw new LedgerClosedError("Ledger is already closed — close() may only be called once.");
    }

    this.append({
      session_id: this.session_id,
      workflow_id: this.session_id, // workflow_id defaults to session_id for the CLOSE event
      task_id: null,
      turn_id: null,
      actor_id: "SYSTEM",
      actor_type: "SYSTEM",
      phase: "CLOSE",
      verdict: null,
      detail: {
        task_count: summary.task_count,
        pass: summary.pass,
        fail: summary.fail,
        skipped: summary.skipped,
        tokens: summary.tokens,
        cost_usd: summary.cost_usd,
        ...(summary.torn === true ? { torn: true } : {}),
      },
    });

    this.closed = true;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Serialize `detail` to JSON to validate it is serializable.
   * Throws LedgerSerializeError if JSON.stringify fails (circular ref, BigInt, etc.).
   * The serialized string is returned for the caller's use.
   */
  private serializeDetail(detail: Record<string, unknown> | null): string {
    if (detail === null) return "null";
    try {
      return JSON.stringify(detail);
    } catch (err) {
      // JSON.stringify always throws a TypeError (an Error subclass), but the
      // non-Error branch is a defensive fallback for any unexpected throw shape.
      /* c8 ignore next */
      const reason = err instanceof Error ? err.message : String(err);
      throw new LedgerSerializeError(reason);
    }
  }

  /**
   * Generate a UUID v4 using Node's crypto.randomUUID().
   * Available natively since Node 15.6.0 / 14.17.0.
   */
  private generateUuidV4(): string {
    return crypto.randomUUID();
  }
}
