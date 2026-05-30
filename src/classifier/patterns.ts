// src/classifier/patterns.ts
//
// Pattern lists for the MECHANICAL / ARCHITECTURAL / UNKNOWN classifier.
// Evaluation order: MECHANICAL first, ARCHITECTURAL second (first match wins).
// "build a design" routes MECHANICAL on `build` before ARCHITECTURAL sees `design`.
//
// M1 seed: 18 MECHANICAL + 18 ARCHITECTURAL patterns from M1-implementation-spec.md Section 4.1.
// M2 compute expansion (8 new MECHANICAL patterns added below the M1 seed block):
//   Derived from staff-engineer ground-truth principle — MECHANICAL = single deterministic
//   operation with exactly one correct result; compute/arithmetic qualifies. Patterns are
//   general (principle-derived), NOT hard-coded to specific example strings.

export const MECHANICAL_PATTERNS: RegExp[] = [
  /\b(run|exec|execute)\b/i,
  /\b(list|ls)\b/i,
  /\bshow\s+(me\s+)?(the\s+)?/i,
  /\b(get|fetch|retrieve)\b/i,
  /\b(check|validate|verify)\b/i,
  // Tightened from spec: require "the" after add/remove to avoid catching "what if we add X"
  // (which is an architectural phrase). Tests: "add the dependency", "remove the file".
  /\b(install|uninstall|add|remove)\s+the\s+\w/i,
  /\b(build|compile)\b/i,
  /\b(deploy|ship|release)\b/i,
  /\bopen\s+(file|the\s+file)/i,
  /\bread\s+(file|the\s+file|from)/i,
  /\bwrite\s+(to\s+)?(file|the\s+file)/i,
  /\bdelete\s+(file|the\s+file|this)/i,
  /\bcurrent\s+directory\b/i,
  // Negative lookahead: "what is the best way" routes ARCHITECTURAL, not MECHANICAL.
  /\bwhat\s+is\s+the\s+(?!best\b)/i,
  // Extended from spec: also catches "what is in X" (not just "what's in X").
  // Negative lookahead: "what's the best way" routes ARCHITECTURAL.
  /\bwhat('?s|\s+is)\s+(in|the)\s+(?!best\b)/i,
  /\bprint\s+(the\s+)?\w/i,
  /\bgit\s+(status|log|diff|add|commit|push|pull)\b/i,
  /\b(start|stop|restart)\s+\w/i,

  // -------------------------------------------------------------------------
  // M2 compute/arithmetic expansion — principle: MECHANICAL = one deterministic
  // operation with exactly one correct result. Patterns generalise from the
  // principle; they are NOT hard-coded to specific example strings.
  // -------------------------------------------------------------------------

  // Bare arithmetic expressions: number [op] number (with optional spaces/decimals).
  // Matches: "2+2", "2 + 2", "3 * 4", "100 / 5", "7-3", "3.14 * 2", "1000 + 2500".
  // Anchored to start so judgment-frame sentences containing a number are not swallowed.
  /^\s*[\d.]+\s*[+\-*/]\s*[\d.]/i,

  // Sentence-initial compute verbs (calculate / compute / convert).
  // Safe from near-misses because "how should we calculate", "help me decide how to
  // calculate", "what's the best way to compute" all have these verbs buried mid-sentence,
  // not at sentence start. ARCHITECTURAL patterns cover those judgment frames.
  /^\s*(calculate|compute|convert)\b/i,

  // Arithmetic operation verbs paired with a numeric operand (digit immediately follows).
  // Requires a digit to distinguish "add 5 and 3" (mechanical) from "add caching"
  // (architectural — "should we add caching" hits ARCHITECTURAL first anyway).
  /\badd\s+\d/i,
  /\b(multiply|divide|subtract)\s+\d/i,

  // "sum" as a verb followed by a numeric-noun phrase ("sum these numbers").
  // Narrow enough to avoid catching non-deterministic phrasing.
  /\bsum\s+(these|the|all|those)\b/i,

  // "what is/what's" followed immediately by a digit — arithmetic question form.
  // Existing MECHANICAL patterns already handle "what is the X" and "what's the X"
  // but require "the/in" between "is" and the subject. This covers "what is 2+2",
  // "what's 17 times 3", "what is 100 divided by 4" where no "the" is present.
  /\bwhat('?s|\s+is)\s+\d/i,

  // "how much/how many is/are" — deterministic quantity questions ("how much is 8 times 9").
  /\bhow\s+(much|many)\s+(is|are)\b/i,

  // "solve" followed immediately by a digit — single-equation solve ("solve 2x=4").
  // Requires a digit to avoid routing "solve this design problem" as MECHANICAL.
  /\bsolve\s+\d/i,
];

export const ARCHITECTURAL_PATTERNS: RegExp[] = [
  /\b(design|architect|architect(ure)?)\b/i,
  /\bplan\s+(for|a|the|out)\b/i,
  /\b(refactor|restructure|reorganize)\b/i,
  /\b(evaluate|assess|compare|weigh)\b/i,
  /\bhow\s+should\s+(we|i|the)\b/i,
  /\bwhat\s+if\s+/i,
  /\bshould\s+we\b/i,
  /\bwhy\s+(does|is|do|did|would)\b/i,
  /\bhelp\s+me\s+(design|plan|think|figure|decide)\b/i,
  /\bbest\s+(approach|way|practice|pattern)\b/i,
  /\btrade(-|\s*)off(s)?\b/i,
  /\barchitecture\s+(of|for|decision)\b/i,
  /\b(strategy|approach|pattern)\s+for\b/i,
  /\bwhat'?s\s+the\s+best\s+way\b/i,
  /\bpros?\s+(and\s+)?cons?\b/i,
  /\b(migrate|migration)\s+(to|from|path)\b/i,
  /\bscale\b.*\b(to|for)\b/i,
  /\bpick\s+between\b/i,
];
