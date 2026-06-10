#!/usr/bin/env bats
# test_md_section_patch.bats — Surface 1: MD section patch tests
# WS-ORCH-FIX memory-write tooling QA spec Section 1.3

setup() {
  TEST_ROOT="$BATS_TMPDIR/test-root-$$"
  mkdir -p "$TEST_ROOT/.claude/memory/pipeline"
  mkdir -p "$TEST_ROOT/.claude/memory/traces"
  export TEO_PROJECT_ROOT="$TEST_ROOT"
  export TEO_AUDIT_DIR="$BATS_TMPDIR/audit-$$"
  mkdir -p "$TEO_AUDIT_DIR"

  # Copy duplicate-sections fixture
  cp "$BATS_TEST_DIRNAME/fixtures/duplicate_sections.md" \
     "$TEST_ROOT/.claude/memory/pipeline/duplicate_sections.md"

  SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-patch-section"
}

teardown() {
  rm -rf "$TEST_ROOT" "$TEO_AUDIT_DIR" 2>/dev/null || true
}

_make_multi_section_file() {
  local path="$TEST_ROOT/.claude/memory/pipeline/multi.md"
  cat > "$path" << 'MDEOF'
# Test Doc

## Disposition

old content

## Next Section

next content
MDEOF
  echo "$path"
}

_make_two_section_file() {
  local path="$TEST_ROOT/.claude/memory/pipeline/two.md"
  cat > "$path" << 'MDEOF'
# Test Doc

## Alpha

alpha content here

## Beta

beta content here
MDEOF
  echo "$path"
}

@test "md_section_patch_replaces_named_section" {
  _make_multi_section_file
  TARGET=".claude/memory/pipeline/multi.md"

  run "$SCRIPT" \
    --target "$TARGET" \
    --section "Disposition" \
    --content "new content" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  result="$(cat "$TEST_ROOT/$TARGET")"
  # New content present
  echo "$result" | grep -q "new content"
  # Old content gone
  if echo "$result" | grep -q "old content"; then
    echo "old content still present" >&2
    return 1
  fi
  # Next section intact
  echo "$result" | grep -q "## Next Section"
  echo "$result" | grep -q "next content"
}

@test "md_section_patch_inserts_new_section_at_eof" {
  _make_multi_section_file
  TARGET=".claude/memory/pipeline/multi.md"
  # Remove existing Disposition so it's missing
  sed -i '' '/^## Disposition/,/^## /{ /^## Disposition/d; /^## /!d; }' \
    "$TEST_ROOT/$TARGET" 2>/dev/null || true
  # Create a fresh file without Disposition
  cat > "$TEST_ROOT/$TARGET" << 'MDEOF'
# Test Doc

## Other Section

other content
MDEOF

  run "$SCRIPT" \
    --target "$TARGET" \
    --section "Disposition" \
    --content "Status: ACCEPTED" \
    --insert-if-missing \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  result="$(cat "$TEST_ROOT/$TARGET")"
  echo "$result" | grep -q "## Disposition"
  echo "$result" | grep -q "Status: ACCEPTED"
  # Prior content intact
  echo "$result" | grep -q "## Other Section"
  echo "$result" | grep -q "other content"
}

@test "md_section_patch_replaces_only_named_section" {
  _make_two_section_file
  TARGET=".claude/memory/pipeline/two.md"

  run "$SCRIPT" \
    --target "$TARGET" \
    --section "Beta" \
    --content "new beta content" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  result="$(cat "$TEST_ROOT/$TARGET")"
  # Alpha unchanged
  echo "$result" | grep -q "## Alpha"
  echo "$result" | grep -q "alpha content here"
  # Beta updated
  echo "$result" | grep -q "new beta content"
  # Old beta content gone
  if echo "$result" | grep -q "beta content here"; then
    echo "old beta content still present" >&2
    return 1
  fi
}

@test "md_section_patch_ambiguous_anchor_is_rejected" {
  TARGET=".claude/memory/pipeline/duplicate_sections.md"

  run "$SCRIPT" \
    --target "$TARGET" \
    --section "Status" \
    --content "new content" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  # Error mentions ambiguous
  echo "$output" | grep -qi "ambiguous"
  # File unchanged
  result="$(cat "$TEST_ROOT/$TARGET")"
  echo "$result" | grep -q "first status section"
}

@test "md_section_patch_missing_anchor_is_rejected" {
  _make_multi_section_file
  TARGET=".claude/memory/pipeline/multi.md"

  run "$SCRIPT" \
    --target "$TARGET" \
    --section "Nonexistent" \
    --content "new content" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi "not found\|anchor"
  # File unchanged
  result="$(cat "$TEST_ROOT/$TARGET")"
  echo "$result" | grep -q "old content"
}

@test "md_section_patch_is_atomic" {
  _make_multi_section_file
  TARGET=".claude/memory/pipeline/multi.md"

  run "$SCRIPT" \
    --target "$TARGET" \
    --section "Disposition" \
    --content "atomic test" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  tmp_count="$(ls "$TEST_ROOT/.claude/memory/pipeline/"*.tmp.* 2>/dev/null | wc -l | tr -d ' ')"
  [ "$tmp_count" -eq 0 ]
}

@test "md_section_patch_misuse_missing_target" {
  run "$SCRIPT" --section "Foo" --content "bar" --project-root "$TEST_ROOT"
  [ "$status" -eq 2 ]
}

@test "md_section_patch_misuse_missing_section" {
  _make_multi_section_file
  run "$SCRIPT" \
    --target ".claude/memory/pipeline/multi.md" \
    --content "bar" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 2 ]
}
