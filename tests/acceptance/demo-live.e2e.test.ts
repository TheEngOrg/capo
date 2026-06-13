/**
 * Acceptance suite — LIVE (agent) tier. NON-GATING.
 *
 * Drives the live-agent demo through real `claude` calls. Unlike the SCRIPT
 * tier, a live run is NOT byte-stable — model output varies, and an agent task
 * can occasionally fail mechanical verification, changing the event structure.
 * So this tier asserts only the STRUCTURAL INVARIANTS that prove the value prop
 * (agents spent only on judgment; every LLM call named + counted), never a full
 * golden diff. Skipped when `claude` / ANTHROPIC_API_KEY is absent, so it never
 * gates CI. See ADR-062 §tier L, docs/specs/TEO-5-demo-suite.md §7.
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { collectDemo } from "./lib/collect.js";
import { LIVE_DEMOS, goldenName } from "./lib/demos.js";

function hasClaude(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return true;
  return spawnSync("which", ["claude"], { encoding: "utf8" }).status === 0;
}

describe.skipIf(!hasClaude())("TEO 5.0 acceptance suite — LIVE tier (non-gating)", () => {
  for (const demo of LIVE_DEMOS) {
    it(`${goldenName(demo)} — structural invariants`, (ctx) => {
      const actual = collectDemo(demo);
      const finance = actual.finance as {
        llm_calls: { total: number; byActor: Record<string, number> };
        total: { cost_usd: unknown };
      };
      const phases = actual.events.map((e) => e.phase);

      // A live run can legitimately not complete: an agent's `claude` output can
      // fail mechanical verification, halting the plan before all tasks run. This
      // tier is NON-GATING — a partial run is not a regression, so skip rather
      // than fail. (The deterministic value props are proven by the SCRIPT tier.)
      if (!phases.includes("DELIVER")) {
        ctx.skip(
          `live run did not complete (${finance.llm_calls.total}/3 agent calls before halt) — non-gating`,
        );
        return;
      }

      // The run completed → assert the headline invariants. Exactly 3 LLM calls,
      // each named to a distinct actor: "agents only on judgment, every call
      // accounted for". Plus the signed gate and the cost being incurred.
      expect(finance.llm_calls.total).toBe(3);
      expect(Object.keys(finance.llm_calls.byActor)).toHaveLength(3);
      const modelEvents = actual.events.filter((e) => (e as { model_present?: boolean }).model_present);
      expect(modelEvents).toHaveLength(3);
      expect(phases).toContain("GATE");
      expect(finance.total.cost_usd).toBe("<n>");
    }, 180_000);
  }
});
