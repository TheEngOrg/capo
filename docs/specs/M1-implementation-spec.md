# TEO M1 — Implementation Specification

**Status:** DRAFT  
**Date:** 2026-05-28  
**Author:** Staff Engineer  
**Source of truth:** `docs/specs/M1-acceptance-criteria.md` (PM), ADR-0005, ADR-0006, ADR-0001, SPIKE-002  
**OQ Closures:** PM Section 5 — heuristic seed patterns, slash commands, stub response content

---

## Section 1 — Project Structure

Every file you'd commit at M1 completion. No surprises.

```
the-eng-org/
├── src/
│   ├── index.tsx                    # Binary entry: parse CLI args, branch to REPL or flag handlers
│   ├── cli/
│   │   ├── args.ts                  # parseArgs(): version, help, debug flags via Commander
│   │   └── App.tsx                  # <App /> top-level Ink component, session lifecycle
│   ├── classifier/
│   │   ├── classifier.ts            # classify(input: string): RouteDecision
│   │   ├── patterns.ts              # MECHANICAL_PATTERNS[], ARCHITECTURAL_PATTERNS[]
│   │   └── types.ts                 # Route, RouteDecision, ClassifierConfig
│   ├── pipelines/
│   │   ├── MechanicalStub.tsx       # <MechanicalStub input={text} /> — renders stub response
│   │   ├── ArchitecturalStub.tsx    # <ArchitecturalStub input={text} /> — renders stub response
│   │   └── types.ts                 # PipelineProps
│   ├── repl/
│   │   ├── Session.tsx              # <Session /> — owns input loop, output history state
│   │   ├── history.ts               # appendHistory(route, text): void, historyPath(): string
│   │   └── useSubmit.ts             # useSubmit hook: blank-input guard, classify, route
│   ├── security/
│   │   ├── identity.ts              # issueIdentityToken(): IdentityToken
│   │   ├── policy.ts                # PolicyEnforcement.preflight(token): void
│   │   └── keys.ts                  # RELEASE_PUBLIC_KEY constant (injected via bun build --define)
│   ├── audit/
│   │   └── log.ts                   # writeAuditEvent(event: AuditEvent): void
│   └── ui/
│       ├── RouteIndicator.tsx       # <RouteIndicator route={displayRoute} /> — dim [→ X] prefix
│       ├── Prompt.tsx               # <Prompt /> — "teo> " + TextInput
│       ├── Output.tsx               # <Output items={history} /> — Static + per-item renders
│       └── ErrorBoundary.tsx        # <ErrorBoundary /> — catches render errors, shows message
├── tests/
│   ├── classifier/
│   │   ├── classifier.test.ts       # classify() unit tests — all patterns from Section 4.1
│   │   └── patterns.test.ts         # Pattern array shape tests (no empty arrays, valid regex)
│   ├── repl/
│   │   ├── history.test.ts          # appendHistory format, XDG path resolution
│   │   └── useSubmit.test.ts        # Blank input guard, route decision flow
│   ├── security/
│   │   ├── identity.test.ts         # Token issuance: structure, uniqueness, HMAC presence
│   │   └── policy.test.ts           # preflight() pass/throw behavior
│   ├── audit/
│   │   └── log.test.ts              # writeAuditEvent() — JSONL output, required fields
│   ├── ui/
│   │   ├── RouteIndicator.test.tsx  # UNKNOWN → architectural display collapse
│   │   ├── Prompt.test.tsx          # "teo> " renders, TextInput present
│   │   ├── Output.test.tsx          # History items render atomically
│   │   └── ErrorBoundary.test.tsx   # Error caught, human-readable message shown
│   ├── integration/
│   │   └── golden.test.ts           # End-to-end REPL flow: PM Section 7 scenario steps
│   └── build/
│       └── long-pem-define.test.sh  # ADR-0005 OQ-3 gate test (see Section 8)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── bunfig.toml
└── .github/
    └── workflows/
        └── ci.yml                   # CI — flagged for devops-engineer (see Section 7)
```

---

## Section 2 — Dependency Manifest

`package.json` shape. Exact versions are pinned; no ranges on production deps.

