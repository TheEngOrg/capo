# D-004 — Synchronous Render-Time Identity Token Issuance (useRef Guard)

**Date:** 2026-05-29
**Author:** staff-eng (binding decision), technical-writer (record)
**Status:** Active
**Applies to:** `src/repl/AppInner.tsx` — identity token issuance on mount

---

## The Problem

M1 issues a SOC2 identity token once per REPL session in the top-level Ink component. T-34 (a PM floor requirement) is specific: if token issuance fails, the failure must surface to the user as a human-readable error message via the React `ErrorBoundary`. Not a raw crash. Not an unhandled rejection. A message the user can actually read.

Two patterns can plausibly satisfy "issue once on mount":

1. `useEffect(() => { issueIdentityToken(); }, [])` — the standard React idiom for one-time side effects on mount
2. A synchronous call during the render phase, guarded by `useRef` to enforce exactly-once semantics

The spec originally prescribed `useEffect`. That prescription is wrong for this case. The `useEffect` pattern violates T-34.

---

## The Decision

Issue `issueIdentityToken()` synchronously during the render phase of `<AppInner />`, guarded by `useRef<IdentityToken | null>(null)`.

```tsx
const tokenRef = useRef<IdentityToken | null>(null);
if (tokenRef.current === null) {
  tokenRef.current = issueIdentityToken(); // throws on failure
}
const token = tokenRef.current;
```

The guard ensures issuance runs exactly once per session — skipped on every subsequent render. The token is read from the ref and passed down as a prop.

The component split matters here: the outer `App` renders `<ErrorBoundary><AppInner /></ErrorBoundary>`. Issuance lives in `AppInner`, not `App`, so it's a child of the boundary that must catch its throw. A throw from a render phase propagates up through the component tree and is caught by the nearest `ErrorBoundary` ancestor.

---

## The React Footgun

React's `ErrorBoundary.getDerivedStateFromError` only fires for errors thrown during the **render phase** — the render method, constructor, or a lifecycle method. Errors thrown inside a `useEffect` callback do NOT propagate to the `ErrorBoundary`. They bypass it entirely. They surface as unhandled errors.

This is documented — `getDerivedStateFromError` is in the React docs — but the implication is not obvious: a `useEffect` throw escapes your boundary. Most engineers haven't run into it and haven't internalized it. We hit it on a security-critical code path.

If token issuance lived in `useEffect` and threw, T-34 would be violated. The boundary would never fire. The user would see a raw crash. Moving issuance into the render phase is not a workaround — it's the only arrangement where the boundary works as intended.

---

## What We Tried First

**`useEffect(() => { issueIdentityToken(); }, [])`** — the textbook React "run once on mount" pattern, and what the spec originally prescribed. Rejected during Pass 2b implementation: a throw inside an effect callback does not reach `getDerivedStateFromError`. The ErrorBoundary sits idle. The app crashes raw. T-34 is violated.

The `useRef`-during-render pattern is the correction. The spec (M1-implementation-spec.md Section 5) has been updated to match.

---

## Trade-offs Acknowledged

Synchronous work during render delays first paint by the cost of `issueIdentityToken()`. That cost is acceptable here: it's HMAC-SHA256 on a UUID — CPU-local crypto, no I/O. Measured overhead is negligible.

The hard constraint is async: you can't `await` during a React render phase. If future issuance work needs to make a network call or read from disk, this pattern breaks and needs to be rethought. That's an explicit M2+ caveat — not a decision to revisit now, but one to flag before adding async work to `issueIdentityToken()`.

---

## Verification

qa-validate independently confirmed the once-only invariant holds across rerenders. Test T-37 mounts `App`, forces two rerenders, and asserts `issueIdentityToken` was called exactly once. No regressions in Pass 2b.

T-34 (ErrorBoundary catch path) is the other relevant test: it confirms that a throw from `issueIdentityToken()` surfaces as a human-readable message rather than a raw crash.

---

## Why This Matters Now

The spec said `useEffect`. The implementation correctly diverges from that. Without this record, a future agent or engineer reads the original spec, sees the pattern in the code doesn't match, and "fixes" it back to `useEffect` — which quietly breaks T-34 compliance on a security boundary. That's a high-cost mistake to rediscover.

The gap between spec language and implementation needs to be documented before M2 work starts.

---

## When to Apply

**Any security-critical initialization that must be caught by an ErrorBoundary:** issue synchronously during render with a `useRef` guard. `useEffect` is not safe for these cases.

**Non-security, non-boundary-caught side effects:** `useEffect` is still the right pattern. This decision is specifically about code paths where the ErrorBoundary is the fallback and a raw crash is unacceptable.

**If future issuance work adds async I/O:** revisit this decision before shipping. You can't await during render. Options at that point include Suspense + a data-fetching wrapper, or a two-phase render with a loading state. Document the choice in a new D-file.

---

## Files Changed

- `src/repl/AppInner.tsx` — synchronous `useRef`-guarded token issuance during render phase
- `docs/specs/M1-implementation-spec.md` Section 5 — updated to match the `useRef` pattern (was `useEffect`)

---

## Related

- [[D-003-coverage-gate-tiered-thresholds]] — same workstream (Pass 2b); the per-file threshold for `src/security/identity.ts` enforces 100% coverage of `issueIdentityToken()`
- `docs/specs/M1-implementation-spec.md` Section 5 — Identity token issuance (now updated to reflect this decision)
- `docs/specs/M1-test-specs.md` T-34 — ErrorBoundary catch path (human-readable error on issuance failure)
- `docs/specs/M1-test-specs.md` T-37 — once-only invariant across rerenders
