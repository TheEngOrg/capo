#!/usr/bin/env bats
# =============================================================================
# teo-claim-evidence-gate.bats
# Suite: teo-claim-evidence-gate Rule 1 -- done-claim evidence
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
# Each helper builds a payload and pipes it to the hook.
# Call with: run hook_gosignal "$content"
# BATS run captures exit code + stdout into $status/$output.

hook_gosignal() {
  local content="$1"
  local payload
  payload="$(jq -n \
    --arg fp ".claude/memory/go-signals/WS-TEST.json" \
    --arg c "$content" \
    '{"tool_name":"Write","tool_input":{"file_path":$fp,"content":$c}}')"
  printf '%s' "$payload" | "$HOOK"
}

hook_pipeline() {
  local content="$1"
  local payload
  payload="$(jq -n \
    --arg fp ".claude/memory/pipeline/ws-test-output.json" \
    --arg c "$content" \
    '{"tool_name":"Write","tool_input":{"file_path":$fp,"content":$c}}')"
  printf '%s' "$payload" | "$HOOK"
}

hook_sage() {
  local content="$1"
  local payload
  payload="$(jq -n \
    --arg fp ".claude/memory/pipeline/sage-result.json" \
    --arg c "$content" \
    '{"tool_name":"Write","tool_input":{"file_path":$fp,"content":$c}}')"
  printf '%s' "$payload" | "$HOOK"
}

hook_path() {
  local file_path="$1"
  local content="$2"
  local payload
  payload="$(jq -n \
    --arg fp "$file_path" \
    --arg c "$content" \
    '{"tool_name":"Write","tool_input":{"file_path":$fp,"content":$c}}')"
  printf '%s' "$payload" | "$HOOK"
}

hook_raw() {
  local payload="$1"
  printf '%s' "$payload" | "$HOOK"
}

# =============================================================================
# R1-PASS cases
# =============================================================================

@test "R1-PASS-1: status:COMPLETE with existing evidence path -- allow" {
  local ev_file="${TEO_PROJECT_ROOT}/exists.json"
  touch "$ev_file"
  local content
  content="$(jq -n --arg p "$ev_file" '{"status":"COMPLETE","evidence":[$p]}')"
  run hook_gosignal "$content"
  [ "$status" -eq 0 ]
}

@test "R1-PASS-2: verdict:PASS with multiple existing evidence paths -- allow" {
  local ev_a="${TEO_PROJECT_ROOT}/artifact-a.json"
  local ev_b="${TEO_PROJECT_ROOT}/artifact-b.json"
  touch "$ev_a" "$ev_b"
  local content
  content="$(jq -n --arg a "$ev_a" --arg b "$ev_b" '{"verdict":"PASS","evidence":[$a,$b]}')"
  run hook_gosignal "$content"
  [ "$status" -eq 0 ]
}

@test "R1-PASS-3: exists:true with existing evidence path -- allow" {
  local ev_file="${TEO_PROJECT_ROOT}/the-file.md"
  touch "$ev_file"
  local content
  content="$(jq -n --arg p "$ev_file" '{"exists":true,"evidence":[$p]}')"
  run hook_gosignal "$content"
  [ "$status" -eq 0 ]
}

@test "R1-PASS-4: free-text 'passed/verified' with existing evidence -- allow" {
  local ev_file="${TEO_PROJECT_ROOT}/deploy-artifact.json"
  touch "$ev_file"
  local content
  content="$(jq -n --arg p "$ev_file" '{"summary":"All tests passed and deployment verified","evidence":[$p]}')"
  run hook_sage "$content"
  [ "$status" -eq 0 ]
}

@test "R1-PASS-5: no terminal-state claim present -- allow with no evidence" {
  local content='{"status":"IN_PROGRESS","notes":"Still running"}'
  run hook_sage "$content"
  [ "$status" -eq 0 ]
}

@test "R1-PASS-7: status:FAILED is not a terminal claim -- allow" {
  local content='{"status":"FAILED","summary":"Build failed at step 3"}'
  run hook_sage "$content"
  [ "$status" -eq 0 ]
}

# =============================================================================
# R1-BLOCK cases
# =============================================================================

@test "R1-BLOCK-1: status:COMPLETE with no evidence field -- BLOCK" {
  local content='{"status":"COMPLETE"}'
  run hook_sage "$content"
  [ "$status" -eq 2 ]
  [[ "$output" == *"done_claim_without_verified_evidence"* ]]
  [[ "$output" == *"permissionDecision"* ]]
}

@test "R1-BLOCK-2: verdict:PASS with evidence path missing from disk -- BLOCK" {
  local missing="${TEO_PROJECT_ROOT}/this-file-does-not-exist.json"
  local content
  content="$(jq -n --arg p "$missing" '{"verdict":"PASS","evidence":[$p]}')"
  run hook_gosignal "$content"
  [ "$status" -eq 2 ]
  [[ "$output" == *"done_claim_without_verified_evidence"* ]]
}

