import { z } from "zod";

// =============================================================================
// plan.ts — TEO Plan Schema (WS-CORE-01)
//
// This module defines the Zod schemas and inferred TypeScript types for a TEO
// Plan. It is on the critical path: schema → validate → runner → gate → ledger
// → sign. All changes require exhaustive tests (ADR-064, amended 2026-06-18).
//
// BOUNDARY DECISIONS (documented here so downstream workstreams know what they own):
//
//   1. Duplicate task IDs — deferred to validatePlan() (WS-CORE-02).
//      The schema validates the SHAPE of each task independently. Cross-task
//      invariants (unique IDs, needs-ref resolution, cycle detection) belong in
//      validatePlan(), which has the full task list available for relational checks.
//
//   2. `disallowedTools` on a SCRIPT task — allowed (no-op at schema level).
//      SCRIPT tasks spawn no agent, so disallowedTools has no runtime effect.
//      We allow the field rather than rejecting it so callers can pass a uniform
//      task shape without stripping the field. The runner ignores it for SCRIPT tasks.
//
// =============================================================================

// ---------------------------------------------------------------------------
// GateRef — a plan-side reference to a gate check.
// Full gate engine lands in WS-CORE-04; this is just the reference shape.
// ---------------------------------------------------------------------------
export const GateRefSchema = z.object({
  name: z.string().min(1),
  on_fail: z.enum(["block", "warn"]),
});

export type GateRef = z.infer<typeof GateRefSchema>;

// ---------------------------------------------------------------------------
// Shared task fields (common to all task variants)
// ---------------------------------------------------------------------------
const BaseTaskSchema = z.object({
  id: z.string().min(1),
  needs: z.array(z.string()),
  gates: z.array(GateRefSchema),
  // See BOUNDARY DECISION #2 above: allowed on SCRIPT tasks as a no-op.
  disallowedTools: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// SCRIPT task — runs a shell command directly, no agent spawned.
// ---------------------------------------------------------------------------
const ScriptTaskSchema = BaseTaskSchema.extend({
  type: z.literal("SCRIPT"),
  command: z.string().min(1),
});

// ---------------------------------------------------------------------------
// AGENT task — spawns a named specialist agent with a prompt.
// ---------------------------------------------------------------------------
const AgentTaskSchema = BaseTaskSchema.extend({
  type: z.literal("AGENT"),
  agent_id: z.string().min(1),
  prompt: z.string().min(1),
});

// ---------------------------------------------------------------------------
// TEOTask — discriminated union on `type`.
//
// Zod's discriminatedUnion enforces the union at parse time:
//   - A SCRIPT object with `agent_id` present is rejected (extra key).
//   - An AGENT object with `command` present is rejected (extra key).
//
// We use .strict() on each variant to reject extra keys.
// ---------------------------------------------------------------------------
export const TEOTaskSchema = z.discriminatedUnion("type", [
  ScriptTaskSchema.strict(),
  AgentTaskSchema.strict(),
]);

export type TEOTask = z.infer<typeof TEOTaskSchema>;

// ---------------------------------------------------------------------------
// Plan — the top-level execution document.
//
// `version` is a literal "1" string so the schema is forward-evolvable:
//   v2 plans get a new schema branch, parsers can discriminate on version.
//
// `created_at` is stored as a plain string (ISO-8601). We intentionally do
//   NOT use z.coerce.date() — the runner needs the raw string for ledger
//   serialization, and date parsing rules vary across engines. Semantic
//   validation of the timestamp format belongs in validatePlan() if needed.
//
// `tasks` requires at least one entry — a plan with no tasks is meaningless.
//
// See BOUNDARY DECISION #1 above: duplicate task IDs are NOT rejected here.
// ---------------------------------------------------------------------------
export const PlanSchema = z.object({
  plan_id: z.string().min(1),
  project_id: z.string().min(1),
  created_at: z.string(),
  version: z.literal("1"),
  tasks: z.array(TEOTaskSchema).min(1),
});

export type Plan = z.infer<typeof PlanSchema>;
