/**
 * diff-golden — semantic comparison of a normalized demo bundle against its
 * committed golden. On drift it emits structured DiffLines keyed by "seq (phase)"
 * so a reviewer reads *what changed at which step*, not a raw JSON wall. See
 * docs/specs/TEO-5-demo-suite.md §3.
 */

export interface DiffLine {
  /** Event seq the diff is at, or null for finance/status/run-result diffs. */
  seq: number | null;
  phase: string | null;
  path: string;
  expected: unknown;
  actual: unknown;
}

interface Event {
  seq: number;
  phase: string;
  [k: string]: unknown;
}
export interface Bundle {
  events: Event[];
  finance: unknown;
  runResult: unknown;
  status: string;
}

/** Deep-equal via canonical JSON (ordering of object keys does not matter here —
 *  inputs are already normalized and constructed in a stable order). */
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Walk a value, emitting a flat list of leaf path/expected/actual diffs. */
function walk(
  prefix: string,
  expected: unknown,
  actual: unknown,
  out: Array<{ path: string; expected: unknown; actual: unknown }>,
): void {
  if (eq(expected, actual)) return;
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (isObj(expected) && isObj(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const k of keys) {
      walk(prefix ? `${prefix}.${k}` : k, expected[k], actual[k], out);
    }
    return;
  }
  out.push({ path: prefix, expected, actual });
}

/** Compare actual vs golden; return the structured drift list ([] = match). */
export function diffGolden(actual: Bundle, golden: Bundle): DiffLine[] {
  const diffs: DiffLine[] = [];

  // Event count first — the seq-count regression signal.
  if (actual.events.length !== golden.events.length) {
    diffs.push({
      seq: null,
      phase: null,
      path: "events.length",
      expected: golden.events.length,
      actual: actual.events.length,
    });
  }

  // Per-event field diffs, zipped by index (seq is contiguous 1..N).
  const n = Math.min(actual.events.length, golden.events.length);
  for (let i = 0; i < n; i++) {
    const ge = golden.events[i];
    const ae = actual.events[i];
    const leaf: Array<{ path: string; expected: unknown; actual: unknown }> = [];
    walk("", ge, ae, leaf);
    for (const l of leaf) {
      diffs.push({ seq: ge.seq, phase: ge.phase, path: l.path, expected: l.expected, actual: l.actual });
    }
  }

  // Finance, run-result, status.
  for (const [key, exp, act] of [
    ["finance", golden.finance, actual.finance],
    ["runResult", golden.runResult, actual.runResult],
  ] as const) {
    const leaf: Array<{ path: string; expected: unknown; actual: unknown }> = [];
    walk(key, exp, act, leaf);
    for (const l of leaf) diffs.push({ seq: null, phase: null, path: l.path, expected: l.expected, actual: l.actual });
  }
  if (actual.status !== golden.status) {
    diffs.push({ seq: null, phase: null, path: "status", expected: golden.status, actual: actual.status });
  }

  return diffs;
}

/** Render the drift list as a readable report. Empty list → empty string. */
export function formatDiff(diffs: DiffLine[], demoName: string): string {
  if (diffs.length === 0) return "";
  const lines: string[] = [`GOLDEN DRIFT: ${demoName}`, ""];
  for (const d of diffs) {
    const where = d.seq !== null ? `seq ${d.seq} (${d.phase}): ${d.path}` : d.path;
    lines.push(`  ${where}`);
    lines.push(`    expected: ${JSON.stringify(d.expected)}`);
    lines.push(`    actual:   ${JSON.stringify(d.actual)}`);
  }
  lines.push("");
  lines.push("  hint: if only signatures/ts drift, the signing key or clock changed —");
  lines.push("        regenerate with  GOLDEN_UPDATE=1 npx vitest run tests/acceptance");
  return lines.join("\n");
}
