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
    // WS-P1-04: forks pool is required for vi.spyOn on node built-in modules
    // (node:fs mkdirSync, renameSync, writeFileSync). vmForks/vmThreads produce
    // non-configurable ESM namespace objects where vi.spyOn cannot redefine properties.
    pool: "forks",
    // WS-P1-04: mockReset resets mock call counts AND implementations before each test.
    // Required for provision tests: clearMocks alone doesn't reset mockImplementation,
    // which causes test-05's loadAgentDefinition override to leak into tests 08/09.
    // vi.fn(original) mocks reset to their original implementations (not undefined).
    mockReset: true,
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
        // WS-P1-06: load.ts is critical-path — agent roster loader with path-traversal
        // guard, frontmatter parser, Zod validation, and agent_id mismatch detection.
        // 100% branch coverage is mandatory.
        "src/agents/load.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // WS-P1-03a: plan-builder.ts is critical-path — incremental PlanBuilder feeds
        // the schema→validate→runner chain. 100% branch coverage is mandatory.
        "src/core/plan-builder.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // WS-P1-03b: stub.ts is the model-free CI adapter — drives PlanBuilder and
        // returns stub PASS results. The finalizePlan() failure branch is guarded with
        // /* c8 ignore next */ (defensive path; the builder only fails if given invalid
        // input that the stub never produces). 100% coverage on all instrumented lines.
        "src/adapters/stub.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // WS-P1-03c: claude-code.ts is critical-path — LLM call site #1, the Sage
        // planning loop via injected AgentRunner + PlanBuilder tool-calls.
        // Two defensive branches (finalize_plan catch, unknown tool default) are
        // guarded with /* c8 ignore start/stop */ — unreachable in typed sessions.
        "src/adapters/claude-code.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // WS-P1-07: run-plan.ts is critical-path — the runPlan() engine entrypoint
        // that wires validate → TopologicalRunner → adapter.spawnAgent. WS-P1-09
        // (Phase 1 CI gate) calls it directly. SCRIPT-task execution is deferred
        // (returns FAILED) pending a separate security-reviewed workstream.
        // 100% branch coverage is mandatory.
        "src/engine/run-plan.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // WS-P1-04: provision.ts is critical-path — the sole sanctioned writer to ~/.teo/.
        // Atomic staging, EXDEV fallback, revocation integration, and repair paths must all
        // be covered. 100% branch coverage is mandatory.
        "src/bootstrap/provision.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
});
