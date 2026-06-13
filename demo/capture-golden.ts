/**
 * capture-golden — (re)generate the committed golden snapshots for the demo
 * suite by driving each demo through the real binary and writing its normalized
 * bundle to tests/acceptance/golden/<name>.json.
 *
 *   TEO_HOME=demo/.teo-home npx tsx demo/capture-golden.ts
 *
 * The canonical regen path in CI/dev is `GOLDEN_UPDATE=1 npx vitest run
 * tests/acceptance` (same code path that asserts them). This script exists so
 * the FIRST goldens can be produced and reviewed before any test depends on
 * them, and so a human can regenerate without vitest. Live-tier demos are
 * captured only when `claude`/ANTHROPIC_API_KEY is available. See ADR-062.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveTeoHome } from "../src/core/home/home.js";
import { collectDemo } from "../tests/acceptance/lib/collect.js";
import { ALL_DEMOS, goldenName, type Demo } from "../tests/acceptance/lib/demos.js";

// Guard: refuse to run unless TEO_HOME is the demo fixture home, so we never
// pollute a real ~/.teo while capturing.
const home = resolveTeoHome();
const expected = resolve("demo/.teo-home");
if (resolve(home.root) !== expected) {
  throw new Error(`capture-golden requires TEO_HOME=demo/.teo-home (got ${home.root})`);
}

function hasClaude(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return true;
  return spawnSync("which", ["claude"], { encoding: "utf8" }).status === 0;
}

const goldenDir = resolve("tests/acceptance/golden");
mkdirSync(goldenDir, { recursive: true });

const live = hasClaude();
for (const demo of ALL_DEMOS as Demo[]) {
  if (demo.tier === "agent" && !live) {
    process.stdout.write(`skip ${goldenName(demo)} (live tier — no claude)\n`);
    continue;
  }
  const bundle = collectDemo(demo);
  const out = join(goldenDir, `${goldenName(demo)}.json`);
  writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
  process.stdout.write(`wrote ${out} (${bundle.events.length} events, status=${bundle.status})\n`);
}

// Ensure the dir isn't left empty if everything was skipped.
if (!existsSync(join(goldenDir, "demo-simple-deploy-staging.json"))) {
  throw new Error("no goldens written — check TEO_HOME and demo plans");
}
