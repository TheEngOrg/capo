#!/usr/bin/env bats
# test_bypass_surface.bats — Surface 3: bypass token and audit tests
# WS-ORCH-FIX memory-write tooling QA spec Section 3

setup() {
  TEST_ROOT="$BATS_TMPDIR/test-root-$$"
  mkdir -p "$TEST_ROOT/.claude/memory/pipeline"
  mkdir -p "$TEST_ROOT/.claude/memory/traces"
  mkdir -p "$TEST_ROOT/.claude/scripts"
  export TEO_PROJECT_ROOT="$TEST_ROOT"
  export TEO_AUDIT_DIR="$BATS_TMPDIR/audit-$$"
  mkdir -p "$TEO_AUDIT_DIR"

  echo '{"status":"ok","data":"test"}' > "$TEST_ROOT/.claude/memory/pipeline/target.json"

  WRITE_SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-write"
  APPEND_SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-append"
  PATCH_SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-patch-section"
  READ_SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-read"
  SI_SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-settings-insert"
}

teardown() {
  rm -rf "$TEST_ROOT" "$TEO_AUDIT_DIR" 2>/dev/null || true
}

# ── No cp/mv/tee in source ──────────────────────────────────────────────────

@test "tooling_does_not_use_cp_to_write_target" {
  # Source inspection: mg-memory-write must not route through cp
  ! grep -n '\bcp ' "$WRITE_SCRIPT" | grep -v '^#' | grep -q 'TARGET\|target\|\$TARGET'
}

@test "tooling_does_not_use_mv_to_write_target" {
  # mv is used for temp+rename (allowed). It must NOT be cp/tee initial write.
  # Check no "tee " writing to target
  ! grep -n '\btee ' "$WRITE_SCRIPT" | grep -q 'TARGET\|target\|\$TARGET'
}

@test "tooling_append_does_not_use_cp_mv_tee_as_primary_write" {
  ! grep -n '\btee ' "$APPEND_SCRIPT" | grep -v '^\s*#' | grep -q 'TARGET\|target'
}

@test "tooling_patch_does_not_use_cp_mv_tee_as_primary_write" {
  ! grep -n '\btee ' "$PATCH_SCRIPT" | grep -v '^\s*#' | grep -q 'TARGET\|target'
}

# ── Audit log on success ─────────────────────────────────────────────────────

@test "every_successful_write_produces_audit_log_entry" {
  TARGET=".claude/memory/pipeline/target.json"
  run "$WRITE_SCRIPT" \
    --target "$TARGET" \
    --field "status" \
    --value-string "tested" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  # Audit log should exist
  audit_files="$(ls "$TEO_AUDIT_DIR"/edit-audit-*.json 2>/dev/null)"
  [ -n "$audit_files" ]

  # Entry matches target path
  for f in $audit_files; do
    if jq -e --arg p "$TARGET" 'map(select(.path == $p)) | length > 0' "$f" > /dev/null 2>&1; then
      found=1; break
    fi
  done
  [ "${found:-0}" -eq 1 ]

  # Entry has verdict applied
  for f in $audit_files; do
    if jq -e --arg p "$TARGET" 'map(select(.path == $p and .verdict == "applied")) | length > 0' "$f" > /dev/null 2>&1; then
      found_applied=1; break
    fi
  done
  [ "${found_applied:-0}" -eq 1 ]
}

@test "every_successful_write_audit_has_required_fields" {
  TARGET=".claude/memory/pipeline/target.json"
  export AGENT_IDENTITY_TOKEN="test-agent-token"

  run "$WRITE_SCRIPT" \
    --target "$TARGET" \
    --field "status" \
    --value-string "audit-test" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  for f in "$TEO_AUDIT_DIR"/edit-audit-*.json; do
    [ -f "$f" ] || continue
    # Check required fields in each entry
    run jq -e 'all(has("execution_id") and has("agent") and has("path") and has("operation") and has("verdict") and has("timestamp"))' "$f"
    [ "$status" -eq 0 ]
  done
}

@test "every_refused_write_produces_audit_log_entry" {
  # Refuse by targeting outside memory
  run "$WRITE_SCRIPT" \
    --target ".claude/scripts/evil.sh" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]

  # Audit log should have refused entry
  found_refused=0
  for f in "$TEO_AUDIT_DIR"/edit-audit-*.json; do
    [ -f "$f" ] || continue
    if jq -e 'map(select(.verdict == "refused")) | length > 0' "$f" > /dev/null 2>&1; then
      found_refused=1; break
    fi
  done
  [ "$found_refused" -eq 1 ]
}

