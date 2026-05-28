<!--
  Copyright (c) 2026 Wonton Web Works LLC. All rights reserved.
  Licensed under the TheEngOrg Enterprise License Agreement.
  See LICENSE.enterprise for terms.
-->
# Protocol Loading Tiers

**Owner:** TheEngOrg Enterprise (TEO)
**Version:** 1.0.0
**Purpose:** Classify shared protocols into loading tiers to minimize context overhead at session start.

---

## Tier Definitions

### Tier 1: Always (session start)

Loaded at every Sage session start. These define identity, formatting basics, and engineering standards.

| Protocol | Size | Why always |
|----------|------|------------|
| `CLAUDE.md` | ~3KB | Project rules, routing, security directives |
| `visual-formatting.md` sections 1-4 | ~2KB | Color defs, banner, badges, status icons (compact only) |
| `engineering-principles.md` | ~5KB | Core engineering standards referenced by all agents |

**Total always-load:** ~10KB

### Tier 2: Pipeline (Sage composes)

Loaded when the Sage begins pipeline composition (step 6-8 of intake). These are the runtime protocols.

| Protocol | Size | When loaded |
|----------|------|-------------|
| `harness-protocol.md` sections 1-5 | ~8KB | Step 3: flow registry loading |
| `process-matcher-protocol.md` | ~8KB | Step 6: process-intent alignment |
| `gate-evaluator-protocol.md` | ~10KB | Step 9: pipeline execution |
| `verification-gate-protocol.md` | ~4KB | Pre-completion verification |
| `process-enforcement-protocol.md` | ~5KB | Re-injection checkpoints |

**Total pipeline-load:** ~35KB (loaded incrementally as pipeline progresses)

### Tier 3: On-demand (when triggered)

Loaded only when a specific condition triggers them. Never loaded at session start.

| Protocol | Trigger |
|----------|---------|
| `debug-protocol.md` | `debug: true` in intake |
| `observability-protocol.md` | First pipeline step (logging) |
| `handoff-protocol.md` | Context cliff detected or session end |
| `tdd-workflow.md` | BUILD intent with test requirements |
| `website-creation-process.md` | Website project detected |
| `development-workflow.md` | BUILD/FIX intent |
| `model-escalation.md` | Model routing decisions |
| `teo-agent-spawn.md` | Agent spawn needed |
| `directive-gate-protocol.md` | Agent edit detected |
| `memory-protocol.md` | Memory operations needed |
| `error-recovery.md` | Error condition detected by any agent |

### Tier 4: Archive (rarely loaded)

These are reference documents that almost never need to be read during normal operation.

| Protocol | When loaded |
|----------|-------------|
| `gate-classification-protocol.md` | Audit or compliance review |
| `trace-protocol.md` | Trace analysis or debugging |

---

## Loading Rules

1. **Tier 1 protocols are loaded in full at session start.** No exceptions.
2. **Tier 2 protocols are loaded just-in-time** when the Sage reaches the relevant pipeline step. Load only the sections needed for that step.
3. **Tier 3 protocols are never loaded proactively.** The Sage reads them only when the trigger condition fires.
4. **Tier 4 protocols are not loaded unless explicitly requested** by the user or a compliance audit.
5. **Gate trace data goes to files only** -- never echoed into conversation context unless debug mode is active.
6. **Protocol references in agent.md use pointers** (e.g., "See shared/debug-protocol.md") rather than inline duplication.

---

## Context Budget Target

| Component | Budget | Actual (post-optimization) |
|-----------|--------|---------------------------|
| CLAUDE.md + Tier 1 protocols | <=12% | ~10KB |
| Sage agent.md (slim) | <=5% | ~25KB |
| **Total session-start overhead** | **<=15%** | **~35KB** |

Previous overhead (pre-optimization): ~19% (~78KB loaded at session start)
Target overhead: <=15%
