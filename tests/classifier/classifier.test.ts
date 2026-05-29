import { describe, it, expect } from 'vitest';
import { classify } from '../../src/classifier/classifier.js';
import type { Route } from '../../src/classifier/types.js';

// T-22, T-23, T-24 are integration tests requiring ink-testing-library and live in
// tests/repl/session.test.tsx (Phase 2b). The pure-logic coverage is here.

const VALID_ROUTES: Route[] = ['MECHANICAL', 'ARCHITECTURAL', 'UNKNOWN'];
const VALID_DISPLAY_ROUTES = ['mechanical', 'architectural'];

// Helper: assert a RouteDecision is structurally sound.
function assertValidDecision(result: ReturnType<typeof classify>): void {
  expect(VALID_ROUTES).toContain(result.route);
  expect(VALID_DISPLAY_ROUTES).toContain(result.display_route);
  expect(typeof result.raw_input).toBe('string');
}

describe('Classifier (Pass 2)', () => {
  // =========================================================================
  // MISUSE — inputs the classifier must survive without crashing
  // =========================================================================

  it('T-15 — empty string input does not crash', () => {
    let result: ReturnType<typeof classify> | undefined;
    expect(() => {
      result = classify('');
    }).not.toThrow();
    expect(result).toBeDefined();
    assertValidDecision(result!);
    // Empty string matches no pattern — must return UNKNOWN.
    expect(result!.route).toBe('UNKNOWN');
    // UNKNOWN collapses to architectural at classification time.
    expect(result!.display_route).toBe('architectural');
  });

  it('T-16 — 10,000-character input does not OOM or hang (< 100ms)', () => {
    const longInput = 'a'.repeat(10_000);
    const start = performance.now();
    let result: ReturnType<typeof classify> | undefined;
    expect(() => {
      result = classify(longInput);
    }).not.toThrow();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
    assertValidDecision(result!);
  });

  it('T-17 — null bytes in input handled gracefully', () => {
    let result: ReturnType<typeof classify> | undefined;
    expect(() => {
      result = classify('show me\x00the directory');
    }).not.toThrow();
    assertValidDecision(result!);
  });

  it('T-18 — unicode input does not crash classifier (emoji)', () => {
    let result: ReturnType<typeof classify> | undefined;
    expect(() => {
      result = classify('🎉👋');
    }).not.toThrow();
    assertValidDecision(result!);
  });

  it('T-18 — unicode input does not crash classifier (arabic)', () => {
    let result: ReturnType<typeof classify> | undefined;
    expect(() => {
      result = classify('مرحبا');
    }).not.toThrow();
    assertValidDecision(result!);
  });

  it('T-18 — unicode input does not crash classifier (zero-width chars)', () => {
    // Zero-width chars can look like empty input to naive byte-length checks.
    let result: ReturnType<typeof classify> | undefined;
    expect(() => {
      result = classify('​​​');
    }).not.toThrow();
    assertValidDecision(result!);
  });

  // =========================================================================
  // BOUNDARY — pattern matching correctness (T-19, T-20, T-21, T-54)
  // Each assertion below maps 1:1 to an entry in MECHANICAL_PATTERNS or
  // ARCHITECTURAL_PATTERNS per spec Section 4.1 (18 + 18 entries).
  // =========================================================================

  // --- T-19: MECHANICAL seed pattern boundary (one assertion per pattern) ---

  it('T-19 — MECHANICAL: run/exec/execute', () => {
    expect(classify('run the tests').route).toBe('MECHANICAL');
    expect(classify('exec the script').route).toBe('MECHANICAL');
    expect(classify('execute this command').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: list/ls', () => {
    expect(classify('list the files').route).toBe('MECHANICAL');
    expect(classify('ls the directory').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: show me', () => {
    expect(classify('show me the current directory').route).toBe('MECHANICAL');
    expect(classify('show the output').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: get/fetch/retrieve', () => {
    expect(classify('get the config value').route).toBe('MECHANICAL');
    expect(classify('fetch the data').route).toBe('MECHANICAL');
    expect(classify('retrieve the record').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: check/validate/verify', () => {
    expect(classify('check the status').route).toBe('MECHANICAL');
    expect(classify('validate the input').route).toBe('MECHANICAL');
    expect(classify('verify the signature').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: install/uninstall/add/remove', () => {
    expect(classify('install the package').route).toBe('MECHANICAL');
    expect(classify('uninstall the old version').route).toBe('MECHANICAL');
    expect(classify('add the dependency').route).toBe('MECHANICAL');
    expect(classify('remove the file').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: build/compile', () => {
    expect(classify('build the project').route).toBe('MECHANICAL');
    expect(classify('compile the binary').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: deploy/ship/release', () => {
    expect(classify('deploy the service').route).toBe('MECHANICAL');
    expect(classify('ship the release').route).toBe('MECHANICAL');
    expect(classify('release the package').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: open file', () => {
    expect(classify('open file config.ts').route).toBe('MECHANICAL');
    expect(classify('open the file').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: read file', () => {
    expect(classify('read file package.json').route).toBe('MECHANICAL');
    expect(classify('read the file').route).toBe('MECHANICAL');
    expect(classify('read from the config').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: write to file', () => {
    expect(classify('write to file output.txt').route).toBe('MECHANICAL');
    expect(classify('write the file').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: delete file/this', () => {
    expect(classify('delete the file').route).toBe('MECHANICAL');
    expect(classify('delete this entry').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: current directory', () => {
    expect(classify('what is the current directory').route).toBe('MECHANICAL');
    expect(classify('show current directory').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: what is the', () => {
    expect(classify('what is the version number').route).toBe('MECHANICAL');
  });

  it("T-19 — MECHANICAL: what's in / what's the", () => {
    expect(classify("what's in the directory").route).toBe('MECHANICAL');
    expect(classify("what's the status").route).toBe('MECHANICAL');
    expect(classify('what is in the folder').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: print word', () => {
    expect(classify('print the output').route).toBe('MECHANICAL');
    expect(classify('print this value').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: git status/log/diff/add/commit/push/pull', () => {
    expect(classify('git status').route).toBe('MECHANICAL');
    expect(classify('git log').route).toBe('MECHANICAL');
    expect(classify('git diff').route).toBe('MECHANICAL');
    expect(classify('git add .').route).toBe('MECHANICAL');
    expect(classify('git commit').route).toBe('MECHANICAL');
    expect(classify('git push').route).toBe('MECHANICAL');
    expect(classify('git pull').route).toBe('MECHANICAL');
  });

  it('T-19 — MECHANICAL: start/stop/restart word', () => {
    expect(classify('start the server').route).toBe('MECHANICAL');
    expect(classify('stop the process').route).toBe('MECHANICAL');
    expect(classify('restart the service').route).toBe('MECHANICAL');
  });

  // --- T-20: ARCHITECTURAL seed pattern boundary (one assertion per pattern) ---

  it('T-20 — ARCHITECTURAL: design/architect/architecture', () => {
    expect(classify('design a caching layer').route).toBe('ARCHITECTURAL');
    expect(classify('architect the system').route).toBe('ARCHITECTURAL');
    expect(classify('architecture for a microservice').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: plan for/a/the/out', () => {
    expect(classify('plan for the migration').route).toBe('ARCHITECTURAL');
    expect(classify('plan a new system').route).toBe('ARCHITECTURAL');
    expect(classify('plan the rollout').route).toBe('ARCHITECTURAL');
    expect(classify('plan out the approach').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: refactor/restructure/reorganize', () => {
    expect(classify('refactor the auth module').route).toBe('ARCHITECTURAL');
    expect(classify('restructure the codebase').route).toBe('ARCHITECTURAL');
    expect(classify('reorganize the folders').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: evaluate/assess/compare/weigh', () => {
    expect(classify('evaluate the options').route).toBe('ARCHITECTURAL');
    expect(classify('assess the risks').route).toBe('ARCHITECTURAL');
    expect(classify('compare these two approaches').route).toBe('ARCHITECTURAL');
    expect(classify('weigh the tradeoffs').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: how should we/i/the', () => {
    expect(classify('how should we handle this').route).toBe('ARCHITECTURAL');
    expect(classify('how should i structure this').route).toBe('ARCHITECTURAL');
    expect(classify('how should the system handle errors').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: what if', () => {
    expect(classify('what if we add caching').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: should we', () => {
    expect(classify('should we use postgres or mysql').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: why does/is/do/did/would', () => {
    expect(classify('why does this fail under load').route).toBe('ARCHITECTURAL');
    expect(classify('why is the service slow').route).toBe('ARCHITECTURAL');
    expect(classify('why do we need this abstraction').route).toBe('ARCHITECTURAL');
    expect(classify('why did we choose this pattern').route).toBe('ARCHITECTURAL');
    expect(classify('why would this cause issues').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: help me design/plan/think/figure/decide', () => {
    expect(classify('help me design an auth system').route).toBe('ARCHITECTURAL');
    expect(classify('help me plan the database schema').route).toBe('ARCHITECTURAL');
    expect(classify('help me think through this').route).toBe('ARCHITECTURAL');
    expect(classify('help me figure out the best approach').route).toBe('ARCHITECTURAL');
    expect(classify('help me decide between the two').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: best approach/way/practice/pattern', () => {
    expect(classify('best approach for this problem').route).toBe('ARCHITECTURAL');
    expect(classify('best way to handle auth').route).toBe('ARCHITECTURAL');
    expect(classify('best practice for error handling').route).toBe('ARCHITECTURAL');
    expect(classify('best pattern for this use case').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: tradeoff(s)', () => {
    expect(classify('what are the tradeoffs').route).toBe('ARCHITECTURAL');
    expect(classify('tradeoffs between approaches').route).toBe('ARCHITECTURAL');
    expect(classify('trade-off analysis').route).toBe('ARCHITECTURAL');
    expect(classify('trade offs here').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: architecture of/for/decision', () => {
    expect(classify('architecture of the system').route).toBe('ARCHITECTURAL');
    expect(classify('architecture for this service').route).toBe('ARCHITECTURAL');
    expect(classify('architecture decision needed').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: strategy/approach/pattern for', () => {
    expect(classify('strategy for database access').route).toBe('ARCHITECTURAL');
    expect(classify('approach for error handling').route).toBe('ARCHITECTURAL');
    expect(classify('pattern for this use case').route).toBe('ARCHITECTURAL');
  });

  it("T-20 — ARCHITECTURAL: what's the best way", () => {
    expect(classify("what's the best way to structure this").route).toBe('ARCHITECTURAL');
    expect(classify('what is the best way to handle auth').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: pros and cons / pro con', () => {
    expect(classify('pros and cons of this approach').route).toBe('ARCHITECTURAL');
    expect(classify('pros cons').route).toBe('ARCHITECTURAL');
    expect(classify('pro and con').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: migrate/migration to/from/path', () => {
    expect(classify('migrate to postgres').route).toBe('ARCHITECTURAL');
    expect(classify('migration from mysql').route).toBe('ARCHITECTURAL');
    expect(classify('migration path for the database').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: scale ... to/for', () => {
    expect(classify('scale the service to handle more load').route).toBe('ARCHITECTURAL');
    expect(classify('scale for global traffic').route).toBe('ARCHITECTURAL');
  });

  it('T-20 — ARCHITECTURAL: pick between', () => {
    expect(classify('pick between redis and memcached').route).toBe('ARCHITECTURAL');
  });

  // --- T-21: UNKNOWN fallback ---

  it('T-21 — no seed pattern match returns UNKNOWN', () => {
    const result = classify('blorp the fleeb');
    expect(result.route).toBe('UNKNOWN');
    // UNKNOWN must collapse to architectural at classification time (PM AC Section 3).
    expect(result.display_route).toBe('architectural');
  });

  it('T-21 — UNKNOWN result has no matched_pattern field', () => {
    const result = classify('blorp the fleeb');
    expect(result.matched_pattern).toBeUndefined();
  });

  // --- Precedence: MECHANICAL wins over ARCHITECTURAL when both could match ---
  // Spec Section 4.1: "build a design" routes MECHANICAL on the `build` keyword,
  // not ARCHITECTURAL on `design`. Order matters.

  it('MECHANICAL-first precedence: "build a design" routes MECHANICAL not ARCHITECTURAL', () => {
    const result = classify('build a design');
    expect(result.route).toBe('MECHANICAL');
    expect(result.display_route).toBe('mechanical');
  });

  // --- T-54: Classifier latency < 100ms for ≤ 1000-char inputs ---

  it('T-54 — classifier latency < 100ms for all 10 inputs of 1000 chars', () => {
    const inputs = [
      'a'.repeat(1000),
      'show me the '.padEnd(1000, 'x'),
      'design a '.padEnd(1000, 'x'),
      'blorp '.padEnd(1000, 'x'),
      '🎉'.repeat(250), // 1000 bytes (250 4-byte emoji)
      'مرحبا'.repeat(200),
      'git status '.padEnd(1000, ' '),
      'what is the '.padEnd(1000, 'x'),
      'help me design '.padEnd(1000, 'x'),
      'z'.repeat(1000),
    ];

    for (const input of inputs) {
      const start = performance.now();
      const result = classify(input);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
      assertValidDecision(result);
    }
  });

  // =========================================================================
  // GOLDEN — RouteDecision structural correctness on happy paths
  // =========================================================================

  it('MECHANICAL result has correct shape', () => {
    const result = classify('show me the current directory');
    expect(result.route).toBe('MECHANICAL');
    expect(result.display_route).toBe('mechanical');
    expect(result.raw_input).toBe('show me the current directory');
    expect(typeof result.matched_pattern).toBe('string');
    expect(result.matched_pattern!.length).toBeGreaterThan(0);
  });

  it('ARCHITECTURAL result has correct shape', () => {
    const result = classify('design a caching layer for a high-traffic API');
    expect(result.route).toBe('ARCHITECTURAL');
    expect(result.display_route).toBe('architectural');
    expect(result.raw_input).toBe('design a caching layer for a high-traffic API');
    expect(typeof result.matched_pattern).toBe('string');
  });

  it('UNKNOWN result shape — display_route is architectural not unknown', () => {
    const result = classify('blorp the fleeb');
    expect(result.route).toBe('UNKNOWN');
    expect(result.display_route).toBe('architectural');
    // Never 'unknown' — PM AC Section 3 lock
    expect(result.display_route).not.toBe('unknown');
    expect(result.raw_input).toBe('blorp the fleeb');
    expect(result.matched_pattern).toBeUndefined();
  });

  it('raw_input is preserved verbatim in RouteDecision', () => {
    const input = 'show me\x00the directory with 日本語';
    const result = classify(input);
    expect(result.raw_input).toBe(input);
  });
});
