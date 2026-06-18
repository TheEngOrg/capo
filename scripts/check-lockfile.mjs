#!/usr/bin/env node
/**
 * check-lockfile.mjs
 *
 * Detects drift between package.json and package-lock.json.
 * Runs `npm install --dry-run --package-lock-only` and fails if npm would make
 * changes to the lockfile. This mirrors what `npm ci` does: it fails when the
 * lockfile is out of sync with package.json.
 *
 * Exit 0 = lockfile is in sync.
 * Exit 1 = lockfile is out of sync; run `npm install` to fix.
 *
 * Wire up: pre-push hook + CI step (ci.yml lockfile-sync job).
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const LOCKFILE = "package-lock.json";

if (!existsSync(LOCKFILE)) {
  console.error(
    `[lockfile-check] ERROR: ${LOCKFILE} not found. Run \`npm install\` to generate it.`
  );
  process.exit(1);
}

try {
  // --dry-run prints what would change without writing anything.
  // --package-lock-only avoids downloading packages — just resolves the graph.
  // If the lockfile is in sync, npm prints nothing and exits 0.
  // If it is out of sync, npm prints the changes it would make and exits 0 too —
  // so we capture stdout and check for "added"/"removed"/"changed" keywords.
  const output = execSync("npm install --dry-run --package-lock-only 2>&1", {
    encoding: "utf8",
  });

  const driftIndicators = [
    /^\s*added /m,
    /^\s*removed /m,
    /^\s*changed /m,
    /\d+ package[s]? installed/m,
    /up to date/m, // "up to date" with changes is fine, but check no additions
  ];

  // "up to date, audited" with zero changes = in sync.
  // Any "added N" / "removed N" / "changed N" = drift.
  const hasDrift =
    /^\s*(added|removed|changed)\s+\d+/m.test(output) && !/^added 0 packages/m.test(output);

  if (hasDrift) {
    console.error("[lockfile-check] FAIL: package-lock.json is out of sync with package.json.");
    console.error("[lockfile-check] Run `npm install` locally and commit the updated lockfile.");
    console.error("[lockfile-check] Output from npm:");
    console.error(output);
    process.exit(1);
  }

  // Secondary check: verify npm ci would succeed (stricter — fails on any mismatch).
  // We do this by checking that `npm ci --dry-run` exits 0.
  execSync("npm ci --dry-run 2>&1", { encoding: "utf8" });

  console.log("[lockfile-check] OK: package-lock.json is in sync with package.json.");
  process.exit(0);
} catch (err) {
  // If `npm ci --dry-run` throws, the lockfile is definitely out of sync.
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("npm ci") || message.includes("package-lock.json")) {
    console.error("[lockfile-check] FAIL: package-lock.json is out of sync with package.json.");
    console.error(
      "[lockfile-check] `npm ci --dry-run` failed. Run `npm install` to regenerate the lockfile."
    );
  } else {
    console.error(`[lockfile-check] ERROR: Unexpected failure running npm: ${message}`);
  }
  process.exit(1);
}