```json
{
  "name": "teo",
  "version": "0.1.0",
  "description": "TEO — Team Orchestration for Claude Code",
  "engines": {
    "bun": ">=1.3.14"
  },
  "scripts": {
    "dev": "bun run src/index.tsx",
    "build:darwin": "bun build --compile --target=bun-darwin-arm64 src/index.tsx --outfile dist/teo-darwin-arm64",
    "build:linux": "bun build --compile --target=bun-linux-x64 src/index.tsx --outfile dist/teo-linux-x64",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "ink": "7.0.4",
    "ink-spinner": "5.0.0",
    "ink-text-input": "6.0.0",
    "react": "19.2.0"
  },
  "optionalDependencies": {
    "react-devtools-core": "7.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "19.1.0",
    "ink-testing-library": "4.0.0",
    "typescript": "5.4.5",
    "vitest": "^1.6.0"
  }
}
```

**Notes:**
- No `bin` field — M1 distributes as a tarball of compiled binaries (see Section 6), not an npm-installable package. `bin` isn't meaningful here and was removed to avoid confusion.
- `commander@^12` for `--version`, `--help`, `--debug` flag parsing. Ink doesn't expose a CLI parsing layer; Commander handles the pre-render argument dispatch so `teo --version` exits without spinning up an Ink render loop.
- `react-devtools-core` as `optionalDependencies` — the `bun build --compile` bundler requires it to resolve Ink 7.0.4's conditional `./devtools.js` import (SPIKE-002 Test 4 finding). Never executes at runtime unless `DEV=true`. Must be in `optionalDependencies`, not `devDependencies`, so it's present in the compile environment.
- No `node` engine field — Bun is the runtime. Node isn't required on user machines.
- `vitest` not `bun test` — Vitest gives us `ink-testing-library` compatibility and consistent coverage reporting. `bun test` is fine for simple unit tests but doesn't integrate cleanly with `@testing-library/react` patterns.

---

## Section 3 — Core Types and Interfaces

```typescript
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
```

```typescript
// src/security/identity.ts

export interface IdentityToken {
  token_id: string;     // UUID v4
  session_id: string;   // UUID v4, per-REPL-launch
  issued_at: string;    // ISO-8601 UTC
  hmac: string;         // HMAC-SHA256 hex digest over token_id + session_id + issued_at
}
```

```typescript
// src/audit/log.ts

export type AuditEventType =
  | 'token_issued'
  | 'preflight_called'
  | 'preflight_failed'
  | 'route_decision'
  | 'history_written';

export interface AuditEvent {
  type: AuditEventType;
  token_id: string;
  timestamp: string;    // ISO-8601 UTC
  route?: DisplayRoute; // present on route_decision events
  input_hash?: string;  // SHA-256 of raw input — for audit without storing plaintext
}
```

```typescript
// src/pipelines/types.ts

export interface PipelineProps {
  input: string;
  decision: RouteDecision;
}
```

```typescript
// src/cli/args.ts

export interface ParsedArgs {
  version: boolean;
  help: boolean;
  debug: boolean;
}
```

**UNKNOWN → ARCHITECTURAL enforcement:** `classify()` may return `route: 'UNKNOWN'`. The `display_route` field is always set by the classifier itself — `UNKNOWN` maps to `'architectural'` at classification time. Consumers should never branch on `route === 'UNKNOWN'` for display purposes; they use `display_route`. This keeps the collapse logic in one place and makes it unit-testable.

---

## Section 4 — Three Delegated Decisions

### 4.1 Heuristic Seed Patterns

Patterns are compiled to regex at module load in `src/classifier/patterns.ts`. Case-insensitive, match anywhere in input string (not anchored).

**MECHANICAL_PATTERNS** — operational, single-step, deterministic:

