<!--
  Copyright (c) 2026 Wonton Web Works LLC. All rights reserved.
  Licensed under the TheEngOrg Enterprise License Agreement.
  See LICENSE.enterprise for terms.
-->
# Visual Formatting Protocol

**Owner:** TheEngOrg Enterprise (TEO)
**Version:** 2.0.0
**Scope:** All agents, skills, and orchestrators in TEO

This is the canonical visual output specification for the framework. All agents and skills reference this document — they do not duplicate it.

---

## 1. ANSI Color Definitions

Terminal color codes for agent categories, status indicators, and UI elements. Derived from the brand palette in `site/src/styles/tokens.css`.

```
# Agent Category Colors
GOLD='\033[0;33m'       # LEAD agents — warm authority
BLUE='\033[0;34m'       # ENG agents — technical trust
GREEN='\033[0;32m'      # QA agents — quality assurance
PURPLE='\033[0;35m'     # CREATE agents — creative output
GRAY='\033[0;90m'       # COORD agents — coordination
INDIGO='\033[0;94m'     # SAGE — orchestrator (TEO-only)
RED='\033[0;31m'        # COMPLIANCE — enforcement (TEO-only)

# Status Colors
GREEN_BRIGHT='\033[1;32m'   # Pass / success
RED_BRIGHT='\033[1;31m'     # Fail / error / block
YELLOW_BRIGHT='\033[1;33m'  # Warning / attention
CYAN='\033[0;36m'           # Info / in-progress
DIM='\033[2m'               # Muted / pending

# Brand Accent (terminal approximations of site tokens)
GUAC='\033[38;5;65m'        # --mg-guac #4A7C59
CILANTRO='\033[38;5;30m'    # --mg-cilantro #2E8B8B
CHILI='\033[38;5;167m'      # --mg-chili #C94D3A
LIME='\033[38;5;214m'       # --mg-lime #F9A825
LIME_ZEST='\033[38;5;190m'  # --mg-lime-zest #D4FF00

# Reset
NC='\033[0m'                # No color — always terminate color sequences
```

**Rule:** Every color sequence MUST be terminated with `NC` (`\033[0m`). Unterminated colors bleed into subsequent output.

---

## 2. Session Banner

Displayed at the start of every Sage session and every `/teo` invocation. This is the first thing the user sees.

```
╔══════════════════════════════════════════════════════════════╗
║  🧘 TheEngOrg Enterprise v2.0.0                             ║
║  📦 Project: {project-name}                                  ║
║  🔧 TEO Base: {teo-version} | Sage: Active                  ║
╚══════════════════════════════════════════════════════════════╝
```

**Field resolution:**
- `{project-name}` — directory name from `basename $(pwd)`
- `{teo-version}` — from `team-config.yaml` field `version`
- Version `v2.0.0` — TEO release version, hardcoded until dynamic versioning lands

**When to display:**
- At Sage session start (after intake, before pipeline)
- At `/teo` skill invocation start
- NOT on sub-agent spawns (only the orchestrator shows the banner)

---

## 3. Agent Badge Identity System

All agents are assigned a colored badge based on their category. Badges appear in all output modes.

### Badge Table (Canonical)

| Badge | Category | Color | Agents |
|-------|----------|-------|--------|
| 🟡 [LEAD] | Leadership | GOLD `\033[0;33m` | ceo, cto, engineering-director, product-owner |
| 🔵 [ENG] | Engineering | BLUE `\033[0;34m` | dev, staff-engineer, devops-engineer, data-engineer, deployment-engineer |
| 🟢 [QA] | Quality | GREEN `\033[0;32m` | qa, security-engineer |
| 🟣 [CREATE] | Creative | PURPLE `\033[0;35m` | design, art-director, copywriter, ai-artist, technical-writer, studio-director |
| ⚪ [COORD] | Coordination | GRAY `\033[0;90m` | supervisor, engineering-manager, product-manager, api-designer |
| 🔮 [SAGE] | Orchestrator | INDIGO `\033[0;94m` | sage |
| 🛡️ [COMPLIANCE] | Enforcement | RED `\033[0;31m` | compliance-officer, legal-counsel |

**TEO-only badges:** SAGE and COMPLIANCE are enterprise-only. MG community edition does not define or use these badges.

### Badge Format

**Compact mode** (single line):
```
{emoji} [{CATEGORY}] {agent-name}: {action} ({duration})
```

Examples:
```
🔵 [ENG] dev: implement auth endpoint (120s)
🟢 [QA] qa: 28 tests created (31s)
🔮 [SAGE] sage: pipeline PLAN composed (2s)
🛡️ [COMPLIANCE] compliance-officer: GDPR review pass (45s)
```

**Verbose mode** (banner):
```
┌──────────────────────────────────────────────────────────────────┐
│  {emoji} AGENT: {Agent Name}                                      │
│  📋 TASK: {Brief task description}                                │
│  ⏱️  STATUS: {Starting | In Progress | Complete}                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Status Icons

| Icon | Meaning | ANSI Color |
|------|---------|------------|
| ✅ | Complete / Pass | GREEN_BRIGHT |
| ❌ | Failed / Error | RED_BRIGHT |
| ⚠️ | Warning / Attention | YELLOW_BRIGHT |
| 🔄 | In Progress | CYAN |
| ⏳ | Pending / Waiting | DIM |
| 🚫 | Blocked | RED_BRIGHT |
| ⏭️ | Skipped | DIM |

---

---

## 5. Pipeline Progress

Displayed by the Sage after each pipeline step completes. Shows the full pipeline with current position.

```
🔮 [SAGE] Pipeline: {INTENT}
  ├─ ✅ Step 1: teo-assess (complete)
  ├─ ✅ Step 2: teo-spec (complete)
  ├─ 🔄 Step 3: teo-leadership-team (in progress)
  └─ ⏳ Step 4: teo-build (pending)
```

For verbose pipeline format with progress bars — see `visual-formatting-templates.md` section 5.

---

## 6. Gate Results

Displayed inline after gate evaluation. Color-coded by verdict.

```
gate:{Gate Name} {PASS|WARN|FAIL} {details}
```

### Gate Color Coding

| Verdict | Color | Icon |
|---------|-------|------|
| PASS | GREEN_BRIGHT | ✅ |
| WARN | YELLOW_BRIGHT | ⚠️ |
| FAIL / BLOCK | RED_BRIGHT | ❌ |
| SKIPPED | DIM | ⏭️ |

For verbose gate format with full box — see `visual-formatting-templates.md` section 6.

---

## 7. Process Flow Progress

Displayed when a registered process flow is active. Shows phase completion.

```
📋 Process: {flow-name} — Phase {n}/{total}: {phase-name} {status-icon}
```

Example:
```
📋 Process: code-change — Phase 2/4: build 🔄
```

For verbose flow format — see `visual-formatting-templates.md` section 7.

---

For agent spawning, team banners, workstream boards, error display, escalation, completion summary, output modes, section headers, and ASCII art patterns — see `visual-formatting-templates.md` (sections 8–16).

---


## Version History

**Version 2.0.0** (2026-03-26)
- Transferred ownership from MG to TEO
- Added ANSI color definitions with brand palette alignment
- Added session banner specification
- Added TEO-only badges: SAGE (indigo) and COMPLIANCE (red)
- Added pipeline progress visualization
- Added gate result color coding
- Added process flow progress display
- Added agent spawning color-coded prefixes
- Consolidated as single source of truth — all agents and skills reference this document

**Version 1.0.0** (2026-03-04)
- Initial MG community version
- Basic badge system, output modes, ASCII art patterns
