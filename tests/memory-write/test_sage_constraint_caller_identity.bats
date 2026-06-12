#!/usr/bin/env bats
# test_sage_constraint_caller_identity.bats
# ws-marker-fix: Tests for teo-sage-constraint.sh caller identity fix (Option B)
#
# Covers 28 test cases:
#   TC-FIX-1..4: Fix-proves-fix (dev caller unblocked)
#   TC-INV1-A..D: Memory protection invariant
#   TC-INV2-A..C: Protected-path routing invariant
#   TC-INV3-A..C: Sage constraint invariant
#   TC-INV4-A..D: Caller-vs-marker distinction invariant
#   TC-INV5-A..E: Git-write protection invariant
#   TC-ORDER-1..5: Hook ordering and interaction
#
# Fix mechanism (Option B): AGENT_IDENTITY_TOKEN env var carries the caller's
# execution_id. The hook reads this env var, looks up the token file at
# .claude/memory/identity-tokens/<exec_id>.json, and reads the role from the
# on-disk file (NOT from the env var directly — spoofability guard).
# CALLER_TOKEN in these tests is an execution_id (e.g. "exec-dev-001").
# The run_hook_* helpers resolve it to the token value from the fixture file.

FIXTURES_DIR="$(dirname "$BATS_TEST_FILENAME")/fixtures"

setup() {
  TEST_ROOT="$(mktemp -d /tmp/bats-sage-constraint-XXXXXX)"
  export TEST_ROOT
  TRACES_DIR="$TEST_ROOT/.claude/memory/traces"
  IDENTITY_TOKENS_DIR="$TEST_ROOT/.claude/memory/identity-tokens"
  export TRACES_DIR
  export IDENTITY_TOKENS_DIR
  mkdir -p "$TRACES_DIR"
  mkdir -p "$IDENTITY_TOKENS_DIR"
  MEMORY_DIR="$TEST_ROOT/.claude/memory/pipeline"
  mkdir -p "$MEMORY_DIR"
  export TEO_PROJECT_ROOT="$TEST_ROOT"
  # Resolve hooks from the real project root (two levels up from tests/memory-write/)
  _PROJ_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
  HOOK="$_PROJ_ROOT/.claude/hooks/teo-sage-constraint.sh"
  GUARD_HOOK="$_PROJ_ROOT/.claude/hooks/pre-edit-write-guard.sh"
  export HOOK GUARD_HOOK
}

teardown() {
  [ -d "$TEST_ROOT" ] && find "$TEST_ROOT" -mindepth 1 -delete 2>/dev/null || true
  rmdir "$TEST_ROOT" 2>/dev/null || true
}

# --- Token management helpers ---

make_sage_token() {
  cp "$FIXTURES_DIR/identity-token-sage.json" \
     "$IDENTITY_TOKENS_DIR/exec-sage-001.json"
}

make_dev_token() {
  cp "$FIXTURES_DIR/identity-token-dev.json" \
     "$IDENTITY_TOKENS_DIR/exec-dev-001.json"
}

make_qa_token() {
  cp "$FIXTURES_DIR/identity-token-qa.json" \
     "$IDENTITY_TOKENS_DIR/exec-qa-001.json"
}

set_sage_active_marker() {
  printf 'exec-sage-001' > "$TRACES_DIR/sage-active-execution-id"
}

set_dev_active_marker() {
  printf 'exec-dev-001' > "$TRACES_DIR/sage-active-execution-id"
}

set_sage_spawned() {
  touch "$TRACES_DIR/sage-spawned"
}

# Hook invocation helpers.
# CALLER_TOKEN: the caller's execution_id (e.g., "exec-dev-001").
# The helper resolves it to the base64url token value for AGENT_IDENTITY_TOKEN.
# This reflects the actual proxy behavior: AGENT_IDENTITY_TOKEN = execution_id
# (the proxy injects the caller's exec-id, not the base64url payload directly).
# The hook reads AGENT_IDENTITY_TOKEN as an exec-id and looks up the token file.

run_hook_write() {
  hook_status=0
  local target="$1"
  printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"test"}}' "$target" \
    | AGENT_IDENTITY_TOKEN="${CALLER_TOKEN:-}" "$HOOK" 2>"$TEST_ROOT/hook_stderr.txt" \
    || hook_status=$?
}

