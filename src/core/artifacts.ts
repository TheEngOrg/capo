// =============================================================================
// artifacts.ts — WS-00: artifact schema layer + repairJson() helper
//
// Exports:
//   repairJson(raw: string): string
//     Wraps the jsonrepair package. Propagates errors on unrecoverable input.
//
//   validateArtifact({ type, payload, strict? }): { valid: boolean; errors?: string[] }
//     Validates a payload against the registered artifact type schema.
// =============================================================================

import { jsonrepair } from "jsonrepair";
import { z } from "../lib/schema.js";
import { PlanSchema } from "./plan.js";

// ---------------------------------------------------------------------------
// repairJson — fault-tolerant JSON normaliser
// ---------------------------------------------------------------------------

export function repairJson(raw: string): string {
  const repaired = jsonrepair(raw);
  // jsonrepair "repairs" arbitrary strings by wrapping them in quotes.
  // If the input wasn't a quoted string and repair just wrapped it, that's
  // not a real repair — throw so callers know the input is unrecoverable.
  if (!raw.trimStart().startsWith('"')) {
    try {
      const parsed = JSON.parse(repaired);
      if (typeof parsed === "string" && repaired === JSON.stringify(raw)) {
        throw new Error(`Input is not repairable JSON: ${raw}`);
      }
    } catch (e) {
      /* c8 ignore next 3 */
      if (e instanceof SyntaxError) {
        // repaired result isn't valid JSON — that's fine, let caller handle
      } else {
        throw e;
      }
    }
  }
  return repaired;
}

// ---------------------------------------------------------------------------
// Artifact Zod schemas
// ---------------------------------------------------------------------------

const GateResultArtifactSchema = z.object({
  task_id: z.string(),
  gate_name: z.string(),
  verdict: z.enum(["PASS", "FAIL", "WARN", "UNENFORCED_MOCK"]),
  timestamp: z.string(),
  details: z.string().optional(),
});

const StepResultArtifactSchema = z.object({
  task_id: z.string(),
  status: z.enum(["COMPLETED", "FAILED", "SKIPPED"]),
  timestamp: z.string(),
  agent_id: z.string().optional(),
});

const PlanArtifactSchema = PlanSchema;

// ---------------------------------------------------------------------------
// validateArtifact
// ---------------------------------------------------------------------------

type ValidateArtifactInput = {
  type: string;
  payload: unknown;
  strict?: boolean;
};

type ValidateArtifactResult = {
  valid: boolean;
  errors?: string[];
};

export function validateArtifact(input: ValidateArtifactInput): ValidateArtifactResult {
  const { type, payload, strict = false } = input;

  let schema: z.ZodTypeAny;

  switch (type) {
    case "GATE_RESULT_ARTIFACT":
      schema = strict ? GateResultArtifactSchema.strict() : GateResultArtifactSchema;
      break;
    case "STEP_RESULT_ARTIFACT":
      schema = strict ? StepResultArtifactSchema.strict() : StepResultArtifactSchema;
      break;
    case "PLAN_ARTIFACT":
      schema = strict ? PlanArtifactSchema.strict() : PlanArtifactSchema;
      break;
    default:
      return {
        valid: false,
        errors: [`Unknown artifact type: ${type}`],
      };
  }

  const result = schema.safeParse(payload);

  if (result.success) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: result.error.issues.map((i) => i.message),
  };
}
