// =============================================================================
// diff-golden.ts — Golden snapshot comparison and update machinery
//
// Usage:
//   - Normal test run: compareToGolden(scenarioId, actual) asserts match.
//   - GOLDEN_UPDATE=1: writeGolden(scenarioId, actual) regenerates the file.
//
// Golden files live at: tests/acceptance/goldens/<scenarioId>.json
// They are committed to the repo and must be deterministic.
//
// GOLDEN_UPDATE=1 regeneration is idempotent: running it twice with the same
// pipeline output produces byte-identical golden files.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDENS_DIR = path.resolve(__dirname, "../goldens");

function goldenPath(scenarioId: string): string {
  return path.join(GOLDENS_DIR, `${scenarioId}.json`);
}

/**
 * Write (or overwrite) the golden file for scenarioId.
 * Called when GOLDEN_UPDATE=1 is set.
 * Output is deterministically sorted so byte-identical on re-run.
 */
export function writeGolden(scenarioId: string, data: unknown): void {
  fs.mkdirSync(GOLDENS_DIR, { recursive: true });
  const content = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(goldenPath(scenarioId), content, "utf8");
}

/**
 * Read the committed golden for scenarioId.
 * Throws if the file does not exist (run GOLDEN_UPDATE=1 first).
 */
export function readGolden(scenarioId: string): unknown {
  const p = goldenPath(scenarioId);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Golden file missing for "${scenarioId}". Run GOLDEN_UPDATE=1 npm run test to generate it.\n` +
        `Expected at: ${p}`
    );
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
}

/**
 * Compare actual normalized output to the committed golden.
 * If GOLDEN_UPDATE=1 is set, writes the golden instead of asserting.
 *
 * Returns true if it wrote a new golden (so the test can skip the assertion).
 */
export function compareOrUpdateGolden(scenarioId: string, actual: unknown): boolean {
  if (process.env["GOLDEN_UPDATE"] === "1") {
    writeGolden(scenarioId, actual);
    return true; // caller should skip assertion — we just wrote
  }
  return false;
}

/**
 * The full path to a golden file (for diagnostic messages).
 */
export function goldenFilePath(scenarioId: string): string {
  return goldenPath(scenarioId);
}
