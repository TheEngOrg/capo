/**
 * Acceptance / regression suite — SCRIPT tier (gating).
 *
 * Replays each deterministic demo through the real `teo` binary, normalizes the
 * audit ledger + finance rollup, and diffs against the committed golden. Drift =
 * failing test. These goldens ARE the acceptance baseline for TEO 5.0 (ADR-062).
 *
 * Regenerate after an intentional change:
 *   GOLDEN_UPDATE=1 npx vitest run tests/acceptance
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectDemo } from "./lib/collect.js";
import { SCRIPT_DEMOS, goldenName } from "./lib/demos.js";
import { type Bundle, diffGolden, formatDiff } from "./lib/diff-golden.js";

const GOLDEN_DIR = join(process.cwd(), "tests/acceptance/golden");
const UPDATE = process.env.GOLDEN_UPDATE === "1";

describe("TEO 5.0 acceptance suite — SCRIPT tier", () => {
  for (const demo of SCRIPT_DEMOS) {
    const label = goldenName(demo);
    it(`${label} matches golden`, () => {
      const actual = collectDemo(demo);
      const goldenPath = join(GOLDEN_DIR, `${label}.json`);

      if (UPDATE) {
        writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
        return;
      }

      if (!existsSync(goldenPath)) {
        throw new Error(`missing golden ${goldenPath} — run: GOLDEN_UPDATE=1 npx vitest run tests/acceptance`);
      }
      const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as Bundle;
      const diffs = diffGolden(actual, golden);
      expect(diffs, formatDiff(diffs, label)).toHaveLength(0);
    }, 60_000);
  }
});
