# WS-ORCH-FIX — Workstream Lessons

Running log of process/quality lessons surfaced during WS-ORCH-FIX (the orchestration context-loss / designed→done fix). These feed the workstream's own deliverables (teo-claim-evidence-gate, right-sizing).

## L-1 — Unverified capability claim in a spawn brief (designed→done instance)

**Date:** 2026-06-10
**Context:** Sage Spawn 6 brief (surgical Block-B delete in mg-memory-patch-section).

**What happened:** Sage's spawn brief asserted "Multi-line anchors ARE supported" by teo-apply-edit and instructed the dev to build a multi-line-anchor `replace` op. That assertion was NOT verified against teo-apply-edit's source. The actual matcher is `grep -cF` (line-scoped) — a multi-line anchor never matches (`ANCHOR_COUNT=0` → anchor-not-found). The dev caught it, reasoned from source, and clean-stopped at 17 tool calls (the defined success condition) rather than flailing.

**Why it matters:** This is a textbook designed→done failure — claiming a capability exists without checking source. It is exactly the class of unverified behavioral claim the teo-claim-evidence-gate (deliverable 1 of this workstream) is built to catch. The mis-assertion came from Sage itself while composing routing context, which is the higher-risk surface (Sage's Post-Tool Classification Gate and Checkpoint Re-verification Rule exist precisely to prevent Sage from emitting unverified behavioral claims).

**Corrective takeaway:** When a spawn brief asserts a tool capability that the spawn will depend on, that assertion must be source-verified (or routed as "verify whether X holds" rather than "X holds, do Y"). Pose the problem; do not pre-bake a capability claim. The downstream cost here was one wasted spawn cycle in an already-long session.

## L-2 — Right-sizing: three oversized/failed spawns in one workstream

**Date:** 2026-06-09 / 2026-06-10
**Context:** Memory-write tooling build + repair cycles.

**What happened:** Original dev build died twice (socket error ~129 calls / ~4h, then a resume stall). Spawn 2 (one fix) ran 197 calls / 52 min. Spawn 5 (5-item cleanup) ran 287 calls / 47 min AND regressed the suite by corrupting dead code it was told to delete.

**Why it matters:** Oversized spawns are the workstream's core failure mode. The pattern: devs re-derive a finicky edit against a tool with sharp edges (teo-apply-edit single-line anchoring), and the work balloons.

**Corrective takeaway:** Pre-compute exact edit targets in routing context (anchor + replacement) so the dev's job is mechanical application, not re-derivation. Hard-cap every spawn and define clean-stop-and-report as the success condition for tool-limitation cases (Spawn 6 demonstrated this working).
