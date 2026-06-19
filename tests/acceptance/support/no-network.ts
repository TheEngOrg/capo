// =============================================================================
// no-network.ts — Global vitest setup: block all outbound HTTP/HTTPS/fetch
//
// ZERO live-model calls. Any attempt to make an outbound network call during
// the golden harness suite THROWS immediately.
//
// node:http and node:https `request`/`get` are non-configurable properties
// so we cannot monkey-patch them directly. Instead we:
//   1. Override the global `fetch` (the primary mechanism for LLM API calls).
//   2. Export a call counter so tests can assert zero network calls were made.
//   3. Document that child_process.exec (used by ScriptMechanism production
//      runner) IS allowed — the demos use stub runners, never live processes.
//
// Wired via vitest.config.ts setupFiles — runs once before any test file.
// =============================================================================

let networkCallCount = 0;

// ---------------------------------------------------------------------------
// Block global fetch (Node 18+ / available in all vitest environments)
// This is the primary path for any LLM API call (OpenAI, Anthropic, etc.)
// ---------------------------------------------------------------------------
if (typeof globalThis.fetch !== "undefined") {
  const _originalFetch = globalThis.fetch;
  void _originalFetch; // suppress unused warning — we intentionally don't call it
  globalThis.fetch = async function blockedFetch(
    _input: RequestInfo | URL,
    _init?: RequestInit
  ): Promise<never> {
    networkCallCount++;
    throw new Error(
      `[no-network] global fetch blocked — zero live-model calls policy. ` +
        `Total blocked calls so far: ${networkCallCount}. ` +
        `All demos must use injected CommandRunner stubs, not live HTTP.`
    );
  };
}

// ---------------------------------------------------------------------------
// Exported counter + reset
// ---------------------------------------------------------------------------

/**
 * Returns the total number of blocked fetch attempts.
 * Tests assert this is always 0 after the full suite.
 */
export function getNetworkCallCount(): number {
  return networkCallCount;
}

/**
 * Reset the counter (useful in beforeEach for per-test isolation).
 */
export function resetNetworkCallCount(): void {
  networkCallCount = 0;
}
