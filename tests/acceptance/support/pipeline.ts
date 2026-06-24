// =============================================================================
// pipeline.ts — End-to-end pipeline runner for golden harness demos
//
// Wires the deterministic-core modules:
//   validatePlan → TopologicalRunner → evaluateGate → AppendOnlyLedger → HmacSigner
//
// ZERO live-model calls. All demos use SCRIPT tasks with an injected
// CommandRunner stub — no real subprocess is spawned unless the scenario
// explicitly opts into trivial commands (true/false). Default: stub runner.
//
// All temp state (ledger, keyring) goes under os.tmpdir()/<uuid>.
// NEVER writes to ~/.teo/ or the project dir.
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { type Plan, PlanSchema } from "../../../src/core/plan.js";
import { validatePlan } from "../../../src/core/validate.js";
import { TopologicalRunner, type Executor, type StepResult } from "../../../src/core/runner.js";
import { evaluateGate, type GateVerdict } from "../../../src/core/gate.js";
import {
  ScriptMechanism,
  type CommandRunner,
  type CommandResult,
} from "../../../src/core/verification.js";
import { AppendOnlyLedger, type LedgerEvent } from "../../../src/core/ledger.js";
import { HmacSigner, type SignPayload } from "../../../src/core/sign.js";
import type { ValidationResult } from "../../../src/core/validate.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A signed verdict record emitted after each gate evaluation */
export interface SignedVerdict {
  taskId: string | null;
  planId: string;
  verdict: GateVerdict;
  seq: number;
  ts: string;
  signature: string;
}

/** Full result of running a demo through the pipeline */
export interface DemoResult {
  scenarioId: string;
  planId: string;
  validationResult: ValidationResult;
  overallStatus: "PASS" | "FAILED" | "VALIDATION_REJECTED";
  events: LedgerEvent[];
  signedVerdicts: SignedVerdict[];
  tempDir: string;
}

/** Per-task command stub: map taskId → exit code */
export type CommandStub = Record<string, number>;

export interface DemoOptions {
  /** The raw plan object (will be parsed through PlanSchema) */
  plan: unknown;
  /**
   * Stub command results by task ID (exit code).
   * Tasks not in this map default to exit 0 (PASS).
   */
  commandStubs?: CommandStub;
  /**
   * If true, use the real node command runner for trivial commands
   * (e.g. `true` or `false`). Not recommended for most demos.
   */
  useRealRunner?: boolean;
  /** Scenario identifier (for ledger session_id and golden file names) */
  scenarioId: string;
}

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

