#!/usr/bin/env bats
# =============================================================================
# pre-bash-write-guard.bats
# Suite: Bash-tool protected-path write enforcement (WS-ORCH-FIX)
# =============================================================================
# Tests the behavioral contract for the guard that closes the cp/mv/tee gap.
# $GUARD is the entry point under test. For Option A (teo-bash-arg-validator
# extended), set GUARD=".claude/scripts/teo-bash-arg-validator" and invoke as
# a script. For Option B (new hook), set GUARD=".claude/hooks/pre-bash-write-guard.sh"
# and pipe the full Claude Code PreToolUse JSON shape.
#
# The hook interface is the stdin JSON shape:
#   {"tool_name":"Bash","tool_input":{"command":"<string>"}}
#
# Exit 2 + deny JSON = BLOCK.
# Exit 0 + {} = ALLOW.
# =============================================================================

GUARD=".claude/hooks/pre-bash-write-guard.sh"

setup() {
  export TEO_PROJECT_ROOT
  TEO_PROJECT_ROOT="$(mktemp -d)"
  mkdir -p "${TEO_PROJECT_ROOT}/.claude/memory/traces"
  unset TEO_APPLY_EDIT_BYPASS
}

teardown() {
  if [[ -n "${TEO_PROJECT_ROOT:-}" && "$TEO_PROJECT_ROOT" == /tmp/* ]]; then
    rm -rf "$TEO_PROJECT_ROOT"
  fi
}

# --- Helpers ------------------------------------------------------------------

hook_bash() {
  local cmd="$1"
  local payload
  payload="$(jq -n --arg c "$cmd" \
    '{"tool_name":"Bash","tool_input":{"command":$c}}')"
  printf '%s' "$payload" | "$GUARD"
}

hook_bash_with_bypass() {
  local cmd="$1"
  local bypass="$2"
  local payload
  payload="$(jq -n --arg c "$cmd" \
    '{"tool_name":"Bash","tool_input":{"command":$c}}')"
  export TEO_APPLY_EDIT_BYPASS="$bypass"
  printf '%s' "$payload" | "$GUARD"
  local ret=$?
  unset TEO_APPLY_EDIT_BYPASS
  return $ret
}

# =============================================================================
# BLOCK cases — cp/mv/tee writing to protected prefixes
# =============================================================================

# --- .claude/hooks/** ---------------------------------------------------------

@test "BLOCK-1a: cp to .claude/hooks/ -- BLOCK" {
  run hook_bash "cp /tmp/myfile.sh .claude/hooks/evil.sh"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"permissionDecision":"deny"'* ]] || \
    [[ "$output" == *'"permissionDecision": "deny"'* ]]
}

@test "BLOCK-1b: mv to .claude/hooks/ -- BLOCK" {
  run hook_bash "mv /tmp/myfile.sh .claude/hooks/evil.sh"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"permissionDecision":"deny"'* ]] || \
    [[ "$output" == *'"permissionDecision": "deny"'* ]]
}

@test "BLOCK-1c: tee writing to .claude/hooks/ -- BLOCK" {
  run hook_bash "tee .claude/hooks/evil.sh"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"permissionDecision":"deny"'* ]] || \
    [[ "$output" == *'"permissionDecision": "deny"'* ]]
}

# --- .claude/scripts/** -------------------------------------------------------

@test "BLOCK-2a: cp to .claude/scripts/ -- BLOCK" {
  run hook_bash "cp /tmp/helper.sh .claude/scripts/teo-malicious"
  [ "$status" -eq 2 ]
}

@test "BLOCK-2b: mv to .claude/scripts/ -- BLOCK" {
  run hook_bash "mv /tmp/helper.sh .claude/scripts/teo-malicious"
  [ "$status" -eq 2 ]
}

@test "BLOCK-2c: tee to .claude/scripts/ -- BLOCK" {
  run hook_bash "tee .claude/scripts/teo-malicious"
  [ "$status" -eq 2 ]
}

# --- .claude/shared/** --------------------------------------------------------

@test "BLOCK-3a: cp to .claude/shared/ -- BLOCK" {
  run hook_bash "cp /tmp/doc.md .claude/shared/handoff-protocol.md"
  [ "$status" -eq 2 ]
}

@test "BLOCK-3b: mv to .claude/shared/ -- BLOCK" {
  run hook_bash "mv /tmp/doc.md .claude/shared/handoff-protocol.md"
  [ "$status" -eq 2 ]
}

# --- .claude/agents/** --------------------------------------------------------

@test "BLOCK-4a: cp to .claude/agents/ -- BLOCK" {
  run hook_bash "cp /tmp/agent.md .claude/agents/qa/agent.md"
  [ "$status" -eq 2 ]
}

@test "BLOCK-4b: mv to .claude/agents/ -- BLOCK" {
  run hook_bash "mv /tmp/agent.md .claude/agents/dev/agent.md"
  [ "$status" -eq 2 ]
}

# --- .claude/settings.json (exact file, not a directory) ----------------------

@test "BLOCK-5a: cp to .claude/settings.json -- BLOCK" {
  run hook_bash "cp /tmp/settings.json .claude/settings.json"
  [ "$status" -eq 2 ]
}

@test "BLOCK-5b: mv to .claude/settings.json -- BLOCK" {
  run hook_bash "mv /tmp/settings.json .claude/settings.json"
  [ "$status" -eq 2 ]
}

@test "BLOCK-5c: tee to .claude/settings.json -- BLOCK" {
  run hook_bash "tee .claude/settings.json"
  [ "$status" -eq 2 ]
}

# --- docs/** ------------------------------------------------------------------

@test "BLOCK-6a: cp to docs/ -- BLOCK" {
  run hook_bash "cp /tmp/README.md docs/index.md"
  [ "$status" -eq 2 ]
}

@test "BLOCK-6b: mv to docs/ -- BLOCK" {
  run hook_bash "mv /tmp/README.md docs/adr/ADR-099.md"
  [ "$status" -eq 2 ]
}

# --- src/** -------------------------------------------------------------------

@test "BLOCK-7a: cp to src/ -- BLOCK" {
  run hook_bash "cp /tmp/index.ts src/index.ts"
  [ "$status" -eq 2 ]
}

@test "BLOCK-7b: mv to src/ -- BLOCK" {
  run hook_bash "mv /tmp/index.ts src/lib/index.ts"
  [ "$status" -eq 2 ]
}

# --- packages/** --------------------------------------------------------------

@test "BLOCK-8a: cp to packages/ -- BLOCK" {
  run hook_bash "cp /tmp/dist.js packages/core/dist.js"
  [ "$status" -eq 2 ]
}

@test "BLOCK-8b: mv to packages/ -- BLOCK" {
  run hook_bash "mv /tmp/dist.js packages/core/dist.js"
  [ "$status" -eq 2 ]
}

# =============================================================================
# ALLOW cases — non-protected destinations, no false positives
# =============================================================================

@test "ALLOW-1: cp to /tmp/ -- ALLOW (non-protected)" {
  run hook_bash "cp .claude/hooks/pre-edit-write-guard.sh /tmp/backup.sh"
  [ "$status" -eq 0 ]
}

@test "ALLOW-2: mv to /tmp/ -- ALLOW (non-protected)" {
  run hook_bash "mv .claude/memory/old-file.json /tmp/old-file.json"
  [ "$status" -eq 0 ]
}

@test "ALLOW-3: cp to .claude/memory/ -- ALLOW (non-protected)" {
  run hook_bash "cp /tmp/result.json .claude/memory/pipeline/ws-test-output.json"
  [ "$status" -eq 0 ]
}

@test "ALLOW-4: mv to .claude/memory/ -- ALLOW (non-protected)" {
  run hook_bash "mv .claude/memory/old.json .claude/memory/archive/old.json"
  [ "$status" -eq 0 ]
}

@test "ALLOW-5: cp from protected to /tmp/ (read-only copy out) -- ALLOW" {
  run hook_bash "cp .claude/hooks/pre-edit-write-guard.sh /tmp/guard-backup.sh"
  [ "$status" -eq 0 ]
}

@test "ALLOW-6: tee to /tmp/ -- ALLOW (non-protected)" {
  run hook_bash "tee /tmp/output.txt"
  [ "$status" -eq 0 ]
}

@test "ALLOW-7: cp to project-local non-protected subdir -- ALLOW" {
  run hook_bash "cp /tmp/data.json .claude/memory/decisions/D-099.md"
  [ "$status" -eq 0 ]
}

@test "ALLOW-8: non-cp/mv/tee command -- ALLOW (out of scope)" {
  run hook_bash "git status"
  [ "$status" -eq 0 ]
}

@test "ALLOW-9: ls of a protected path (read-only) -- ALLOW (destination not written)" {
  run hook_bash "ls .claude/hooks/"
  [ "$status" -eq 0 ]
}

# =============================================================================
# Bypass token cases
# =============================================================================

@test "BYPASS-1: valid bypass token on protected cp -- ALLOW" {
  run hook_bash_with_bypass \
    "cp /tmp/hook.sh .claude/hooks/my-hook.sh" \
    "teo-ae-12345-1717000000"
  [ "$status" -eq 0 ]
}

@test "BYPASS-2: valid bypass token on protected mv -- ALLOW" {
  run hook_bash_with_bypass \
    "mv /tmp/hook.sh .claude/scripts/teo-new-script" \
    "teo-ae-99999-1717000001"
  [ "$status" -eq 0 ]
}

@test "BYPASS-3: malformed bypass token on protected cp -- BLOCK" {
  # Token does not match ^teo-ae-[0-9]+-[0-9]+$
  run hook_bash_with_bypass \
    "cp /tmp/hook.sh .claude/hooks/evil.sh" \
    "not-a-valid-token"
  [ "$status" -eq 2 ]
}

@test "BYPASS-4: empty bypass token on protected cp -- BLOCK" {
  run hook_bash_with_bypass \
    "cp /tmp/hook.sh .claude/hooks/evil.sh" \
    ""
  [ "$status" -eq 2 ]
}

@test "BYPASS-5: valid bypass token on non-protected cp -- ALLOW (bypass irrelevant)" {
  run hook_bash_with_bypass \
    "cp /tmp/file.json .claude/memory/traces/out.json" \
    "teo-ae-12345-1717000000"
  [ "$status" -eq 0 ]
}

# =============================================================================
# Path resolution / normalization cases
# =============================================================================

@test "PATH-1: relative path with ./ prefix to protected path -- BLOCK" {
  run hook_bash "cp /tmp/x.sh ./.claude/hooks/evil.sh"
  [ "$status" -eq 2 ]
}

@test "PATH-2: absolute dest path under PROJECT_ROOT to protected path -- BLOCK" {
  # Guard must strip PROJECT_ROOT prefix before prefix matching (mirrors
  # pre-edit-write-guard.sh behavior for the absolute-path bypass vector).
  run hook_bash "cp /tmp/x.sh ${TEO_PROJECT_ROOT}/.claude/hooks/evil.sh"
  [ "$status" -eq 2 ]
}

@test "PATH-3: path traversal into protected path -- BLOCK" {
  # .claude/memory/../hooks/ resolves to .claude/hooks/ after normalization
  run hook_bash "cp /tmp/x.sh .claude/memory/../hooks/evil.sh"
  [ "$status" -eq 2 ]
}

@test "PATH-4: path traversal to non-protected path -- ALLOW" {
  # /tmp/subdir/../output.json resolves to /tmp/output.json -- not protected
  run hook_bash "cp .claude/hooks/x.sh /tmp/subdir/../output.json"
  [ "$status" -eq 0 ]
}

@test "PATH-5: absolute dest that does NOT resolve under PROJECT_ROOT -- ALLOW" {
  # e.g., /var/tmp is not a protected prefix in any form
  run hook_bash "cp /tmp/x.sh /var/tmp/x.sh"
  [ "$status" -eq 0 ]
}

# =============================================================================
# Fail-open / infrastructure edge cases
# =============================================================================

@test "EDGE-1: empty command -- ALLOW (fail-open, nothing to parse)" {
  local payload
  payload="$(jq -n '{"tool_name":"Bash","tool_input":{"command":""}}')"
  run bash -c "printf '%s' '$payload' | '$GUARD'"
  [ "$status" -eq 0 ]
}

@test "EDGE-2: tool_name is not Bash (Edit shape) -- ALLOW (not in scope)" {
  local payload
  payload="$(jq -n \
    '{"tool_name":"Edit","tool_input":{"file_path":".claude/hooks/x.sh","old_string":"","new_string":""}}')"
  run bash -c "printf '%s' '$payload' | '$GUARD'"
  # The Bash write guard should only act on Bash tool invocations
  [ "$status" -eq 0 ]
}

@test "EDGE-3: command field missing entirely -- ALLOW (fail-open)" {
  local payload
  payload="$(jq -n '{"tool_name":"Bash","tool_input":{}}')"
  run bash -c "printf '%s' '$payload' | '$GUARD'"
  [ "$status" -eq 0 ]
}

@test "EDGE-4: cp with three arguments (cp -r src/ dest/) -- BLOCK if dest is protected" {
  # cp -r /tmp/src/ .claude/hooks/ — destination is still the last positional arg
  run hook_bash "cp -r /tmp/src .claude/hooks/"
  [ "$status" -eq 2 ]
}

@test "EDGE-5: tee with -a flag -- BLOCK if dest is protected" {
  run hook_bash "tee -a .claude/hooks/evil.sh"
  [ "$status" -eq 2 ]
}

@test "EDGE-6: cp with --preserve flag -- BLOCK if dest is protected" {
  run hook_bash "cp --preserve .claude/hooks/x.sh .claude/hooks/y.sh"
  [ "$status" -eq 2 ]
}
