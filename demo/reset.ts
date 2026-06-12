/**
 * reset.ts — return the demo to a clean, pre-run state.
 *
 *   TEO_HOME=demo/.teo-home npx tsx demo/reset.ts
 *
 * Truncates the per-plan telemetry (events/signoffs/streams) for the demo plans so
 * `teo run` starts from seq 1 every time. Leaves the signed plans, the agent
 * registry, and the signing key in place — those are the durable demo fixtures.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { projectId, projectPaths, resolveTeoHome } from "../src/core/home/home.js";

const home = resolveTeoHome();
const project_id = projectId({ absPath: "teo-demo" });
const paths = projectPaths(home, project_id);

// Clear the per-plan telemetry; leave plans/, registry, and the key alone.
for (const dir of [paths.eventsDir, paths.signoffsDir, paths.streamsDir]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    rmSync(join(dir, f));
    process.stdout.write(`cleared ${basename(dir)}/${f}\n`);
  }
}
process.stdout.write("demo reset — plans, registry, and signing key preserved.\n");
