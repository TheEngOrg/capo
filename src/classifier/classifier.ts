// src/classifier/classifier.ts
//
// Pass 1: classify() is a stub — returns UNKNOWN for all inputs.
// Pass 2: Wire MECHANICAL_PATTERNS and ARCHITECTURAL_PATTERNS per staff-eng spec Section 4.1.

import { MECHANICAL_PATTERNS, ARCHITECTURAL_PATTERNS } from './patterns.js';
import type { RouteDecision } from './types.js';

export function classify(input: string): RouteDecision {
  // Pass 2: implement pattern matching. Stub returns UNKNOWN for everything.
  // Evaluate order: MECHANICAL first, ARCHITECTURAL second, UNKNOWN fallback.
  for (const pattern of MECHANICAL_PATTERNS) {
    if (pattern.test(input)) {
      return {
        route: 'MECHANICAL',
        display_route: 'mechanical',
        raw_input: input,
        matched_pattern: pattern.source,
      };
    }
  }

  for (const pattern of ARCHITECTURAL_PATTERNS) {
    if (pattern.test(input)) {
      return {
        route: 'ARCHITECTURAL',
        display_route: 'architectural',
        raw_input: input,
        matched_pattern: pattern.source,
      };
    }
  }

  // UNKNOWN collapses to 'architectural' at classification time per PM AC Section 3.
  return {
    route: 'UNKNOWN',
    display_route: 'architectural',
    raw_input: input,
  };
}