run_hook_edit() {
  hook_status=0
  local target="$1"
  printf '{"tool_name":"Edit","tool_input":{"file_path":"%s","old_string":"old","new_string":"new"}}' "$target" \
    | AGENT_IDENTITY_TOKEN="${CALLER_TOKEN:-}" "$HOOK" 2>"$TEST_ROOT/hook_stderr.txt" \
    || hook_status=$?
}

run_hook_bash() {
  hook_status=0
  local cmd="$1"
  printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$cmd" \
    | AGENT_IDENTITY_TOKEN="${CALLER_TOKEN:-}" "$HOOK" 2>"$TEST_ROOT/hook_stderr.txt" \
    || hook_status=$?
}

run_guard_write() {
  guard_status=0
  local target="$1"
  printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"test"}}' "$target" \
    | TEO_PROJECT_ROOT="$TEST_ROOT" "$GUARD_HOOK" 2>/dev/null \
    || guard_status=$?
}

# =============================================================================
# Part 2 — Fix-Proves-Fix Cases
# =============================================================================

@test "fix_dev_caller_can_write_free_path_when_sage_marker_active" {
  # TC-FIX-1: Dev caller with AGENT_IDENTITY_TOKEN=exec-dev-001, Sage marker active
  # free path → ALLOW. Confirms Blocker A fix: dev identity takes priority over
  # sage-active-execution-id marker.
  make_sage_token
  make_dev_token
  set_sage_active_marker   # marker still points to Sage's exec-id
  set_sage_spawned
  CALLER_TOKEN="exec-dev-001" run_hook_write "$TEST_ROOT/vitest.config.ts"
  [ "$hook_status" -eq 0 ]
}

@test "fix_dev_caller_reaches_guard_for_protected_path" {
  # TC-FIX-2: Constraint hook exits 0 for dev on src/ path.
  # guard (pre-edit-write-guard) fires next and blocks (no bypass).
  # This confirms the constraint hook is no longer the pre-emptive blocker.
  make_sage_token
  make_dev_token
  set_sage_active_marker
  set_sage_spawned
  unset TEO_APPLY_EDIT_BYPASS 2>/dev/null || true
  CALLER_TOKEN="exec-dev-001" run_hook_write "$TEST_ROOT/src/foo.ts"
  [ "$hook_status" -eq 0 ]
  # Note: pre-edit-write-guard would subsequently BLOCK this path (no bypass).
  # This test confirms the constraint hook ALLOWS, giving the guard a chance.
}

@test "fix_sage_spawned_fallback_not_reached_when_dev_execid_present" {
  # TC-FIX-3: dev exec-id in sage-active-execution-id marker, sage-spawned set,
  # NO AGENT_IDENTITY_TOKEN → identity resolved via marker, SAGE-SPAWNED not reached.
  make_dev_token
  set_dev_active_marker    # marker holds dev's exec-id
  set_sage_spawned
  CALLER_TOKEN="" run_hook_write "$TEST_ROOT/package.json"
  [ "$hook_status" -eq 0 ]
}

@test "fix_tests_dir_is_free_path_not_protected" {
  # TC-FIX-4: tests/ is not in PROTECTED_PREFIXES — raw write allowed for dev.
  # Also confirms pre-edit-write-guard would allow (tests/ not in its list).
  make_sage_token
  make_dev_token
  set_sage_active_marker
  set_sage_spawned
  CALLER_TOKEN="exec-dev-001" run_hook_write "$TEST_ROOT/tests/unit/foo.test.ts"
  [ "$hook_status" -eq 0 ]
}

# =============================================================================
# Part 3 — Invariant Tests
# =============================================================================

# --- Invariant 1: Memory protection intact ---

@test "inv1_existing_memory_file_blocked_for_dev_caller" {
  # TC-INV1-A: Memory protection fires BEFORE identity check — blocked unconditionally.
  make_dev_token
  EXISTING="$TEST_ROOT/.claude/memory/pipeline/some-existing-file.json"
  printf '{"x":1}' > "$EXISTING"
  CALLER_TOKEN="exec-dev-001" run_hook_edit "$EXISTING"
  [ "$hook_status" -eq 2 ]
}