```typescript
export const MECHANICAL_PATTERNS: RegExp[] = [
  /\b(run|exec|execute)\b/i,
  /\b(list|ls)\b/i,
  /\bshow\s+(me\s+)?(the\s+)?/i,
  /\b(get|fetch|retrieve)\b/i,
  /\b(check|validate|verify)\b/i,
  /\b(install|uninstall|add|remove)\s+\w/i,
  /\b(build|compile)\b/i,
  /\b(deploy|ship|release)\b/i,
  /\bopen\s+(file|the\s+file)/i,
  /\bread\s+(file|the\s+file|from)/i,
  /\bwrite\s+(to\s+)?(file|the\s+file)/i,
  /\bdelete\s+(file|the\s+file|this)/i,
  /\bcurrent\s+directory\b/i,
  /\bwhat\s+is\s+the\s+/i,
  /\bwhat'?s\s+(in|the)\s+/i,
  /\bprint\s+(the\s+)?\w/i,
  /\bgit\s+(status|log|diff|add|commit|push|pull)\b/i,
  /\b(start|stop|restart)\s+\w/i,
];
```

**ARCHITECTURAL_PATTERNS** — design, planning, multi-step reasoning:

```typescript
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
```

**Evaluation order:** Check MECHANICAL first, then ARCHITECTURAL. First match wins. No match → UNKNOWN → display as `architectural`. This order matters: `build a design` should route MECHANICAL on the `build` match, not ARCHITECTURAL on `design`. If this produces wrong results in practice, the order is a one-line flip — easy to tune after M1 ships.

**UNKNOWN fallback:** no pattern in either list matches → `route: 'UNKNOWN'`, `display_route: 'architectural'`. qa should write misuse cases specifically targeting inputs that fall into UNKNOWN and confirm they display as `[→ architectural]` not as an error.

### 4.2 Slash Commands

**Decision: no slash commands in M1. Ctrl+D is the only exit mechanism.**

Rationale: Brodie's instinct from Round 3 was to keep M1 simple, and that call holds up. The argument for `/help` is discoverability — a new user might not know Ctrl+D exits. But `/help` implies a parsing layer that tokenizes input before the classifier sees it, which means we need to decide: does the classifier even run on slash-prefixed input? Does `/help` appear in history? What if someone types `/help design a system` — does that route or trigger help? These edge cases are trivial to define but non-trivial to test, and they bite exactly when M2 adds verb-prefix syntax. We'd be pre-baking a slash-command parsing layer that M2 will either conflict with or have to absorb.

M1 `--help` output will include a line noting that Ctrl+D exits the REPL. That covers discoverability without adding parsing complexity. This is explicitly allowed by PM's AC ("or do we handle quit exclusively via Ctrl+D" — yes, we do).

No `/help`, no `/quit`, no slash commands in M1.

### 4.3 Stub Response Content

**Locked wording:**

MECHANICAL stub:
```
[mechanical stub] Received: {input}
```

ARCHITECTURAL stub:
```
[architectural stub] Received: {input}
```

Where `{input}` is the raw input string the user submitted.

Example for PM Section 7 scenario step 3 (`show me the current directory`):
```
[→ mechanical]
[mechanical stub] Received: show me the current directory
```

One line per stub. No streaming (PM AC: "renders atomically"). No matched_pattern echo in the default output — that goes to `--debug` output only, so normal output stays clean. Both stubs are pure Ink components — no side effects, no async, renders synchronously.

qa: assert that the string `[mechanical stub] Received: ` + raw input text appears in the render output for MECHANICAL-classified input, and `[architectural stub] Received: ` + raw input for ARCHITECTURAL (including UNKNOWN inputs that display as architectural).

---

## Section 5 — Implementation Paths for PM AC

**Binary launch**

`src/index.tsx` is the entry point. Before Ink renders anything, Commander parses `process.argv`. If `--version` is present, print `package.json#version` to stdout and `process.exit(0)`. If `--help` is present, Commander's generated help output prints and exits. If `--debug` is present, set a module-level `DEBUG_MODE = true` flag before rendering. Then `render(<App debug={DEBUG_MODE} />)`.

`App.tsx` renders `<ErrorBoundary><Session debug={debug} /></ErrorBoundary>`.

**`--version` and `--help`**

Commander handles both. We import `package.json` as a JSON module (`import pkg from '../package.json'`) and pass `pkg.version` to `.version()`. This way `teo --version` prints `0.1.0` without a render cycle.

**REPL loop**

`<Session />` owns all REPL state. It renders `<Output items={history} />` and `<Prompt onSubmit={handleSubmit} />`. `<Prompt />` wraps Ink's `<TextInput />` with a `teo> ` prefix. On submit, `handleSubmit` calls `useSubmit()`.

