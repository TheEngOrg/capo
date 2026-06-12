import { defineConfig } from "vitest/config";

// TEO v5 — deterministic core is pure logic and gated at 100%.
// The CLI/TUI surface (src/cli, src/index.tsx) is excluded from coverage —
// it is thin and exercised by integration/e2e rather than unit coverage.

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/core/**"],
      exclude: [
        "src/index.tsx",
        "src/cli/**",
        "node_modules/**",
        // Live-I/O LLM runners — exercised by integration tests against a real
        // binary / API key, not the unit coverage gate. See TEO-5.md §6.
        "src/core/agent-spawn/runners/**",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
