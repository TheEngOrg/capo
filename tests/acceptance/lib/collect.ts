/**
 * collect — drive one demo through the real `teo` binary (reset → run → gate? →
 * status → audit) and return the NORMALIZED bundle for golden capture/diff. The
 * single shared "run a demo and gather" helper used by both capture-golden.ts
 * and the acceptance e2e tests, so they can never diverge.
 *
 * Spawns node_modules/.bin/tsx directly — NEVER `npx tsx`. npx installs tsx on
 * demand into a shared ~/.npm/_npx cache; concurrent tests racing that install
 * collide (ENOTEMPTY / exit 190) on CI. See tests/integration/cli-e2e.test.ts.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Bundle } from "./diff-golden.js";
import type { Demo } from "./demos.js";
import { normalizeEvent, normalizeFinance, normalizeRunResult } from "./normalize.js";

const ROOT = process.cwd();
const TSX_BIN = join(ROOT, "node_modules", ".bin", "tsx");
const ENTRY = join(ROOT, "src/index.ts");
const RESET = join(ROOT, "demo/reset.ts");
export const DEMO_HOME = join(ROOT, "demo", ".teo-home");

function teo(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(TSX_BIN, [ENTRY, ...args], {
    // cwd MUST be the repo root: demo plans reference relative `demo/scripts/*.sh`
    // paths, resolved against cwd by the script runner.
    cwd: ROOT,
    env: { ...process.env, TEO_HOME: DEMO_HOME },
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Clear the teo-demo namespace so seq starts at 1 (idempotent). */
export function resetDemoHome(): void {
  const r = spawnSync(TSX_BIN, [RESET], {
    cwd: ROOT,
    env: { ...process.env, TEO_HOME: DEMO_HOME },
    encoding: "utf8",
    timeout: 60_000,
  });
  if (r.status !== 0) throw new Error(`demo reset failed: ${r.stderr ?? ""}`);
}

/** Run a demo end-to-end and return its normalized bundle. Throws on any CLI error. */
export function collectDemo(demo: Demo): Bundle {
  const planPath = join("demo/plans", demo.planFile);

  resetDemoHome();

  const run = teo(["run", planPath]);
  if (run.status !== 0) throw new Error(`run ${demo.name} failed (status ${run.status}): ${run.stderr}`);

  if (demo.gate) {
    const g = teo(["gate", planPath, demo.gate, "--as", "byazaki", "--reason", demo.gateReason ?? ""]);
    if (g.status !== 0) throw new Error(`gate ${demo.name} failed (status ${g.status}): ${g.stderr}`);
  }

  const status = teo(["status", planPath]);
  if (status.status !== 0) throw new Error(`status ${demo.name} failed: ${status.stderr}`);

  const audit = teo(["audit", planPath]);
  if (audit.status !== 0) throw new Error(`audit ${demo.name} failed: ${audit.stderr}`);

  const auditJson = JSON.parse(audit.stdout) as { events: Parameters<typeof normalizeEvent>[0][]; finance: Parameters<typeof normalizeFinance>[0] };
  const runResult = JSON.parse(run.stdout);
  const statusJson = JSON.parse(status.stdout) as { status: string };

  return {
    events: auditJson.events.map((e) => normalizeEvent(e, demo.tier)) as unknown as Bundle["events"],
    finance: normalizeFinance(auditJson.finance, demo.tier),
    runResult: normalizeRunResult(runResult, demo.tier),
    status: statusJson.status,
  };
}
