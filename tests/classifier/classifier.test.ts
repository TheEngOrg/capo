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

// =============================================================================
// M2 Tightening — FU-2..FU-5 Over-Broadening Regressions
//
// PRINCIPLE (D-005): The fix for M2 over-broadening is to require STRUCTURAL
// SIGNAL of a deterministic operation (numeric operand/operator/unit), not to
// blocklist specific example strings. Tests therefore include varied phrasings
// beyond the D-005 literal table rows, so a dev who blocklists only those
// eight strings still fails this suite.
//
// Order: MISUSE (false-positives that must flip) → BOUNDARY (edge cases) →
// GOLDEN (true-positives that must remain MECHANICAL after tightening).
//
// RED = currently routes MECHANICAL but must route ARCHITECTURAL or UNKNOWN.
// GREEN guard = already routes correctly and must STAY that way after tightening.
// =============================================================================

describe('Classifier M2 tightening — FU-2..FU-5 over-broadening regressions', () => {
  // ===========================================================================
  // MISUSE — false positives that are RED right now and MUST flip after tightening.
  // These are the defects the fix must resolve.
  // ===========================================================================

  // --- FU-2: /\badd\s+\d/i is too loose — "add N <non-numeric-noun>" is not arithmetic ---
  //
  // PRINCIPLE: "add 10 engineers" is a capacity or org decision — reasonable engineers
  // could answer it differently (hire vs contract, team split, etc.). The digit in these
  // inputs is modifying an ORGANIZATIONAL noun, not an arithmetic operand. A tightened
  // pattern must require that the digit is part of a pure arithmetic expression, not an
  // adjective quantifying a human/temporal/project noun.

  it('FU-2-MISUSE-01 — "add 10 engineers to the team" must route ARCHITECTURAL (capacity decision, not arithmetic)', () => {
    // RED: currently matches /\badd\s+\d/i and routes MECHANICAL.
    // The digit "10" quantifies an organizational noun. This is a staffing/capacity judgment.
    expect(classify('add 10 engineers to the team').route).toBe('ARCHITECTURAL');
  });

  it('FU-2-MISUSE-02 — "add 3 more requirements to the spec" must route ARCHITECTURAL (scope decision)', () => {
    // RED: digit gates on "3" but "requirements" is a project-management noun.
    expect(classify('add 3 more requirements to the spec').route).toBe('ARCHITECTURAL');
  });

  it('FU-2-MISUSE-03 — "add 5 people to the project" must route ARCHITECTURAL (resourcing judgment)', () => {
    // RED: varied phrasing — "people" instead of "engineers". Blocklisting "engineers"
    // alone would not fix this.
    expect(classify('add 5 people to the project').route).toBe('ARCHITECTURAL');
  });

  it('FU-2-MISUSE-04 — "add 2 weeks to the timeline" must route ARCHITECTURAL (schedule/planning decision)', () => {
    // RED: "weeks" is a temporal planning noun, not an arithmetic operand.
    // A correct fix must distinguish "add N <quantity-noun>" from "add N <and|to N>".
    expect(classify('add 2 weeks to the timeline').route).toBe('ARCHITECTURAL');
  });

  it('FU-2-MISUSE-05 — "add 4 developers to the sprint" must route ARCHITECTURAL (agile capacity decision)', () => {
    // RED: phrasing variety beyond D-005 literal strings — prevents blocklist workaround.
    // "Sprint" and "developers" are organizational/agile nouns, not numeric operands.
    expect(classify('add 4 developers to the sprint').route).toBe('ARCHITECTURAL');
  });

  it('FU-2-MISUSE-06 — "add 6 months to the roadmap" must route ARCHITECTURAL (schedule judgment)', () => {
    // RED: "months" is a planning/schedule noun, not an arithmetic operand.
    expect(classify('add 6 months to the roadmap').route).toBe('ARCHITECTURAL');
  });

  // --- FU-3: /\bsum\s+(these|the|all|those)\b/i too loose — "sum the <results/outcomes>"
  //     is a reporting or evaluation question, not a compute request.
  //
  // PRINCIPLE: "sum the quarterly results" asks for judgment about what those results
  // mean — "it depends on the framing" is a legitimate answer. Pure deterministic sum
  // requires the VALUES being summed to be present or clearly numeric. Without concrete
  // numeric operands in the sentence, "sum the X" is a reporting/interpretation request.

  it('FU-3-MISUSE-01 — "sum the quarterly results" must route ARCHITECTURAL (reporting/interpretation, not compute)', () => {
    // RED: currently matches /\bsum\s+(these|the|all|those)\b/i. "Quarterly results"
    // is a business-reporting noun phrase, not a set of numeric operands.
    expect(classify('sum the quarterly results').route).toBe('ARCHITECTURAL');
  });

  it('FU-3-MISUSE-02 — "sum the business outcomes" must route ARCHITECTURAL (evaluation question)', () => {
    // RED: "business outcomes" requires interpretive judgment — no single correct sum.
    expect(classify('sum the business outcomes').route).toBe('ARCHITECTURAL');
  });

  it('FU-3-MISUSE-03 — "sum the team\'s feedback" must route ARCHITECTURAL (qualitative judgment)', () => {
    // RED: phrasing variety — "feedback" is qualitative, not numeric.
    // A blocklist on "results" and "outcomes" would not catch this.
    expect(classify("sum the team's feedback").route).toBe('ARCHITECTURAL');
  });

  it('FU-3-MISUSE-04 — "sum all the performance issues" must route ARCHITECTURAL (qualitative review)', () => {
    // RED: additional variety — "all" variant of the pattern, non-numeric noun.
    expect(classify('sum all the performance issues').route).toBe('ARCHITECTURAL');
  });

  it('FU-3-MISUSE-05 — "sum those architectural concerns" must route ARCHITECTURAL (judgment, not count)', () => {
    // RED: "those" variant — qualitative concerns are not numeric operands.
    expect(classify('sum those architectural concerns').route).toBe('ARCHITECTURAL');
  });

  // --- FU-4: /^\s*(calculate|compute|convert)\b/i too loose at sentence start —
  //     when the OBJECT of calculate/compute/convert is an architectural noun, the
  //     operation requires judgment, not deterministic arithmetic.
  //
  // PRINCIPLE: "convert the database schema" is an architectural activity — schema
  // migrations require decisions about type mappings, nullability, backwards compat.
  // "compute the optimal strategy" requires judgment — "optimal" means "it depends."
  // Sentence-initial anchoring was meant to exclude mid-sentence judgment frames, but
  // it fails when the object itself is an architectural/judgment noun. The fix must
  // require that the object is numeric or a recognized unit of measure.

  it('FU-4-MISUSE-01 — "convert the database schema" must route ARCHITECTURAL (migration is architecture)', () => {
    // RED: starts with "convert", matches /^\s*(calculate|compute|convert)\b/i.
    // Schema conversion involves structural decisions — no single correct result.
    expect(classify('convert the database schema').route).toBe('ARCHITECTURAL');
  });

  it('FU-4-MISUSE-02 — "compute the optimal strategy" must route ARCHITECTURAL (judgment: optimal = it depends)', () => {
    // RED: "optimal" is a judgment word — reasonable engineers disagree on optimal strategies.
    expect(classify('compute the optimal strategy').route).toBe('ARCHITECTURAL');
  });

  it('FU-4-MISUSE-03 — "calculate the best team structure" must route ARCHITECTURAL (org design decision)', () => {
    // RED: phrasing variety — "calculate" at sentence start, but object is an org/design noun.
    expect(classify('calculate the best team structure').route).toBe('ARCHITECTURAL');
  });

  it('FU-4-MISUSE-04 — "convert our monolith to microservices" must route ARCHITECTURAL (architectural migration)', () => {
    // RED: "convert" at sentence start, but this is a system architecture decision.
    // Blocklisting "database schema" alone would not catch this case.
    expect(classify('convert our monolith to microservices').route).toBe('ARCHITECTURAL');
  });

  it('FU-4-MISUSE-05 — "compute the ideal architecture" must route ARCHITECTURAL (design judgment)', () => {
    // RED: "ideal architecture" is a judgment noun — no single correct result.
    expect(classify('compute the ideal architecture').route).toBe('ARCHITECTURAL');
  });

  it('FU-4-MISUSE-06 — "calculate the right approach for authentication" must route ARCHITECTURAL (design decision)', () => {
    // RED: phrasing variety — "right approach" is judgment-dependent.
    // Prevents a blocklist fix covering only the D-005 literal strings.
    expect(classify('calculate the right approach for authentication').route).toBe('ARCHITECTURAL');
  });

  it('FU-4-MISUSE-07 — "convert the legacy system to event-driven" must route ARCHITECTURAL (architectural decision)', () => {
    // RED: "convert" + architectural migration target = judgment required.
    expect(classify('convert the legacy system to event-driven').route).toBe('ARCHITECTURAL');
  });

  // --- FU-5: /\bhow\s+(much|many)\s+(is|are)\b/i too loose —
  //     "how much is X worth" is valuation (UNKNOWN), "how many is too many X" is opinion (ARCHITECTURAL).
  //
  // PRINCIPLE: deterministic "how much/many is/are" requires a numeric or arithmetic
  // operand immediately following (e.g., "how much is 8 times 9"). Without a numeric
  // operand, these are valuation or opinion questions where "it depends" is legitimate.
  // UNKNOWN is correct for valuation questions (genuinely ambiguous without more context).

  it('FU-5-MISUSE-01 — "how much is the project worth" must route UNKNOWN (valuation question — genuinely ambiguous)', () => {
    // RED: currently matches /\bhow\s+(much|many)\s+(is|are)\b/i and routes MECHANICAL.
    // Project valuation depends on context, market, and stakeholder perspective.
    // UNKNOWN collapses to display_route: 'architectural' per PM AC Section 3.
    const result = classify('how much is the project worth');
    expect(result.route).toBe('UNKNOWN');
    expect(result.display_route).toBe('architectural');
  });

  it('FU-5-MISUSE-02 — "how many is too many microservices" must route ARCHITECTURAL (opinion question)', () => {
    // RED: "too many" is an opinion frame — reasonable engineers answer differently.
    // This is not a count request; it is a design philosophy question.
    expect(classify('how many is too many microservices').route).toBe('ARCHITECTURAL');
  });

  it('FU-5-MISUSE-03 — "how much is good test coverage" must route UNKNOWN (genuinely ambiguous — context-dependent)', () => {
    // RED: "good test coverage" depends on risk tolerance, team maturity, and project type.
    // No single correct threshold — genuinely ambiguous without more context.
    // D-005 instruction specifies UNKNOWN for this category.
    const result = classify('how much is good test coverage');
    expect(result.route).toBe('UNKNOWN');
    expect(result.display_route).toBe('architectural');
  });

  it('FU-5-MISUSE-04 — "how much is technical debt costing us" must route UNKNOWN (valuation/estimation judgment)', () => {
    // RED: phrasing variety — "technical debt cost" is an estimation question, not arithmetic.
    // Prevents blocklisting only "project worth" and "test coverage".
    const result = classify('how much is technical debt costing us');
    expect(result.route).toBe('UNKNOWN');
    expect(result.display_route).toBe('architectural');
  });

  it('FU-5-MISUSE-05 — "how many is enough for redundancy" must route ARCHITECTURAL (design tradeoff)', () => {
    // RED: phrasing variety — "enough for redundancy" is an architectural judgment.
    // "It depends on your SLA, cost tolerance, and failure domain" is a valid answer.
    expect(classify('how many is enough for redundancy').route).toBe('ARCHITECTURAL');
  });

  // ===========================================================================
  // BOUNDARY — edge cases that sit near the mechanical/non-mechanical border.
  // These confirm the tightened patterns hit the right lines.
  // ===========================================================================

  it('FU-BOUNDARY-01 — "add 5 and 3" stays MECHANICAL (two numeric operands with conjunction)', () => {
    // GREEN guard: "and 3" after the digit confirms the operand pattern — pure arithmetic.
    expect(classify('add 5 and 3').route).toBe('MECHANICAL');
  });

  it('FU-BOUNDARY-02 — "add 100 to 250" stays MECHANICAL (numeric operands on both sides of "to")', () => {
    // GREEN guard: "100 to 250" — both operands are digits, clearly arithmetic.
    expect(classify('add 100 to 250').route).toBe('MECHANICAL');
  });

  it('FU-BOUNDARY-03 — "sum these numbers" stays MECHANICAL (object is a numeric noun)', () => {
    // GREEN guard: "numbers" is a numeric noun — this is a compute request.
    expect(classify('sum these numbers').route).toBe('MECHANICAL');
  });

  it('FU-BOUNDARY-04 — "sum the values 4 8 15" stays MECHANICAL (explicit numeric values present)', () => {
    // GREEN guard: inline numeric values make this deterministic.
    expect(classify('sum the values 4 8 15').route).toBe('MECHANICAL');
  });

  it('FU-BOUNDARY-05 — "calculate the total" stays MECHANICAL (standard deterministic compute)', () => {
    // GREEN guard: "the total" is a numeric aggregate — single correct result.
    expect(classify('calculate the total').route).toBe('MECHANICAL');
  });

  it('FU-BOUNDARY-06 — "compute the sum" stays MECHANICAL (numeric aggregate noun)', () => {
    // GREEN guard: "sum" as noun is numeric — compute request with one correct result.
    expect(classify('compute the sum').route).toBe('MECHANICAL');
  });

  it('FU-BOUNDARY-07 — "convert 5km to miles" stays MECHANICAL (numeric operand + unit)', () => {
    // GREEN guard: digit + unit = deterministic unit conversion.
    expect(classify('convert 5km to miles').route).toBe('MECHANICAL');
  });

  it('FU-BOUNDARY-08 — "convert 100 fahrenheit to celsius" stays MECHANICAL (numeric + unit conversion)', () => {
    // GREEN guard: canonical unit conversion with digit — one correct result.
    expect(classify('convert 100 fahrenheit to celsius').route).toBe('MECHANICAL');
  });

  it('FU-BOUNDARY-09 — "how much is 8 times 9" stays MECHANICAL (arithmetic operands present)', () => {
    // GREEN guard: digit immediately follows "is" — structural signal of arithmetic.
    expect(classify('how much is 8 times 9').route).toBe('MECHANICAL');
  });

  it('FU-BOUNDARY-10 — "how many is 3 plus 4" stays MECHANICAL (arithmetic expression)', () => {
    // GREEN guard: digit immediately follows "is" — deterministic count arithmetic.
    expect(classify('how many is 3 plus 4').route).toBe('MECHANICAL');
  });

  it('FU-BOUNDARY-11 — "how many services should we run" routes ARCHITECTURAL (FU-6 formally resolved)', () => {
    // RESOLVED by FU-6 (D-005). Previously asserted MECHANICAL as "current behavior /
    // debatable." FU-6 formally resolves this as ARCHITECTURAL: "how many services should
    // we run" is a capacity/design question — "it depends on your SLA, cost, and redundancy
    // model" is a legitimate answer. The tightened run-pattern (FU-6) no longer fires on
    // judgment frames with "should we" preceding the verb; /\bshould\s+we\b/ in
    // ARCHITECTURAL_PATTERNS catches this correctly.
    // Updated by dev at gate 2 per CONFLICT NOTE in the FU-6 QA spec.
    expect(classify('how many services should we run').route).toBe('ARCHITECTURAL');
  });

  it('FU-BOUNDARY-12 — "add 2+2" stays MECHANICAL (inline arithmetic expression as operand)', () => {
    // GREEN guard: the operand itself is an arithmetic expression — unambiguously deterministic.
    expect(classify('add 2+2').route).toBe('MECHANICAL');
  });

  // ===========================================================================
  // GOLDEN — structural correctness of RouteDecision for tightened-pattern outputs.
  // ===========================================================================

  it('FU-GOLDEN-01 — UNKNOWN valuation result has correct RouteDecision shape (display_route is architectural)', () => {
    // PM AC Section 3 lock: UNKNOWN never surfaces as "unknown" to end users.
    const result = classify('how much is the project worth');
    expect(result.route).toBe('UNKNOWN');
    expect(result.display_route).toBe('architectural');
    expect(result.display_route).not.toBe('unknown');
    expect(result.raw_input).toBe('how much is the project worth');
  });

  it('FU-GOLDEN-02 — ARCHITECTURAL false-positive flip has correct RouteDecision shape', () => {
    const result = classify('convert the database schema');
    expect(result.route).toBe('ARCHITECTURAL');
    expect(result.display_route).toBe('architectural');
    expect(result.raw_input).toBe('convert the database schema');
  });

  it('FU-GOLDEN-03 — tightened compute true-positive retains matched_pattern field', () => {
    // After tightening, true MECHANICAL compute inputs must still report a matched_pattern.
    const result = classify('calculate the total');
    expect(result.route).toBe('MECHANICAL');
    expect(typeof result.matched_pattern).toBe('string');
    expect(result.matched_pattern!.length).toBeGreaterThan(0);
  });

  it('FU-GOLDEN-04 — classifier latency for tightening regressions < 100ms each', () => {
    const inputs = [
      'add 10 engineers to the team',
      'sum the quarterly results',
      'convert the database schema',
      'compute the optimal strategy',
      'how much is the project worth',
      'how many is too many microservices',
      'add 5 and 3',
      'sum these numbers',
      'convert 5km to miles',
      'how much is 8 times 9',
    ];
    for (const input of inputs) {
      const start = performance.now();
      const result = classify(input);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
      assertValidDecision(result);
    }
  });
});

