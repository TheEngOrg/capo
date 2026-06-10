#!/usr/bin/env bats
# test_json_field_update.bats — Surface 1: JSON field update tests
# WS-ORCH-FIX memory-write tooling QA spec Section 1.1

setup() {
  TEST_ROOT="$BATS_TMPDIR/test-root-$$"
  mkdir -p "$TEST_ROOT/.claude/memory/pipeline"
  mkdir -p "$TEST_ROOT/.claude/memory/traces"
  export TEO_PROJECT_ROOT="$TEST_ROOT"
  export TEO_AUDIT_DIR="$BATS_TMPDIR/audit-$$"
  mkdir -p "$TEO_AUDIT_DIR"

  # Copy fixture into test tree
  cp "$BATS_TEST_DIRNAME/fixtures/prereqs_original.json" \
     "$TEST_ROOT/.claude/memory/pipeline/test-prereqs.json"

  SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-write"
  TARGET=".claude/memory/pipeline/test-prereqs.json"
}

teardown() {
  rm -rf "$TEST_ROOT" "$TEO_AUDIT_DIR" 2>/dev/null || true
}

@test "json_field_update_sets_boolean_to_false" {
  # Given: field prerequisites.model_inheritance_fixed.met = true
  run "$SCRIPT" \
    --target "$TARGET" \
    --field "prerequisites.model_inheritance_fixed.met" \
    --value "false" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  # File is valid JSON
  run jq empty "$TEST_ROOT/$TARGET"
  [ "$status" -eq 0 ]
  # Field value is now false
  result="$(jq '.prerequisites.model_inheritance_fixed.met' "$TEST_ROOT/$TARGET")"
  [ "$result" = "false" ]
  # Other fields unchanged
  note="$(jq -r '.prerequisites.model_inheritance_fixed.note' "$TEST_ROOT/$TARGET")"
  [ "$note" = "BYPASS_CONFIRMED via A2A CLI subprocess path." ]
}

@test "json_field_update_sets_string_field" {
  # Given: a string field "last_updated"
  run "$SCRIPT" \
    --target "$TARGET" \
    --field "last_updated" \
    --value-string "updated-value" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  result="$(jq -r '.last_updated' "$TEST_ROOT/$TARGET")"
  [ "$result" = "updated-value" ]
  # Other fields unchanged
  all_met="$(jq '.all_met' "$TEST_ROOT/$TARGET")"
  [ "$all_met" = "false" ]
}

@test "json_field_update_creates_nested_path" {
  # Given: no key a.b.c
  run "$SCRIPT" \
    --target "$TARGET" \
    --field "a.b.c" \
    --value "true" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  result="$(jq '.a.b.c' "$TEST_ROOT/$TARGET")"
  [ "$result" = "true" ]
}

@test "json_field_update_result_is_valid_json" {
  run "$SCRIPT" \
    --target "$TARGET" \
    --field "prerequisites.rbac_landed.met" \
    --value "true" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  run jq empty "$TEST_ROOT/$TARGET"
  [ "$status" -eq 0 ]
}

@test "json_field_update_is_atomic" {
  run "$SCRIPT" \
    --target "$TARGET" \
    --field "all_met" \
    --value "false" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  # No temp file remnants
  tmp_count="$(ls "$TEST_ROOT/.claude/memory/pipeline/"*.tmp.* 2>/dev/null | wc -l | tr -d ' ')"
  [ "$tmp_count" -eq 0 ]
}

@test "json_field_update_preserves_all_other_fields" {
  # Get the original provenance
  orig_authored_by="$(jq -r '._provenance.authored_by' "$TEST_ROOT/$TARGET")"
  run "$SCRIPT" \
    --target "$TARGET" \
    --field "all_met" \
    --value "false" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  new_authored_by="$(jq -r '._provenance.authored_by' "$TEST_ROOT/$TARGET")"
  [ "$new_authored_by" = "$orig_authored_by" ]
}

@test "json_field_update_misuse_missing_target_arg" {
  run "$SCRIPT" \
    --field "all_met" \
    --value "false" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 2 ]
}

@test "json_field_update_misuse_missing_field_arg" {
  run "$SCRIPT" \
    --target "$TARGET" \
    --value "false" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 2 ]
}

@test "json_field_update_misuse_missing_value_arg" {
  run "$SCRIPT" \
    --target "$TARGET" \
    --field "all_met" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 2 ]
}

@test "json_field_update_refuses_invalid_json_value" {
  run "$SCRIPT" \
    --target "$TARGET" \
    --field "all_met" \
    --value "not-valid-json" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  # File unchanged
  orig="$(jq '.all_met' "$BATS_TEST_DIRNAME/fixtures/prereqs_original.json")"
  current="$(jq '.all_met' "$TEST_ROOT/$TARGET")"
  [ "$current" = "$orig" ]
}