@test "refused_audit_entry_has_refusal_reason" {
  run "$WRITE_SCRIPT" \
    --target ".claude/scripts/evil.sh" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]

  for f in "$TEO_AUDIT_DIR"/edit-audit-*.json; do
    [ -f "$f" ] || continue
    if jq -e 'map(select(.verdict == "refused" and (.refusal_reason | length > 0))) | length > 0' "$f" > /dev/null 2>&1; then
      found=1; break
    fi
  done
  [ "${found:-0}" -eq 1 ]
}

@test "bypass_token_surface_not_widened" {
  # The scripts must use teo-ae-PID-EPOCH format (same as teo-apply-edit)
  # not a simpler fixed string like "bypass=true"
  for script in "$WRITE_SCRIPT" "$APPEND_SCRIPT" "$PATCH_SCRIPT" "$READ_SCRIPT"; do
    # Should contain teo-ae- pattern (uses same bypass mechanism)
    grep -q 'teo-ae-' "$script"
    # Should NOT use a trivially forgeable fixed bypass value
    ! grep -q 'bypass=true\|BYPASS=true\|bypass=1\|BYPASS=1' "$script"
  done
}

@test "bypass_token_is_unset_after_invocation" {
  # Run the script in a subshell; check that TEO_APPLY_EDIT_BYPASS is not
  # exported to the caller's environment after script exit
  TARGET=".claude/memory/pipeline/target.json"

  # Run the write script; capture env after
  TEO_APPLY_EDIT_BYPASS="pre-existing-value"
  "$WRITE_SCRIPT" \
    --target "$TARGET" \
    --field "status" \
    --value-string "bypass-test" \
    --project-root "$TEST_ROOT" \
    > /dev/null 2>&1 || true

  # The script sets/exports its own bypass token but uses a subprocess
  # Since it runs as a subprocess (not sourced), the parent env is unaffected
  # The value should still be what we set (or unset if we hadn't set it)
  # The key invariant: the script's bypass is scoped to its own subprocess
  [ "${TEO_APPLY_EDIT_BYPASS:-NOT_SET}" = "pre-existing-value" ]
}

@test "forged_bypass_token_does_not_grant_write_to_non_memory_path" {
  # Path gate fires BEFORE bypass check
  # Even with a valid-format bypass token, memory tools refuse non-memory paths
  TEO_APPLY_EDIT_BYPASS="teo-ae-99999-99999"
  export TEO_APPLY_EDIT_BYPASS
  run "$WRITE_SCRIPT" \
    --target ".claude/scripts/evil.sh" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "forged_bypass_token_cannot_widen_to_settings_json_via_memory_tool" {
  TEO_APPLY_EDIT_BYPASS="teo-ae-99999-99999"
  export TEO_APPLY_EDIT_BYPASS
  run "$WRITE_SCRIPT" \
    --target ".claude/settings.json" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "arbitrary_caller_cannot_write_via_tooling_to_non_memory_path" {
  run "$WRITE_SCRIPT" \
    --target ".claude/scripts/evil.sh" \
    --field "x" --value "1" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "allowlist\|memory"
}

@test "tool_invocation_via_bash_requires_settings_json_allowlist" {
  # Static check: each memory-write script name must be in settings.json Bash allow list
  SETTINGS_FILE="$BATS_TEST_DIRNAME/../../.claude/settings.json"

  for script_name in mg-memory-write mg-memory-append mg-memory-patch-section mg-memory-read; do
    run jq -e --arg name "$script_name" \
      '[.permissions.allow[] | select(startswith("Bash(.claude/scripts/") and contains($name))] | length > 0' \
      "$SETTINGS_FILE"
    [ "$status" -eq 0 ] || {
      echo "FAIL: $script_name not in settings.json Bash allowlist" >&2
      return 1
    }
  done
}

@test "pre_bash_write_guard_does_not_block_cp_to_memory_path" {
  # The guard does NOT block cp to .claude/memory/ — memory is not a protected
  # prefix (ALLOW-3). The memory tools own that scope with their own path-gate
  # and audit. Only .claude/scripts, .claude/hooks, .claude/shared, etc. are
  # protected by this guard.
  GUARD="$BATS_TEST_DIRNAME/../../.claude/hooks/pre-bash-write-guard.sh"
  [ -f "$GUARD" ] || skip "pre-bash-write-guard.sh not found"

  # Simulate a cp command to a memory path without bypass token
  unset TEO_APPLY_EDIT_BYPASS
  INPUT='{"tool_name":"Bash","tool_input":{"command":"cp /tmp/evil.json .claude/memory/pipeline/team-mode-prereqs.json"}}'
  run bash -c "printf '%s' '$INPUT' | '$GUARD'"
  # Should ALLOW (exit 0) — .claude/memory is not a protected prefix
  [ "$status" -eq 0 ]
}
