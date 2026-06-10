#!/usr/bin/env bats
# test_memory_read.bats — Surface 1: read tests
# WS-ORCH-FIX memory-write tooling QA spec Section 1.4

setup() {
  TEST_ROOT="$BATS_TMPDIR/test-root-$$"
  mkdir -p "$TEST_ROOT/.claude/memory/pipeline"
  mkdir -p "$TEST_ROOT/.claude/memory/traces"
  export TEO_PROJECT_ROOT="$TEST_ROOT"
  export TEO_AUDIT_DIR="$BATS_TMPDIR/audit-$$"
  mkdir -p "$TEO_AUDIT_DIR"

  cp "$BATS_TEST_DIRNAME/fixtures/prereqs_original.json" \
     "$TEST_ROOT/.claude/memory/pipeline/test-prereqs.json"
  cp "$BATS_TEST_DIRNAME/fixtures/ruling_original.md" \
     "$TEST_ROOT/.claude/memory/pipeline/test-ruling.md"

  SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mg-memory-read"
}

teardown() {
  rm -rf "$TEST_ROOT" "$TEO_AUDIT_DIR" 2>/dev/null || true
}

@test "memory_read_json_returns_parsed_structure" {
  TARGET=".claude/memory/pipeline/test-prereqs.json"
  ORIG_MTIME="$(stat -f '%m' "$TEST_ROOT/$TARGET" 2>/dev/null || stat -c '%Y' "$TEST_ROOT/$TARGET")"

  run "$SCRIPT" --target "$TARGET" --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  # stdout is valid JSON
  echo "$output" | jq empty
  # Contains expected content
  authored_by="$(echo "$output" | jq -r '._provenance.authored_by')"
  [ "$authored_by" = "cto" ]
  # File not modified (mtime unchanged)
  NEW_MTIME="$(stat -f '%m' "$TEST_ROOT/$TARGET" 2>/dev/null || stat -c '%Y' "$TEST_ROOT/$TARGET")"
  [ "$NEW_MTIME" = "$ORIG_MTIME" ]
}

@test "memory_read_md_returns_full_text" {
  TARGET=".claude/memory/pipeline/test-ruling.md"
  ORIG_MTIME="$(stat -f '%m' "$TEST_ROOT/$TARGET" 2>/dev/null || stat -c '%Y' "$TEST_ROOT/$TARGET")"

  run "$SCRIPT" --target "$TARGET" --project-root "$TEST_ROOT"
  [ "$status" -eq 0 ]
  # stdout contains known content
  echo "$output" | grep -q "BYPASS_CONFIRMED"
  echo "$output" | grep -q "## Binary verdict"
  # File not modified
  NEW_MTIME="$(stat -f '%m' "$TEST_ROOT/$TARGET" 2>/dev/null || stat -c '%Y' "$TEST_ROOT/$TARGET")"
  [ "$NEW_MTIME" = "$ORIG_MTIME" ]
}

@test "memory_read_nonexistent_file_exits_nonzero" {
  run "$SCRIPT" \
    --target ".claude/memory/pipeline/does-not-exist.json" \
    --project-root "$TEST_ROOT"
  [ "$status" -ne 0 ]
  # Error message on stderr
  [ -n "$output" ] || [ -n "$stderr" ]
}

@test "memory_read_misuse_missing_target" {
  run "$SCRIPT" --project-root "$TEST_ROOT"
  [ "$status" -eq 2 ]
}

@test "memory_read_help_exits_zero" {
  run "$SCRIPT" --help
  [ "$status" -eq 0 ]
}
