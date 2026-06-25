// =============================================================================
// gate-profiles/index.ts — WS-06: gate profile dispatcher
//
// STATUS: FAILING — implement in dev gate (WS-06)
//
// Dispatches to the correct profile based on input.gate_type. Known profiles:
//   acceptance-criteria | qa-spec | dev | staff-review
// Unknown gate_type returns BLOCKED.
// =============================================================================

import type { GateProfileInput, GateProfileResult } from "./types.js";
import { runAcceptanceCriteriaGate } from "./acceptance-criteria.js";
import { runQaSpecGate } from "./qa-spec.js";
import { runDevGate } from "./dev.js";
import { runStaffReviewGate } from "./staff-review.js";

export type {
  GateProfileInput,
  GateProfileResult,
  GateProfileVerdict,
  GateProfileRunner,
  SubprocessResult,
} from "./types.js";

export function runGateProfile(input: GateProfileInput): GateProfileResult {
  switch (input.gate_type) {
    case "acceptance-criteria":
      return runAcceptanceCriteriaGate(input);
    case "qa-spec":
      return runQaSpecGate(input);
    case "dev":
      return runDevGate(input);
    case "staff-review":
      return runStaffReviewGate(input);
    default:
      throw new Error(`Unknown gate_type: ${input.gate_type}`);
  }
}