// =============================================================================
// M2 Refinement — FU-7 noun-list gaps + greedy-edge cases
//
// PRINCIPLE (D-005): MECHANICAL = single deterministic operation with exactly one
// correct result. A numeric-aggregate noun that names a technical/statistical
// quantity with one correct answer is MECHANICAL (e.g., variance, throughput,
// latency, hash). A noun that requires judgment or "it depends" stays ARCHITECTURAL.
//
// FU-7 targets: the FU-4 noun allowlist is incomplete. Technical/statistical/
// performance quantities (variance, throughput, latency, count, standard deviation,
// hash, checksum, ratio, temperature) have exactly one correct result given
// concrete inputs — they are MECHANICAL by the principle, but currently the
// FU-4 lookahead doesn't find them and they fall through to the architectural
// extension (/\b(convert|calculate|compute)\s+(?:the|our|a|this)\b/i).
//
// Greedy-edge targets: two borderline inputs that the FU-2 architectural extension
// catches — "add 5 items to the cart" and "add 7 rows to the database" — are
// operational commands but lack a second numeric operand, so MECHANICAL correctly
// rejects them. ARCHITECTURAL is slightly aggressive but defensible.
//
// Order: MISUSE (judgment nouns that must STAY ARCHITECTURAL) → BOUNDARY (gap
// nouns currently RED, plus greedy-edge and digit-ordering probes) → GOLDEN
// (existing numeric-aggregate nouns that must stay MECHANICAL after any noun-list
// expansion).
//
// RED = currently wrong, must be fixed by dev.
// GREEN guard = already correct, must not regress.
//
// FU-7 nouns tested explicitly: variance, throughput, latency, count,
//   standard deviation, hash, checksum, ratio, temperature.
// FU-7 nouns INTENTIONALLY left as headroom for dev's category-widening:
//   entropy, frequency, duration, offset, bandwidth, p99, percentile.
//   Dev MUST NOT enumerate these nine test nouns blindly — the fix requires a
//   principled category generalisation (e.g., "technical/statistical numeric
//   quantity with exactly one correct result" as a comment + extended noun list
//   or a unit/suffix heuristic).
// =============================================================================

