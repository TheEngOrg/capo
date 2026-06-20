import { defineConfig } from "vitest/config";

// Live-test config — runs ONLY tests in tests/live/**/*.test.ts.
// No network blocking (live tests intentionally call real APIs).
// No coverage thresholds.
// MUST NOT be referenced by vitest.config.ts — the main `npm test` never picks up live tests.

export default defineConfig({
  test: {
    // No setupFiles — live tests need real network access (no no-network.ts)
    include: ["tests/live/**/*.test.ts"],
    pool: "forks",
  },
});
