# ADR-0005 — Stack: Bun + React/Ink + TypeScript

**Status:** PROPOSED  
**Date:** 2026-05-28  
**Author:** Technical Writer (draft) — authored from Stack C confirmation session  
**Deciders:** CTO, Staff-Engineer, User  
**Supersedes:** None — this closes the implicit stack assumption carried forward from ADR-0001 and the release-signing spec  
**Related:** ADR-0001 (SOC2 V1 Boundary — public key compiled via `bun build --define`), ADR-0004 (Root-Config Integrity), SPIKE-002 (Bun + Ink + TypeScript Stack Viability)

---

## Context

The repo entered v1 with an implicit Bun assumption that was never formally recorded. SPIKE-001 established that the Claude CLI is itself compiled with Bun; ADR-0001 references `bun build --define` as the mechanism for embedding the Ed25519 public key into the binary. The release-signing spec in `docs/specs/release-signing.md` is written entirely in terms of Bun toolchain primitives. Bun was the de facto stack, but no ADR said so.

A session-level exploration of Python/Click as an alternative was conducted before this ADR was drafted. The exploration reached the following conclusions that ruled out Stack A:

- The `_keys.py` constant approach for compiling in the Ed25519 public key is a file-based key. A file-based key can be replaced by an attacker with local filesystem access, which directly contradicts ADR-0001 D2's required closing control. The SOC2 audit chain requires a compiled-in key, not an importable constant.
- Python distribution via `uv` still requires a runtime interpreter on the user's machine. The SOC2 single-binary story requires zero runtime dependencies for the installed binary.
- `prompt_toolkit` cannot cleanly support the classifier-first routing display interleaved with streaming output. The Round 4 design requirement is that routing decisions are visible inline as the output streams — this interaction model requires Ink's React reconciler-driven render loop, not a sequential I/O model.

Four stacks were evaluated:

| Stack | Runtime | TUI | Distribution |
|-------|---------|-----|-------------|
| A | Python + Click | prompt_toolkit | uv (interpreter required) |
| B | Node.js + TypeScript | React/Ink | npm package |
| C | Bun + TypeScript | React/Ink | `bun build --compile` single binary |
| D | Rust | Ratatui | Cargo (cross-compile) |

Stack D (Rust + Ratatui) was rejected for time-to-ship cost. A Rust rewrite is estimated at 6–12 months. The team is building to M1; that timeline is not compatible with shipping.

Stack A was eliminated per the analysis above. Stack B was dominated by Stack C on the single-binary distribution story: npm distribution requires Node.js on the user's machine, which fails the same ADR-0001 single-binary requirement. Stack C and Stack B share the same Ink renderer and TypeScript type system; the only material difference is the runtime and build output.

Stack C was selected contingent on SPIKE-002. SPIKE-002 was the required gate — Ink is not officially supported on Bun, and `bun build --compile` cross-platform behavior needed empirical confirmation before the stack was locked.

---

## Decision

**TEO M1 is built on Stack C: Bun 1.3.14 + React/Ink 7.0.4 + TypeScript 5.4.5.**

SPIKE-002 returned GO on 2026-05-28. Stack C is confirmed.

**Pinned dependencies:**

| Dependency | Version | Notes |
|-----------|---------|-------|
| bun | 1.3.14 | Runtime and build toolchain |
| ink | 7.0.4 | TUI renderer |
| react | 19.2.0 | Hard peer dependency of Ink 7.0.4 — NOT 18.x |
| @types/react | 19.1.0+ | Ink 7.0.4 requires React 19 types |
| ink-text-input | 6.0.0 | Input component |
| ink-spinner | 5.0.0 | Spinner component |
| typescript | 5.4.5 | Type system |
| react-devtools-core | optional | Required at build time — see note below |

**React version note:** QA's initial SPIKE-002 spec pinned react 18.3.1. This was a writing error. Ink 7.0.4's `peerDependencies` require react >= 19.2.0, which the bun.lock lockfile confirms. Staff-Eng identified this in Round 4. React 19.2.0 is the correct version for this Ink release.

**`react-devtools-core` note:** Ink 7.0.4's `reconciler.js` conditionally imports `./devtools.js` behind a `process.env.DEV === 'true'` guard. Bun's bundler statically resolves all reachable imports, including this conditional branch. Without `react-devtools-core` installed, `bun build --compile` fails. The fix is to add it as an optional dependency (`bun add react-devtools-core --optional`). This satisfies the bundler; the devtools branch is still guarded at runtime and never executes unless `DEV=true` is explicitly set. This is a build-time gotcha, not a runtime behavior change.

**Distribution:**

- Primary: single compiled binary via `bun build --compile`
- Signing: Ed25519, public key embedded via `bun build --define`
- Targets: macOS arm64 (`bun-darwin-arm64`), Linux x64 (`bun-linux-x64`)
- Binary sizes observed in SPIKE-002: ~65MB macOS arm64, ~96MB Linux x64

**Documented fallback:** Stack B (Node.js + Ink + TypeScript + npm) was the documented contingency if SPIKE-002 had returned NO-GO. SPIKE-002 returned GO. Stack B is not the fallback going forward — it has been superseded by this ADR's confirmation of Stack C.

---

## Rationale

**SPIKE-002 returned GO.** All six tests either passed or had a documented non-Bun-specific gap (Test 2 TTY — requires manual terminal confirmation, but the Bun-specific failure mode was confirmed absent). Stack C is empirically viable. The spike was the required gate, and it cleared.

