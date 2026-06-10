#!/usr/bin/env bats
# test_path_safety.bats — Surface 3: path validation for all tools
# WS-ORCH-FIX memory-write tooling QA spec Section 2

setup() {
  TEST_ROOT="$BATS_TMPDIR/test-root-$$"
  mkdir -p "$TEST_ROOT/.claude/memory/pipeline"
  mkdir -p "$TEST_ROOT/.claude/memory/traces"
  mkdir -p "$TEST_ROOT/.claude/scripts"
  export TEO_PROJECT_ROOT="$TEST_ROOT"
  export TEO_AUDIT_DIR="$BATS_TMPDIR/audit-$$"
  mkdir -p "$TEO_AUDIT_DIR"

  # Create a valid target file for write tests
  echo '{"status":"ok","data":"test"}' > "$TEST_ROOT/.claude/memory/pipeline/target.json"
  echo "# Test MD" > "$TEST_ROOT/.claude/memory/pipeline/target.md"

  # Copy malformed json fixture
  cp "$BATS_TEST_DIRNAME/fixtures/malformed.json" \
     "$TEST_ROOT/.claude/memory/pipeline/malformed.json"

  # Create symlink target in tmp
  echo '{"symlink":"target"}' > "/tmp/symlink-target-$$.json"
  ln -s "/tmp/symlink-target-$$.json" \
     "$TEST_ROOT/.claude/memory/pipeline/link.json" 2>/dev/null || true

  # Create symlink directory
  mkdir -p "/tmp/outside-dir-$$"
  echo '{"evil":"attack"}' > "/tmp/outside-dir-$$/attack.json"
  ln -s "/tmp/outside-dir-$$" \
     "$TEST_ROOT/.claude/memory/evil" 2>/dev/null || true

  WRITE_SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-write"
  APPEND_SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-append"
  PATCH_SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-patch-section"
  READ_SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-read"
}

teardown() {
  rm -rf "$TEST_ROOT" "$TEO_AUDIT_DIR" 2>/dev/null || true
  rm -f "/tmp/symlink-target-$$.json" 2>/dev/null || true
  rm -rf "/tmp/outside-dir-$$" 2>/dev/null || true
}

# ── Dotdot traversal ─────────────────────────────────────────────────────────

@test "reject_dotdot_traversal_write" {
  run "$WRITE_SCRIPT" \
    --target ".claude/memory/../../../etc/passwd" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "traversal\|path"
}

@test "reject_dotdot_traversal_append" {
  run "$APPEND_SCRIPT" \
    --target ".claude/memory/../../../etc/passwd" \
    --content "evil" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "reject_dotdot_traversal_patch" {
  run "$PATCH_SCRIPT" \
    --target ".claude/memory/../../../etc/passwd" \
    --section "X" --content "evil" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "reject_dotdot_traversal_read" {
  run "$READ_SCRIPT" \
    --target ".claude/memory/../../../etc/passwd" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

# ── Absolute paths ────────────────────────────────────────────────────────────

@test "reject_absolute_path_outside_project_write" {
  run "$WRITE_SCRIPT" \
    --target "/etc/hosts" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "absolute\|allowlist\|path"
}

@test "reject_absolute_path_outside_project_append" {
  run "$APPEND_SCRIPT" \
    --target "/etc/hosts" \
    --content "evil" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "reject_absolute_path_outside_project_read" {
  run "$READ_SCRIPT" \
    --target "/etc/hosts" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "reject_absolute_path_to_memory_write" {
  # Tools require relative paths; absolute form is rejected
  run "$WRITE_SCRIPT" \
    --target "${TEST_ROOT}/.claude/memory/pipeline/target.json" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "reject_absolute_path_to_memory_read" {
  run "$READ_SCRIPT" \
    --target "${TEST_ROOT}/.claude/memory/pipeline/target.json" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

# ── Outside .claude/memory ───────────────────────────────────────────────────

@test "reject_path_outside_claude_memory_write" {
  run "$WRITE_SCRIPT" \
    --target ".claude/scripts/teo-apply-edit" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "allowlist\|memory"
}

@test "reject_path_outside_claude_memory_append" {
  run "$APPEND_SCRIPT" \
    --target ".claude/scripts/teo-apply-edit" \
    --content "evil" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "reject_path_outside_claude_memory_patch" {
  run "$PATCH_SCRIPT" \
    --target ".claude/scripts/teo-apply-edit" \
    --section "X" --content "evil" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "read_outside_claude_memory_is_rejected" {
  run "$READ_SCRIPT" \
    --target ".claude/hooks/pre-bash-write-guard.sh" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "allowlist\|memory"
}

# ── Symlink checks ───────────────────────────────────────────────────────────

@test "reject_symlink_target_write" {
  if [ ! -L "$TEST_ROOT/.claude/memory/pipeline/link.json" ]; then
    skip "symlink creation failed on this platform"
  fi
  run "$WRITE_SCRIPT" \
    --target ".claude/memory/pipeline/link.json" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "symlink"
}

@test "reject_symlink_target_read" {
  if [ ! -L "$TEST_ROOT/.claude/memory/pipeline/link.json" ]; then
    skip "symlink creation failed on this platform"
  fi
  run "$READ_SCRIPT" \
    --target ".claude/memory/pipeline/link.json" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "symlink"
}

@test "reject_symlink_in_path_component_write" {
  if [ ! -L "$TEST_ROOT/.claude/memory/evil" ]; then
    skip "symlink directory creation failed on this platform"
  fi
  run "$WRITE_SCRIPT" \
    --target ".claude/memory/evil/attack.json" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "symlink"
}

# ── Edge cases ───────────────────────────────────────────────────────────────

@test "reject_empty_path_write" {
  run "$WRITE_SCRIPT" \
    --target "" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "reject_empty_path_read" {
  run "$READ_SCRIPT" \
    --target "" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "reject_tilde_expansion_write" {
  run "$WRITE_SCRIPT" \
    --target "~/.ssh/authorized_keys" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "tilde\|expansion\|allowed"
}

@test "reject_tilde_expansion_read" {
  run "$READ_SCRIPT" \
    --target "~/.ssh/authorized_keys" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "reject_env_var_expansion_in_path_write" {
  run "$WRITE_SCRIPT" \
    --target '$HOME/.ssh/authorized_keys' \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "expansion\|allowed\|env"
}

@test "reject_env_var_expansion_in_path_read" {
  run "$READ_SCRIPT" \
    --target '$HOME/.ssh/authorized_keys' \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "reject_malformed_json_target_for_json_ops" {
  # Malformed JSON file
  run "$WRITE_SCRIPT" \
    --target ".claude/memory/pipeline/malformed.json" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "json\|invalid"
  # File unchanged
  content="$(cat "$TEST_ROOT/.claude/memory/pipeline/malformed.json")"
  echo "$content" | grep -q "bad json"
}
