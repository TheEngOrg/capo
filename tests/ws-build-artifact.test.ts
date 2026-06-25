/**
 * WS-BUILD-ARTIFACT — QA spec (all ACs implemented and green)
 *
 * AC-1  bin/teo-run.js is NOT tracked in git
 * AC-2  .gitignore covers bin/teo-run.js.map
 * AC-3  postinstall script present in package.json
 * AC-4  esbuild.config.mjs has sourcemap: "external"
 * AC-5  esbuild.config.mjs reads TEO_VERSION dynamically (createRequire, no hardcoded "1.0.0")
 * AC-6  npm run bundle produces bin/teo-run.js AND bin/teo-run.js.map  (skipped in CI)
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Derive repo root from this file's location — never hardcode an absolute path.
const REPO_ROOT = new URL("../", import.meta.url).pathname;

// ─── AC-1: bin/teo-run.js must NOT be tracked in git ────────────────────────

describe("AC-1: bin/teo-run.js is untracked in git", () => {
  it("git ls-files bin/teo-run.js returns empty string", () => {
    const result = execSync("git ls-files bin/teo-run.js", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    expect(result).toBe("");
  });
});

// ─── AC-2: .gitignore must cover bin/teo-run.js.map ─────────────────────────

describe("AC-2: .gitignore covers bin/teo-run.js.map", () => {
  it(".gitignore contains an entry matching bin/teo-run.js.map", () => {
    const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    // Accept any line that literally covers the .map file: a dedicated entry
    // OR a glob pattern such as bin/teo-run.js* or bin/*.map.
    // The minimal contract is that the literal string appears somewhere.
    expect(gitignore).toMatch(/bin\/teo-run\.js\.map/);
  });
});

// ─── AC-3: postinstall must exist in package.json ───────────────────────────

describe("AC-3: postinstall script in package.json", () => {
  it('scripts.postinstall === "npm run bundle"', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.postinstall).toBe("npm run bundle");
  });
});

// ─── AC-4: esbuild.config.mjs has sourcemap: "external" ─────────────────────

describe('AC-4: esbuild.config.mjs has sourcemap: "external"', () => {
  it('contains sourcemap: "external" (with or without spaces around colon)', () => {
    const config = readFileSync(join(REPO_ROOT, "esbuild.config.mjs"), "utf8");
    // Match both `sourcemap: "external"` and `sourcemap:"external"`.
    expect(config).toMatch(/sourcemap:\s*"external"/);
  });
});

// ─── AC-5: TEO_VERSION is dynamic (createRequire), not hardcoded "1.0.0" ────

describe("AC-5: esbuild.config.mjs reads TEO_VERSION dynamically", () => {
  it('does NOT contain JSON.stringify("1.0.0") (hardcoded version removed)', () => {
    const config = readFileSync(join(REPO_ROOT, "esbuild.config.mjs"), "utf8");
    expect(config).not.toContain('JSON.stringify("1.0.0")');
  });

  it("contains createRequire (dynamic version read pattern)", () => {
    const config = readFileSync(join(REPO_ROOT, "esbuild.config.mjs"), "utf8");
    expect(config).toContain("createRequire");
  });
});

// ─── AC-6: npm run bundle emits both output files  (local-only, skip in CI) ──

const runBundleTests = describe.skipIf(!!process.env.CI)(
  "AC-6: npm run bundle produces bin/teo-run.js and bin/teo-run.js.map (local only)",
  () => {
    it("both bin/teo-run.js and bin/teo-run.js.map exist after bundle", () => {
      execSync("npm run bundle", {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(existsSync(join(REPO_ROOT, "bin/teo-run.js"))).toBe(true);
      expect(existsSync(join(REPO_ROOT, "bin/teo-run.js.map"))).toBe(true);
    }, 65_000); // vitest test timeout slightly above execSync timeout
  }
);

// Silence the unused-variable warning from linters — skipIf returns the suite.
void runBundleTests;
