#!/usr/bin/env bats
# test_settings_json_insert.bats — Surface 2: settings.json hook block insert
# WS-ORCH-FIX memory-write tooling QA spec Section 6

setup() {
  TEST_ROOT="$BATS_TMPDIR/test-root-$$"
  mkdir -p "$TEST_ROOT/.claude/memory/traces"
  export TEO_PROJECT_ROOT="$TEST_ROOT"
  export TEO_AUDIT_DIR="$BATS_TMPDIR/audit-$$"
  mkdir -p "$TEO_AUDIT_DIR"

  # Copy settings fixture into test area (NOT the live settings.json)
  cp "$BATS_TEST_DIRNAME/fixtures/settings_minimal.json" \
     "$TEST_ROOT/settings.json"

  SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-settings-insert"
  SETTINGS="$TEST_ROOT/settings.json"
}

teardown() {
  rm -rf "$TEST_ROOT" "$TEO_AUDIT_DIR" 2>/dev/null || true
}

@test "hook_block_insert_produces_valid_json" {
  orig_count="$(jq '.hooks.PreToolUse | length' "$SETTINGS")"

  run "$SCRIPT" \
    --hook-command ".claude/hooks/pre-bash-write-guard.sh" \
    --matcher "Bash" \
    --settings-file "$SETTINGS" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  run jq empty "$SETTINGS"
  [ "$status" -eq 0 ]

  new_count="$(jq '.hooks.PreToolUse | length' "$SETTINGS")"
  [ "$new_count" -eq $((orig_count + 1)) ]
}

@test "hook_block_insert_at_beginning" {
  orig_first="$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$SETTINGS")"

  run "$SCRIPT" \
    --hook-command ".claude/hooks/new-first-hook.sh" \
    --matcher "Bash" \
    --position "0" \
    --settings-file "$SETTINGS" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  new_first="$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$SETTINGS")"
  [ "$new_first" = ".claude/hooks/new-first-hook.sh" ]

  # Original first entry shifted to index 1
  shifted="$(jq -r '.hooks.PreToolUse[1].hooks[0].command' "$SETTINGS")"
  [ "$shifted" = "$orig_first" ]
}

@test "hook_block_insert_at_end" {
  orig_count="$(jq '.hooks.PreToolUse | length' "$SETTINGS")"

  run "$SCRIPT" \
    --hook-command ".claude/hooks/last-hook.sh" \
    --matcher "Write" \
    --position "append" \
    --settings-file "$SETTINGS" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  last_idx="$(jq '.hooks.PreToolUse | length - 1' "$SETTINGS")"
  last_cmd="$(jq -r ".hooks.PreToolUse[$last_idx].hooks[0].command" "$SETTINGS")"
  [ "$last_cmd" = ".claude/hooks/last-hook.sh" ]
}

@test "hook_block_insert_is_idempotent" {
  # First insert
  run "$SCRIPT" \
    --hook-command ".claude/hooks/idempotent-hook.sh" \
    --matcher "Bash" \
    --settings-file "$SETTINGS" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  count_after_first="$(jq '.hooks.PreToolUse | length' "$SETTINGS")"

  # Second insert (same command)
  run "$SCRIPT" \
    --hook-command ".claude/hooks/idempotent-hook.sh" \
    --matcher "Bash" \
    --settings-file "$SETTINGS" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  count_after_second="$(jq '.hooks.PreToolUse | length' "$SETTINGS")"

  # Count must not increase
  [ "$count_after_second" -eq "$count_after_first" ]
  # Appears exactly once
  entry_count="$(jq --arg cmd ".claude/hooks/idempotent-hook.sh" \
    '[.hooks.PreToolUse[] | select(.hooks[0].command == $cmd)] | length' \
    "$SETTINGS")"
  [ "$entry_count" -eq 1 ]
}