@test "inv1_existing_memory_file_blocked_for_sage_caller" {
  # TC-INV1-B: Same — unconditional for all agents including sage.
  make_sage_token
  set_sage_active_marker
  EXISTING="$TEST_ROOT/.claude/memory/pipeline/some-existing-file.json"
  printf '{"x":1}' > "$EXISTING"
  CALLER_TOKEN="exec-sage-001" run_hook_edit "$EXISTING"
  [ "$hook_status" -eq 2 ]
}

@test "inv1_new_memory_file_creation_allowed_for_dev_caller" {
  # TC-INV1-C: New file in memory — allowed (Write for non-existent file).
  make_dev_token
  NEW="$TEST_ROOT/.claude/memory/pipeline/brand-new-file.json"
  [ ! -f "$NEW" ]
  CALLER_TOKEN="exec-dev-001" run_hook_write "$NEW"
  [ "$hook_status" -eq 0 ]
}

@test "inv1_new_memory_file_creation_allowed_for_sage_caller" {
  # TC-INV1-D: New memory file for sage — memory check fires first, exits 0.
  # The sage identity check is never reached (memory branch exits early).
  make_sage_token
  set_sage_active_marker
  NEW="$TEST_ROOT/.claude/memory/go-signals/new-signal.json"
  mkdir -p "$(dirname "$NEW")"
  [ ! -f "$NEW" ]
  CALLER_TOKEN="exec-sage-001" run_hook_write "$NEW"
  [ "$hook_status" -eq 0 ]
}

# --- Invariant 2: Protected-path routing intact ---

@test "inv2_raw_write_to_src_blocked_for_dev_caller_no_bypass" {
  # TC-INV2-A: Constraint ALLOWS dev; guard BLOCKS without bypass (end-to-end).
  # After fix: constraint hook no longer pre-empts the guard for dev callers.
  make_sage_token
  make_dev_token
  set_sage_active_marker
  set_sage_spawned
  unset TEO_APPLY_EDIT_BYPASS 2>/dev/null || true
  CALLER_TOKEN="exec-dev-001" run_hook_write "$TEST_ROOT/src/index.ts"
  [ "$hook_status" -eq 0 ]  # constraint hook allows dev
  unset TEO_APPLY_EDIT_BYPASS 2>/dev/null || true
  run_guard_write "$TEST_ROOT/src/index.ts"
  [ "$guard_status" -eq 2 ]  # guard hook blocks (no bypass)
}

@test "inv2_raw_write_to_hooks_blocked_for_dev_caller_no_bypass" {
  # TC-INV2-B: Same for .claude/hooks/ path.
  make_sage_token
  make_dev_token
  set_sage_active_marker
  set_sage_spawned
  unset TEO_APPLY_EDIT_BYPASS 2>/dev/null || true
  CALLER_TOKEN="exec-dev-001" run_hook_write "$TEST_ROOT/.claude/hooks/some-hook.sh"
  [ "$hook_status" -eq 0 ]
  unset TEO_APPLY_EDIT_BYPASS 2>/dev/null || true
  run_guard_write "$TEST_ROOT/.claude/hooks/some-hook.sh"
  [ "$guard_status" -eq 2 ]
}

@test "inv2_dev_with_valid_bypass_allowed_to_protected_path" {
  # TC-INV2-C: Full teo-apply-edit path — both hooks pass.
  make_dev_token
  set_sage_active_marker
  set_sage_spawned
  CALLER_TOKEN="exec-dev-001" run_hook_write "$TEST_ROOT/src/index.ts"
  [ "$hook_status" -eq 0 ]
  TEO_APPLY_EDIT_BYPASS="teo-ae-12345-67890" run_guard_write "$TEST_ROOT/src/index.ts"
  [ "$guard_status" -eq 0 ]
}

# --- Invariant 3: Sage's own constraint intact ---

