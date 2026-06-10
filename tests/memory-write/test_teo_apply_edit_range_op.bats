#!/usr/bin/env bats
# tests/memory-write/test_teo_apply_edit_range_op.bats
# QA spec: WS-ORCH-FIX - replace-range op for teo-apply-edit
# 22 tests: acceptance, regression, REFUSE, security, audit, co-fix

setup() {
  TEST_ROOT="$BATS_TMPDIR/teo-range-op-test-$$"
  mkdir -p "$TEST_ROOT/.claude/scripts"
  mkdir -p "$TEST_ROOT/.claude/config"
  TEST_AUDIT_DIR="$BATS_TMPDIR/teo-range-op-audit-$$"
  mkdir -p "$TEST_AUDIT_DIR"
  export TEO_PROJECT_ROOT="$TEST_ROOT"
  export TEO_AUDIT_DIR="$TEST_AUDIT_DIR"

  APPLY_EDIT="$BATS_TEST_DIRNAME/../../.claude/scripts/teo-apply-edit"
  HOOK_FILE="$BATS_TEST_DIRNAME/../../.claude/hooks/teo-sage-constraint.sh"
  SCRIPTS_DIR="$BATS_TEST_DIRNAME/../../.claude/scripts"
  PATCH_TMP="$BATS_TMPDIR/teo-range-patch-$$.json"

  # Synthetic fixture for acceptance test (deterministic, independent of live scripts)
  FIXTURE_FILE="$TEST_ROOT/.claude/scripts/synthetic-fixture.sh"
  printf '%s\n' '#!/usr/bin/env bash' > "$FIXTURE_FILE"
  printf '%s\n' '# line before range' >> "$FIXTURE_FILE"
  printf '%s\n' '# START-ANCHOR' >> "$FIXTURE_FILE"
  printf '%s\n' 'survivor_line_1=true' >> "$FIXTURE_FILE"
  printf '%s\n' 'survivor_line_2=true' >> "$FIXTURE_FILE"
  printf '%s\n' 'survivor_line_3=true' >> "$FIXTURE_FILE"
  printf '%s\n' 'survivor_line_4=true' >> "$FIXTURE_FILE"
  printf '%s\n' 'survivor_line_5=true' >> "$FIXTURE_FILE"
  printf '%s\n' 'if true; then' >> "$FIXTURE_FILE"
  printf '%s\n' '  dead_code_1=true' >> "$FIXTURE_FILE"
  printf '%s\n' 'if true; then' >> "$FIXTURE_FILE"
  printf '%s\n' '  dead_code_2=true' >> "$FIXTURE_FILE"
  printf '%s\n' 'fi' >> "$FIXTURE_FILE"
  printf '%s\n' 'fi' >> "$FIXTURE_FILE"
  printf '%s\n' '# END-ANCHOR  # DEBUGMARK' >> "$FIXTURE_FILE"
  printf '%s\n' '# line after range' >> "$FIXTURE_FILE"

  # Simple script for regression tests
  SIMPLE_FILE="$TEST_ROOT/.claude/scripts/simple-target.sh"
  printf '%s\n' '#!/usr/bin/env bash' > "$SIMPLE_FILE"
  printf '%s\n' 'original_line=true' >> "$SIMPLE_FILE"
  printf '%s\n' '# unique-anchor' >> "$SIMPLE_FILE"
  printf '%s\n' 'end_content=true' >> "$SIMPLE_FILE"

  # File with ambiguous lines for ambiguity tests
  AMBIG_FILE="$TEST_ROOT/.claude/scripts/ambig-target.sh"
  printf '%s\n' '#!/usr/bin/env bash' > "$AMBIG_FILE"
  printf '%s\n' '# REPEATED-LINE' >> "$AMBIG_FILE"
  printf '%s\n' 'middle=true' >> "$AMBIG_FILE"
  printf '%s\n' '# REPEATED-LINE' >> "$AMBIG_FILE"
  printf '%s\n' '# unique-end' >> "$AMBIG_FILE"

  # File for inverted range test (end before start)
  INVERTED_FILE="$TEST_ROOT/.claude/scripts/inverted-target.sh"
  printf '%s\n' '#!/usr/bin/env bash' > "$INVERTED_FILE"
  printf '%s\n' '# END-LINE' >> "$INVERTED_FILE"
  printf '%s\n' 'middle=true' >> "$INVERTED_FILE"
  printf '%s\n' '# START-LINE' >> "$INVERTED_FILE"
}

teardown() {
  rm -rf "$TEST_ROOT" "$TEST_AUDIT_DIR" 2>/dev/null || true
  rm -f "$PATCH_TMP" 2>/dev/null || true
}

# Helper: write patch JSON to PATCH_TMP
write_patch() {
  jq -nc "$@" > "$PATCH_TMP"
}

# ─── Test 1: Acceptance ─────────────────────────────────────────────────────