`useSubmit` hook:
1. If `input.trim() === ''`, return early — no-op (PM AC: "Blank input is a no-op").
2. Call `classify(input)` → `RouteDecision`.
3. Call `PolicyEnforcement.preflight(token)` — throws on failure, caught by `<ErrorBoundary />`.
4. If `--debug`, call `writeAuditEvent({ type: 'preflight_called', ... })`.
5. Append `{ decision, input }` to `history` state — triggers re-render of `<Output />`.
6. Call `appendHistory(decision.display_route, input)`.

**Ctrl+C handling**

Ink's `useInput` with `{ isActive: true }` fires on Ctrl+C. When detected, if any async operation is in flight (none in M1 — stubs are synchronous), cancel via AbortController. Do not call `process.exit()`. Return to prompt. Since M1 stubs are synchronous, Ctrl+C during stub render is a no-op; the stub has already rendered. This is still wired correctly so M2 async operations inherit the cancellation pattern.

**Ctrl+D handling**

Ink automatically handles `stdin` end-of-file (Ctrl+D). `<App />` uses a `useEffect` that listens for the `stdin`'s `end` event and calls `process.exit(0)`. Clean exit, no stack trace.

**Classifier**

`classify(input: string): RouteDecision` in `src/classifier/classifier.ts`. Pattern arrays are compiled once at module load (not re-compiled per call). Match order: MECHANICAL first, ARCHITECTURAL second. Returns `RouteDecision` with `display_route` set at classification time.

```typescript
export function classify(input: string): RouteDecision {
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
  return {
    route: 'UNKNOWN',
    display_route: 'architectural',
    raw_input: input,
  };
}
```

**Routing display**

`<RouteIndicator route={decision.display_route} />` renders dim text `[→ {route}]`. The `display_route` field is always `'mechanical'` or `'architectural'` — never `'UNKNOWN'`. The RouteIndicator component needs no special-case logic.

**Identity token**

`issueIdentityToken()` is called once in `<App />` on mount via `useEffect([], ...)`. It generates a UUID v4 `token_id`, a UUID v4 `session_id`, current timestamp, and computes HMAC-SHA256 over `${token_id}:${session_id}:${issued_at}` using a session-local secret (random 32 bytes generated at startup). The token is stored in `App` state and passed down as a prop. If `--debug`, `writeAuditEvent({ type: 'token_issued', token_id, timestamp })` is called immediately after issuance.

**PolicyEnforcement.preflight()**

`PolicyEnforcement.preflight(token: IdentityToken): void` in `src/security/policy.ts`. In M1, this is a skeleton — it validates the token is non-null and `token_id` is non-empty, then returns. It does NOT silently no-op: if `token` is null or malformed, it throws `new Error('preflight failed: invalid or missing identity token')`. This error propagates up to `<ErrorBoundary />` and renders a human-readable message. If `--debug`, the call itself is logged via `writeAuditEvent` before and after.

**History file**

`appendHistory(route: DisplayRoute, text: string): void` in `src/repl/history.ts`. Path: `${process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local/state')}/teo/history`. Creates the directory if absent (`fs.mkdirSync(dir, { recursive: true })`). Appends `${route}: ${text}\n` using `fs.appendFileSync` — this is atomic at the OS level for single-process writes, which is sufficient for M1 (no concurrent REPL instances).

**Audit log**

`writeAuditEvent(event: AuditEvent): void` in `src/audit/log.ts`. Path: `${process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local/state')}/teo/audit.log`. Serializes `event` to JSON and appends `${JSON.stringify(event)}\n` via `fs.appendFileSync`. Same directory creation logic as history. Input is hashed (SHA-256) before inclusion — plaintext input is never written to the audit log, only `input_hash`.

## XDG Compliance

TEO uses strict XDG Base Directory Specification compliance:

- `$XDG_CONFIG_HOME` (default `~/.config`) — user-editable configuration files. TEO has no config files in M1 — this directory is unused until M2+ adds user settings.
- `$XDG_STATE_HOME` (default `~/.local/state`) — state files: history and audit log. These are write-once append files, not user-editable config.

**Path resolution in code:**

