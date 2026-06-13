/**
 * demos — the demo-suite registry. The single source of truth for which demos
 * the golden capturer and the acceptance tests drive. Explicit, not
 * filesystem-globbed: a glob would silently pick up new plans before their
 * goldens exist. Phase 0+1 covers the four cases the three existing plans yield.
 * See docs/specs/TEO-5-demo-suite.md §1, ADR-062.
 */
import type { Tier } from "./normalize.js";

export interface Demo {
  /** Stable id; also the golden filename stem. */
  name: string;
  /** Plan file under demo/plans/. */
  planFile: string;
  tier: Tier;
  /** If set, run `teo gate <plan> <gate>` after the run (human final gate). */
  gate?: "accept" | "reject";
  /** Reason passed to the gate (kept deterministic in the golden). */
  gateReason?: string;
}

/** Golden file stem for a demo (suffix on the gate variant). */
export function goldenName(d: Demo): string {
  return d.gate ? `${d.name}.${d.gate}` : d.name;
}

/** The deterministic, gating SCRIPT-tier demos (Phase 1). */
export const SCRIPT_DEMOS: Demo[] = [
  // #1 — mechanical work, 0 tokens.
  { name: "demo-simple-deploy-staging", planFile: "demo-simple-deploy-staging.json", tier: "script" },
  // #2/#3/#4 — signed gate + full ledger + human accept → closed.
  {
    name: "demo-planned-health-feature",
    planFile: "demo-planned-health-feature.json",
    tier: "script",
    gate: "accept",
    gateReason: "reviewed, ship it",
  },
  // #5 — same plan, human reject → reopened.
  {
    name: "demo-planned-health-feature",
    planFile: "demo-planned-health-feature.json",
    tier: "script",
    gate: "reject",
    gateReason: "needs another pass",
  },
];

/** The non-gating live-agent demos (Phase 1, tier L). */
export const LIVE_DEMOS: Demo[] = [
  // #13 — agents only on judgment; every LLM call named/counted/costed.
  { name: "demo-live-agent-feature", planFile: "demo-live-agent-feature.json", tier: "agent" },
];

export const ALL_DEMOS: Demo[] = [...SCRIPT_DEMOS, ...LIVE_DEMOS];
