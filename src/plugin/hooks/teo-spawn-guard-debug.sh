#!/usr/bin/env bash
# =============================================================================
# teo-spawn-guard-debug.sh — PreToolUse debug logger
#
# PURPOSE
#   Empirical tool: logs the full PreToolUse stdin JSON to a file so we can
#   confirm exact payload field names before the real guard relies on them.
#   Fires on tool_name "Agent" AND "Task" (legacy). Never blocks — always
#   exits 0 (fail-open, observational only).
#
# ENV VARS
#   SPAWN_GUARD_DEBUG_LOG  Full path for the log file. If not set, writes to
#                          ${PROJECT_ROOT}/.claude/memory/traces/spawn-guard-debug-<ts>.json
#   TEO_PROJECT_ROOT       Override project root. If unset, uses git rev-parse
#                          --show-toplevel, else $PWD.
#
# EXIT CODES
#   0  Always (fail-open — this hook NEVER blocks)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve PROJECT_ROOT
# ---------------------------------------------------------------------------
if [ -n "${TEO_PROJECT_ROOT:-}" ]; then
  PROJECT_ROOT="${TEO_PROJECT_ROOT}"
elif command -v git &>/dev/null; then
  PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "${PWD}")"
else
  PROJECT_ROOT="${PWD}"
fi

# ---------------------------------------------------------------------------
# Require jq — fail-open if missing
# ---------------------------------------------------------------------------
if ! command -v jq &>/dev/null; then
  echo "WARN [teo-spawn-guard-debug]: jq not found — cannot parse stdin JSON; skipping log" >&2
  exit 0
fi

# ---------------------------------------------------------------------------
# Read stdin
# ---------------------------------------------------------------------------
STDIN_CONTENT="$(cat)"

# ---------------------------------------------------------------------------
# Validate JSON — fail-open on bad input, no log file written
# ---------------------------------------------------------------------------
if ! echo "${STDIN_CONTENT}" | jq . &>/dev/null; then
  echo "WARN [teo-spawn-guard-debug]: stdin is not valid JSON — skipping log" >&2
  exit 0
fi

# Handle empty stdin (jq parses empty string as 'null' which is valid-ish,
# but we want to treat empty stdin as "no payload" — skip logging)
if [ -z "${STDIN_CONTENT}" ]; then
  echo "WARN [teo-spawn-guard-debug]: stdin is empty — skipping log" >&2
  exit 0
fi

# jq treats empty string as parse error above, but double-check null
PARSED_TYPE="$(echo "${STDIN_CONTENT}" | jq -r 'type' 2>/dev/null || echo "null")"
if [ "${PARSED_TYPE}" = "null" ]; then
  echo "WARN [teo-spawn-guard-debug]: stdin parsed as null — skipping log" >&2
  exit 0
fi

# ---------------------------------------------------------------------------
# Determine log path
# ---------------------------------------------------------------------------
if [ -n "${SPAWN_GUARD_DEBUG_LOG:-}" ]; then
  LOG_PATH="${SPAWN_GUARD_DEBUG_LOG}"
else
  TIMESTAMP="$(date +%Y%m%d%H%M%S)"
  TRACES_DIR="${PROJECT_ROOT}/.claude/memory/traces"
  mkdir -p "${TRACES_DIR}" 2>/dev/null || true
  LOG_PATH="${TRACES_DIR}/spawn-guard-debug-${TIMESTAMP}.json"
fi

# ---------------------------------------------------------------------------
# Ensure parent directory exists
# ---------------------------------------------------------------------------
LOG_DIR="$(dirname "${LOG_PATH}")"
mkdir -p "${LOG_DIR}" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Write log — pretty-print the JSON payload
# ---------------------------------------------------------------------------
echo "${STDIN_CONTENT}" | jq . > "${LOG_PATH}" 2>/dev/null || {
  echo "WARN [teo-spawn-guard-debug]: failed to write log to ${LOG_PATH}" >&2
}

exit 0