describe('Classifier M2 refinement — FU-7 noun gaps + greedy edges', () => {
  // ===========================================================================
  // MISUSE — judgment nouns that must STAY ARCHITECTURAL after any noun-list
  // widening. These are GREEN guards — they should pass before AND after dev's
  // fix. If any of these flip to MECHANICAL, the fix over-widened.
  // ===========================================================================

  it('FU7-MISUSE-01 — "calculate the best architecture" stays ARCHITECTURAL (judgment noun, not a numeric aggregate)', () => {
    // "best architecture" requires judgment — "it depends" is a legitimate answer.
    // This is a load-bearing guard from the prior FU-2..FU-5 cycle.
    expect(classify('calculate the best architecture').route).toBe('ARCHITECTURAL');
  });

  it('FU7-MISUSE-02 — "compute the optimal strategy" stays ARCHITECTURAL (already-passing FU-4 guard)', () => {
    // Re-asserting from FU-4 misuse block — re-stated here as an explicit guard
    // so dev widening of FU-7 nouns does not accidentally swallow "strategy".
    expect(classify('compute the optimal strategy').route).toBe('ARCHITECTURAL');
  });

  it('FU7-MISUSE-03 — "calculate the right approach" stays ARCHITECTURAL (judgment: "right" = it depends)', () => {
    // "Right approach" has no single correct answer — context and tradeoffs determine it.
    expect(classify('calculate the right approach').route).toBe('ARCHITECTURAL');
  });

  it('FU7-MISUSE-04 — "compute the ideal solution" stays ARCHITECTURAL (ideal = judgment-laden)', () => {
    // "Ideal" is an opinion qualifier — no single numeric result.
    // Phrasing variety beyond the three D-005 literal strings prevents blocklist workaround.
    expect(classify('compute the ideal solution').route).toBe('ARCHITECTURAL');
  });

  it('FU7-MISUSE-05 — "calculate the best approach for authentication" stays ARCHITECTURAL (design decision)', () => {
    // Additional guard: "best approach" + domain noun should never be MECHANICAL.
    expect(classify('calculate the best approach for authentication').route).toBe('ARCHITECTURAL');
  });

  // ===========================================================================
  // BOUNDARY — FU-7 gap-noun cases (RED) + greedy-edge probes + digit-ordering
  // confirmation. Gap-noun cases are RED against the current patterns.ts.
  // ===========================================================================

  // --- FU-7 gap nouns: technical/statistical quantities with one correct result ---
  // All of these route ARCHITECTURAL today because the noun is not in the FU-4 allowlist.
  // After dev's fix they must route MECHANICAL.

  it('FU7-BOUNDARY-01 — "calculate the variance" must route MECHANICAL (statistical quantity, one correct result) [RED]', () => {
    // PRINCIPLE: given a dataset, variance has exactly one correct value.
    // Currently routes ARCHITECTURAL — "variance" not in FU-4 noun list.
    expect(classify('calculate the variance').route).toBe('MECHANICAL');
  });

  it('FU7-BOUNDARY-02 — "calculate the throughput" must route MECHANICAL (performance metric, one correct value) [RED]', () => {
    // Throughput = operations/second — deterministic given the measurement inputs.
    // Currently routes ARCHITECTURAL — "throughput" not in FU-4 noun list.
    expect(classify('calculate the throughput').route).toBe('MECHANICAL');
  });

  it('FU7-BOUNDARY-03 — "calculate the latency" must route MECHANICAL (timing metric, one correct value) [RED]', () => {
    // Network/system latency is a measured numeric quantity — exactly one correct result.
    // Currently routes ARCHITECTURAL — "latency" not in FU-4 noun list.
    expect(classify('calculate the latency').route).toBe('MECHANICAL');
  });

  it('FU7-BOUNDARY-04 — "calculate the count" must route MECHANICAL (deterministic integer result) [RED]', () => {
    // Count of a set is deterministic — exactly one correct answer.
    // Currently routes ARCHITECTURAL — "count" not in FU-4 noun list.
    expect(classify('calculate the count').route).toBe('MECHANICAL');
  });

  it('FU7-BOUNDARY-05 — "calculate the standard deviation" must route MECHANICAL (statistical quantity, one correct result) [RED]', () => {
    // Standard deviation of a dataset has exactly one correct value.
    // "standard deviation" as a two-word phrase: lookahead must find "deviation" or the phrase.
    expect(classify('calculate the standard deviation').route).toBe('MECHANICAL');
  });

  it('FU7-BOUNDARY-06 — "compute the hash" must route MECHANICAL (cryptographic function, one correct output) [RED]', () => {
    // A hash of a given input is deterministic — exactly one correct result.
    // Currently routes ARCHITECTURAL — "hash" not in FU-4 noun list.
    expect(classify('compute the hash').route).toBe('MECHANICAL');
  });

  it('FU7-BOUNDARY-07 — "compute the checksum" must route MECHANICAL (error-detection value, deterministic) [RED]', () => {
    // Checksum is a deterministic numeric computation — one correct result.
    // Currently routes ARCHITECTURAL — "checksum" not in FU-4 noun list.
    expect(classify('compute the checksum').route).toBe('MECHANICAL');
  });

  it('FU7-BOUNDARY-08 — "compute the ratio" must route MECHANICAL (numeric proportion, one correct result) [RED]', () => {
    // A ratio of two quantities is deterministic — one correct value.
    // Currently routes ARCHITECTURAL — "ratio" not in FU-4 noun list.
    expect(classify('compute the ratio').route).toBe('MECHANICAL');
  });

  it('FU7-BOUNDARY-09 — "convert the temperature" must route MECHANICAL (unit conversion noun, one correct result) [RED]', () => {
    // Temperature is a unit-of-measure noun — converting a temperature value is deterministic.
    // Currently routes ARCHITECTURAL — "temperature" not in FU-4 noun list.
    // NOTE: without a numeric value ("convert 100F to C") this is the noun-only form;
    // the noun itself is sufficient signal per the FU-4 allowlist design.
    expect(classify('convert the temperature').route).toBe('MECHANICAL');
  });

  // --- Phrasing variety: technical nouns with "our/a/this" determiners ---
  // Verifies dev's fix generalises to all determiners in the FU-4 pattern, not just "the".

  it('FU7-BOUNDARY-10 — "compute our checksum" must route MECHANICAL (determiner variation) [RED]', () => {
    // Same determinism principle as FU7-BOUNDARY-07, but "our" determiner.
    expect(classify('compute our checksum').route).toBe('MECHANICAL');
  });

  it('FU7-BOUNDARY-11 — "calculate a variance" must route MECHANICAL (indefinite article variation) [RED]', () => {
    // Same determinism principle as FU7-BOUNDARY-01, but "a" determiner.
    expect(classify('calculate a variance').route).toBe('MECHANICAL');
  });

  // --- Greedy-edge cases: operational commands that lack a second numeric operand ---
  // These match the FU-2 ARCHITECTURAL extension (/\badd\s+\d+\s+\w.*?\s+(?:to|for|in)\s+(?:the|our|a|this)\b/i).
  // Routing them ARCHITECTURAL is the conservative/defensible call (no second numeric operand).
  // D-005 Concern A adjudication: "slightly aggressive but not wrong — neither has a single
  // deterministic result given the context-free input. Accepted."

  it('FU7-BOUNDARY-12 — "add 5 items to the cart" routes ARCHITECTURAL (no second numeric operand; operational noun) [GREEN]', () => {
    // "items" is an operational noun, not an arithmetic operand. MECHANICAL correctly rejects
    // (no "and N", "to N", or arithmetic operator after the digit). ARCHITECTURAL extension fires.
    // Conservative call: routing ARCHITECTURAL avoids false mechanical route for a DB write.
    // If this were UNKNOWN the user experience would be the same (display_route: architectural)
    // but ARCHITECTURAL is explicitly documented in D-005 Concern A adjudication.
    expect(classify('add 5 items to the cart').route).toBe('ARCHITECTURAL');
  });

  it('FU7-BOUNDARY-13 — "add 7 rows to the database" routes ARCHITECTURAL (no second numeric operand; data operation) [GREEN]', () => {
    // "rows" is a data noun, not an arithmetic operand. Same reasoning as FU7-BOUNDARY-12.
    // Mechanical pattern requires "and <N>", "to <N>", or operator after digit — absent here.
    expect(classify('add 7 rows to the database').route).toBe('ARCHITECTURAL');
  });

  // --- Digit-ordering probe: MECHANICAL-first holds when digit IS present ---
  // This proves the evaluate-MECHANICAL-first ordering works correctly even with
  // the architectural extension present for the same verb form.

  it('FU7-BOUNDARY-14 — "convert the 5 files" routes MECHANICAL (digit present → FU-4 lookahead fires before arch extension) [GREEN]', () => {
    // MECHANICAL FU-4 pattern: /^\s*(calculate|compute|convert)\b(?=.*(?:\d|...))/i
    // Lookahead finds the digit "5" → MECHANICAL fires first.
    // Architectural extension /\b(convert|calculate|compute)\s+(?:the|our|a|this)\b/i also matches
    // but is evaluated SECOND — MECHANICAL wins.
    // This confirms MECHANICAL-first ordering is preserved after FU-7 noun widening.
    expect(classify('convert the 5 files').route).toBe('MECHANICAL');
  });

  // --- True-positive guards near the greedy edge: arithmetic stays MECHANICAL ---
  // These confirm the tightened FU-2 pattern still routes arithmetic correctly
  // after dev's FU-7 work — no regression on the MECHANICAL side.

  it('FU7-BOUNDARY-15 — "add 5 and 3" stays MECHANICAL (two numeric operands — pure arithmetic) [GREEN guard]', () => {
    // Tightened FU-2 mechanical pattern: "and 3" is a second numeric operand.
    expect(classify('add 5 and 3').route).toBe('MECHANICAL');
  });

  it('FU7-BOUNDARY-16 — "add 100 to 250" stays MECHANICAL (digit after "to" — pure arithmetic) [GREEN guard]', () => {
    // Tightened FU-2 mechanical pattern: "to 250" — digit follows "to".
    expect(classify('add 100 to 250').route).toBe('MECHANICAL');
  });

  it('FU7-BOUNDARY-17 — "add 2+2" stays MECHANICAL (inline arithmetic expression) [GREEN guard]', () => {
    // Tightened FU-2 mechanical pattern: arithmetic operator + digit.
    expect(classify('add 2+2').route).toBe('MECHANICAL');
  });

  // ===========================================================================
  // GOLDEN — existing numeric-aggregate nouns that must stay MECHANICAL after
  // dev widens the FU-7 noun list. These are GREEN guards. If any flip to
  // ARCHITECTURAL after the fix, the widening broke the existing allowlist.
  // ===========================================================================

  it('FU7-GOLDEN-01 — "calculate the total" stays MECHANICAL (original FU-4 allowlist noun) [GREEN guard]', () => {
    expect(classify('calculate the total').route).toBe('MECHANICAL');
    expect(classify('calculate the total').display_route).toBe('mechanical');
  });

  it('FU7-GOLDEN-02 — "compute the sum" stays MECHANICAL (original FU-4 allowlist noun) [GREEN guard]', () => {
    expect(classify('compute the sum').route).toBe('MECHANICAL');
  });

  it('FU7-GOLDEN-03 — "calculate the average" stays MECHANICAL (original FU-4 allowlist noun) [GREEN guard]', () => {
    expect(classify('calculate the average').route).toBe('MECHANICAL');
  });

  it('FU7-GOLDEN-04 — "calculate the median" stays MECHANICAL (median IS in FU-4 allowlist — confirmed) [GREEN guard]', () => {
    // Explicitly confirming median is already in the list — tests the pre-existing coverage.
    expect(classify('calculate the median').route).toBe('MECHANICAL');
  });

  it('FU7-GOLDEN-05 — "calculate the mean" stays MECHANICAL (original FU-4 allowlist noun) [GREEN guard]', () => {
    expect(classify('calculate the mean').route).toBe('MECHANICAL');
  });

  it('FU7-GOLDEN-06 — "convert 5km to miles" stays MECHANICAL (digit present — digit branch of FU-4) [GREEN guard]', () => {
    // This passes via the digit branch of the FU-4 lookahead, not the noun branch.
    // Confirms digit branch is unaffected by noun-list widening.
    expect(classify('convert 5km to miles').route).toBe('MECHANICAL');
  });

  it('FU7-GOLDEN-07 — RouteDecision shape for FU-7 gap noun after fix (MECHANICAL with matched_pattern) [GREEN after fix]', () => {
    // After dev's fix: gap nouns must return a fully-formed MECHANICAL RouteDecision,
    // not just any truthy result. matched_pattern must be populated.
    // NOTE: this test is RED now (route is ARCHITECTURAL); it turns GREEN after the fix.
    const result = classify('calculate the variance');
    expect(result.route).toBe('MECHANICAL');
    expect(result.display_route).toBe('mechanical');
    expect(result.raw_input).toBe('calculate the variance');
    expect(typeof result.matched_pattern).toBe('string');
    expect(result.matched_pattern!.length).toBeGreaterThan(0);
  });

  it('FU7-GOLDEN-08 — classifier latency < 100ms for all FU-7 inputs', () => {
    const inputs = [
      'calculate the variance',
      'calculate the throughput',
      'calculate the latency',
      'calculate the count',
      'calculate the standard deviation',
      'compute the hash',
      'compute the checksum',
      'compute the ratio',
      'convert the temperature',
      'compute our checksum',
      'calculate a variance',
      'add 5 items to the cart',
      'add 7 rows to the database',
      'convert the 5 files',
      'calculate the best architecture',
      'compute the optimal strategy',
    ];
    for (const input of inputs) {
      const start = performance.now();
      const result = classify(input);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
      assertValidDecision(result);
    }
  });
});

