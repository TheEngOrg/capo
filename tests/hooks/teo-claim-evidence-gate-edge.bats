#!/usr/bin/env bats
# =============================================================================
# teo-claim-evidence-gate-edge.bats
# Suite: teo-claim-evidence-gate edge cases
# =============================================================================

HOOK=".claude/hooks/teo-claim-evidence-gate.sh"

setup() {
  export TEO_PROJECT_ROOT
  TEO_PROJECT_ROOT="$(mktemp -d)"
  mkdir -p "${TEO_PROJECT_ROOT}/.claude/memory/pipeline"
  mkdir -p "${TEO_PROJECT_ROOT}/.claude/memory/go-signals"
  mkdir -p "${TEO_PROJECT_ROOT}/.claude/memory/spawn-requests"
  unset TEO_CLAIM_EVIDENCE_TIER
}

teardown() {
  if [[ -n "${TEO_PROJECT_ROOT:-}" && "$TEO_PROJECT_ROOT" == /tmp/* ]]; then
    rm -rf "$TEO_PROJECT_ROOT"
  fi
}

# --- Helpers -----------------------------------------------------------------

hook_gosignal() {
  local content="$1"
  local tier="${2:-standard}"
  export TEO_CLAIM_EVIDENCE_TIER="$tier"
  local payload
  payload="$(jq -n \
    --arg fp ".claude/memory/go-signals/WS-TEST.json" \
    --arg c "$content" \
    '{"tool_name":"Write","tool_input":{"file_path":$fp,"content":$c}}')"
  printf '%s' "$payload" | "$HOOK"
}

hook_spawn() {
  local content="$1"
  local tier="${2:-standard}"
  export TEO_CLAIM_EVIDENCE_TIER="$tier"
  local payload
  payload="$(jq -n \
    --arg fp ".claude/memory/spawn-requests/req-001.json" \
    --arg c "$content" \
    '{"tool_name":"Write","tool_input":{"file_path":$fp,"content":$c}}')"
  printf '%s' "$payload" | "$HOOK"
}

hook_sage() {
  local content="$1"
  local tier="${2:-standard}"
  export TEO_CLAIM_EVIDENCE_TIER="$tier"
  local payload
  payload="$(jq -n \
    --arg fp ".claude/memory/pipeline/sage-result.json" \
    --arg c "$content" \
    '{"tool_name":"Write","tool_input":{"file_path":$fp,"content":$c}}')"
  printf '%s' "$payload" | "$HOOK"
}

# =============================================================================
# Edge cases
# =============================================================================

@test "EDGE-1: empty evidence array with terminal claim -- BLOCK" {
  local content='{"status":"COMPLETE","evidence":[]}'
  run hook_gosignal "$content"
  [ "$status" -eq 2 ]
  [[ "$output" == *"done_claim_without_verified_evidence"* ]]
}

@test "EDGE-2: evidence array with one missing path -- BLOCK (AND-logic)" {
  local ev_exists="${TEO_PROJECT_ROOT}/exists.json"
  touch "$ev_exists"
  local ev_missing="${TEO_PROJECT_ROOT}/does-not-exist.json"
  local content
  content="$(jq -n --arg a "$ev_exists" --arg b "$ev_missing" \
    '{"verdict":"PASS","evidence":[$a,$b]}')"
  run hook_gosignal "$content"
  [ "$status" -eq 2 ]
  [[ "$output" == *"done_claim_without_verified_evidence"* ]]
}

@test "EDGE-3: non-JSON content at matching path -- fail-open exit 0" {
  # Content is non-JSON bash script text
  hook_non_json() {
    local payload
    payload='{"tool_name":"Write","tool_input":{"file_path":".claude/memory/pipeline/sage-result.json","content":"#!/bin/bash\necho not json\n"}}'
    printf '%s' "$payload" | "$HOOK"
  }
  run hook_non_json
  [ "$status" -eq 0 ]
}

@test "EDGE-4: TEO_CLAIM_EVIDENCE_TIER=strict promotes Rule 2 WARN to BLOCK" {
  # R2-WARN-1 scenario at strict tier
  local content
  content="$(jq -n --arg p "confirm that ADR-046 was applied" '{"prompt":$p}')"
  run hook_spawn "$content" "strict"
  [ "$status" -eq 2 ]
  [[ "$output" == *"spawn_prompt_preconcludes"* ]]
}

@test "EDGE-5: strict tier does not relax Rule 1 PASS cases" {
  # R1-PASS-1 at strict tier: PASS with evidence should still be 0
  local ev_file="${TEO_PROJECT_ROOT}/exists.json"
  touch "$ev_file"
  local content
  content="$(jq -n --arg p "$ev_file" '{"status":"COMPLETE","evidence":[$p]}')"
  run hook_gosignal "$content" "strict"
  [ "$status" -eq 0 ]
}

@test "EDGE-5b: strict tier does not relax Rule 1 BLOCK cases" {
  # R1-BLOCK-1 at strict tier: BLOCK (no evidence) should still be exit 2
  local content='{"status":"COMPLETE"}'
  run hook_gosignal "$content" "strict"
  [ "$status" -eq 2 ]
  [[ "$output" == *"done_claim_without_verified_evidence"* ]]
}

@test "EDGE-6: spawn-request with terminal claim AND priming pattern -- BLOCK wins" {
  # Spawn-request with status:COMPLETE (no evidence) AND "confirm that" pattern
  # Rule 1 fires first (terminal claim + no evidence) -> BLOCK
  local content
  content="$(jq -n '{"prompt":"confirm that the migration is done","status":"COMPLETE"}')"
  run hook_spawn "$content" "standard"
  [ "$status" -eq 2 ]
  # Either signal is valid -- Rule 1 fires first so we expect done_claim
  [[ "$output" == *"done_claim_without_verified_evidence"* ]] || \
    [[ "$output" == *"spawn_prompt_preconcludes"* ]]
}

@test "EDGE-7: unknown TEO_CLAIM_EVIDENCE_TIER value -- falls back to standard" {
  # "experimental" tier -> falls back to standard -> WARN not BLOCK for Rule 2
  local content
  content="$(jq -n --arg p "confirm that ADR-046 was applied" '{"prompt":$p}')"
  run --separate-stderr hook_spawn "$content" "experimental"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"spawn_prompt_preconcludes"* ]]
}

@test "EDGE-8: relative evidence path resolved from PROJECT_ROOT -- allow if exists" {
  # Create the file relative to PROJECT_ROOT
  local rel_path=".claude/memory/go-signals/some-signal.json"
  touch "${TEO_PROJECT_ROOT}/${rel_path}"
  local content
  content="$(jq -n --arg p "$rel_path" '{"status":"COMPLETE","evidence":[$p]}')"
  run hook_gosignal "$content"
  [ "$status" -eq 0 ]
}
