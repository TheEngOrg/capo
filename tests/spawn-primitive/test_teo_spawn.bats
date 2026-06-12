#!/usr/bin/env bats
# test_teo_spawn.bats — 19 test cases for teo-spawn (WS-MARKER-FIX Deliverable 2)

SCRIPT="/Users/brodieyazaki/work/agent-tools/the-eng-org/.claude/scripts/teo-spawn"
ISSUE_TOKEN_SCRIPT="/Users/brodieyazaki/work/agent-tools/the-eng-org/.claude/scripts/teo-issue-identity-token"
HOOK="/Users/brodieyazaki/work/agent-tools/the-eng-org/.claude/hooks/teo-sage-constraint.sh"
FIXTURES_DIR="/Users/brodieyazaki/work/agent-tools/the-eng-org/tests/spawn-primitive/fixtures"

setup() {
  TMPDIR="$(mktemp -d /tmp/bats-teo-spawn-XXXXXX)"
  export TMPDIR
  export TEO_PROJECT_ROOT="$TMPDIR"
  mkdir -p "$TMPDIR/.claude/memory/identity-tokens"
  mkdir -p "$TMPDIR/.claude/memory/traces"
  mkdir -p "$TMPDIR/.claude/agents"
  for role_dir in "$FIXTURES_DIR/mock-agents"/*/; do
    role="$(basename "$role_dir")"
    mkdir -p "$TMPDIR/.claude/agents/$role"
    cp "$role_dir/agent.md" "$TMPDIR/.claude/agents/$role/agent.md"
  done
}

teardown() {
  [ -d "$TMPDIR" ] && find "$TMPDIR" -mindepth 1 -delete 2>/dev/null || true
  rmdir "$TMPDIR" 2>/dev/null || true
}

invoke_hook_write() {
  local file_path="$1" exec_id="$2"
  printf "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"%s\",\"content\":\"test\"}}" "$file_path" \
    | AGENT_IDENTITY_TOKEN="$exec_id" TEO_PROJECT_ROOT="$TMPDIR" "$HOOK" 2>/dev/null
}

@test "T1: spawn_emits_valid_json_for_known_role" {
  run "$SCRIPT" dev --workstream ws-test
  [ "$status" -eq 0 ]
  echo "$output" | jq -e .execution_id
  echo "$output" | jq -e .agent_identity_token
  echo "$output" | jq -e '.role == "dev"'
  echo "$output" | jq -e '.model == "sonnet"'
  echo "$output" | jq -e '.workstream_id == "ws-test"'
}

@test "T2: spawn_generates_unique_execution_ids" {
  run "$SCRIPT" dev
  [ "$status" -eq 0 ]
  EID1=$(echo "$output" | jq -r .execution_id)
  run "$SCRIPT" dev
  [ "$status" -eq 0 ]
  EID2=$(echo "$output" | jq -r .execution_id)
  [ "$EID1" != "$EID2" ]
  [ -n "$EID1" ]
  [ -n "$EID2" ]
}

@test "T3: spawn_issues_token_file_on_disk" {
  run "$SCRIPT" dev --workstream ws-test
  [ "$status" -eq 0 ]
  EID=$(echo "$output" | jq -r .execution_id)
  TOKEN_FILE="$TMPDIR/.claude/memory/identity-tokens/${EID}.json"
  [ -f "$TOKEN_FILE" ]
}

@test "T4: spawn_token_file_has_correct_role" {
  run "$SCRIPT" dev --workstream ws-test
  [ "$status" -eq 0 ]
  EID=$(echo "$output" | jq -r .execution_id)
  TOKEN_FILE="$TMPDIR/.claude/memory/identity-tokens/${EID}.json"
  [ -f "$TOKEN_FILE" ]
  jq -e '.role == "dev"' "$TOKEN_FILE"
  TFILE_EID=$(jq -r .execution_id "$TOKEN_FILE")
  [ "$TFILE_EID" = "$EID" ]
}

@test "T5: spawn_refuses_duplicate_execution_id" {
  PRE_EXISTING_EID="replay-test-eid-$(date +%s)"
  touch "$TMPDIR/.claude/memory/identity-tokens/${PRE_EXISTING_EID}.json"
  run "$ISSUE_TOKEN_SCRIPT" "$PRE_EXISTING_EID" dev -
  [ "$status" -eq 1 ]
  echo "$output" | grep -qi "duplicate issuance refused"
}

@test "T6: spawn_resolves_model_from_frontmatter_dev" {
  run "$SCRIPT" dev
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.model == "sonnet"'
}

@test "T7: spawn_resolves_model_from_frontmatter_deployment_engineer" {
  run "$SCRIPT" deployment-engineer
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.model == "haiku"'
}

@test "T8: spawn_explicit_model_overrides_frontmatter" {
  run "$SCRIPT" dev --model haiku
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.model == "haiku"'
}

@test "T9: spawn_writes_sage_active_execution_id_marker" {
  run "$SCRIPT" dev --workstream ws-test
  [ "$status" -eq 0 ]
  EID=$(echo "$output" | jq -r .execution_id)
  MARKER="$TMPDIR/.claude/memory/traces/sage-active-execution-id"
  [ -f "$MARKER" ]
  jq -e .execution_id "$MARKER"
  MARKER_EID=$(jq -r .execution_id "$MARKER")
  MARKER_ROLE=$(jq -r .role "$MARKER")
  [ "$MARKER_EID" = "$EID" ]
  [ "$MARKER_ROLE" = "dev" ]
}

@test "T10: spawn_workstream_defaults_to_null_when_not_passed" {
  run "$SCRIPT" dev
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.workstream_id == null'
}

@test "T11: spawn_workstream_passed_through" {
  run "$SCRIPT" dev --workstream ws-marker-fix
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.workstream_id == "ws-marker-fix"'
}

@test "T12: spawn_max_turns_null_when_not_passed_and_frontmatter_absent" {
  run "$SCRIPT" no-maxturns-role
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.max_turns == null'
}

@test "T13: spawn_max_turns_from_frontmatter_when_present" {
  run "$SCRIPT" dev
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.max_turns == 300'
}

@test "T14: spawn_explicit_max_turns_overrides_frontmatter" {
  run "$SCRIPT" dev --max-turns 30
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.max_turns == 30'
}

@test "T15: spawn_fails_with_exit_1_on_unknown_role" {
  run "$SCRIPT" nonexistent-role
  [ "$status" -eq 1 ]
  TOKEN_COUNT=$(ls "$TMPDIR/.claude/memory/identity-tokens/" | wc -l | tr -d " ")
  [ "$TOKEN_COUNT" = "0" ]
}

@test "T16: spawn_token_in_output_json_matches_token_file" {
  run "$SCRIPT" dev
  [ "$status" -eq 0 ]
  EID=$(echo "$output" | jq -r .execution_id)
  TOKEN_OUT=$(echo "$output" | jq -r .agent_identity_token)
  TOKEN_FILE_VAL=$(jq -r .token "$TMPDIR/.claude/memory/identity-tokens/${EID}.json")
  [ "$TOKEN_OUT" = "$TOKEN_FILE_VAL" ]
}

@test "T17: spawn_execution_id_in_output_matches_token_file" {
  run "$SCRIPT" dev
  [ "$status" -eq 0 ]
  EID=$(echo "$output" | jq -r .execution_id)
  TOKEN_FILE="$TMPDIR/.claude/memory/identity-tokens/${EID}.json"
  FILE_EID=$(jq -r .execution_id "$TOKEN_FILE")
  [ "$EID" = "$FILE_EID" ]
}

@test "T18: spawn_agent_identity_token_enables_constraint_hook_allow" {
  touch "$TMPDIR/.claude/memory/traces/sage-spawned"
  SPAWN_OUTPUT=$("$SCRIPT" dev --workstream ws-test)
  EID=$(echo "$SPAWN_OUTPUT" | jq -r .execution_id)
  run invoke_hook_write "/Users/somebody/project/src/main.ts" "$EID"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '. == {} or .hookSpecificOutput.permissionDecision == "allow"'
}

@test "T19: spawn_sage_role_token_still_blocked_by_constraint_hook" {
  touch "$TMPDIR/.claude/memory/traces/sage-spawned"
  SPAWN_OUTPUT=$("$SCRIPT" sage --workstream ws-test)
  EID=$(echo "$SPAWN_OUTPUT" | jq -r .execution_id)
  run invoke_hook_write "/Users/somebody/project/src/main.ts" "$EID"
  [ "$status" -eq 2 ]
  echo "$output" | jq -e '.hookSpecificOutput.permissionDecision == "deny"'
}
