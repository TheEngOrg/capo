// src/classifier/types.ts

export type Route = 'MECHANICAL' | 'ARCHITECTURAL' | 'UNKNOWN';
export type DisplayRoute = 'mechanical' | 'architectural'; // user-visible labels, always lowercase

export interface RouteDecision {
  route: Route;             // internal classifier result — may be UNKNOWN
  display_route: DisplayRoute; // UNKNOWN collapses to 'architectural' — PM AC Section 3
  raw_input: string;
  matched_pattern?: string; // first matching regex source string, for --debug output
}

export interface ClassifierConfig {
  mechanical_patterns: RegExp[];
  architectural_patterns: RegExp[];
}
