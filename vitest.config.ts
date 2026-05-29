import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      // CI-FU-2: 99% thresholds enforced mechanically on the gated modules.
      // UI component snapshots are covered separately; index.tsx entry point excluded.
      include: [
        'src/classifier/**',
        'src/pipelines/**',
        'src/security/**',
        'src/audit/**',
        'src/repl/**',
      ],
      exclude: [
        'src/index.tsx',
        'src/ui/**',
        'src/cli/**',
        'node_modules/**',
      ],
      thresholds: {
        lines: 99,
        functions: 99,
        branches: 99,
        statements: 99,
      },
    },
  },
});
