#!/usr/bin/env bash
# =============================================================================
# teo-spawn-guard.sh — PreToolUse spawn-permission enforcement hook
#
# PURPOSE
#   Checks caller → target spawn pairs against a build-time allowlist.
#   Operates in log-only mode by default (TEO_SPAWN_GUARD_MODE=observe).
#   Only blocks in TEO_SPAWN_GUARD_MODE=enforce.
#
# KEY DESIGN DECISIONS
#   D1 — Root/main session: when agent_type (top-level field) is absent (main/root
#        session), always ALLOW + log "root-session-allow". Fail-open for root.
#   D2 — Log-only default: TEO_SPAWN_GUARD_MODE defaults to "observe".
#        In observe mode: log everything, never exit 2.
#   D3 — Allowlist at TEO_SPAWN_ALLOWLIST path.
#
# ENV VARS
#   TEO_SPAWN_ALLOWLIST        Path to spawn-allowlist.json
#                              (default: ${CLAUDE_PLUGIN_ROOT}/spawn-allowlist.json)
#   TEO_SPAWN_GUARD_MODE       "observe" (default) or "enforce"
#   TEO_HOOK_LOG_DIR_OVERRIDE  Override directory for spawn-log-YYYY-MM-DD.json
#   TEO_PROJECT_ROOT           Override project root (for git-free test environments)
#
# STDIN JSON SHAPE (Claude Code PreToolUse/Agent)
#   {
#     "tool_name": "Agent" | "Task",
#     "tool_input": { "agent": "<name>" },
#     "agent_type": "<caller-agent-name>",    // optional — absent in root/main session
#     "agent_id": "<caller-agent-id>"         // optional — absent in root/main session
#   }
#
# EXIT CODES
#   0  ALLOW (or observe-mode would-block)
#   2  BLOCK (enforce mode only, when not permitted by allowlist)
# =============================================================================

set -euo pipefail

# =============================================================================
# FUNCTIONS — must be defined before use in bash
# =============================================================================

# resolve_project_root — sets PROJECT_ROOT
resolve_project_root() {
  if [ -n "${TEO_PROJECT_ROOT:-}" ]; then
    PROJECT_ROOT="${TEO_PROJECT_ROOT}"
  elif command -v git &>/dev/null; then
    PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "${PWD}")"
  else
    PROJECT_ROOT="${PWD}"
  fi
}

# resolve_log_dir — sets LOG_DIR
resolve_log_dir() {
  if [ -n "${TEO_HOOK_LOG_DIR_OVERRIDE:-}" ]; then
    LOG_DIR="${TEO_HOOK_LOG_DIR_OVERRIDE}"
  else
    LOG_DIR="${PROJECT_ROOT}/.claude/memory/traces"
  fi
}

# append_log_entry — appends one JSON object to today's spawn-log file
# Usage: append_log_entry <caller> <target> <verdict> <mode> <tool_name>
append_log_entry() {
  local caller="${1}"
  local target="${2}"
  local verdict="${3}"
  local mode="${4}"
  local tool_name="${5}"

  local today
  today="$(date -u +%Y-%m-%d)"
  local log_file="${LOG_DIR}/spawn-log-${today}.json"

  mkdir -p "${LOG_DIR}" 2>/dev/null || true

  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local entry
  entry="$(jq -n \
    --arg timestamp "${ts}" \
    --arg caller "${caller}" \
    --arg target "${target}" \
    --arg verdict "${verdict}" \
    --arg mode "${mode}" \
    --arg tool_name "${tool_name}" \
    '{timestamp: $timestamp, caller: $caller, target: $target, verdict: $verdict, mode: $mode, tool_name: $tool_name}')"

  # Atomically append to JSON array file
  if [ -f "${log_file}" ]; then
    # Read existing array, append entry, write back
    local existing
    existing="$(cat "${log_file}" 2>/dev/null || echo "[]")"
    echo "${existing}" | jq --argjson entry "${entry}" '. + [$entry]' > "${log_file}.tmp" 2>/dev/null && mv "${log_file}.tmp" "${log_file}" || true
  else
    # Create new file with single-entry array
    echo "[${entry}]" | jq . > "${log_file}.tmp" 2>/dev/null && mv "${log_file}.tmp" "${log_file}" || true
  fi
}

# emit_deny_json — writes deny JSON to stdout for enforce-mode blocks
# Usage: emit_deny_json <caller> <target>
emit_deny_json() {
  local caller="${1}"
  local target="${2}"
  local reason="BLOCK: ${caller} is not permitted to spawn '${target}'. See spawn-allowlist.json."

  jq -n \
    --arg reason "${reason}" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
}

# =============================================================================
# MAIN
# =============================================================================

# ---------------------------------------------------------------------------
# Require jq — fail-open if missing
# ---------------------------------------------------------------------------
if ! command -v jq &>/dev/null; then
  echo "WARN [teo-spawn-guard]: jq not found — failing open (all spawns allowed)" >&2
  exit 0
fi

# ---------------------------------------------------------------------------
# Read and validate stdin
# ---------------------------------------------------------------------------
STDIN_CONTENT="$(cat)"