// =============================================================================
// FU-6 — M1 seed pattern over-breadth
//
// PRINCIPLE (D-005): MECHANICAL = single deterministic operation with exactly
// one correct result. ARCHITECTURAL = requires judgment ("it depends" is
// legitimate). The two M1 seed patterns below are too greedy:
//
//   1. /\b(run|exec|execute)\b/i  — bare verb match fires on architectural
//      frames ("should we run our own infrastructure", "why run kubernetes")
//      where the correct answer depends on context, cost, and team preferences.
//
//   2. /\bwhat\s+is\s+the\s+(?!best\b)/i  — negative lookahead blocks "best"
//      but allows other judgment-laden phrasings after "what is the":
//      strategy, approach, recommended, ideal, right — none of which have a
//      single deterministic answer.
//
// RED (false positives, currently MECHANICAL — must flip to ARCHITECTURAL):
//   These tests will FAIL against the current patterns.ts. Dev must tighten
//   the two M1 seed patterns so these architectural framings no longer fire
//   MECHANICAL.
//
// GREEN guards (must STAY MECHANICAL after tightening):
//   Operational "run" targets (run the tests, execute the script, etc.) and
//   factual "what is the" lookups (version, status, file size) must remain
//   MECHANICAL. The fix must split at framing, not at word choice.
//
// CONFLICT NOTE for dev: FU-BOUNDARY-11 in the tightening suite currently
// asserts `how many services should we run` → MECHANICAL as the documented
// "current behavior." FU-6 formalises this as a defect. After the fix, dev
// must update FU-BOUNDARY-11 to assert ARCHITECTURAL (or UNKNOWN) consistent
// with the corrected behavior. Do not leave two contradicting assertions.
//
// Order: MISUSE (false-positives RED) → BOUNDARY (edge cases) → GOLDEN (green guards).
// =============================================================================

