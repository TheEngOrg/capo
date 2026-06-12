# TEO 5 — Taskless as a Native Verification Kind

Status: **PROPOSAL — pending approval**
Extends: [`TEO-5.md`](./TEO-5.md) §3 (verifications), §4 (telemetry)
Decision record: ADR-061 (RAG)
Related: `Knowledge/taskless-tool-reference.md` (RAG)

Step-1 design doc. No `src/` code is written until approved. The CI integration
(advisory `taskless` job) ships separately and is **not** gated on this.

---

## 1. The idea

A TEO `verifications[]` check is already exactly the shape of a Taskless run: *run a
thing, the exit code is the verdict, no LLM judges it.* So Taskless slots in as a new
**verification kind** with almost no new machinery.

Today (`src/core/plan/plan.ts`):

```ts
interface Verification { kind: "script"; cmd: string; expect_exit: number; }
```

`kind` is already a discriminant with one arm. This adds a second:

```ts
type Verification =
  | { kind: "script";   cmd: string; expect_exit: number; }
  | { kind: "taskless"; rules?: string[]; severity?: "error" | "warning"; expect_exit?: number; };
```

A plan task can then carry:

```jsonc
"verifications": [
  { "kind": "script",   "cmd": "npx vitest run x.test.ts", "expect_exit": 0 },
  { "kind": "taskless",  "rules": ["no-nondeterminism-in-core"] }   // ← new
]
```

The orchestrator runs it, exit code → verdict, and — because it's a verification —
its result already flows into the **signed gate** that follows. So a Taskless rule
can back a gate with a cryptographically signed verdict, which is the thing the CI
job alone can't give you.

## 2. Why this is the right seam

- **`verifications[]` is the only place mechanical pass/fail already lives**, and it's
  already deterministic (no LLM). Taskless is deterministic static analysis. Same class.
- **Gates consume verification results.** A `gate_constraint` of `kind:"verification-ref"`
  points at a task's verification. Make Taskless a verification and a gate can assert
  "rule X held" and sign that assertion — `verdict | actor_id | ts | seq`, HMAC'd. The
  audit ledger then shows *which rule* gated *which task*, signed by the gate owner.
- **Zero LLM tokens.** Consistent with the engine's whole thesis: Taskless is a script,
  not an agent. It belongs in the deterministic core.
- **One small, discriminated extension** — no schema rework. The `kind` field was built
  for this.

## 3. Mechanics (how it runs)

`mechanical-verify.ts` branches on `kind`:

- `kind: "script"` → today's path (`/bin/sh -c cmd`).
- `kind: "taskless"` → shell `taskless check --json` (optionally scoped to `rules[]`),
  parse the JSON, map to a verdict:
  - no error-severity matches (and no warning matches if `severity:"warning"`) → **pass**
  - any disqualifying match → **fail**, with the matched rule/file/line captured in the
    `VerifyResult` for the telemetry `detail`.

The runner is the same `runScript` the engine already uses, so a human and the engine
invoke Taskless identically — no drift (the §6 `run-script` principle).

### Telemetry

The `MECH_VERIFY` event's `detail` gains the Taskless specifics:

```jsonc
{ "phase": "MECH_VERIFY", "verdict": "fail",
  "detail": { "kind": "taskless", "matches": [
    { "rule": "no-nondeterminism-in-core", "file": "src/core/x.ts", "line": 12, "severity": "error" }
  ] } }
```

So the ledger names the exact rule that failed a task — auditable, attributable, and
(once the gate signs over it) tamper-evident.

## 4. Planner guidance (§5a addition)

Sage already prefers SCRIPT over agent. Add one line: when a task's expectation is a
**known structural rule** ("no X pattern in Y"), prefer a `kind:"taskless"` verification
over hand-rolling a grep in a `kind:"script"` cmd. Rules are versioned in `.taskless/`,
testable, and reusable across plans — the same "promote a procedure into the library"
principle the engine already applies to scripts.

## 5. Boundaries / non-goals

- **No new LLM call.** `taskless check` is static analysis; rule *authoring* may use an
  agent, but that happens outside a run, in `.taskless/`. The engine only ever *runs* rules.
- **No account dependency.** Uses the free/local path (`check` against `.taskless/rules/`).
  No network in a run.
- **Doesn't replace script verifications.** Tests, builds, typecheck stay `kind:"script"`.
  Taskless is for structural-pattern rules, where it's better than a grep.
- **CI integration is independent.** The advisory `taskless` CI job (already added) needs
  none of this; this proposal is about the *engine's* gates, not the pipeline.

## 6. Component map (build order, tests-first — when approved)

| # | Change | Responsibility |
|---|--------|----------------|
| 1 | `plan.ts` | widen `Verification` to the discriminated union; validate the `taskless` arm |
| 2 | `mechanical-verify.ts` | branch on `kind`; add the `taskless` runner + JSON→verdict map; capture matches in the result |
| 3 | `telemetry`/orchestrator | thread the match detail into the `MECH_VERIFY` event (no schema change — `detail` is free-form) |
| 4 | planner prompt | one line of §5a guidance: structural rule → `kind:"taskless"` |

The new arm stays in the deterministic core and is unit-testable with a fake Taskless
result — same 100% coverage bar as the rest of `src/core/**`. No live `taskless` binary
in unit tests; a thin integration test exercises the real CLI (like the LLM runners).

## 7. Open items

- Scoping: does a `taskless` verification run *all* rules or only `rules[]`? Default to
  `rules[]` if given, else all — so a task gates on the rules it cares about.
- Warning handling: do `warning`-severity matches ever fail a verification, or only
  `error`? Propose: `error` fails by default; `severity:"warning"` opts warnings in.
- Whether to cache `npx @taskless/cli` resolution per run (cold npx is slow); maybe pin a
  resolved binary path in the runner, mirroring the `claude-cli` model selection.