@test "R1-BLOCK-3: exists:true with null evidence -- BLOCK" {
  local content='{"exists":true,"evidence":null}'
  run hook_pipeline "$content"
  [ "$status" -eq 2 ]
  [[ "$output" == *"done_claim_without_verified_evidence"* ]]
}

@test "R1-BLOCK-4: free-text 'done' in summary, no evidence -- BLOCK" {
  local content='{"summary":"Migration is done."}'
  run hook_sage "$content"
  [ "$status" -eq 2 ]
  [[ "$output" == *"done_claim_without_verified_evidence"* ]]
}

@test "R1-BLOCK-5: free-text 'confirmed' in nested field, evidence path missing -- BLOCK" {
  local missing="${TEO_PROJECT_ROOT}/nonexistent-prereqs.json"
  local content
  content="$(jq -n --arg p "$missing" \
    '{"result":{"message":"All prerequisites confirmed"},"evidence":[$p]}')"
  run hook_gosignal "$content"
  [ "$status" -eq 2 ]
  [[ "$output" == *"done_claim_without_verified_evidence"* ]]
}

@test "R1-BLOCK-6: status:complete (lowercase) -- BLOCK" {
  local content='{"status":"complete"}'
  run hook_sage "$content"
  [ "$status" -eq 2 ]
  [[ "$output" == *"done_claim_without_verified_evidence"* ]]
}

# =============================================================================
# FIRE / NO-FIRE path filter tests
# =============================================================================

@test "FIRE-1: sage-result.json path triggers gate" {
  local content='{"status":"COMPLETE"}'
  run hook_path ".claude/memory/pipeline/sage-result.json" "$content"
  [ "$status" -eq 2 ]
}

@test "FIRE-2: pipeline/*-output.json path triggers gate" {
  local content='{"status":"COMPLETE"}'
  run hook_path ".claude/memory/pipeline/ws-orch-fix-output.json" "$content"
  [ "$status" -eq 2 ]
}

@test "FIRE-3: go-signals/*.json path triggers gate" {
  local content='{"status":"COMPLETE"}'
  run hook_path ".claude/memory/go-signals/WS-ORCH-FIX-qa-spec.json" "$content"
  [ "$status" -eq 2 ]
}

@test "NO-FIRE-1: .ts source file -- gate skips" {
  local content='{"status":"COMPLETE"}'
  run hook_path "src/security/identity.ts" "$content"
  [ "$status" -eq 0 ]
}

@test "NO-FIRE-2: .md memory file -- gate skips" {
  local content='{"status":"COMPLETE"}'
  run hook_path ".claude/memory/pipeline/ws-orch-fix-reconciled-proposal.md" "$content"
  [ "$status" -eq 0 ]
}

@test "NO-FIRE-3: .jsonl trace file -- gate skips" {
  local content='{"status":"COMPLETE"}'
  run hook_path ".claude/memory/traces/tool-calls-abc123.jsonl" "$content"
  [ "$status" -eq 0 ]
}

@test "NO-FIRE-4: tool_name:Read -- gate skips" {
  local payload
  payload='{"tool_name":"Read","tool_input":{"file_path":".claude/memory/pipeline/sage-result.json"}}'
  run hook_raw "$payload"
  [ "$status" -eq 0 ]
}

# =============================================================================
# FAIL-OPEN infrastructure cases
# =============================================================================

@test "FAIL-OPEN-1: jq not found -- exit 0" {
  local tmp_bin="${TEO_PROJECT_ROOT}/bin-no-jq"
  mkdir -p "$tmp_bin"
  local hook_abs
  hook_abs="$(pwd)/${HOOK}"
  # Invoke hook in a subshell with restricted PATH (no jq available)
  # Use a helper function to capture correctly with run
  hook_no_jq() {
    local payload='{"tool_name":"Write","tool_input":{"file_path":".claude/memory/pipeline/sage-result.json","content":"{\"status\":\"COMPLETE\"}"}}'
    printf '%s' "$payload" | env PATH="$tmp_bin:$(dirname "$(which git)")" "$hook_abs"
  }
  run hook_no_jq
  [ "$status" -eq 0 ]
}

@test "FAIL-OPEN-2: file_path missing from tool_input -- exit 0" {
  local payload='{"tool_name":"Write","tool_input":{}}'
  run hook_raw "$payload"
  [ "$status" -eq 0 ]
}

@test "FAIL-OPEN-3: tool_name:Edit on matching path -- exit 0" {
  local payload
  payload='{"tool_name":"Edit","tool_input":{"file_path":".claude/memory/pipeline/sage-result.json"}}'
  run hook_raw "$payload"
  [ "$status" -eq 0 ]
}

@test "FAIL-OPEN-4: file content not valid JSON -- exit 0" {
  local payload
  payload='{"tool_name":"Write","tool_input":{"file_path":".claude/memory/pipeline/sage-result.json","content":"#!/bin/bash"}}'
  run hook_raw "$payload"
  [ "$status" -eq 0 ]
}
