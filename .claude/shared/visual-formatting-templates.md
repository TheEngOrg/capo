<!--
  Copyright (c) 2026 Wonton Web Works LLC. All rights reserved.
  Licensed under the TheEngOrg Enterprise License Agreement.
  See LICENSE.enterprise for terms.
-->
# Visual Formatting — Pipeline Templates

**Owner:** TheEngOrg Enterprise (TEO)
**Version:** 2.0.0
**Scope:** All agents, skills, and orchestrators in TEO and MG

Pipeline progress, gate results, process flow, agent spawning, team banners, workstream boards, error display, and ASCII art templates. Load on demand during pipeline execution.

For colors, session banner, agent badges, and status icons — see `visual-formatting.md` sections 1–4.

---

## 5. Pipeline Progress

Displayed by the Sage after each pipeline step completes. Shows the full pipeline with current position.

### Compact Pipeline (default)

```
🔮 [SAGE] Pipeline: {INTENT}
  ├─ 🟡 [LEAD] CEO: strategic assessment ✅
  ├─ 🟡 [LEAD] CTO: technical assessment ✅
  ├─ 🟢 [QA] Security: review pass ⚠️ (2 findings)
  └─ 🛡️ [COMPLIANCE] Legal: IP assessment ✅
```

### Verbose Pipeline

```
╔══════════════════════════════════════════════════════════════╗
║  🔮 SAGE PIPELINE: {INTENT}                                  ║
╠══════════════════════════════════════════════════════════════╣
║  Step 1/5: teo-assess         ✅ GO              █████░░░░░  ║
║  Step 2/5: teo-spec           ✅ APPROVED         ██████░░░░  ║
║  Step 3/5: teo-leadership     🔄 IN PROGRESS      ███████░░░  ║
║  Step 4/5: teo-build          ⏳ PENDING           ░░░░░░░░░░  ║
║  Step 5/5: teo-code-review    ⏳ PENDING           ░░░░░░░░░░  ║
╠══════════════════════════════════════════════════════════════╣
║  Progress: 40%  •  Active: teo-leadership  •  Blocked: 0     ║
╚══════════════════════════════════════════════════════════════╝
```

---

## 6. Gate Results

Displayed inline after gate evaluation. Color-coded by verdict.

### Compact Gate (default)

```
gate:{Gate Name} {PASS|WARN|FAIL} {details}
```

Examples:
```
gate:structural-integrity PASS (0.34s)
gate:count-freshness PASS (0.02s)
gate:docs-freshness WARN — source changed, no docs staged
gate:no-critical-findings FAIL — 2 critical vulnerabilities
```

### Verbose Gate

```
┌────────────────────────────────────────────────────────────┐
│  🚦 QUALITY GATE: {Gate Name}                               │
├────────────────────────────────────────────────────────────┤
│  ✅ Tests passing: 47/47                                    │
│  ✅ Coverage: 99.2% (target: 99%)                           │
│  ✅ No linting errors                                       │
│  ⚠️  Visual changes detected (pending design review)        │
├────────────────────────────────────────────────────────────┤
│  RESULT: ⚠️ CONDITIONAL PASS (awaiting design approval)     │
└────────────────────────────────────────────────────────────┘
```

### Gate Color Coding

| Verdict | Color | Icon |
|---------|-------|------|
| PASS | GREEN_BRIGHT | ✅ |
| WARN | YELLOW_BRIGHT | ⚠️ |
| FAIL / BLOCK | RED_BRIGHT | ❌ |
| SKIPPED | DIM | ⏭️ |

---

## 7. Process Flow Progress

Displayed when a registered process flow is active. Shows phase completion.

### Compact Flow

```
📋 Process: {flow-name} — Phase {n}/{total}: {phase-name} {status-icon}
```

### Verbose Flow

```
📋 Process: {flow-name}
  Phase 1/6: planning ✅
  Phase 2/6: design   ✅
  Phase 3/6: build    🔄 in progress
  Phase 4/6: review   ⏳ pending
  Phase 5/6: security ⏳ pending
  Phase 6/6: ship     ⏳ pending
```

---

## 8. Agent Spawning Feedback

### Columnar Activity Feed (default)

```
>> 🔵 [ENG]  dev      spawn   "implement auth"         depth:2/3
<< 🟢 [QA]   qa       done    "28 tests created"       31s
>> 🔵 [ENG]  dev      spawn   "implement to pass"      depth:2/3
.. 🔵 [ENG]  dev      running                           40%
<< 🔵 [ENG]  dev      done    "impl ready"             120s
!! ⚪ [COORD] em       blocked "waiting on qa"          depth:1/3
```

**Prefix key:**

| Prefix | Meaning | Color |
|--------|---------|-------|
| `>>` | Spawn / delegate | CYAN |
| `<<` | Return / complete | GREEN_BRIGHT |
| `..` | In progress | DIM |
| `!!` | Error / blocked | RED_BRIGHT |

