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
// M2 tightening (D-005 FU-2..FU-5): 4 over-broad M2 patterns tightened in-place.
//   Each tightened pattern now requires an additional STRUCTURAL SIGNAL of determinism
//   (second numeric operand, numeric-aggregate noun, inline digit) derived from the
//   D-005 principle. Pattern count is unchanged at 26. See D-005 for the FU table.
//
// M2 refinement (D-005 FU-7): FU-4 noun allowlist widened with a principled second tier.
//   CATEGORY RULE: a noun qualifies if and only if it names a TECHNICAL/STATISTICAL
//   NUMERIC QUANTITY that has exactly one correct computed result given concrete inputs —
//   i.e., the noun is a measure, aggregate, or transformation output, not a judgment term.
//   Sub-categories and their qualifying property:
//     Statistical aggregates  — value is uniquely determined by a dataset
//       (total, sum, average, mean, median, variance, deviation, percentile, ratio,
//        percent/percentage, difference, product, quotient, remainder)
//     Performance/systems     — value is a measured or derived scalar
//       (throughput, latency, rate, count, frequency, duration, offset, bandwidth, speed)
//     Crypto/data integrity   — output is a deterministic function of input bytes
//       (hash, checksum, entropy)
//     Physical/unit measures  — value is a dimensioned scalar with a single conversion
//       (area, volume, distance, temperature)
//   Terms that do NOT qualify: judgment words (best, optimal, ideal, right, strategy,
//   approach, architecture) — these require "it depends" reasoning, not computation.
//   Future additions: add to one of the four sub-categories above and verify no
//   judgment-frame near-miss passes the pattern (test adversarially per D-005 Step 3).

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

  // Sentence-initial compute verbs (calculate / compute / convert) — tightened from M2.
  // FU-4 fix: "convert the database schema" and "compute the optimal strategy" mis-routed
  // as MECHANICAL; the sentence-start anchor alone is insufficient when the object is an
  // architectural/judgment noun. Structural signal required: the sentence must also contain
  // a digit OR have a recognised numeric-aggregate noun as the direct object.
  //
  // FU-7 widening: noun list extended from original consumer-math nouns to include
  // technical/statistical/performance/crypto categories. CATEGORY RULE: noun qualifies
  // iff it names a numeric quantity with exactly one correct computed result (see file
  // header for the full sub-category breakdown and the rule for future additions).
  //
  // Noun list by sub-category:
  //   Statistical aggregates : total|sum|average|mean|median|variance|deviation|percentile|
  //                            ratio|percent(?:age)?|difference|product|quotient|remainder
  //   Performance/systems    : throughput|latency|rate|count|frequency|duration|offset|bandwidth|speed
  //   Crypto/data integrity  : hash|checksum|entropy
  //   Physical/unit measures : area|volume|distance|temperature
  //   Financial (consumer)   : cost|tip|tax|discount|interest|balance
  //
  // Judgment terms that must NOT be in this list (verified adversarially):
  //   strategy, approach, architecture, schema, solution, design, best, optimal, ideal, right
  /^\s*(calculate|compute|convert)\b(?=.*(?:\d|\b(?:total|sum|average|mean|median|variance|deviation|percentile|ratio|percent(?:age)?|difference|product|quotient|remainder|throughput|latency|rate|count|frequency|duration|offset|bandwidth|speed|hash|checksum|entropy|area|volume|distance|temperature|cost|tip|tax|discount|interest|balance)\b))/i,

  // Arithmetic operation verbs paired with TWO numeric operands — tightened from M2.
  // FU-2 fix: digit gate alone is insufficient; "add 10 engineers" is a capacity/org decision.
  // Structural signal required: a second numeric operand connected by "and", "to", or an
  // arithmetic operator. Pattern: add <N> (and|to) <N>  OR  add <N><op><N>.
  // "add 5 and 3" ✓  "add 100 to 250" ✓  "add 10 engineers to the team" ✗ (no digit after "to").
  /\badd\s+[\d.]+\s*(and\s+\d|[+\-*\/]\s*\d|\bto\s+\d)/i,
  /\b(multiply|divide|subtract)\s+\d/i,

  // "sum" as a verb followed by a determiner + recognised NUMERIC noun — tightened from M2.
  // FU-3 fix: "sum the quarterly results" is reporting/interpretation, not compute.
  // Structural signal required: noun following the determiner must be a numeric noun
  // ("numbers", "values", "figures", "totals"). Without numeric operands present in the
  // phrase, "sum the X" is a qualitative evaluation, not a deterministic compute request.
  /\bsum\s+(?:these|the|all|those)(?:\s+the)?\s+(?:numbers?|values?|figures?|totals?)/i,

  // "what is/what's" followed immediately by a digit — arithmetic question form.
  // Existing MECHANICAL patterns already handle "what is the X" and "what's the X"
  // but require "the/in" between "is" and the subject. This covers "what is 2+2",
  // "what's 17 times 3", "what is 100 divided by 4" where no "the" is present.
  /\bwhat('?s|\s+is)\s+\d/i,

  // "how much/how many is/are" — deterministic ONLY when a digit immediately follows.
  // FU-5 fix: "how much is the project worth" is valuation (UNKNOWN); "how many is too many"
  // is opinion (ARCHITECTURAL). Structural signal: digit right after "is/are" confirms
  // arithmetic ("how much is 8 times 9", "how many is 3 plus 4").
  /\bhow\s+(much|many)\s+(is|are)\s+\d/i,

  // "solve" followed immediately by a digit — single-equation solve ("solve 2x=4").
  // Requires a digit to avoid routing "solve this design problem" as MECHANICAL.
  /\bsolve\s+\d/i,
];

