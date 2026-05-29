// src/classifier/patterns.ts
//
// Heuristic seed patterns per M1-implementation-spec.md Section 4.1.
// Verbatim copy — 18 MECHANICAL + 18 ARCHITECTURAL, case-insensitive, unanchored.
// Evaluation order: MECHANICAL first, ARCHITECTURAL second (first match wins).
// "build a design" routes MECHANICAL on `build` before ARCHITECTURAL sees `design`.

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