### Debug Dashboard (verbose-only)

Available when `debug: true` or `--verbose`. Full ASCII table with AGENT, MODEL, STATUS, TASK columns plus SPAWN HISTORY and METRICS sections.

---

## 9. Team Invocation Banner

For composite teams (multiple agents working together):

### Compact

```
>> team:{Team Name} members:[Agent 1, Agent 2, Agent 3] mode:{mode}
```

### Verbose

```
╔══════════════════════════════════════════════════════════════╗
║  👥 TEAM: {Team Name}                                        ║
╠══════════════════════════════════════════════════════════════╣
║  Members: {Agent 1} • {Agent 2} • {Agent 3}                  ║
║  Mode: {Planning | Execution | Review}                       ║
╚══════════════════════════════════════════════════════════════╝
```

---

## 10. Workstream Status Board

### Compact

```
[WS-{id}]: {name} [{STATUS}]
```

### Verbose

```
╔══════════════════════════════════════════════════════════════╗
║                    WORKSTREAM STATUS                         ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  WS-1: Shared Memory         [✅ COMPLETE]    ████████████  ║
║  WS-2: Role Anchors          [🔄 IN PROGRESS] ████████░░░░  ║
║  WS-3: Structured Returns    [🔄 IN PROGRESS] ██████░░░░░░  ║
║  WS-4: Supervisor Agent      [🚫 BLOCKED]     ░░░░░░░░░░░░  ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║  Overall Progress: 45%  •  Active: 2  •  Blocked: 1         ║
╚══════════════════════════════════════════════════════════════╝
```

Progress bar: `█` = complete, `░` = remaining

---

## 11. Error Display

Errors ALWAYS use the full box regardless of output mode. Errors are NEVER replaced — they accumulate.

```
╔════════════════════════════════════════════════════════════╗
║  ❌ ERROR: {Error Type}                                     ║
╠════════════════════════════════════════════════════════════╣
║  Message: {Error message}                                   ║
║  Location: {file:line or agent}                             ║
║  Action: {What to do next}                                  ║
╚════════════════════════════════════════════════════════════╝
```

---

## 12. Escalation Notice

**Compact:**
```
⚠ ESCALATION: {reason} -> {target}
```

**Verbose:**
Full box with reason, from, to, and decision-needed fields.

---

## 13. Completion Summary

**Compact** (exactly 2 lines):
```
✓ {agent-name}: {task} ({duration})
  next: {recommended next action}
```

**Verbose:**
Double-border box with agent, task, duration, deliverables, and next action.

---

## 14. Output Modes

All visual output supports an `output_mode` flag:

| Mode | Behavior | Default |
|------|----------|---------|
| `compact` | Single-line per event, no banners, no ASCII art | **Yes** |
| `verbose` | Full banners, ASCII art, status boxes, progress bars | No |

- `compact` is the default. Unknown or undefined values default to compact.
- Errors always use the full box regardless of mode.
- To request verbose: include "verbose" or `output_mode: verbose` in the invocation.

### Status Replacement

Agents replace their previous status output instead of appending. Each status update overwrites the prior one. Errors are the exception — error output is NEVER replaced and always accumulates.

---

## 15. Section Headers

**Compact:** `--- {SECTION TITLE} ---`

**Verbose:** Use the appropriate box style (single-border for agents, double-border for teams/dashboards).

---

## 16. ASCII Progress Patterns (verbose mode)

### CAD Cycle Pipeline

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  TEST   │───▶│  IMPL   │───▶│ VERIFY  │───▶│ REVIEW  │
│   ✓     │    │   ●     │    │   ○     │    │   ○     │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
   done          active        pending        pending
```

Legend: `✓` = done, `●` = active, `○` = pending, `×` = failed

### Agent Delegation Flow

```
           ┌──────────────┐
           │ engineering- │
           │    team      │
           └──────┬───────┘
                  │
     ┌────────────┼────────────┐
     ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌────────┐
│   qa   │  │  dev   │  │ staff- │
│   ✓    │  │   ●    │  │  eng   │
└────────┘  └────────┘  └────────┘
```

### Simple Progress Indicator

```
Progress: [████████░░░░░░░░] 50% (Step 2/4)
```

### Status Summary Box

```
┌─────────────────────────────────────┐
│ WS-16: Token Usage Audit Log        │
├─────────────────────────────────────┤
│ Phase:    complete                  │
│ Tests:    690/690 ✓                 │
│ Coverage: 83%                       │
│ Gate:     ready_for_leadership      │
│ Blocker:  none                      │
└─────────────────────────────────────┘
```

### When to Use ASCII Visuals

In **verbose** mode:
- **Always**: Show CAD cycle progress during `/teo-build` execution
- **Always**: Show dashboard when multiple workstreams active
- **Optional**: Show delegation flow when spawning multiple agents
- **Optional**: Show multi-lens diagram during feature assessments

In **compact** mode: Use the single-line variants defined in their respective sections above.