export const ARCHITECTURAL_PATTERNS: RegExp[] = [
  /\b(design|architect|architect(ure)?)\b/i,
  // Extended: also catches resource/capacity planning — "add N engineers to the team" is
  // a staffing/planning decision (no single correct answer). MECHANICAL evaluates first,
  // so true arithmetic "add 5 and 3" / "add 100 to 250" still route MECHANICAL.
  /\bplan\s+(for|a|the|out)\b|\badd\s+\d+\s+\w.*?\s+(?:to|for|in)\s+(?:the|our|a|this)\b/i,
  /\b(refactor|restructure|reorganize)\b/i,
  // Extended: also catches qualitative-sum requests — "sum the quarterly results" is
  // a reporting/interpretation question, not a compute request. MECHANICAL evaluates first,
  // so "sum these numbers" / "sum the values" still route MECHANICAL.
  /\b(evaluate|assess|compare|weigh)\b|\bsum\s+(?:the|these|all|those)\b/i,
  /\bhow\s+should\s+(we|i|the)\b/i,
  /\bwhat\s+if\s+/i,
  // Extended: also catches "how many is <opinion-phrase>" — opinion/judgment count
  // questions ("how many is too many microservices", "how many is enough for redundancy").
  // Negative lookahead (?!\s+\d) excludes arithmetic ("how many is 3 plus 4" routes
  // MECHANICAL first via the tightened FU-5 pattern).
  /\bshould\s+we\b|\bhow\s+many\s+is\b(?!\s+\d)/i,
  /\bwhy\s+(does|is|do|did|would)\b/i,
  /\bhelp\s+me\s+(design|plan|think|figure|decide)\b/i,
  /\bbest\s+(approach|way|practice|pattern)\b/i,
  /\btrade(-|\s*)off(s)?\b/i,
  /\barchitecture\s+(of|for|decision)\b/i,
  /\b(strategy|approach|pattern)\s+for\b/i,
  /\bwhat'?s\s+the\s+best\s+way\b/i,
  /\bpros?\s+(and\s+)?cons?\b/i,
  // Extended: also catches "convert/calculate/compute the/our/a <architectural-noun>" —
  // these are judgment/migration operations when the object is non-numeric.
  // MECHANICAL evaluates first, so "convert 5km to miles" / "calculate the total" /
  // "compute the sum" still route MECHANICAL (they have digit or numeric-aggregate noun).
  /\b(migrate|migration)\s+(to|from|path)\b|\b(convert|calculate|compute)\s+(?:the|our|a|this)\b/i,
  /\bscale\b.*\b(to|for)\b/i,
  /\bpick\s+between\b/i,
];