**ADR-0001's compiled-in public key requirement.** ADR-0001 D2 requires the verification public key to be compiled into the binary — no file-based key path. `bun build --define` is the mechanism. SPIKE-002 Test 6 confirmed `--define` handles all four encoding cases (base64, PEM with escaped newlines, special characters, empty string) without silent truncation. The SOC2 closing control is verified buildable.

**Claude Code is Bun-compiled.** SPIKE-001 confirmed that the Claude CLI is itself a Bun-compiled binary. TEO drives Claude CLI as a subprocess (ADR-0001 Part 1). Building TEO on the same stack produces a coherent ecosystem — same runtime, same binary model, same distribution story. This isn't a strong engineering argument on its own, but it removes a category of "Bun vs Node compatibility" questions when debugging the subprocess integration.

**Round 4 specialist findings.** The CTO recommended Stack C. Staff-Eng recommended Stack C with SPIKE-002 as a required day-1 gate. CMO endorsed Stack C for positioning (single-binary story, enterprise distribution). Design flagged Stack B for faster initial velocity but withdrew the argument after the session-level Python/Click exploration surfaced that a stack pivot would require a full wipe of existing scaffolding — Design's velocity concern was about ADR churn, not about the stacks themselves, and a wipe would reset velocity to zero regardless of which stack was chosen. Three of four specialists recommended C; SPIKE-002 was the gate that closed staff-eng's concern.

---

## Consequences

### Positive

- SOC2 single-binary signing chain matches ADR-0001's original design. No deviations in the critical compliance path.
- Compiled binary requires no runtime on the user's machine. Zero install prerequisites for end users.
- Same compile stack as Claude Code — coherent ecosystem positioning and one less cross-runtime compatibility surface to debug.
- `bun build --compile` produces self-contained binaries for macOS arm64 and Linux x64 from the same source tree. Cross-platform distribution is a build flag, not a CI matrix with different tool installs.
- `bun build --define` confirmed for compiled-in key embedding across all relevant encoding cases (SPIKE-002 Test 6). ADR-0001 OQ-4 is resolved.

### Negative

- Ink-on-Bun is not officially supported by Ink maintainers. Bun implements the Node APIs Ink requires, but the Gemini CLI team's fork (`@jrichman/ink@6.6.9`) is evidence that upstream Ink has had real-world compatibility issues in Bun environments. We're committed to monitoring Ink releases and Bun's Node compatibility changelog.
- `react-devtools-core` optional dependency is a build-time gotcha. Any engineer setting up the project for the first time without the M1 build setup doc will hit this error and spend time debugging it. It must be in the setup doc.
- Binary sizes are ~65MB macOS / ~96MB Linux. These are large for a CLI tool but acceptable for enterprise distribution. Users installing via a managed package or downloading from a release page won't notice; users with bandwidth constraints might.

### Neutral

- Bun must be installed directly on dev machines (via https://bun.sh/install or Homebrew). SPIKE-002 was run via `npx bun@1.3.14`, which works for a spike but adds startup overhead in a real dev loop. Direct install is the right setup for M1. Install steps documented in the M1 build setup doc — day-1 M1 deliverable.

---

## Open Questions

| ID | Question | Owner | Status |
|----|----------|-------|--------|
| OQ-1 | `--external react-devtools-core` as an alternative to optional-dep install — does this produce a clean `bun build --compile` without adding the package to `package.json`? Evaluate on M1 day 1. | Staff-Engineer | OPEN — M1 day-1 evaluation |
| OQ-2 | Compiled binary startup latency target: QA's SPIKE-002 spec specifies <2000ms. Not measured in the spike (no timer tooling without system Bun). Measure on M1 sprint day 1 with `time ./teo` on the target machines. | QA + Dev | OPEN — M1 day-1 measurement |
| OQ-3 | `bun build --define` behavior with very long PEM strings (>1KB). Resolved in `docs/spikes/OQ3-long-pem-define.md` (commit d959af4). All three cases passed: PKCS8 PEM (137 chars), OpenSSH format (201 chars), cert chain (616 chars). Bun 1.3.14 correctly injects long PEM strings without silent truncation at any tested length or at intermediate byte boundaries. | Staff-Engineer | RESOLVED (d959af4) |

---

## Future Work

- ADR-0001 status update: the pending "blocks on Week 1 subprocess spike" language in ADR-0001 should be updated to "PROPOSED, stack verified via SPIKE-002, advances to Week 1 live validation of CLI multi-turn coherence." OQ-4 in ADR-0001 is resolved by SPIKE-002 Test 6.
- M1 build setup doc with concrete dependency install steps: Bun direct install, `bun install`, `bun add react-devtools-core --optional`, and `bun run test2-tty.tsx` manual TTY verification. This doc is a M1 day-1 deliverable.
- Codesigning evaluation for enterprise macOS distribution: SPIKE-002 Test 4 confirmed macOS Gatekeeper did not trigger for the spike binary. Enterprise macOS environments with stricter Gatekeeper settings (e.g., MDM-enforced "App Store and identified developers only") may require a paid Apple Developer certificate and `codesign` step in the release pipeline. Evaluate before v1 release.
- Test 2 (Raw TTY) manual closure: SPIKE-002's automated execution confirmed Bun implements `setRawMode`, but full arrow key and Ctrl+C behavior requires human verification in a real terminal. Close this before M1 sprint completion.