```typescript
const stateDir = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local/state');
// history: `${stateDir}/teo/history`
// audit:   `${stateDir}/teo/audit.log`
```

On macOS and Linux without XDG env vars set, paths resolve to `~/.local/state/teo/` — the XDG default on both platforms. If a user has set custom `XDG_STATE_HOME`, that value is honored automatically.

**M1 XDG surface:** Only `$XDG_STATE_HOME` is used. No config or cache directories. Future milestones may add `$XDG_CONFIG_HOME` for user settings and `$XDG_CACHE_HOME` for any cached state.

**`--debug` flag**

When `debug` prop is `true` on `<App />`, all `writeAuditEvent` calls fire. Additionally, `classify()` logs the matched pattern to stderr. This gives a running stream of token issuance + preflight calls visible during `teo --debug` usage (PM AC Section 3, SOC2 baseline).

**Error handling**

`<ErrorBoundary />` in `src/ui/ErrorBoundary.tsx` wraps the full render tree. Caught errors render a single Ink `<Text color="red">` line with the error's `.message`. No stack trace. For fatal startup errors (e.g., `issueIdentityToken` throws before the REPL renders), wrap `render()` in a try/catch: print to stderr and `process.exit(1)`.

---

## Section 6 — Build & Distribution

**Build commands:**

```sh
# macOS arm64
bun build --compile \
  --target=bun-darwin-arm64 \
  --define 'RELEASE_PUBLIC_KEY="<ed25519-public-key>"' \
  src/index.tsx \
  --outfile dist/teo-darwin-arm64

# Linux x64
bun build --compile \
  --target=bun-linux-x64 \
  --define 'RELEASE_PUBLIC_KEY="<ed25519-public-key>"' \
  src/index.tsx \
  --outfile dist/teo-linux-x64
```

The `RELEASE_PUBLIC_KEY` value is the Ed25519 public key in PKCS8 PEM format with `\n` escaping for newlines. SPIKE-002 Test 6 Case B confirmed this encoding works. The OQ-3 gate test (Section 8) verifies it works for the full-length real key before the M1 release build is cut.

**Distribution tarballs:**

```sh
# macOS
tar -czf dist/teo-darwin-arm64.tar.gz -C dist teo-darwin-arm64 ../LICENSE ../README.md

# Linux
tar -czf dist/teo-linux-x64.tar.gz -C dist teo-linux-x64 ../LICENSE ../README.md
```

Each tarball contains: compiled binary, LICENSE, README.

**`react-devtools-core` compile requirement:** Must be installed as an optional dep before any `bun build --compile` runs. `bun install` handles this automatically since it's in `optionalDependencies`. CI must run `bun install` before build steps. This is documented in the M1 build setup doc (day-1 deliverable alongside this spec).

**ADR-0005 OQ-1 evaluation:** On M1 day 1, evaluate whether `--external react-devtools-core` can replace the optional dep install. If it works, it simplifies the build step. If it doesn't, the optional dep approach stands. Staff-eng makes the call during M1 sprint setup.

---

## Section 7 — CI Plan (flagged for devops-engineer)

The original `.github/workflows/ci.yml` was wiped. devops-engineer owns the workflow file. These are the requirements it must satisfy:

| Step | Command | Gate behavior |
|------|---------|---------------|
| Install deps | `bun install` | Must include optional deps |
| Typecheck | `bun run typecheck` | Fail on any TS error |
| Lint | TBD by devops-engineer | Fail on lint errors |
| Tests | `bun run test` (vitest) | Fail on any test failure |
| Coverage check | vitest `--coverage` with 99% gate | Fail below 99% |
| Build macOS | `bun run build:darwin` | Fail if binary not produced |
| Build Linux | `bun run build:linux` | Fail if binary not produced |
| Smoke test | Run binary with `--version` | Fail if exit non-zero |

**Platform matrix:** macOS arm64 runner for the macOS binary; Linux x64 runner (ubuntu-latest) for the Linux binary. Both run tests. Cross-compile works from either platform but running tests on the target platform catches TTY behavior differences.

**Test 2 TTY closure (SPIKE-002 gap):** devops-engineer should wire a manual TTY verification step or confirm Vitest's ink-testing-library coverage is sufficient to close this before M1 release. This is a shared devops-engineer / qa concern — flag it.

