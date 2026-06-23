# TEO — Session Handoff (2026-06-21)

Single source for picking this work back up. Reflects state at end of the 2026-06-20/21 session.
Durable decisions live in agent memory (`~/.claude/projects/.../memory/`); this is the operational summary.

---

## TL;DR — where things stand

- **Phase 1 (engineering core): COMPLETE**, merged to main.
- **GO roadmap (alpha launch): 3 of 5 done.** GO-01 (ledger), GO-02 (plugin), GO-04 (acceptance harness) merged. GO-03 (integrity hook) + GO-06 (docs) + GO-07 (release tag) remain.
- **The plugin is genuinely installable** — proven by a real `claude plugin install` (18 skills, 10 hook scripts / 9 actively registered in hooks.json; `teo-post-spawn-citation-check.sh` present but pending Component C gate before registration). A blocker bug was found via dogfooding and fixed (PR #31, awaiting merge).
- **Two big initiatives planned but NOT built** (build later): the C-suite roster rename, and the marketing-site rewrite.

---

## OPEN — needs the user (Brodie)

| # | Item | Action |
|---|------|--------|
| 1 | **PR #31** (eng repo, `fix/plugin-manifest-paths`) | CI GREEN, OPEN — **merge it.** Makes the plugin actually installable (`../`→`./` + agents-array + marketplace `./` source + the `verify-plugin-install.sh` gate + M-02 CI-skip). |
| 2 | **Marketing PR #3** (`TheEngOrg/teo-marketing-site`) | OPEN — merge. Unbreaks the Lighthouse CI job (config typo + `continue-on-error`). |
| 3 | **theengorg.com 403** | Serving-layer, NOT code. Cloudflare Bot Fight Mode and/or Hetzner+Caddy origin reachability. Needs the Cloudflare dashboard — only Brodie can do this. (The SEO fix already merged + deployed; the 403 still gates public access.) |
| 4 | **Confirm rename names + depth** at build time | Names proposed (below); depth DECIDED = full rename. Confirm the 4 task-type+level labels when building. |

---

## DONE this session (merged to main, eng repo)

- **Phase 1:** WS-P1-05 spawnAgent + parseVerdict refactor (#20), vitest-4 bump + coverage fix (#22), run-plan/#21, gate run-plan coverage (#23), zero-footprint CI gate (#24), bootstrap provisioner WS-P1-04 (#25), skill file WS-P1-08 (#26).
- **GO-01** ledger + HMAC signer wired into runPlan, `StepResult.signature` (#28).
- **GO-02** plugin packaging — `.claude-plugin/`, `bin/teo-run.js` (esbuild), `host.ts` discovery seam, provision() role-shift, fail-open revocation (#29).
- **GO-04** in-session acceptance harness — asserts signed ledger written + HMAC verifies + adversarial cases (#30).
- **Marketing:** SEO fix (sitemap/robots → theengorg.com + real routes) merged + deployed live (PR #2).

---

## PLANNED but NOT built (execute in a future session)

Both are fully scoped in memory: `teo-roster-rename-and-site-rewrite.md`.

### Initiative A — C-suite roster rename (ENGINE repo, do FIRST)
- **Decision: FULL rename (depth b), across the board.** Names (confirm at build):
  - ceo → **Strategic Direction · L8**
  - cto → **Architecture Review · L7**
  - cmo → **Go-to-Market Strategy · L6**
  - cfo → **Cost & ROI Analysis · L6**
  - (eng/function roles keep names; Sage stays Sage)
- **Scope: 30 files, ZERO src/, ZERO tests.** Watch-outs: the `.claude/agents/` MIRROR (every file twice); functional spawn wiring (`subagent_type: cto/ceo` in 3 skills, `Task(cto,...)` in ceo/agent.md, Sage roster table, plugin.json agents-array) — miss one → silent runtime "unknown agent" failure. Re-run `scripts/verify-plugin-install.sh` after (plugin.json changed).
- **Execution: ~2 CAD workstreams.** Phase 1 agents+plugin.json (both trees) → Phase 2 skills subagent_type → Phase 3 real-install gate before any tag.

### Initiative B — Marketing site rewrite (`TheEngOrg/teo-marketing-site`, AFTER A)
- **OSS-tool homepage**, no sales motion. DELETE `/cto`, `/investor`, `/pilot` + `src/data/funds/`.
- Positioning: deterministic orchestration → CONFIDENCE/TRUST. Hero: *"Your agents are working. Do you know what they're doing?"* Plugin-led, value-first.
- Keep Capy/Sage branding + interactions. Evolve TerminalAnimation to a real `/teo` run + a signed-LEDGER line. New "Ledger Proof Visualizer" widget.
- Semantic tokens (`--mg-*` → `--teo-primary/secondary/accent/warn/...`). Roles shown as levels (per A). Buy-me-a-coffee / GitHub Sponsors as the only ask.
- **Open sub-decisions:** which roles to feature (team leans eng-only); buy-me-a-coffee provider; plugin-install repo slug (placeholder until GO-07 public cutover); keep/drop the changelog section.
- The CMO produced a detailed direction doc (in the Sage task transcript) — re-surface it for approval before building B.

---

## Remaining GO roadmap (after PR #31 merges)

`teo-roadmap-to-go.md`. Order: GO-03 → GO-06 → GO-07.
- **GO-03** session-start integrity hook (Claude Code only for alpha). Depends on the WS-P1-11 manifest design.
- **GO-06** user docs (README / Getting Started / How It Works / What It Does NOT Do) — **COMPLETE via WS-DOCS-01.**
- **GO-07** alpha release gate — **HARD GATE:** swap marketplace.json source `./`→github, run `scripts/verify-plugin-install.sh` ✔ PASS, then tag `v0.1.0-alpha`. Skipping the gate recreates the GO-02 regression.

---

## Hard-won rules from this session (in memory, apply going forward)

- **Verify the REAL external check, not the green proxy.** `claude plugin validate` lied (install is stricter). "Passes locally" lied (CI env differs). CI-green-without-push lied (commit wasn't pushed). The bar is always the real thing: real install, real CI run on the actual pushed commit.
- **A PR isn't done until CI is green on the pushed commit** — verify `git log origin/<branch>..HEAD` is empty, then poll `gh pr checks`.
- **TEO runs in-session, no API key** — sagePlan/spawnAgent use the host session's Task mechanism, not a subprocess. The MCP-orchestrator path is forward-compat (discovery seam) but blocked today (sampling unsupported on 3/4 runtimes).

---

## Notes / loose ends

- `wonton-web-works/theengorg-marketing` (duplicate marketing repo) was DELETED by Brodie. `TheEngOrg/teo-marketing-site` is canonical.
- PR #27 (subprocess live-test harness) is PARKED as a draft — daemon-mode (Phase 4) scaffolding, not the Phase-1 path.
- The TEO plugin is currently installed in Brodie's user scope (from tonight's dogfood) — `/teo:teo` works.