@test "hook_block_insert_duplicate_detection_key" {
  # Manually insert a duplicate entry
  jq '.hooks.PreToolUse += [{"matcher":"Bash","hooks":[{"type":"command","command":".claude/hooks/dup-hook.sh"}]}]' \
    "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
  jq '.hooks.PreToolUse += [{"matcher":"Bash","hooks":[{"type":"command","command":".claude/hooks/dup-hook.sh"}]}]' \
    "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"

  dup_count_before="$(jq --arg cmd ".claude/hooks/dup-hook.sh" \
    '[.hooks.PreToolUse[] | select(.hooks[0].command == $cmd)] | length' "$SETTINGS")"
  [ "$dup_count_before" -eq 2 ]

  # Running the insert tool with the same command should be a no-op (already present)
  run "$SCRIPT" \
    --hook-command ".claude/hooks/dup-hook.sh" \
    --matcher "Bash" \
    --settings-file "$SETTINGS" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  # Should not have added a third entry
  dup_count_after="$(jq --arg cmd ".claude/hooks/dup-hook.sh" \
    '[.hooks.PreToolUse[] | select(.hooks[0].command == $cmd)] | length' "$SETTINGS")"
  [ "$dup_count_after" -le 2 ]
}

@test "hook_block_insert_schema_intact" {
  run "$SCRIPT" \
    --hook-command ".claude/hooks/schema-test-hook.sh" \
    --matcher "Bash" \
    --settings-file "$SETTINGS" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  # has("hooks") = true
  run jq -e 'has("hooks")' "$SETTINGS"
  [ "$status" -eq 0 ]

  # .hooks has("PreToolUse") = true
  run jq -e '.hooks | has("PreToolUse")' "$SETTINGS"
  [ "$status" -eq 0 ]

  # .hooks.PreToolUse | type = "array"
  ptu_type="$(jq -r '.hooks.PreToolUse | type' "$SETTINGS")"
  [ "$ptu_type" = "array" ]

  # No other top-level keys added (compare against fixture)
  orig_keys="$(jq -r 'keys | sort | @csv' "$BATS_TEST_DIRNAME/fixtures/settings_minimal.json")"
  new_keys="$(jq -r 'keys | sort | @csv' "$SETTINGS")"
  [ "$orig_keys" = "$new_keys" ]
}

@test "hook_block_insert_atomic" {
  run "$SCRIPT" \
    --hook-command ".claude/hooks/atomic-hook.sh" \
    --matcher "Bash" \
    --settings-file "$SETTINGS" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  # No temp file remnants
  tmp_count="$(ls "${SETTINGS}.teo-si.tmp."* 2>/dev/null | wc -l | tr -d ' ')"
  [ "$tmp_count" -eq 0 ]
}

@test "hook_block_insert_is_audited" {
  run "$SCRIPT" \
    --hook-command ".claude/hooks/audit-hook.sh" \
    --matcher "Bash" \
    --settings-file "$SETTINGS" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  # Audit log should exist with applied entry
  found_applied=0
  for f in "$TEO_AUDIT_DIR"/edit-audit-*.json; do
    [ -f "$f" ] || continue
    if jq -e 'map(select(.verdict == "applied" and .operation == "settings-json-insert")) | length > 0' "$f" > /dev/null 2>&1; then
      found_applied=1; break
    fi
  done
  [ "$found_applied" -eq 1 ]
}

@test "hook_block_insert_blocked_for_non_settings_targets" {
  # Calling settings-insert on a memory file must fail
  echo '{}' > "$TEST_ROOT/not-settings.json"

  run "$SCRIPT" \
    --hook-command ".claude/hooks/hook.sh" \
    --matcher "Bash" \
    --settings-file "$TEST_ROOT/not-settings.json" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "settings.json\|wrong.tool\|only"
}

@test "hook_block_insert_blocked_for_memory_path_target" {
  # Refuse if settings-file contains .claude/memory
  run "$SCRIPT" \
    --hook-command ".claude/hooks/hook.sh" \
    --matcher "Bash" \
    --settings-file ".claude/memory/pipeline/foo.json" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}

@test "hook_block_insert_via_hook_json" {
  HOOK_BLOCK='{"matcher":"Bash","hooks":[{"type":"command","command":".claude/hooks/json-block-hook.sh"}]}'
  orig_count="$(jq '.hooks.PreToolUse | length' "$SETTINGS")"

  run "$SCRIPT" \
    --hook-json "$HOOK_BLOCK" \
    --settings-file "$SETTINGS" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  new_count="$(jq '.hooks.PreToolUse | length' "$SETTINGS")"
  [ "$new_count" -eq $((orig_count + 1)) ]

  # Verify it's the right block
  last_cmd="$(jq -r '.hooks.PreToolUse[-1].hooks[0].command' "$SETTINGS")"
  [ "$last_cmd" = ".claude/hooks/json-block-hook.sh" ]
}