**CI secret:** `RELEASE_PUBLIC_KEY` injected as a CI secret for the build step. devops-engineer coordinates with CTO on secret name and rotation policy (ADR-0001 OQ-3).

---

## Section 8 — Long-PEM `--define` Gate Test (ADR-0005 OQ-3)

Staff-engineer runs this test on M1 sprint day 1. It's a required gate before the release build is cut. Not a blocker for implementation start.

**Test fixture set:**

```
Fixture 1 — Realistic Ed25519 PKCS8 PEM (~119 chars body + headers):
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA[64-char-base64-body-here]
-----END PUBLIC KEY-----
→ Escaped for --define: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA[64-chars]\n-----END PUBLIC KEY-----"
→ Expected char count: 26 + 1 + 66 + 1 + 24 = 118 chars

Fixture 2 — OpenSSH format (~200 chars):
ssh-ed25519 AAAA[~174-char-base64] user@host
→ Single line, no escaping needed
→ Expected char count: the exact string length

Fixture 3 — Worst-case cert chain (~1KB+):
[Multi-line PEM cert chain with multiple -----BEGIN/END----- blocks]
→ Each newline escaped as \n
→ Expected char count: total string length including all \n escapes
```

**Procedure for each fixture:**

```sh
# Build with fixture value
bun build --compile \
  --target=bun-darwin-arm64 \
  --define "RELEASE_PUBLIC_KEY=\"<escaped-fixture-value>\"" \
  src/security/keys.ts \
  --outfile /tmp/test-define-<n>

# Run and check length
/tmp/test-define-<n>
# Binary must print RELEASE_PUBLIC_KEY.length
# Must equal: character count of the unescaped string
```

`src/security/keys.ts` for the gate test should contain:
```typescript
declare const RELEASE_PUBLIC_KEY: string;
console.log(RELEASE_PUBLIC_KEY.length);
process.exit(0);
```

**Pass criteria:** For every fixture, `RELEASE_PUBLIC_KEY.length` at runtime equals the character count of the string passed to `--define` (counting each `\n` escape as one character). Zero truncation across all three fixtures.

**Fail criteria:** Any length mismatch, `RELEASE_PUBLIC_KEY` is `undefined`, or `bun build` exits non-zero. If any fixture fails, the M1 release build does not proceed. Escalate to CTO with Bun version, exact command, and full stderr.

**Schedule:** M1 sprint day 1. Evidence documented in a findings file at `docs/spikes/OQ3-long-pem-define.md`.

---

## Section 9 — Open Questions for Sage / User

These couldn't be resolved unilaterally from the spec inputs.

**Storage path — RESOLVED.** Strict XDG compliance. History and audit log are state files, not config — they live in `$XDG_STATE_HOME` (default `~/.local/state/teo/`), not `$XDG_CONFIG_HOME`. M1 has no config files, so `$XDG_CONFIG_HOME` is unused until M2+. On macOS and Linux without custom XDG vars, paths resolve to `~/.local/state/teo/history` and `~/.local/state/teo/audit.log`. See XDG Compliance subsection in Section 5.

**Codesigning.** SPIKE-002 Test 4 confirmed macOS Gatekeeper didn't trigger for the spike binary in Brodie's environment. Enterprise macOS with MDM-enforced Gatekeeper policies (`App Store and identified developers only`) will block the binary. ADR-0005 flags this for pre-v1 evaluation. For M1, document the `xattr -d com.apple.quarantine` workaround in the README. Decision on paying for an Apple Developer certificate ($99/year) is Brodie's call.

**License headers.** No call made here. If yes, we need a standard header comment block and a script to apply it. If no, nothing changes. Brodie decides.

**README ownership post-M1.** Currently the README likely reflects pre-M1 state. After M1 ships, someone needs to update it with install instructions, `teo --help` output, and usage examples. Scope not assigned in any spec. Recommend PM or staff-eng owns a one-pass update as part of M1 Done Definition.

**ADR-0005 OQ-1 resolution.** `--external react-devtools-core` as alternative to optional dep. Evaluate on M1 day 1 alongside OQ-3 gate test. Staff-eng closes this and notes the result in the build setup doc.