@test "inv3_sage_blocked_on_free_path_by_identity_token" {
  # TC-INV3-A: Sage blocked on free path (not in pre-edit-write-guard list).
  # The identity check confirms role=sage → deny.
  make_sage_token
  set_sage_active_marker
  CALLER_TOKEN="exec-sage-001" run_hook_write "$TEST_ROOT/vitest.config.ts"
  [ "$hook_status" -eq 2 ]
}

@test "inv3_sage_blocked_on_protected_path" {
  # TC-INV3-B: Sage blocked on protected path (double enforcement).
  # Constraint hook blocks before guard even runs.
  make_sage_token
  set_sage_active_marker
  CALLER_TOKEN="exec-sage-001" run_hook_write "$TEST_ROOT/src/foo.ts"
  [ "$hook_status" -eq 2 ]
}

@test "inv3_sage_mode_main_blocks_sage_direct_session" {
  # TC-INV3-C: Mode A install — sage-mode-main marker blocks directly.
  touch "$TRACES_DIR/sage-mode-main"
  CALLER_TOKEN="" run_hook_write "$TEST_ROOT/vitest.config.ts"
  [ "$hook_status" -eq 2 ]
}

# --- Invariant 4: Caller-vs-marker distinction ---

@test "inv4_marker_sage_caller_dev_free_path_allowed" {
  # TC-INV4-A: Core invariant — marker=sage, caller=dev (via AGENT_IDENTITY_TOKEN)
  # → ALLOW on free path. This directly proves the caller-vs-marker distinction.
  make_sage_token
  make_dev_token
  set_sage_active_marker   # marker still holds Sage's exec-id
  set_sage_spawned
  CALLER_TOKEN="exec-dev-001" run_hook_write "$TEST_ROOT/package.json"
  [ "$hook_status" -eq 0 ]
}

@test "inv4_marker_sage_caller_sage_denied" {
  # TC-INV4-B: marker=sage, caller=sage (AGENT_IDENTITY_TOKEN also sage) → DENY.
  make_sage_token
  set_sage_active_marker
  CALLER_TOKEN="exec-sage-001" run_hook_write "$TEST_ROOT/package.json"
  [ "$hook_status" -eq 2 ]
}

@test "inv4_marker_dev_caller_dev_allowed" {
  # TC-INV4-C: No sage session at all — baseline non-sage case.
  # No sage-spawned, no sage-active-execution-id, no sage-mode-main.
  make_dev_token
  CALLER_TOKEN="exec-dev-001" run_hook_write "$TEST_ROOT/package.json"
  [ "$hook_status" -eq 0 ]
}

@test "inv4_missing_token_file_fails_open" {
  # TC-INV4-D: Missing token file → fail-open (ALLOW + warn to stderr).
  # U-2 directive: legitimate callers must not be permanently blocked.
  printf 'exec-ghost-001' > "$TRACES_DIR/sage-active-execution-id"
  # No token file for exec-ghost-001 exists in IDENTITY_TOKENS_DIR
  CALLER_TOKEN="" run_hook_write "$TEST_ROOT/package.json"
  [ "$hook_status" -eq 0 ]
  grep -q "WARNING\|token file missing\|Failing open" "$TEST_ROOT/hook_stderr.txt"
}

# --- Invariant 5: Git-write / rogue-commit protections intact ---

@test "inv5_git_commit_blocked_when_sage_teammate_active" {
  # TC-INV5-A: sage-teammate-active marker → git commit blocked.
  touch "$TRACES_DIR/sage-teammate-active"
  CALLER_TOKEN="" run_hook_bash "git commit -m message"
  [ "$hook_status" -eq 2 ]
}

@test "inv5_git_push_blocked_when_sage_teammate_active" {
  # TC-INV5-B: sage-teammate-active marker → git push blocked.
  touch "$TRACES_DIR/sage-teammate-active"
  CALLER_TOKEN="" run_hook_bash "git push origin main"
  [ "$hook_status" -eq 2 ]
}

@test "inv5_git_status_allowed_when_sage_teammate_active" {
  # TC-INV5-C: Read-only git passes through even when sage-teammate-active.
  touch "$TRACES_DIR/sage-teammate-active"
  CALLER_TOKEN="" run_hook_bash "git status"
  [ "$hook_status" -eq 0 ]
}

