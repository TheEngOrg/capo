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

// =============================================================================
// M2 — Compute / Arithmetic Ground-Truth Expansion
//
// PRINCIPLE (staff-engineer): MECHANICAL = single deterministic operation with
// exactly one correct result. Arithmetic and deterministic compute are MECHANICAL.
// ARCHITECTURAL = requires judgment ("it depends" is legitimate).
//
// Tests are ordered: MISUSE → BOUNDARY → GOLDEN.
// All new assertions in this block must be RED against the current patterns.ts
// (no numeric/compute patterns exist yet). Existing tests above stay GREEN.
// =============================================================================

describe('Classifier M2 — compute/arithmetic ground-truth', () => {
  // ===========================================================================
  // MISUSE — inputs the compute path must survive AND route correctly under
  // adversarial or unexpected forms. These also serve as regression guards for
  // boundaries that must NOT change.
  // ===========================================================================

  // --- Regression guard: UNKNOWN→architectural display collapse is PM-locked ---

  it('M2-MISUSE-01 — "test a thing" stays UNKNOWN→architectural (genuinely ambiguous, not mechanical)', () => {
    // Staff-eng confirmed: "test" without context could mean many things.
    // This must NOT become MECHANICAL after M2 numeric patterns are added.
    const result = classify('test a thing');
    expect(result.route).toBe('UNKNOWN');
    expect(result.display_route).toBe('architectural');
  });

  it('M2-MISUSE-02 — UNKNOWN display_route is still "architectural" not "unknown" after M2', () => {
    // PM AC Section 3 lock: display_route for UNKNOWN is always 'architectural'.
    const result = classify('blorp 42');
    expect(result.display_route).toBe('architectural');
    expect(result.display_route).not.toBe('unknown');
  });

  // --- Regression guard: architectural inputs must NOT be swallowed by a too-greedy numeric pattern ---

  it('M2-MISUSE-03 — "what is the best way to handle auth" stays ARCHITECTURAL (what-is-the + best exemption)', () => {
    expect(classify('what is the best way to handle auth').route).toBe('ARCHITECTURAL');
  });

  it("M2-MISUSE-04 — \"what's the best way to compute X\" stays ARCHITECTURAL (judgment, not deterministic)", () => {
    // "compute X" here is a design question about HOW to compute, not a compute request.
    expect(classify("what's the best way to compute X").route).toBe('ARCHITECTURAL');
  });

  it('M2-MISUSE-05 — "should we add caching" stays ARCHITECTURAL (not a compute request)', () => {
    expect(classify('should we add caching').route).toBe('ARCHITECTURAL');
  });

  it('M2-MISUSE-06 — "design a system" stays ARCHITECTURAL', () => {
    expect(classify('design a system').route).toBe('ARCHITECTURAL');
  });

  it('M2-MISUSE-07 — "how should we structure this" stays ARCHITECTURAL', () => {
    expect(classify('how should we structure this').route).toBe('ARCHITECTURAL');
  });

  // --- Dangerous near-misses: compute-adjacent phrasing that is ARCHITECTURAL, NOT mechanical ---

  it('M2-MISUSE-08 — "how should we calculate pricing" is ARCHITECTURAL (judgment about approach, not a calculation)', () => {
    // PRINCIPLE: "it depends" is a legitimate answer — pricing strategy requires judgment.
    expect(classify('how should we calculate pricing').route).toBe('ARCHITECTURAL');
  });

  it('M2-MISUSE-09 — "how should we compute the hash function" is ARCHITECTURAL (design question)', () => {
    expect(classify('how should we compute the hash function').route).toBe('ARCHITECTURAL');
  });

  it('M2-MISUSE-10 — "help me decide how to calculate the rate" is ARCHITECTURAL (explicit design/decide verb)', () => {
    expect(classify('help me decide how to calculate the rate').route).toBe('ARCHITECTURAL');
  });

  it('M2-MISUSE-11 — "what is the best approach to compute throughput" is ARCHITECTURAL (best approach = judgment)', () => {
    expect(classify('what is the best approach to compute throughput').route).toBe('ARCHITECTURAL');
  });

  // ===========================================================================
  // BOUNDARY — the mechanical/architectural border for compute inputs.
  // Tests cover: bare arithmetic, varied operators, spacing, compute verbs,
  // verb+number combos, phrasing variety. Each group uses multiple distinct
  // phrasings so a dev cannot hard-code specific strings to pass.
  // ===========================================================================

  // --- Bare arithmetic expressions ---

  it('M2-BOUNDARY-01 — bare arithmetic "2+2" routes MECHANICAL', () => {
    // Canonical example from M2 gap report. Single deterministic operation.
    expect(classify('2+2').route).toBe('MECHANICAL');
    expect(classify('2+2').display_route).toBe('mechanical');
  });

  it('M2-BOUNDARY-02 — arithmetic with spaces "2 + 2" routes MECHANICAL', () => {
    expect(classify('2 + 2').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-03 — multiplication "3 * 4" routes MECHANICAL', () => {
    expect(classify('3 * 4').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-04 — division "100 / 5" routes MECHANICAL', () => {
    expect(classify('100 / 5').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-05 — subtraction "7-3" routes MECHANICAL', () => {
    expect(classify('7-3').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-06 — arithmetic phrasing variety: floats and decimals route MECHANICAL', () => {
    // Verifies the pattern handles non-integer operands — principle, not literal strings.
    expect(classify('3.14 * 2').route).toBe('MECHANICAL');
    expect(classify('100.5 / 4.2').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-07 — large numbers in arithmetic route MECHANICAL', () => {
    // Tests that the pattern is not limited to single-digit operands.
    expect(classify('1000 + 2500').route).toBe('MECHANICAL');
    expect(classify('99999 * 12').route).toBe('MECHANICAL');
  });

  // --- Compute verbs (deterministic operation, single result) ---

  it('M2-BOUNDARY-08 — "calculate the total" routes MECHANICAL', () => {
    // Deterministic: given a set of values, there is exactly one correct total.
    expect(classify('calculate the total').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-09 — "calculate 5 percent of 200" routes MECHANICAL', () => {
    expect(classify('calculate 5 percent of 200').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-10 — "compute the sum" routes MECHANICAL', () => {
    expect(classify('compute the sum').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-11 — "compute 15 squared" routes MECHANICAL', () => {
    expect(classify('compute 15 squared').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-12 — "convert 5km to miles" routes MECHANICAL', () => {
    // Unit conversion: single deterministic result, no judgment involved.
    expect(classify('convert 5km to miles').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-13 — "convert 100 fahrenheit to celsius" routes MECHANICAL', () => {
    expect(classify('convert 100 fahrenheit to celsius').route).toBe('MECHANICAL');
  });

  // --- Verb + number combos ---

  it('M2-BOUNDARY-14 — "add 2+2" routes MECHANICAL', () => {
    // Verb + arithmetic expression — unambiguously deterministic.
    expect(classify('add 2+2').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-15 — "add 5 and 3" routes MECHANICAL', () => {
    expect(classify('add 5 and 3').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-16 — "multiply 6 by 7" routes MECHANICAL', () => {
    expect(classify('multiply 6 by 7').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-17 — "sum these numbers" routes MECHANICAL', () => {
    expect(classify('sum these numbers').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-18 — "divide 81 by 9" routes MECHANICAL', () => {
    expect(classify('divide 81 by 9').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-19 — "subtract 12 from 50" routes MECHANICAL', () => {
    expect(classify('subtract 12 from 50').route).toBe('MECHANICAL');
  });

  // --- Phrasing variety: "what is" and "what's" with compute content ---

  it('M2-BOUNDARY-20 — "what is 2+2" routes MECHANICAL', () => {
    // Note: existing pattern /what\s+is\s+the\s+(?!best\b)/ requires "the" after "is".
    // "what is 2+2" has no "the" — this MUST be a new pattern, not the existing one.
    expect(classify('what is 2+2').route).toBe('MECHANICAL');
  });

  it("M2-BOUNDARY-21 — \"what's 17 times 3\" routes MECHANICAL", () => {
    // Existing /what('?s|\s+is)\s+(in|the)\s+/ requires "in" or "the" — "what's 17" doesn't match.
    // This requires new pattern coverage.
    expect(classify("what's 17 times 3").route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-22 — "what is 100 divided by 4" routes MECHANICAL', () => {
    expect(classify('what is 100 divided by 4').route).toBe('MECHANICAL');
  });

  it("M2-BOUNDARY-23 — \"what's the square root of 144\" routes MECHANICAL", () => {
    // Deterministic: one correct answer.
    expect(classify("what's the square root of 144").route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-24 — phrasing variety: "how much is 8 times 9" routes MECHANICAL', () => {
    // "how much is" with arithmetic — deterministic, not opinion-seeking.
    expect(classify('how much is 8 times 9').route).toBe('MECHANICAL');
  });

  it('M2-BOUNDARY-25 — phrasing variety: "how many is 3 plus 4" routes MECHANICAL', () => {
    expect(classify('how many is 3 plus 4').route).toBe('MECHANICAL');
  });

  // --- "solve" — flagged as BORDERLINE; testing both ends of the boundary ---
  // Per the M2 spec: "solve for x" is borderline; a deterministic solve like
  // "solve 2x=4" is mechanical. We test both and flag the ambiguous case below.

  it('M2-BOUNDARY-26 — "solve 2x=4" routes MECHANICAL (deterministic, single result)', () => {
    // Single linear equation: exactly one solution.
    expect(classify('solve 2x=4').route).toBe('MECHANICAL');
  });

  // ===========================================================================
  // GOLDEN — RouteDecision structural correctness for M2 compute paths
  // ===========================================================================

  it('M2-GOLDEN-01 — MECHANICAL compute result has correct RouteDecision shape', () => {
    const result = classify('2+2');
    expect(result.route).toBe('MECHANICAL');
    expect(result.display_route).toBe('mechanical');
    expect(result.raw_input).toBe('2+2');
    expect(typeof result.matched_pattern).toBe('string');
    expect(result.matched_pattern!.length).toBeGreaterThan(0);
  });

  it('M2-GOLDEN-02 — MECHANICAL compute result: display_route is "mechanical" not "arithmetic"', () => {
    // Classifier has only two display labels. Compute maps to "mechanical".
    const result = classify('calculate the total');
    expect(result.display_route).toBe('mechanical');
    expect(result.display_route).not.toBe('arithmetic');
    expect(result.display_route).not.toBe('compute');
  });

  it('M2-GOLDEN-03 — raw_input preserved verbatim for arithmetic input', () => {
    const input = '3 * 4';
    const result = classify(input);
    expect(result.raw_input).toBe(input);
  });

  it('M2-GOLDEN-04 — raw_input preserved verbatim for compute-verb input', () => {
    const input = 'calculate the total';
    const result = classify(input);
    expect(result.raw_input).toBe(input);
  });

  it('M2-GOLDEN-05 — classifier latency for compute inputs < 100ms', () => {
    const computeInputs = [
      '2+2',
      '100 / 5',
      'calculate the total',
      'compute the sum',
      'convert 5km to miles',
      'what is 2+2',
      "what's 17 times 3",
      'multiply 6 by 7',
      'add 5 and 3',
      'solve 2x=4',
    ];
    for (const input of computeInputs) {
      const start = performance.now();
      classify(input);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
    }
  });
});
