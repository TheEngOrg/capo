# Brownfield Project Context Template

<!-- Copy this template to .claude/memory/project-context-{initiative}.md for brownfield migration engagements. -->
<!-- Remove comment lines before saving the populated file. -->

---
template: project-context-brownfield
version: "1.0.0"
created: <!-- ISO-8601 date -->
initiative: <!-- workstream or engagement ID -->
---

## Migration Overview

**migration_source:** <!-- e.g. "Rails 5.2 monolith on Heroku", "Java Spring Boot 2.x on-prem" -->

**migration_target:** <!-- e.g. "Next.js + Supabase on Vercel", "Go microservices on GKE" -->

**current_percent_migrated:** <!-- 0-100%, or "unknown" if not assessed -->

**migration_phase:** <!-- e.g. "not started", "discovery", "in progress", "cutover pending", "complete" -->

## Current State

**source_system_summary:** |
  <!-- 2-5 sentences describing the source system's architecture, key dependencies,
  and known pain points. Include: language/framework versions, database, auth system,
  external integrations, estimated code volume. -->

**what_already_exists:** |
  <!-- Any prior migration work: partial rewrites, adapters, dual-write paths,
  migrated services. Be specific — "auth service migrated, user profile still on old stack". -->

**attempts_so_far:** |
  <!-- Previous migration attempts, why they stalled or failed, lessons learned.
  "None" is a valid answer. Include dates if known. -->

## Known Blockers

**known_blockers:**
  - <!-- blocker 1: e.g. "No test coverage on legacy billing module — can't validate parity" -->
  - <!-- blocker 2: e.g. "Third-party vendor API only supports old auth scheme" -->
  - <!-- Add as many as known. Remove placeholder lines if none. -->

**undocumented_behavior:** |
  <!-- Areas where legacy behavior is not documented and must be reverse-engineered.
  These are migration risk multipliers. -->

## Success Definition

**partner_definition_of_done:** |
  <!-- What does the partner consider "migration complete"? Verbatim if possible.
  e.g. "All user traffic on new stack, old infra decommissioned, < 0.1% error rate" -->

**deadline_context:** |
  <!-- Is there a hard deadline? What drives it? (contract, compliance, cost, customer commitment)
  "None stated" is valid. -->

**acceptable_interim_state:** |
  <!-- Is a partial migration acceptable for any phase? e.g. "Read path migrated, write path
  dual-write for 6 months is OK" -->

## Session Progress

**session_accomplishments:**
  - <!-- Populated by Capo at end of each session -->

**open_decisions:**
  - <!-- Decisions that have been deferred or need partner input -->

**last_updated:** <!-- ISO-8601 datetime -->
**updated_by:** <!-- capo / workstream-{id} -->
