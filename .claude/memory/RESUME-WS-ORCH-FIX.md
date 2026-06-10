# RESUME — WS-ORCH-FIX (checkpoint 2026-06-10)

**Goal of current push:** Finish + commit WS-ORCH-FIX to a clean green committed baseline, THEN start M3 (real LLM dispatch — the MVP). User chose: finish+commit WS-ORCH-FIX FIRST, then M3.

## Current state (verified from disk)
- `tests/memory-write/` suite is RED: **79/87** (8 failures).
- Working tree is DIRTY and UNCOMMITTED: ~30 modified tracked files (agents, hooks, settings.json, ADR-0005, SPIKE-001) + untracked (mg-memory-* scripts, tests/, research-mvp-gap-*.md, go-signals, ws-orch-fix-lessons.md). None of WS-ORCH-FIX is committed.
- `v0.1.0` already tagged at commit 1ce4c0c. HEAD is 16e0b02.
- `sage-result.json` is STALE (describes old M1 work) — rebuild from this doc.

## The 8 failing tests — two independent causes
**Cause A — Block-B corruption (6 tests):** tests 2, 41, 42, 43, 45, 46.
`.claude/scripts/mg-memory-patch-section` has dead "Block B" = lines **221-241** (a duplicate `if [[ "$INSERT_IF_MISSING" == "true" ]]; then` block with empty bodies) + a stray `else` at 242. A prior cleanup spawn hollowed it into BROKEN BASH SYNTAX.

**Cause B — hook phantom-citation (2 tests):** tests 18, 20.
`.claude/hooks/teo-sage-constraint.sh` (~line 136) error message cites `teo-memory-patch-section, teo-memory-append, teo-memory-write, teo-memory-read` — but the real scripts are `mg-memory-*`. One-line fix: change the cited names to `mg-memory-*`.

## THE EXACT FIX for Cause A (fully specified, byte-verified)
In `.claude/scripts/mg-memory-patch-section`, the region between two UNIQUE anchors must be corrected:
- start_anchor (UNIQUE, ~line 215): `    _MG_PS_DEDUPE=true`
- end_anchor (UNIQUE, ~line 243): `# Replace the existing section using awk  # DEBUGMARK`
- The interior strictly between them is lines 216-242. Lines **216-220 are VALID and MUST SURVIVE**; lines **221-242 are DEAD and must be deleted**.
- After the fix, the region from `_MG_PS_DEDUPE=true` to the DEBUGMARK line must read:
```
    _MG_PS_DEDUPE=true
  else
    printf 'ERROR: anchor not found — section "%s" not in %s (use --insert-if-missing to append)\n' "$FULL_HEADER" "$TARGET" >&2
    write_audit "refused" "anchor-not-found"
    exit 1
  fi
else
# Replace the existing section using awk
```
(i.e. survivors 216-220 = the inner-block `else`/printf/write_audit/`exit 1`/`fi` that closes the `if INSERT_IF_MISSING` at line 191; then the outer `else` at 242; then the awk comment with `# DEBUGMARK` stripped.)
**Verify line numbers against disk before editing — they may shift.** Confirm with `bats tests/memory-write/` → expect 87/87 after both A and B fixes.

## How the user decided to fix it
User chose **Option 2**: build a permanent `replace-range` op into `.claude/scripts/teo-apply-edit` (current anchor matcher is `grep -cF` = single-line only; no multi-line/delete-range; that's why Block B couldn't be cleanly removed). Then use `replace-range` to delete Block B.
- qa-spec for the op is ON DISK: `.claude/memory/pipeline/ws-orch-fix-teo-apply-edit-range-op-qa-spec.md` (21 bats tests planned for `tests/memory-write/test_teo_apply_edit_range_op.bats`).
- **KNOWN SPEC BUG:** §3's acceptance-test `content` field says `""` (empty) — that is WRONG (would delete the valid survivors 216-220). The correct `content` is the survivor lines above. The spec-.md correction is currently DEADLOCKED (see below) — but the build can proceed carrying the correct content in the dev prompt.