@test "inv5_git_commit_blocked_dev_caller_sage_teammate_active" {
  # TC-INV5-D: Identity-token fix does NOT create a git-write exception.
  # git-write block is independent of caller identity — applies to ALL agents.
  make_dev_token
  touch "$TRACES_DIR/sage-teammate-active"
  CALLER_TOKEN="exec-dev-001" run_hook_bash "git commit -m message"
  [ "$hook_status" -eq 2 ]
}

@test "inv5_edit_write_not_affected_by_sage_teammate_active_alone" {
  # TC-INV5-E: sage-teammate-active does NOT affect Edit/Write path.
  # The Bash/sage-teammate branch exits early (Bash-only). Edit/Write
  # falls through to identity check, which has nothing to block here.
  touch "$TRACES_DIR/sage-teammate-active"
  # No sage-spawned, no exec-id, no sage-mode-main
  CALLER_TOKEN="" run_hook_write "$TEST_ROOT/package.json"
  [ "$hook_status" -eq 0 ]
}

# =============================================================================
# Part 4 — Hook Ordering and Interaction Cases
# =============================================================================

@test "ordering_constraint_hook_fires_before_guard" {
  # TC-ORDER-1: Sage caller blocked at constraint hook.
  # The guard (pre-edit-write-guard) never reaches sage callers.
  # The ordering: constraint fires first (exit 2), guard never runs.
  make_sage_token
  set_sage_active_marker
  CALLER_TOKEN="exec-sage-001" run_hook_write "$TEST_ROOT/src/foo.ts"
  [ "$hook_status" -eq 2 ]
}

@test "ordering_dev_with_bypass_passes_both_hooks" {
  # TC-ORDER-2: Both hooks pass for dev with valid bypass token.
  make_dev_token
  set_sage_active_marker
  set_sage_spawned
  CALLER_TOKEN="exec-dev-001" run_hook_write "$TEST_ROOT/src/index.ts"
  [ "$hook_status" -eq 0 ]
  TEO_APPLY_EDIT_BYPASS="teo-ae-12345-67890" run_guard_write "$TEST_ROOT/src/index.ts"
  [ "$guard_status" -eq 0 ]
}

@test "ordering_constraint_allow_does_not_bypass_guard_for_protected_path" {
  # TC-ORDER-3: Constraint ALLOW for dev does NOT bypass guard for docs/ path.
  # Fix proves dev can reach the guard, but guard still enforces bypass requirement.
  make_dev_token
  set_sage_active_marker
  unset TEO_APPLY_EDIT_BYPASS 2>/dev/null || true
  CALLER_TOKEN="exec-dev-001" run_hook_write "$TEST_ROOT/docs/adr/ADR-001.md"
  [ "$hook_status" -eq 0 ]  # constraint allows dev
  unset TEO_APPLY_EDIT_BYPASS 2>/dev/null || true
  run_guard_write "$TEST_ROOT/docs/adr/ADR-001.md"
  [ "$guard_status" -eq 2 ]  # guard blocks (no bypass)
}

@test "ordering_sage_spawned_fallback_not_reached_when_dev_execid_resolves" {
  # TC-ORDER-4: dev exec-id in marker + sage-spawned set → resolved identity
  # exits early; SAGE-SPAWNED fallback block at end is never reached.
  make_dev_token
  set_dev_active_marker    # marker holds dev's exec-id
  set_sage_spawned
  CALLER_TOKEN="" run_hook_write "$TEST_ROOT/package.json"
  [ "$hook_status" -eq 0 ]
}

@test "ordering_sage_spawned_fallback_fires_when_execid_absent" {
  # TC-ORDER-5: SAGE-SPAWNED blocks when NO exec-id AND NO AGENT_IDENTITY_TOKEN.
  # Safe default: cannot identify caller + sage-spawned present → block.
  # This confirms Blocker B is preserved as the last-resort safe default
  # when all identity resolution paths fail.
  set_sage_spawned
  [ ! -f "$TRACES_DIR/sage-active-execution-id" ]
  CALLER_TOKEN="" run_hook_write "$TEST_ROOT/package.json"
  [ "$hook_status" -eq 2 ]
}