if [ -z "${STDIN_CONTENT}" ]; then
  echo "WARN [teo-spawn-guard]: stdin is empty — failing open" >&2
  exit 0
fi

if ! echo "${STDIN_CONTENT}" | jq . &>/dev/null; then
  echo "WARN [teo-spawn-guard]: stdin is not valid JSON — failing open" >&2
  exit 0
fi

# ---------------------------------------------------------------------------
# Check tool_name — only act on Agent or Task spawns
# ---------------------------------------------------------------------------
TOOL_NAME="$(echo "${STDIN_CONTENT}" | jq -r '.tool_name // empty')"

if [ "${TOOL_NAME}" != "Agent" ] && [ "${TOOL_NAME}" != "Task" ]; then
  # Not a spawn event — pass through silently, no log entry
  exit 0
fi

# ---------------------------------------------------------------------------
# Extract target and caller
# ---------------------------------------------------------------------------
TARGET="$(echo "${STDIN_CONTENT}" | jq -r '.tool_input.agent // empty')"

# agent_type (top-level) is the caller; absent for root/main session
CALLER="$(echo "${STDIN_CONTENT}" | jq -r '.agent_type // empty')"

# ---------------------------------------------------------------------------
# Resolve mode and log dir early (needed for all log calls)
# ---------------------------------------------------------------------------
MODE="${TEO_SPAWN_GUARD_MODE:-observe}"

resolve_project_root
resolve_log_dir

# ---------------------------------------------------------------------------
# D1: Root/main session handling — always fail-open
# ---------------------------------------------------------------------------
if [ -z "${CALLER}" ]; then
  # No top-level agent_type = root/main session; always allow
  append_log_entry "root-session" "${TARGET}" "allowed" "${MODE}" "${TOOL_NAME}"
  exit 0
fi

# ---------------------------------------------------------------------------
# Resolve allowlist path
# ---------------------------------------------------------------------------
if [ -n "${TEO_SPAWN_ALLOWLIST:-}" ]; then
  ALLOWLIST_PATH="${TEO_SPAWN_ALLOWLIST}"
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  ALLOWLIST_PATH="${CLAUDE_PLUGIN_ROOT}/spawn-allowlist.json"
else
  # Fallback: relative to the hook script location
  HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ALLOWLIST_PATH="${HOOK_DIR}/../spawn-allowlist.json"
fi

# ---------------------------------------------------------------------------
# Load allowlist — fail-open if not found or invalid
# ---------------------------------------------------------------------------
if [ ! -f "${ALLOWLIST_PATH}" ]; then
  echo "WARN [teo-spawn-guard]: allowlist not found at '${ALLOWLIST_PATH}' — failing open (all spawns allowed)" >&2
  exit 0
fi

if ! jq . "${ALLOWLIST_PATH}" &>/dev/null; then
  echo "WARN [teo-spawn-guard]: allowlist at '${ALLOWLIST_PATH}' is not valid JSON — failing open" >&2
  exit 0
fi

# ---------------------------------------------------------------------------
# Check caller in allowlist
# ---------------------------------------------------------------------------
CALLER_IN_ALLOWLIST="$(jq -r --arg caller "${CALLER}" '.allowlist | has($caller)' "${ALLOWLIST_PATH}")"

if [ "${CALLER_IN_ALLOWLIST}" != "true" ]; then
  # Caller not in allowlist — not permitted to spawn
  if [ "${MODE}" = "enforce" ]; then
    append_log_entry "${CALLER}" "${TARGET}" "blocked" "${MODE}" "${TOOL_NAME}"
    emit_deny_json "${CALLER}" "${TARGET}"
    exit 2
  else
    append_log_entry "${CALLER}" "${TARGET}" "would-block" "${MODE}" "${TOOL_NAME}"
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Caller is in allowlist — check wildcard or specific targets
# ---------------------------------------------------------------------------
PERMITTED_JSON="$(jq -r --arg caller "${CALLER}" '.allowlist[$caller]' "${ALLOWLIST_PATH}")"

# Check for wildcard ["*"]
IS_WILDCARD="$(echo "${PERMITTED_JSON}" | jq 'length == 1 and .[0] == "*"')"

if [ "${IS_WILDCARD}" = "true" ]; then
  # Wildcard — allowed to spawn any agent
  append_log_entry "${CALLER}" "${TARGET}" "allowed" "${MODE}" "${TOOL_NAME}"
  exit 0
fi

# Specific list — check if target is in the permitted list
TARGET_PERMITTED="$(echo "${PERMITTED_JSON}" | jq -r --arg target "${TARGET}" 'map(select(. == $target)) | length > 0')"

if [ "${TARGET_PERMITTED}" = "true" ]; then
  append_log_entry "${CALLER}" "${TARGET}" "allowed" "${MODE}" "${TOOL_NAME}"
  exit 0
fi

# Target not permitted
if [ "${MODE}" = "enforce" ]; then
  append_log_entry "${CALLER}" "${TARGET}" "blocked" "${MODE}" "${TOOL_NAME}"
  emit_deny_json "${CALLER}" "${TARGET}"
  exit 2
else
  append_log_entry "${CALLER}" "${TARGET}" "would-block" "${MODE}" "${TOOL_NAME}"
  exit 0
fi
