#!/usr/bin/env bats
# =============================================================================
# teo-claim-evidence-gate-rule2.bats
# Suite: teo-claim-evidence-gate Rule 2 -- spawn prompt priming
# =============================================================================

HOOK=".claude/hooks/teo-claim-evidence-gate.sh"
SPAWN_PATH=".claude/memory/spawn-requests/req-001.json"

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

# Build and invoke hook for a spawn-request path with a prompt string
hook_spawn() {
  local prompt="$1"
  local tier="${2:-standard}"
  export TEO_CLAIM_EVIDENCE_TIER="$tier"
  local content
  content="$(jq -n --arg p "$prompt" '{"prompt":$p}')"
  local payload
  payload="$(jq -n \
    --arg fp "$SPAWN_PATH" \
    --arg c "$content" \
    '{"tool_name":"Write","tool_input":{"file_path":$fp,"content":$c}}')"
  printf '%s' "$payload" | "$HOOK"
}

# Build and invoke hook for spawn-request with raw content JSON object
hook_spawn_raw() {
  local content="$1"
  local tier="${2:-standard}"
  export TEO_CLAIM_EVIDENCE_TIER="$tier"
  local payload
  payload="$(jq -n \
    --arg fp "$SPAWN_PATH" \
    --arg c "$content" \
    '{"tool_name":"Write","tool_input":{"file_path":$fp,"content":$c}}')"
  printf '%s' "$payload" | "$HOOK"
}

# =============================================================================
# R2-WARN cases (standard tier)
# =============================================================================

@test "R2-WARN-1: 'confirm that' in prompt at standard tier -- exit 0 with warn" {
  run --separate-stderr hook_spawn "confirm that ADR-046 was applied and proceed" "standard"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"spawn_prompt_preconcludes"* ]]
}

@test "R2-WARN-2: 'verify that X is' in prompt at standard tier -- exit 0 with warn" {
  run --separate-stderr hook_spawn "verify that the prerequisite is satisfied before spawning" "standard"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"spawn_prompt_preconcludes"* ]]
}

@test "R2-WARN-3: 'make sure X is COMPLETE' in prompt at standard tier -- exit 0 with warn" {
  run --separate-stderr hook_spawn "make sure the migration is COMPLETE before reporting" "standard"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"spawn_prompt_preconcludes"* ]]
}

@test "R2-WARN-4: 'double-check that X passed' at standard tier -- exit 0 with warn" {
  run --separate-stderr hook_spawn "double-check that the test suite passed" "standard"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"spawn_prompt_preconcludes"* ]]
}

# =============================================================================
# R2-BLOCK cases (strict tier)
# =============================================================================

@test "R2-BLOCK-1: 'confirm that' at strict tier -- exit 2" {
  run hook_spawn "confirm that the deployment succeeded" "strict"
  [ "$status" -eq 2 ]
  [[ "$output" == *"spawn_prompt_preconcludes"* ]]
  [[ "$output" == *"permissionDecision"* ]]
}

@test "R2-BLOCK-2: 'verify that X is' at strict tier -- exit 2" {
  run hook_spawn "verify that the ruling is valid" "strict"
  [ "$status" -eq 2 ]
  [[ "$output" == *"spawn_prompt_preconcludes"* ]]
}

@test "R2-BLOCK-3: 'make sure X is COMPLETE' at strict tier -- exit 2" {
  run hook_spawn "make sure phase-0 is COMPLETE" "strict"
  [ "$status" -eq 2 ]
  [[ "$output" == *"spawn_prompt_preconcludes"* ]]
}

@test "R2-BLOCK-4: 'double-check that X passed' at strict tier -- exit 2" {
  run hook_spawn "double-check that the gate passed" "strict"
  [ "$status" -eq 2 ]
  [[ "$output" == *"spawn_prompt_preconcludes"* ]]
}

# =============================================================================
# R2-PASS cases
# =============================================================================

@test "R2-PASS-1: pose-the-problem template -- allow at both tiers" {
  local prompt
  prompt="PROBLEM: Does ADR-046 apply to this repo?
PRIOR CLAIMS (to challenge, not confirm): Prior turns asserted ADR-046 was applied.
SOURCE OF TRUTH: .claude/shared/a2a-architecture.md, git log
RETURN: reconciled finding + evidence paths verified on disk"
  run --separate-stderr hook_spawn "$prompt" "standard"
  [ "$status" -eq 0 ]
  [[ "$stderr" != *"spawn_prompt_preconcludes"* ]]
}

@test "R2-PASS-2: 'verify' present but not full pattern 'verify that X is' -- allow" {
  run --separate-stderr hook_spawn "verify the file contents against the schema" "standard"
  [ "$status" -eq 0 ]
  [[ "$stderr" != *"spawn_prompt_preconcludes"* ]]
}

@test "R2-PASS-3: spawn request with no prompt field -- fail-open exit 0" {
  local content='{"subagent_type":"dev","model":"claude-sonnet-4-6"}'
  run hook_spawn_raw "$content" "standard"
  [ "$status" -eq 0 ]
}

@test "R2-PASS-4: spawn request with null prompt -- fail-open exit 0" {
  local content='{"prompt":null}'
  run hook_spawn_raw "$content" "standard"
  [ "$status" -eq 0 ]
}

@test "R2-PASS-5: 'confirmed' in narrative (not 'confirm that' pattern) -- allow" {
  run --separate-stderr hook_spawn "The prior agent confirmed the file structure. Investigate whether that finding holds." "standard"
  [ "$status" -eq 0 ]
  [[ "$stderr" != *"spawn_prompt_preconcludes"* ]]
}

# =============================================================================
# FIRE-4
# =============================================================================

@test "FIRE-4: spawn-requests/*.json path triggers gate" {
  # confirm-that at strict tier on spawn-request path -> BLOCK
  run hook_spawn "confirm that the deployment succeeded" "strict"
  [ "$status" -eq 2 ]
  [[ "$output" == *"spawn_prompt_preconcludes"* ]]
}