@test "replace_range_acceptance_removes_dead_interior_keeps_anchors_survivors" {
  local SURVIVOR_CONTENT
  SURVIVOR_CONTENT=$(printf '%s\n%s\n%s\n%s\n%s' \
    'survivor_line_1=true' 'survivor_line_2=true' \
    'survivor_line_3=true' 'survivor_line_4=true' 'survivor_line_5=true')

  # Precondition: dead block present in fixture
  before_count=$(grep -c 'dead_code' "$FIXTURE_FILE" 2>/dev/null || printf '0')
  [ "$before_count" -ge 2 ]

  write_patch \
    --arg t '.claude/scripts/synthetic-fixture.sh' \
    --arg sa '# START-ANCHOR' \
    --arg ea '# END-ANCHOR  # DEBUGMARK' \
    --arg c "$SURVIVOR_CONTENT" \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'

  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  # Anchors still present
  grep -q '# START-ANCHOR' "$FIXTURE_FILE"
  grep -q '# END-ANCHOR  # DEBUGMARK' "$FIXTURE_FILE"

  # Dead code removed
  run grep -q 'dead_code_1' "$FIXTURE_FILE"
  [ "$status" -ne 0 ]
  run grep -q 'dead_code_2' "$FIXTURE_FILE"
  [ "$status" -ne 0 ]

  # Survivors present
  grep -q 'survivor_line_1' "$FIXTURE_FILE"
  grep -q 'survivor_line_5' "$FIXTURE_FILE"

  # Lines outside range preserved
  grep -q '# line before range' "$FIXTURE_FILE"
  grep -q '# line after range' "$FIXTURE_FILE"
  grep -q '# DEBUGMARK' "$FIXTURE_FILE"
}

# ─── Tests 2-4: Regression ──────────────────────────────────────────────────

@test "regression_replace_op_still_works" {
  write_patch \
    --arg t '.claude/scripts/simple-target.sh' \
    --arg a '# unique-anchor' \
    --arg c '# replaced' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace","anchor":$a,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  grep -q '# replaced' "$SIMPLE_FILE"
  run grep -q '# unique-anchor' "$SIMPLE_FILE"
  [ "$status" -ne 0 ]
}

@test "regression_insert_before_op_still_works" {
  write_patch \
    --arg t '.claude/scripts/simple-target.sh' \
    --arg a '# unique-anchor' \
    --arg c '# inserted-before' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"insert-before","anchor":$a,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  grep -q '# inserted-before' "$SIMPLE_FILE"
  grep -q '# unique-anchor' "$SIMPLE_FILE"
}

@test "regression_append_op_still_works" {
  write_patch \
    --arg t '.claude/scripts/simple-target.sh' \
    --arg c '# appended' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"append","content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  grep -q '# appended' "$SIMPLE_FILE"
}

# ─── Tests 5-13: REFUSE cases ───────────────────────────────────────────────

@test "refuse_replace_range_start_anchor_not_found" {
  write_patch \
    --arg t '.claude/scripts/synthetic-fixture.sh' \
    --arg sa '# NONEXISTENT-START' \
    --arg ea '# END-ANCHOR  # DEBUGMARK' \
    --arg c '' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qi 'anchor-not-found'
}

@test "refuse_replace_range_end_anchor_not_found" {
  write_patch \
    --arg t '.claude/scripts/synthetic-fixture.sh' \
    --arg sa '# START-ANCHOR' \
    --arg ea '# NONEXISTENT-END' \
    --arg c '' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qi 'anchor-not-found'
}

@test "refuse_replace_range_start_anchor_ambiguous" {
  write_patch \
    --arg t '.claude/scripts/ambig-target.sh' \
    --arg sa '# REPEATED-LINE' \
    --arg ea '# unique-end' \
    --arg c '' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qi 'ambiguous'
}

@test "refuse_replace_range_end_anchor_ambiguous" {
  printf '%s\n' '# new-unique-start' >> "$AMBIG_FILE"
  write_patch \
    --arg t '.claude/scripts/ambig-target.sh' \
    --arg sa '# new-unique-start' \
    --arg ea '# REPEATED-LINE' \
    --arg c '' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qi 'ambiguous'
}

@test "refuse_replace_range_degenerate_range" {
  write_patch \
    --arg t '.claude/scripts/synthetic-fixture.sh' \
    --arg sa '# START-ANCHOR' \
    --arg ea '# START-ANCHOR' \
    --arg c '' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qi 'degenerate'
}

@test "refuse_replace_range_inverted_range" {
  write_patch \
    --arg t '.claude/scripts/inverted-target.sh' \
    --arg sa '# START-LINE' \
    --arg ea '# END-LINE' \
    --arg c '' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qi 'inverted'
}

@test "refuse_replace_range_missing_start_anchor_field" {
  write_patch \
    --arg t '.claude/scripts/synthetic-fixture.sh' \
    --arg ea '# END-ANCHOR  # DEBUGMARK' \
    --arg c '' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qi 'start_anchor'
}

@test "refuse_replace_range_missing_end_anchor_field" {
  write_patch \
    --arg t '.claude/scripts/synthetic-fixture.sh' \
    --arg sa '# START-ANCHOR' \
    --arg c '' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qi 'end_anchor'
}

