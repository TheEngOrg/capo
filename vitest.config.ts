import { defineConfig } from "vitest/config";

// ADR-064 (amended 2026-06-18): Coverage policy is critical-path exhaustive, NOT blanket 100%.
// Only modules on the schema→validate→runner→gate→ledger→sign critical path require 100% coverage.
// Peripheral scaffold code (config, index re-exports, etc.) is excluded from thresholds.
// As new critical-path modules land they MUST be added to the perFile thresholds below.

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/index.ts"],
      // Per-file 100% thresholds on critical-path modules.
      // Global thresholds are intentionally omitted — peripheral files should
      // not drag down or be forced to 100%.
      thresholds: {
        "src/core/plan.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        "src/core/runner.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
});
