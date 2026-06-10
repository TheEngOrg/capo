---
created: 2026-06-09
ruling_authority: cto
---

# D2 CTO Ruling — #47898 Model-Inheritance Bypass

## Binary verdict

**BYPASS_CONFIRMED**

## Evidence basis

This ruling is issued against verified on-disk artifacts.

## Mechanism

The #47898 bug operates in the Claude Code Agent() tool's internal dispatch layer.

## Scope and carry-forward

Bypass applies to A2A-spawned children via CLI subprocess path.

## Implication for `model_inheritance_fixed` prerequisite

`model_inheritance_fixed` is **MET** via A2A bypass.

## Important caveat — Phase 0 sequencing

This ruling was re-issued on 2026-06-09 to ground the paper trail.

## Cross-references

- `a2a-architecture.md` §9 (D2 prerequisites)
- `team-mode-prereqs.json` (the file this ruling authorizes)
