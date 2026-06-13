/**
 * global-setup — ensures the demo fixture home is runnable before the acceptance
 * suite. Both demo/.teo-home/ (the signing key + registry) and demo/plans/ (the
 * signed plans) are gitignored and per-machine, so on a clean checkout they're
 * absent and `teo run` would fail. This regenerates the WHOLE matched set —
 * fresh key + fresh registry + freshly-signed plans — via build-plans.ts.
 *
 * Why the goldens still match a fresh build: signatures are shape-normalized
 * (so the per-machine key doesn't matter), and a fresh registry always issues
 * the same agent ids in the same order (qa-001, eng-001, …), so the spine is
 * stable. The key/plans/registry must be a matched set — never regenerate the
 * key alone (that desyncs the plans). See ADR-062.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export default function setup(): void {
  const root = process.cwd();
  const demoHome = resolve("demo/.teo-home");
  const keyPath = join(demoHome, "keyring", "signing.key");
  const aPlan = resolve("demo/plans/demo-simple-deploy-staging.json");

  // Already a matched set present — leave it. (Both are gitignored, so a clean
  // checkout has neither and we rebuild; a dev machine has both and we skip.)
  if (existsSync(keyPath) && existsSync(aPlan)) return;

  const tsx = join(root, "node_modules", ".bin", "tsx");
  const r = spawnSync(tsx, [join(root, "demo/build-plans.ts")], {
    cwd: root,
    env: { ...process.env, TEO_HOME: demoHome },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.status !== 0) {
    throw new Error(`acceptance global-setup: build-plans failed: ${r.stderr ?? ""}`);
  }
}
