#!/usr/bin/env bats
# test_md_append.bats — Surface 1: MD append tests
# WS-ORCH-FIX memory-write tooling QA spec Section 1.2

setup() {
  TEST_ROOT="$BATS_TMPDIR/test-root-$$"
  mkdir -p "$TEST_ROOT/.claude/memory/pipeline"
  mkdir -p "$TEST_ROOT/.claude/memory/traces"
  export TEO_PROJECT_ROOT="$TEST_ROOT"
  export TEO_AUDIT_DIR="$BATS_TMPDIR/audit-$$"
  mkdir -p "$TEO_AUDIT_DIR"

  SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-append"
}

teardown() {
  rm -rf "$TEST_ROOT" "$TEO_AUDIT_DIR" 2>/dev/null || true
}

_make_md_file() {
  local path="$TEST_ROOT/.claude/memory/pipeline/test.md"
  printf '%s' "$1" > "$path"
  echo "$path"
}

@test "md_append_adds_line_at_eof" {
  # File with no trailing newline
  MD_PATH="$(_make_md_file "# Title

Original content")"
  TARGET=".claude/memory/pipeline/test.md"

  run "$SCRIPT" \
    --target "$TARGET" \
    --content "## New Section

appended content" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  # Original content intact
  result="$(cat "$MD_PATH")"
  echo "$result" | grep -q "Original content"
  # Appended text appears
  echo "$result" | grep -q "## New Section"
  echo "$result" | grep -q "appended content"
}

@test "md_append_with_existing_trailing_newline" {
  # File whose last byte is newline
  MD_PATH="$(_make_md_file "# Title

Original content
")"
  TARGET=".claude/memory/pipeline/test.md"

  run "$SCRIPT" \
    --target "$TARGET" \
    --content "## Appended" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  result="$(cat "$MD_PATH")"
  # Should not produce double blank line before appended content
  # Check no triple newline (which would be two blank lines)
  if printf '%s' "$result" | grep -qP '\n\n\n## Appended'; then
    echo "Double blank line before appended content" >&2
    return 1
  fi
  echo "$result" | grep -q "## Appended"
}

@test "md_append_to_empty_file" {
  # 0-byte file
  MD_PATH="$TEST_ROOT/.claude/memory/pipeline/empty.md"
  touch "$MD_PATH"
  TARGET=".claude/memory/pipeline/empty.md"

  run "$SCRIPT" \
    --target "$TARGET" \
    --content "First content" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  result="$(cat "$MD_PATH")"
  [ "$result" = "First content" ]
}

@test "md_append_is_atomic" {
  MD_PATH="$(_make_md_file "# Title")"
  TARGET=".claude/memory/pipeline/test.md"

  run "$SCRIPT" \
    --target "$TARGET" \
    --content "new line" \
    --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]

  # No temp file remnants
  tmp_count="$(ls "$TEST_ROOT/.claude/memory/pipeline/"*.tmp.* 2>/dev/null | wc -l | tr -d ' ')"
  [ "$tmp_count" -eq 0 ]
}

@test "md_append_misuse_missing_target" {
  run "$SCRIPT" --content "text" --project-root "$TEST_ROOT"
  [ "$status" -eq 2 ]
}

@test "md_append_misuse_missing_content" {
  MD_PATH="$(_make_md_file "# Title")"
  TARGET=".claude/memory/pipeline/test.md"
  run "$SCRIPT" --target "$TARGET" --project-root "$TEST_ROOT"
  [ "$status" -eq 2 ]
}

@test "md_append_refuses_nonexistent_file" {
  run "$SCRIPT" \
    --target ".claude/memory/pipeline/nonexistent.md" \
    --content "test" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
}
