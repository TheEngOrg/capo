import { defineConfig } from 'vitest/config';

// D-003: Tiered per-file coverage thresholds.
// Pure-logic files gated at 100%; TTY-dependent files have lower branch floors.
// Global floor is a safety net; per-file overrides are the primary enforcement.
//
// Per-file key syntax: glob form (**/filename.ts) per Vitest ^1.6.0 docs.
// Bare paths (src/classifier/classifier.ts) may not bind correctly — use glob.

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: [
        'src/classifier/**',
        'src/pipelines/**',
        'src/security/**',
        'src/audit/**',
        'src/repl/**',
        'src/llm/**',
        'src/mechanical/**',
        'src/context/**',
        'src/spinner/**',
      ],
      exclude: [
        'src/index.tsx',
        'src/ui/**',
        'src/cli/**',
        'node_modules/**',
        '**/keys.ts',
      ],
      thresholds: {
        // Global floor — safety net, not primary gate (D-003).
        lines: 95,
        functions: 99,
        branches: 95,
        statements: 95,

        // Pure-logic files — 100% on all four metrics (D-003).
        '**/classifier/classifier.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        '**/classifier/patterns.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        '**/security/identity.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        '**/security/policy.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        '**/audit/log.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        '**/repl/history.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // M3 new modules — Tier 1 (pure logic, 100% all metrics).
        '**/llm/claude-runtime.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        '**/llm/context.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        '**/mechanical/executor.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        '**/mechanical/allowlist.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        '**/mechanical/errors.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        '**/context/manager.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        '**/cli/auth-probe.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        '**/repl/SubprocessController.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // Spinner — Tier 2 (TTY branch paths not headlessly testable).
        '**/spinner/Spinner.tsx': {
          lines: 95,
          functions: 100,
          branches: 90,
          statements: 95,
        },
        // Phase 2b files — lower floors per D-003 (TTY branch paths not headlessly testable).
        '**/repl/useSubmit.ts': {
          lines: 99,
          functions: 99,
          branches: 99,
          statements: 99,
        },
        '**/repl/Session.tsx': {
          lines: 95,
          functions: 100,
          branches: 90,
          statements: 95,
        },
      },
    },
  },
});