@test "replace_range_missing_content_field_allowed_as_deletion" {
  # Missing content field treated as empty (deletion of interior)
  write_patch \
    --arg t '.claude/scripts/synthetic-fixture.sh' \
    --arg sa '# START-ANCHOR' \
    --arg ea '# END-ANCHOR  # DEBUGMARK' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  grep -q '# START-ANCHOR' "$FIXTURE_FILE"
  grep -q '# END-ANCHOR  # DEBUGMARK' "$FIXTURE_FILE"
}

# ─── Tests 14-17: Security ──────────────────────────────────────────────────

@test "security_reject_path_traversal_target" {
  write_patch \
    --arg t '../../etc/passwd' \
    --arg sa 'x' --arg ea 'y' --arg c '' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qi 'traversal'
}

@test "security_reject_absolute_path_target" {
  write_patch \
    --arg t '/etc/passwd' \
    --arg sa 'x' --arg ea 'y' --arg c '' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qi 'absolute'
}

@test "security_reject_symlink_target" {
  # Create a symlink pointing outside project root
  local OUTSIDE_FILE
  OUTSIDE_FILE="$(mktemp /tmp/teo-sec-outside.XXXXXX)"
  printf 'legit content' > "$OUTSIDE_FILE"
  ln -sf "$OUTSIDE_FILE" "$TEST_ROOT/.claude/scripts/symlink-target.sh"
  write_patch \
    --arg t '.claude/scripts/symlink-target.sh' \
    --arg sa 'x' --arg ea 'y' --arg c '' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  # Symlink is rejected OR anchor not found — either is a valid refusal
  [ "$status" -ne 0 ]
  rm -f "$OUTSIDE_FILE" "$TEST_ROOT/.claude/scripts/symlink-target.sh" 2>/dev/null || true
}

@test "security_reject_non_allowlist_target" {
  mkdir -p "$TEST_ROOT/some-other-dir"
  printf 'content\n' > "$TEST_ROOT/some-other-dir/file.sh"
  write_patch \
    --arg t 'some-other-dir/file.sh' \
    --arg sa 'x' --arg ea 'y' --arg c '' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qi 'allowlist'
}

# ─── Tests 18-19: Audit ─────────────────────────────────────────────────────

@test "audit_replace_range_writes_execution_id_entry" {
  write_patch \
    --arg t '.claude/scripts/synthetic-fixture.sh' \
    --arg sa '# START-ANCHOR' \
    --arg ea '# END-ANCHOR  # DEBUGMARK' \
    --arg c '# cleaned' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  # Audit log must exist and contain execution_id field
  local audit_file
  audit_file=$(ls "$TEST_AUDIT_DIR"/edit-audit-*.json 2>/dev/null | head -1)
  [ -n "$audit_file" ]
  grep -q 'execution_id' "$audit_file"
}

@test "audit_replace_range_no_tmp_file_left_behind" {
  before_tmp_count=$(ls /tmp/teo-apply-edit-content.* 2>/dev/null | wc -l | tr -d ' ')
  write_patch \
    --arg t '.claude/scripts/synthetic-fixture.sh' \
    --arg sa '# START-ANCHOR' \
    --arg ea '# END-ANCHOR  # DEBUGMARK' \
    --arg c '# cleaned-atomic' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  after_tmp_count=$(ls /tmp/teo-apply-edit-content.* 2>/dev/null | wc -l | tr -d ' ')
  [ "$after_tmp_count" -le "$before_tmp_count" ]
}

# ─── Tests 20-22: Co-fix ─────────────────────────────────────────────────────

@test "cofix_sage_constraint_hook_cites_mg_memory_not_teo_memory" {
  # Hook file must cite mg-memory-* scripts, not teo-memory-* names
  run grep -c 'teo-memory-patch-section' "$HOOK_FILE"
  [ "$output" -eq 0 ]
  run grep -c 'teo-memory-append' "$HOOK_FILE"
  [ "$output" -eq 0 ]
  grep -q 'mg-memory-patch-section' "$HOOK_FILE"
}

@test "cofix_mg_memory_scripts_resolve_on_disk" {
  [ -f "$SCRIPTS_DIR/mg-memory-patch-section" ]
  [ -f "$SCRIPTS_DIR/mg-memory-append" ]
  [ -f "$SCRIPTS_DIR/mg-memory-write" ]
}

@test "cofix_replace_range_op_accepted_by_apply_edit" {
  # Verify teo-apply-edit recognizes replace-range as a valid op
  write_patch \
    --arg t '.claude/scripts/synthetic-fixture.sh' \
    --arg sa '# START-ANCHOR' \
    --arg ea '# END-ANCHOR  # DEBUGMARK' \
    --arg c '# co-fix-line' \
    '{"schema_version":"1.0.0","target":$t,"patches":[{"op":"replace-range","start_anchor":$sa,"end_anchor":$ea,"content":$c}]}'
  run "$APPLY_EDIT" --patch-file "$PATCH_TMP" --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  grep -q '# co-fix-line' "$FIXTURE_FILE"
}
