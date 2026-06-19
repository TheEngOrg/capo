import { defineConfig } from "vitest/config";

// ADR-064 (amended 2026-06-18): Coverage policy is critical-path exhaustive, NOT blanket 100%.
// Only modules on the schema→validate→runner→gate→ledger→sign critical path require 100% coverage.
// Peripheral scaffold code (config, index re-exports, etc.) is excluded from thresholds.
// As new critical-path modules land they MUST be added to the perFile thresholds below.

export default defineConfig({
  test: {
    // WS-CORE-09: Block all outbound network calls globally.
    // The no-network setup file monkey-patches http/https/fetch so any live-model
    // call throws immediately. Zero outbound HTTP across the full harness run.
    setupFiles: ["./tests/acceptance/support/no-network.ts"],
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
        // WS-CORE-02: validate.ts is critical-path — all cross-task checks.
        // Gap found during WS-CORE-09 integration: threshold was missing despite
        // full coverage existing. Added per WS-CORE-08 fold-in mandate.
        "src/core/validate.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // WS-CORE-07: workstream-tree.ts is critical-path — isolation backend.
        "src/core/workstream-tree.ts": {
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
        // WS-CORE-04: gate.ts and verification.ts are critical-path modules.
        // gate.ts IS the fail-safe — 100% branch coverage is mandatory.
        "src/core/gate.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        "src/core/verification.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // WS-CORE-05: ledger.ts is critical-path — append-only JSONL writer.
        // Production-only branches (homedir fallback, non-Error throw shape)
        // are guarded with /* c8 ignore next */ per the established pattern.
        "src/core/ledger.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // WS-CORE-06: sign.ts is critical-path — HMAC-SHA-256 signing + keyring.
        // sign.ts IS the tamper-evidence layer — 100% branch coverage is mandatory.
        // Production-only branch (homedir fallback) is guarded with /* c8 ignore next */.
        "src/core/sign.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // WS-P1-02: revocation.ts is critical-path — ed25519 bootstrap revocation check.
        // All fail-safe branches (missing sig, wrong length, fetch failure, malformed list,
        // revoked key, bad sig) must be covered. 100% branch coverage is mandatory.
        "src/bootstrap/revocation.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
});