## The tooling deadlock that forced the checkpoint (verified from source)
Correcting §3 of the spec .md is blocked because NO sanctioned tool can write multiline/metacharacter content to a `.claude/memory/` .md section:
- `mg-memory-patch-section` (section-replace): `--content` INLINE ONLY (no `--content-file`/stdin); survivor content has metacharacters (`>` `$` `(` `)` quotes) the Bash arg-validator blocks.
- `mg-memory-append`: HAS `--content-file` but append-only (can't section-replace).
- `mg-memory-write`: JSON-field only (wrong for .md).
- `teo-apply-edit`: allowlist EXCLUDES `.claude/memory/` (lines ~67-77) — can't write memory files.
- direct Edit/Write: blocked by `teo-sage-constraint.sh`.
**Cleanest unblock (qa + Sage recommendation): add `--content-file` to `mg-memory-patch-section`** (copy the pattern from `mg-memory-append` lines ~169-171). Small, targeted. This is its own qa→dev→review mini-build, OR fold it into the replace-range build.

## RESUME SEQUENCE (in order)
1. Decide write-path: simplest is to do the Block-B fix + hook co-fix directly (fresh session, healthy infra) OR proceed the Option-2 `replace-range` build. The actual edits (A + B) are tiny and fully specified above — a healthy session can apply them in minutes.
2. Get `bats tests/memory-write/` to **87/87** (fix A + B).
3. Held follow-on sequence (uses the now-green memory tooling):
   a. Register `pre-bash-write-guard.sh` in `.claude/settings.json` via `mg-memory-settings-insert` → ACTIVATES the security fix (the bash-write guard built earlier, 40/40, currently INACTIVE/unregistered).
   b. Apply D2 #47898 revert: `model_inheritance_fixed → false` in `.claude/memory/pipeline/team-mode-prereqs.json` via `mg-memory-write`; annotate `.claude/memory/pipeline/cto-d2-47898-ruling-2026-04-29.md` (status → runtime-pending). (User ruled HOLD-at-false until A2A ships.)
   c. Finish Phase 0 Item 4 (phantom citations in sage/agent.md lines ~293/319) + tooling repairs.
4. Final security-engineer re-review: confirm cp/mv/tee to REAL protected prefixes BLOCKs with the guard ACTIVE (cp-to-memory STAYS allowed per the test-17 ruling — memory is not a protected prefix).
5. COMMIT via deployment-engineer (COMMIT_DIRECTIVE) — FIRST reconcile commit scope: the ~30 modified tracked files (agents/hooks/settings) may be framework-upgrade changes unrelated to WS-ORCH-FIX; surface to user before committing.
6. THEN start M3 (real LLM dispatch) on the clean baseline.

## Key artifacts on disk
- Overall spec: `.claude/memory/pipeline/ws-orch-fix-reconciled-proposal.md`
- Memory-tooling acceptance: `.claude/memory/pipeline/ws-orch-fix-memory-write-tooling-qa-spec.md`
- Range-op spec (has the known content:"" bug): `.claude/memory/pipeline/ws-orch-fix-teo-apply-edit-range-op-qa-spec.md`
- Lessons: `.claude/memory/ws-orch-fix-lessons.md` (L-1 unverified-claim, L-2 right-sizing; append the two new lessons below)
- Built+reviewed (DONE): `.claude/hooks/teo-claim-evidence-gate.sh` (46/46), `.claude/hooks/pre-bash-write-guard.sh` (40/40, INACTIVE pending registration), the 5 `mg-memory-*` scripts (passed both reviews at 86/87 before the Block-B regression).

## Lessons to append to ws-orch-fix-lessons.md (deferred — append-able via mg-memory-append --content-file)
- L-3: qa-spec asserted `content: ""` without checking the interior had must-survive lines (designed→done / L-1 class). The dev's boundary read-and-compare caught it via stop-and-report. The system caught its own designed→done bug.
- L-4: the memory tooling can't carry multiline/special-char content for a SECTION REPLACE — `mg-memory-patch-section` lacks `--content-file`. This is the same capability gap `replace-range` targets, surfacing one level up at the spec-correction layer. Concrete missing primitive: `--content-file` on `mg-memory-patch-section`.
- META: the right-sized, hard-capped, stop-and-report spawns SUCCEEDED and caught real bugs; the large uncapped spawns (197, 287 calls) FAILED/regressed. Right-sizing is the load-bearing fix.
