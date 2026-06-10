#!/usr/bin/env bats
# test_acceptance_scenarios.bats — Section 7: concrete acceptance scenarios
# WS-ORCH-FIX memory-write tooling QA spec Section 7
# These tests use COPIES of live files (fixtures). They do NOT modify live files.

setup() {
  TEST_ROOT="$BATS_TMPDIR/test-root-$$"
  mkdir -p "$TEST_ROOT/.claude/memory/pipeline"
  mkdir -p "$TEST_ROOT/.claude/memory/traces"
  export TEO_PROJECT_ROOT="$TEST_ROOT"
  export TEO_AUDIT_DIR="$BATS_TMPDIR/audit-$$"
  mkdir -p "$TEO_AUDIT_DIR"

  # Copy fixtures (NOT live files)
  cp "$BATS_TEST_DIRNAME/fixtures/prereqs_original.json" \
     "$TEST_ROOT/.claude/memory/pipeline/team-mode-prereqs.json"
  cp "$BATS_TEST_DIRNAME/fixtures/ruling_original.md" \
     "$TEST_ROOT/.claude/memory/pipeline/cto-d2-47898-ruling-2026-04-29.md"

  WRITE_SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-write"
  PATCH_SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-patch-section"
}

teardown() {
  rm -rf "$TEST_ROOT" "$TEO_AUDIT_DIR" 2>/dev/null || true
}

@test "acceptance_prereqs_json_field_flip" {
  TARGET=".claude/memory/pipeline/team-mode-prereqs.json"
  TARGET_FULL="$TEST_ROOT/$TARGET"

  # Verify starting condition: met = true in our fixture
  orig_met="$(jq '.prerequisites.model_inheritance_fixed.met' "$TARGET_FULL")"
  [ "$orig_met" = "true" ]

  run "$WRITE_SCRIPT" \
    --target "$TARGET" \
    --field "prerequisites.model_inheritance_fixed.met" \
    --value "false" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  # jq empty passes (valid JSON)
  run jq empty "$TARGET_FULL"
  [ "$status" -eq 0 ]

  # Field flipped to false
  new_met="$(jq '.prerequisites.model_inheritance_fixed.met' "$TARGET_FULL")"
  [ "$new_met" = "false" ]

  # Note field unchanged
  note="$(jq -r '.prerequisites.model_inheritance_fixed.note' "$TARGET_FULL")"
  [ -n "$note" ]
  echo "$note" | grep -q "BYPASS_CONFIRMED"

  # rbac_landed.met unchanged (false)
  rbac_met="$(jq '.prerequisites.rbac_landed.met' "$TARGET_FULL")"
  [ "$rbac_met" = "false" ]

  # Provenance block intact
  authored_by="$(jq -r '._provenance.authored_by' "$TARGET_FULL")"
  [ "$authored_by" = "cto" ]
}

@test "acceptance_ruling_file_disposition_section_add" {
  TARGET=".claude/memory/pipeline/cto-d2-47898-ruling-2026-04-29.md"
  TARGET_FULL="$TEST_ROOT/$TARGET"

  # Count original headers
  orig_header_count="$(grep -c '^## ' "$TARGET_FULL")"

  run "$PATCH_SCRIPT" \
    --target "$TARGET" \
    --section "Disposition" \
    --content "Status: ACCEPTED
Actioned: 2026-06-09" \
    --insert-if-missing \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  # ## Disposition appears exactly once
  disp_count="$(grep -c '^## Disposition' "$TARGET_FULL")"
  [ "$disp_count" -eq 1 ]

  # Content under Disposition contains Status: ACCEPTED
  result="$(cat "$TARGET_FULL")"
  echo "$result" | grep -q "Status: ACCEPTED"

  # All prior sections present
  echo "$result" | grep -q "## Binary verdict"
  echo "$result" | grep -q "## Evidence basis"
  echo "$result" | grep -q "## Mechanism"
  echo "$result" | grep -q "## Scope and carry-forward"

  # Header count increased by 1
  new_header_count="$(grep -c '^## ' "$TARGET_FULL")"
  [ "$new_header_count" -eq $((orig_header_count + 1)) ]
}
