import { describe, it, expect } from 'vitest';
import { MECHANICAL_PATTERNS, ARCHITECTURAL_PATTERNS } from '../../src/classifier/patterns.js';

// T-19 and T-20 seed pattern boundary tests live in classifier.test.ts.
// Shape tests here verify the arrays themselves are well-formed so classifier.test.ts
// can rely on them safely.

describe('Patterns (Pass 2)', () => {
  // --- MISUSE ---

  it('MECHANICAL_PATTERNS is not empty', () => {
    // An empty pattern array would silently make every input UNKNOWN — misuse guard.
    expect(MECHANICAL_PATTERNS.length).toBeGreaterThan(0);
  });

  it('ARCHITECTURAL_PATTERNS is not empty', () => {
    expect(ARCHITECTURAL_PATTERNS.length).toBeGreaterThan(0);
  });

  // --- BOUNDARY ---

  it('MECHANICAL_PATTERNS has exactly 18 entries per spec Section 4.1', () => {
    expect(MECHANICAL_PATTERNS).toHaveLength(18);
  });

  it('ARCHITECTURAL_PATTERNS has exactly 18 entries per spec Section 4.1', () => {
    expect(ARCHITECTURAL_PATTERNS).toHaveLength(18);
  });

  it('every MECHANICAL pattern is a RegExp instance', () => {
    for (const p of MECHANICAL_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });

  it('every ARCHITECTURAL pattern is a RegExp instance', () => {
    for (const p of ARCHITECTURAL_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });

  // --- GOLDEN ---

  it('all MECHANICAL patterns have the case-insensitive (i) flag', () => {
    for (const p of MECHANICAL_PATTERNS) {
      expect(p.flags).toContain('i');
    }
  });

  it('all ARCHITECTURAL patterns have the case-insensitive (i) flag', () => {
    for (const p of ARCHITECTURAL_PATTERNS) {
      expect(p.flags).toContain('i');
    }
  });
});