/** Create a unique temp directory under os.tmpdir() for this demo run. */
export function createTempDir(scenarioId: string): string {
  const sanitized = scenarioId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const tmpRoot = path.join(os.tmpdir(), `teo-golden-${sanitized}-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });
  return tmpRoot;
}

/** Remove the temp directory after the demo. */
export function cleanupTempDir(tmpDir: string): void {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Stub command runner factory
// ---------------------------------------------------------------------------

/**
 * Build an injected CommandRunner from a stub map.
 * Each task's command is mapped to a task ID by the executor (see below).
 * The stub map keys are task IDs; the runner receives the command string.
 * We embed the task ID in the command via the `run-<taskId>` convention used
 * in plan fixtures, so the runner can look it up.
 */
export function makeStubRunner(stubs: CommandStub): CommandRunner {
  return async (
    command: string,
    _cwd: string,
    _ctx: Record<string, unknown>
  ): Promise<CommandResult> => {
    // Command convention: "run-<taskId>" or just "<taskId>"
    // Try to extract the task ID from the command string
    const match = /^(?:run-)?(.+)$/.exec(command.trim());
    const taskId = match ? match[1] : command;
    const exitCode = stubs[taskId] ?? stubs[command] ?? 0;
    return { exitCode, stdout: exitCode === 0 ? "" : `task ${taskId} failed` };
  };
}

// ---------------------------------------------------------------------------
// Main pipeline runner
// ---------------------------------------------------------------------------

/**
 * Run a demo plan through the full deterministic pipeline.
 *
 * Returns a DemoResult with all ledger events and signed verdicts.
 * Cleans up temp state on completion.
 */
export async function runDemo(options: DemoOptions): Promise<DemoResult> {
  const { scenarioId, commandStubs = {}, useRealRunner = false } = options;

  // 1. Parse + validate the plan
  const parseResult = PlanSchema.safeParse(options.plan);
  if (!parseResult.success) {
    return {
      scenarioId,
      planId: String((options.plan as Record<string, unknown>)?.plan_id ?? "unknown"),
      validationResult: {
        valid: false,
        errors: [{ code: "SCHEMA_ERROR", message: parseResult.error.message }],
        warnings: [],
      },
      overallStatus: "VALIDATION_REJECTED",
      events: [],
      signedVerdicts: [],
      tempDir: "",
    };
  }

  const plan: Plan = parseResult.data;
  const validationResult = validatePlan(plan);

  // Hard-stop: if validation errors exist, reject (schema-valid but logic-invalid)
  if (!validationResult.valid) {
    return {
      scenarioId,
      planId: plan.plan_id,
      validationResult,
      overallStatus: "VALIDATION_REJECTED",
      events: [],
      signedVerdicts: [],
      tempDir: "",
    };
  }

  // 2. Set up zero-footprint temp infrastructure
  const tmpDir = createTempDir(scenarioId);
  const sessionId = scenarioId.replace(/[^a-zA-Z0-9_-]/g, "-");

  try {
    // Ledger: inject tmpDir as baseDir so it NEVER writes to ~/.teo
    const ledger = new AppendOnlyLedger({
      session_id: sessionId,
      baseDir: tmpDir,
    });

    // Signer: inject tmpDir as baseDir so keyring goes to tmpDir/keyring/
    const signer = new HmacSigner({ baseDir: tmpDir });

    // Signed verdicts accumulator
    const signedVerdicts: SignedVerdict[] = [];

    // 3. Log PLAN event
    ledger.append({
      session_id: sessionId,
      workflow_id: plan.plan_id,
      task_id: null,
      turn_id: null,
      actor_id: "SYSTEM",
      actor_type: "SYSTEM",
      phase: "PLAN",
      verdict: null,
      detail: {
        plan_id: plan.plan_id,
        project_id: plan.project_id,
        task_count: plan.tasks.length,
      },
    });

    // 4. Build executor: uses ScriptMechanism with stub or real runner
    const commandRunner: CommandRunner = useRealRunner
      ? // real runner via dynamic import to avoid top-level dep
        (await import("../../../src/core/verification.js")).makeNodeCommandRunner()
      : makeStubRunner(commandStubs);

    const executor: Executor = async (task, _ctx): Promise<StepResult> => {
      const mechanism = new ScriptMechanism(
        task.type === "SCRIPT" ? task.command : `echo agent:${task.type}`,
        commandRunner
      );

      const verResult = await mechanism.verify(process.cwd(), { plan_id: plan.plan_id });
      const gateVerdict = evaluateGate(verResult);

      // Map gate verdict to step status
      const stepStatus: "PASS" | "FAILED" = gateVerdict.verdict === "PASS" ? "PASS" : "FAILED";

      const stepVerdict: "PASS" | "FAIL" | "BLOCKED" =
        gateVerdict.verdict === "PASS"
          ? "PASS"
          : gateVerdict.verdict === "FAIL"
            ? "FAIL"
            : "BLOCKED";

      // Log EXECUTE event to ledger
      ledger.append({
        session_id: sessionId,
        workflow_id: plan.plan_id,
        task_id: task.id,
        turn_id: null,
        actor_id: task.type === "SCRIPT" ? task.command : task.agent_id,
        actor_type: task.type === "SCRIPT" ? "SCRIPT" : "AGENT",
        phase: "EXECUTE",
        verdict: stepVerdict,
        detail: {
          task_type: task.type,
          gate_verdict: gateVerdict.verdict,
          ...(gateVerdict.verdict === "FAIL"
            ? { evidence: (gateVerdict as { evidence: string }).evidence }
            : {}),
          ...(gateVerdict.verdict === "BLOCKED"
            ? { reason: (gateVerdict as { reason: string }).reason }
            : {}),
        },
      });

      // Log GATE event
      ledger.append({
        session_id: sessionId,
        workflow_id: plan.plan_id,
        task_id: task.id,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "GATE",
        verdict: stepVerdict,
        detail: { gate_verdict: gateVerdict.verdict },
      });

      return { taskId: task.id, status: stepStatus };
    };

    // 5. Run the plan through the topological runner
    const runner = new TopologicalRunner({
      executor,
      maxParallel: 4,
      defaultStepTimeoutMs: 5000,
    });

    const runResult = await runner.run(plan);

    // 6. Log SKIPPED steps (not visited by executor — handle post-run)
    for (const step of runResult.steps) {
      if (step.status === "SKIPPED") {
        const task = plan.tasks.find((t) => t.id === step.taskId);
        if (!task) continue;

        ledger.append({
          session_id: sessionId,
          workflow_id: plan.plan_id,
          task_id: step.taskId,
          turn_id: null,
          actor_id: task.type === "SCRIPT" ? task.command : task.agent_id,
          actor_type: task.type === "SCRIPT" ? "SCRIPT" : "AGENT",
          phase: "EXECUTE",
          verdict: "SKIPPED",
          detail: { reason: "Skipped due to upstream failure" },
        });
      }
    }

    // 7. Sign all verdicts and log SIGN events
    // Collect all events logged so far (read from the JSONL file)
    const ledgerFilePath = path.join(tmpDir, "ledger", `${sessionId}.jsonl`);
    const rawLines = fs.readFileSync(ledgerFilePath, "utf8").trim().split("\n").filter(Boolean);
    const intermediateEvents: LedgerEvent[] = rawLines.map((l) => JSON.parse(l) as LedgerEvent);

    // Sign events that have a non-null verdict
    const eventsWithVerdict = intermediateEvents.filter(
      (e) => e.verdict !== null && e.phase === "GATE"
    );

    for (const event of eventsWithVerdict) {
      const payload: SignPayload = {
        plan_id: plan.plan_id,
        task_id: event.task_id,
        actor_id: event.actor_id,
        verdict: event.verdict,
        ts: event.ts,
        seq: event.seq,
      };
      const signature = signer.sign(payload);
      const verified = signer.verify(payload, signature);

      signedVerdicts.push({
        taskId: event.task_id,
        planId: plan.plan_id,
        verdict: evaluateGate({
          verdict: event.verdict as "PASS" | "FAIL" | "BLOCKED",
          ...(event.verdict === "FAIL" ? { evidence: "" } : {}),
          ...(event.verdict === "BLOCKED" ? { reason: "" } : {}),
        }),
        seq: event.seq,
        ts: event.ts,
        signature,
      });

      // Log SIGN event
      ledger.append({
        session_id: sessionId,
        workflow_id: plan.plan_id,
        task_id: event.task_id,
        turn_id: null,
        actor_id: "SYSTEM",
        actor_type: "SYSTEM",
        phase: "SIGN",
        verdict: event.verdict,
        detail: {
          signed: true,
          verified,
          sig_len: signature.length,
        },
      });
    }

    // 8. Count results
    const passTasks = runResult.steps.filter((s) => s.status === "PASS").length;
    const failTasks = runResult.steps.filter((s) => s.status === "FAILED").length;
    const skippedTasks = runResult.steps.filter((s) => s.status === "SKIPPED").length;

    // 9. Close the ledger
    ledger.close({
      task_count: plan.tasks.length,
      pass: passTasks,
      fail: failTasks,
      skipped: skippedTasks,
      tokens: 0,
      cost_usd: 0,
    });

    // 10. Read final events from JSONL
    const finalLines = fs.readFileSync(ledgerFilePath, "utf8").trim().split("\n").filter(Boolean);
    const events: LedgerEvent[] = finalLines.map((l) => JSON.parse(l) as LedgerEvent);

    return {
      scenarioId,
      planId: plan.plan_id,
      validationResult,
      overallStatus: runResult.overallStatus,
      events,
      signedVerdicts,
      tempDir: tmpDir,
    };
  } finally {
    cleanupTempDir(tmpDir);
  }
}