describe('Classifier FU-6 — M1 seed over-breadth', () => {
  // ===========================================================================
  // MISUSE — false positives that are RED now and MUST flip after the fix.
  // These inputs currently route MECHANICAL via one of the two M1 seed patterns.
  // The correct route is ARCHITECTURAL (judgment required, "it depends" is valid).
  // ===========================================================================

  // --- Defect 1: /\b(run|exec|execute)\b/i fires on architectural frames ---
  //
  // PRINCIPLE: "run" in these inputs is inside a design-philosophy or strategy
  // frame. The question is HOW MANY, WHETHER, or WHY — not WHICH COMMAND. A
  // correct answer depends on SLA, cost, team skill, and tradeoff preferences.
  // No single deterministic answer exists.

  it('FU6-D1-MISUSE-01 — "how many services should we run" must route ARCHITECTURAL (capacity/design decision) [RED]', () => {
    // "how many ... should we run" is a design-philosophy question: "it depends on
    // your SLA, cost, and redundancy model" is a legitimate answer.
    // Currently routes MECHANICAL via /\b(run|exec|execute)\b/i.
    // CONFLICT: FU-BOUNDARY-11 in the tightening suite asserts MECHANICAL (current behavior).
    // Dev must update FU-BOUNDARY-11 after fixing this pattern.
    expect(classify('how many services should we run').route).toBe('ARCHITECTURAL');
  });

  it('FU6-D1-MISUSE-02 — "should we run our own infrastructure" must route ARCHITECTURAL (infra strategy decision) [RED]', () => {
    // "should we run" is a vendor/build/buy decision — judgment required, no single correct answer.
    // Currently routes MECHANICAL (run-pattern fires before /\bshould\s+we\b/ in ARCHITECTURAL).
    expect(classify('should we run our own infrastructure').route).toBe('ARCHITECTURAL');
  });

  it('FU6-D1-MISUSE-03 — "why run kubernetes instead of ECS" must route ARCHITECTURAL (platform tradeoff question) [RED]', () => {
    // "why run X instead of Y" is a comparative tradeoff question — it depends on
    // team expertise, cost, portability requirements. No single correct answer.
    // "why run" does NOT match /\bwhy\s+(does|is|do|did|would)\b/i (run is not in that list),
    // so /\b(run|exec|execute)\b/i fires first → MECHANICAL today.
    expect(classify('why run kubernetes instead of ECS').route).toBe('ARCHITECTURAL');
  });

  it('FU6-D1-MISUSE-04 — "how should we run our deployments" must route ARCHITECTURAL (deployment strategy) [RED]', () => {
    // "how should we" is an architectural frame — /\bhow\s+should\s+(we|i|the)\b/i is
    // ARCHITECTURAL, but MECHANICAL evaluates first and /\brun\b/ fires.
    // Deployment approach (blue/green, canary, rolling) requires judgment.
    expect(classify('how should we run our deployments').route).toBe('ARCHITECTURAL');
  });

  it('FU6-D1-MISUSE-05 — "should we run a monolith or microservices" must route ARCHITECTURAL (architecture decision) [RED]', () => {
    // Classic architectural tradeoff: "it depends on team size, coupling, scalability needs."
    // Currently routes MECHANICAL via /\brun\b/ before /\bshould\s+we\b/ is evaluated.
    expect(classify('should we run a monolith or microservices').route).toBe('ARCHITECTURAL');
  });

  it('FU6-D1-MISUSE-06 — "is it worth running our own database" routes UNKNOWN today (gerund; run pattern does not fire) [COVERAGE GAP]', () => {
    // NOTE: "running" (gerund) does NOT match /\b(run|exec|execute)\b/i — word boundary
    // after "run" fails inside "running". This input is therefore NOT a D1 false positive.
    // It falls through to UNKNOWN (no pattern fires). UNKNOWN display_route is "architectural"
    // per PM AC Section 3, so the user sees the same UI as ARCHITECTURAL.
    // This is a separate coverage gap (ARCHITECTURAL patterns don't cover "is it worth X-ing"):
    // fix scope is outside FU-6. Asserting actual behavior so dev is not misled.
    const result = classify('is it worth running our own database');
    expect(result.route).toBe('UNKNOWN');
    expect(result.display_route).toBe('architectural');
  });

  it('FU6-D1-MISUSE-07 — "should we run containers or VMs" must route ARCHITECTURAL (infrastructure tradeoff) [RED]', () => {
    // Containers vs VMs is a platform-selection decision — isolation, overhead, tooling all vary.
    // Phrasing variety to prevent a blocklist fix on specific strings.
    expect(classify('should we run containers or VMs').route).toBe('ARCHITECTURAL');
  });

  // --- FU-8 regression fix: instruction-form "how to/do/can run X" must route MECHANICAL ---
  //
  // The FU-6 lookbehind window included "how" and blocked instruction forms ("how to run
  // the tests", "how do I run the tests") — they incorrectly routed UNKNOWN. These are
  // procedural requests for the mechanical action, not judgment frames.
  // FU-8 replaces the lookbehind with a positive sentence-start / instruction-form anchor.
  //
  // Asserted RED before fix, GREEN after.

  it('FU6-FU8-01 — "how to run the tests" routes MECHANICAL (instruction form, not judgment) [FU-8 fix]', () => {
    // "how to run X" is a request for the procedure — deterministic, one correct action.
    // Was incorrectly routed UNKNOWN by the FU-6 lookbehind (regression).
    expect(classify('how to run the tests').route).toBe('MECHANICAL');
  });

  it('FU6-FU8-02 — "how do I run the tests" routes MECHANICAL (instruction form) [FU-8 fix]', () => {
    // Same principle: "how do I run X" asks for the mechanical procedure.
    expect(classify('how do I run the tests').route).toBe('MECHANICAL');
  });

  it('FU6-FU8-03 — "how exactly do I run the tests" routes MECHANICAL (adverb between how and do) [FU-8 fix]', () => {
    // Phrasing variety with an adverb modifier — still an instruction form.
    expect(classify('how exactly do I run the tests').route).toBe('MECHANICAL');
  });

  it('FU6-FU8-04 — "explain why then run npm test" routes MECHANICAL (chained command) [FU-8 fix]', () => {
    // "then run X" is a chained command clause — the run is the execution target.
    expect(classify('explain why then run npm test').route).toBe('MECHANICAL');
  });

  it('FU6-FU8-05 — "how should we run our deployments" stays ARCHITECTURAL after FU-8 fix [FU-8 guard]', () => {
    // "how should we run" is a judgment frame — NOT caught by the new instruction-form
    // anchor. Must remain ARCHITECTURAL. Phrasing variety from the D1-MISUSE block.
    expect(classify('how should we run our deployments').route).toBe('ARCHITECTURAL');
  });

  it('FU6-FU8-06 — "how should we even consider letting the team run the migration" stays ARCHITECTURAL [FU-8 guard]', () => {
    // Long lead-in judgment frame. SE confirmed this was leaking to MECHANICAL under
    // the lookbehind. The new pattern correctly does not fire on "how should we" forms.
    expect(classify('how should we even consider letting the team run the migration').route).toBe('ARCHITECTURAL');
  });

  // --- Defect 2: /\bwhat\s+is\s+the\s+(?!best\b)/i fires on judgment phrasings ---
  //
  // PRINCIPLE: "what is the X" is ARCHITECTURAL when X names a strategy, approach,
  // recommendation, or design choice — because "it depends" is a legitimate answer.
  // The negative lookahead only excludes "best"; every other judgment word slips through.

  it('FU6-D2-MISUSE-01 — "what is the deployment strategy" must route ARCHITECTURAL (strategy = judgment) [RED]', () => {
    // "deployment strategy" depends on team, environment, and SLA — blue/green, rolling,
    // canary are all legitimate answers. No single correct result.
    // Currently routes MECHANICAL via /\bwhat\s+is\s+the\s+(?!best\b)/i.
    expect(classify('what is the deployment strategy').route).toBe('ARCHITECTURAL');
  });

  it('FU6-D2-MISUSE-02 — "what is the exchange rate strategy" must route ARCHITECTURAL (strategy = judgment) [RED]', () => {
    // Exchange rate handling (at-request, cached, hedged) requires business judgment.
    // "strategy" after "what is the" signals a design choice, not a lookup.
    expect(classify('what is the exchange rate strategy').route).toBe('ARCHITECTURAL');
  });

  it('FU6-D2-MISUSE-03 — "what is the right approach for caching" must route ARCHITECTURAL ("right approach" = judgment) [RED]', () => {
    // "right approach" has no single answer — write-through, write-back, TTL choices
    // depend on consistency/latency tradeoffs.
    expect(classify('what is the right approach for caching').route).toBe('ARCHITECTURAL');
  });

  it('FU6-D2-MISUSE-04 — "what is the recommended pattern" must route ARCHITECTURAL ("recommended" = opinion/judgment) [RED]', () => {
    // "recommended" is a judgment qualifier — recommendations depend on context.
    // Phrasing variety: "recommended" is not "best" but is equally judgment-laden.
    expect(classify('what is the recommended pattern').route).toBe('ARCHITECTURAL');
  });

  it('FU6-D2-MISUSE-05 — "what is the ideal architecture" must route ARCHITECTURAL ("ideal" = judgment) [RED]', () => {
    // "ideal architecture" has no single correct answer — it depends on scale, team, domain.
    // MECHANICAL evaluates first; the ARCHITECTURAL /\b(design|architect)\b/i would catch
    // "architecture" but never fires because MECHANICAL wins today.
    expect(classify('what is the ideal architecture').route).toBe('ARCHITECTURAL');
  });

  it('FU6-D2-MISUSE-06 — "what is the correct approach to database design" must route ARCHITECTURAL (design judgment) [RED]', () => {
    // "correct approach" is equivalent to "right approach" — still judgment-dependent.
    // Phrasing variety to prevent blocklisting only the listed D-005 strings.
    expect(classify('what is the correct approach to database design').route).toBe('ARCHITECTURAL');
  });

  it('FU6-D2-MISUSE-07 — "what is the best practice for error handling" stays ARCHITECTURAL (negative lookahead guard) [GREEN]', () => {
    // "best practice" — "best" IS in the negative lookahead so this already works.
    // Included as a boundary guard confirming the existing lookahead still fires.
    expect(classify('what is the best practice for error handling').route).toBe('ARCHITECTURAL');
  });

  it('FU6-D2-MISUSE-08 — "what is the scalability approach" must route ARCHITECTURAL (approach = judgment) [RED]', () => {
    // "approach" after "what is the" names a design choice. Phrasing variety.
    expect(classify('what is the scalability approach').route).toBe('ARCHITECTURAL');
  });

  // ===========================================================================
  // BOUNDARY — inputs that sit near the mechanical/architectural split.
  // Some confirm the tightened pattern STILL fires for true operational inputs.
  // Others probe the exact edge between framing that is MECHANICAL vs ARCHITECTURAL.
  // ===========================================================================

  it('FU6-BOUNDARY-01 — "run the tests" stays MECHANICAL (explicit execution target, no judgment) [GREEN]', () => {
    // "run the tests" has exactly one correct interpretation: execute the test suite.
    // This is the canonical MECHANICAL case for the run pattern. Must not regress.
    expect(classify('run the tests').route).toBe('MECHANICAL');
  });

  it('FU6-BOUNDARY-02 — "run the build" stays MECHANICAL (explicit build-step execution) [GREEN]', () => {
    // "run the build" = "execute the build pipeline." Deterministic operational command.
    expect(classify('run the build').route).toBe('MECHANICAL');
  });

  it('FU6-BOUNDARY-03 — "run npm install" stays MECHANICAL (specific command with named tool) [GREEN]', () => {
    // Named tool + command = specific execution target. No judgment involved.
    expect(classify('run npm install').route).toBe('MECHANICAL');
  });

  it('FU6-BOUNDARY-04 — "execute the script" stays MECHANICAL (explicit execution target) [GREEN]', () => {
    // "execute the script" names a target object — deterministic operational command.
    expect(classify('execute the script').route).toBe('MECHANICAL');
  });

  it('FU6-BOUNDARY-05 — "run the migration" stays MECHANICAL (explicit step execution) [GREEN]', () => {
    // "run the migration" = execute a specific migration step. One correct result.
    // Distinct from "should we run migrations" or "how should we run migrations"
    // which would be judgment questions.
    expect(classify('run the migration').route).toBe('MECHANICAL');
  });

  it('FU6-BOUNDARY-06 — "restart the server" stays MECHANICAL (explicit operational command) [GREEN]', () => {
    // "restart the server" is covered by /\b(start|stop|restart)\s+\w/i, not the run pattern.
    // Included here as a boundary guard confirming no regression on related M1 patterns.
    expect(classify('restart the server').route).toBe('MECHANICAL');
  });

  it('FU6-BOUNDARY-07 — "run the linter" stays MECHANICAL (specific tool execution) [GREEN]', () => {
    // Phrasing variety for golden "run" cases: linter is a named tool, deterministic.
    expect(classify('run the linter').route).toBe('MECHANICAL');
  });

  it('FU6-BOUNDARY-08 — "what is the current directory" stays MECHANICAL (factual lookup, one answer) [GREEN]', () => {
    // "current directory" is a deterministic lookup — also covered by /\bcurrent\s+directory\b/i.
    // Guards the "what is the" MECHANICAL path specifically.
    expect(classify('what is the current directory').route).toBe('MECHANICAL');
  });

  it('FU6-BOUNDARY-09 — "what is the version" stays MECHANICAL (factual lookup, one answer) [GREEN]', () => {
    // "version" is a deterministic property — exactly one correct answer.
    // This is the core green guard for the "what is the" pattern after tightening.
    expect(classify('what is the version').route).toBe('MECHANICAL');
  });

  it('FU6-BOUNDARY-10 — "what is the status" stays MECHANICAL (factual state lookup) [GREEN]', () => {
    // Status is a deterministic observable fact at a point in time — one correct answer.
    expect(classify('what is the status').route).toBe('MECHANICAL');
  });

  it('FU6-BOUNDARY-11 — "what is the file size" stays MECHANICAL (factual filesystem property) [GREEN]', () => {
    // File size is a deterministic property — exactly one correct numeric answer.
    expect(classify('what is the file size').route).toBe('MECHANICAL');
  });

  it('FU6-BOUNDARY-12 — "what is the error message" stays MECHANICAL (factual lookup of string value) [GREEN]', () => {
    // The error message is a specific string property — one correct answer.
    // Phrasing variety beyond T-19 to prevent narrow fix that only passes listed strings.
    expect(classify('what is the error message').route).toBe('MECHANICAL');
  });

  it('FU6-BOUNDARY-13 — "what is the output" stays MECHANICAL (deterministic result lookup) [GREEN]', () => {
    // "what is the output" of a command or function = one correct answer.
    expect(classify('what is the output').route).toBe('MECHANICAL');
  });

  // --- Genuinely debatable inputs — documented as comments, not asserted ---
  //
  // These inputs cannot be cleanly resolved as MECHANICAL or ARCHITECTURAL without
  // additional context. They are documented here for Sage/staff-engineer review.
  // Do NOT add assertions for these until a staff position is issued.
  //
  //   "run kubernetes" — bare object with no frame. Could be "run the kubernetes
  //   command" (MECHANICAL) or part of "should we run kubernetes" (ARCHITECTURAL).
  //   Without framing, defaults to MECHANICAL via current pattern. Unclear whether
  //   a tightened pattern should force UNKNOWN or leave MECHANICAL here.
  //
  //   "what is the approach" — "approach" alone (without "for" or "to") is a
  //   gray-area noun. "/\b(strategy|approach|pattern)\s+for\b/i" requires "for",
  //   so "what is the approach" today routes MECHANICAL. After tightening, if dev
  //   excludes "approach" from allowed nouns, it would flip to UNKNOWN or ARCHITECTURAL.
  //   Both are defensible. Flag before asserting a direction.
  //
  //   "what is the architecture" — RESOLVED by C3 (gate-3 staff-engineer ruling).
  //   "architecture" is the canonical judgment noun per D-005. See FU6-C3-01/02 below.

  // --- C3 fix assertions — architecture is a judgment noun, must route ARCHITECTURAL ---
  //
  // Staff-engineer gate-3 ruling: "architecture" must never route MECHANICAL.
  // C3 adds architecture to both the leading-noun and tail-noun exclusions in the
  // two tightened "what is the" MECHANICAL patterns, and to the ARCHITECTURAL
  // tail-noun alternation so these inputs affirmatively land ARCHITECTURAL (not UNKNOWN).

  it('FU6-C3-01 — "what is the architecture" routes ARCHITECTURAL (canonical judgment noun) [C3 fix]', () => {
    // "architecture" has no single correct answer — it depends on scale, team, and domain.
    // C3 adds it to both the MECHANICAL exclusions and the ARCHITECTURAL tail-noun list.
    expect(classify('what is the architecture').route).toBe('ARCHITECTURAL');
  });

  it('FU6-C3-02 — "what is the current architecture" routes ARCHITECTURAL (judgment noun in tail) [C3 fix]', () => {
    // "current" is a modifier, not a factual property — the tail noun is still "architecture"
    // which is a design choice noun, not a deterministic system property.
    expect(classify('what is the current architecture').route).toBe('ARCHITECTURAL');
  });

  it('FU6-C3-03 — "what is the current directory" stays MECHANICAL (factual property, not architecture) [C3 guard]', () => {
    // Guard: "current directory" must not be caught by the architecture exclusion.
    expect(classify('what is the current directory').route).toBe('MECHANICAL');
  });

  it('FU6-C3-04 — "what is the version" stays MECHANICAL after C3 [C3 guard]', () => {
    expect(classify('what is the version').route).toBe('MECHANICAL');
  });

  it('FU6-C3-05 — "what is the status" stays MECHANICAL after C3 [C3 guard]', () => {
    expect(classify('what is the status').route).toBe('MECHANICAL');
  });

  // ===========================================================================
  // GOLDEN — RouteDecision shape and latency for FU-6 inputs.
  // These confirm correct RouteDecision structure after the fix, not just route.
  // ===========================================================================

  it('FU6-GOLDEN-01 — MECHANICAL "run" operational result has correct RouteDecision shape [GREEN guard]', () => {
    // After tightening, true-positive MECHANICAL run inputs must still return a
    // fully-formed RouteDecision with a populated matched_pattern.
    const result = classify('run the tests');
    expect(result.route).toBe('MECHANICAL');
    expect(result.display_route).toBe('mechanical');
    expect(result.raw_input).toBe('run the tests');
    expect(typeof result.matched_pattern).toBe('string');
    expect(result.matched_pattern!.length).toBeGreaterThan(0);
  });

  it('FU6-GOLDEN-02 — MECHANICAL "what is the" factual result has correct RouteDecision shape [GREEN guard]', () => {
    const result = classify('what is the version');
    expect(result.route).toBe('MECHANICAL');
    expect(result.display_route).toBe('mechanical');
    expect(result.raw_input).toBe('what is the version');
    expect(typeof result.matched_pattern).toBe('string');
    expect(result.matched_pattern!.length).toBeGreaterThan(0);
  });

  it('FU6-GOLDEN-03 — ARCHITECTURAL false-positive flip has correct RouteDecision shape [RED→GREEN after fix]', () => {
    // After the fix: FU-6 false positives must return a fully-formed ARCHITECTURAL
    // RouteDecision, not just any truthy result.
    const result = classify('should we run our own infrastructure');
    expect(result.route).toBe('ARCHITECTURAL');
    expect(result.display_route).toBe('architectural');
    expect(result.raw_input).toBe('should we run our own infrastructure');
  });

  it('FU6-GOLDEN-04 — ARCHITECTURAL "what is the strategy" flip has correct RouteDecision shape [RED→GREEN after fix]', () => {
    const result = classify('what is the deployment strategy');
    expect(result.route).toBe('ARCHITECTURAL');
    expect(result.display_route).toBe('architectural');
    expect(result.raw_input).toBe('what is the deployment strategy');
  });

  it('FU6-GOLDEN-05 — classifier latency < 100ms for all FU-6 inputs', () => {
    const inputs = [
      // RED (false positives — will route architectural after fix)
      'how many services should we run',
      'should we run our own infrastructure',
      'why run kubernetes instead of ECS',
      'how should we run our deployments',
      'should we run a monolith or microservices',
      // NOTE: 'is it worth running our own database' routes UNKNOWN (gerund, not D1 false positive)
      'what is the deployment strategy',
      'what is the exchange rate strategy',
      'what is the right approach for caching',
      'what is the recommended pattern',
      'what is the ideal architecture',
      // GREEN guards (must stay mechanical)
      'run the tests',
      'run the build',
      'run npm install',
      'execute the script',
      'run the migration',
      'what is the current directory',
      'what is the version',
      'what is the status',
      'what is the file size',
    ];
    for (const input of inputs) {
      const start = performance.now();
      const result = classify(input);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
      assertValidDecision(result);
    }
  });
});
