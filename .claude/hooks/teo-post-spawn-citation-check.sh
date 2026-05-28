#!/usr/bin/env bash
# ============================================================================
# teo-post-spawn-citation-check.sh — TEO PostToolUse Hook on Agent/Task
# ============================================================================
# Fires after Agent() or Task() tool calls return. Checks if any new
# researcher output files (.claude/memory/research-*.md) were written
# during the spawn and invokes teo-research-citation-check on each.
#
# Registration: .claude/settings.json hooks.PostToolUse[] matcher: "Agent"
#   (DO NOT register until vacuum-test PASS is confirmed -- Component C gate)
#
# stdin JSON shape (Claude Code PostToolUse/Agent):
#   {
#     "tool_name": "Agent",
#     "tool_input": { ... },
#     "tool_response": { ... }
#   }
#
# Logic:
#   1. Read tool_name from stdin JSON
#   2. If tool_name is not "Agent" or "Task" -> exit 0 (not applicable)
#   3. Find .claude/memory/research-*.md files newer than TEO_CITATION_WINDOW_SECS
#      (default 120 seconds)
#   4. For each new research file: invoke teo-research-citation-check <file>
#   5. CITATION_OK (exit 0) or CITATION_SOFT_FAIL (exit 1) -> log + continue
#   6. CITATION_HARD_FAIL (exit 2) -> write hook-failures.json, emit deny JSON,
#      exit 2 (block)
#
# PostToolUse hooks cannot block operations in most Claude Code versions.
# We emit the deny shape for forward-compat with PreToolUse wiring if it lands.
# Soft fails are logged to hook-failures.json; hard fails also emit deny JSON.
#
# Environment:
#   TEO_PROJECT_ROOT          Override project root (for tests)
#   TEO_CITATION_WINDOW_SECS  Seconds window for "newly written" files (default 120)
#   TEO_CITATION_CHECK_SCRIPT Override path to teo-research-citation-check (for tests)
#
# Fail-open cases (exit 0 with WARN):
#   - jq not found
#   - tool_name not Agent or Task
#   - citation check script not found or not executable
#   - no research-*.md files newer than window
#
# Exit codes:
#   0  ALLOW / no-op
#   2  BLOCK -- citation hard fail detected (hook-failures.json written)
#
# Origin: 2026-04-26 -- Phase 0 Component C -- phase0-citation-check workstream
# See: .claude/memory/pipeline/phase0-compC-output.json
# ============================================================================

set -uo pipefail

# --- Environment -------------------------------------------------------------

# Resolve project root (TEO_PROJECT_ROOT overrides for tests)
if [[ -n "${TEO_PROJECT_ROOT:-}" ]]; then
  PROJECT_ROOT="$TEO_PROJECT_ROOT"
elif command -v git > /dev/null 2>&1; then
  PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")"
else
  PROJECT_ROOT="$PWD"
fi

# Configurable time window for "newly written" files (default 120 seconds)
CITATION_WINDOW_SECS="${TEO_CITATION_WINDOW_SECS:-120}"

# Path to citation check script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CITATION_CHECK_DEFAULT="${SCRIPT_DIR}/../scripts/teo-research-citation-check"
CITATION_CHECK="${TEO_CITATION_CHECK_SCRIPT:-${CITATION_CHECK_DEFAULT}}"

# Traces directory for hook-failures.json
TRACES_DIR="${PROJECT_ROOT}/.claude/memory/traces"
HOOK_FAILURES_LOG="${TRACES_DIR}/hook-failures.json"

# --- Infrastructure checks ---------------------------------------------------

if ! command -v jq > /dev/null 2>&1; then
  printf 'WARN: jq not found -- teo-post-spawn-citation-check skipped (fail-open)\n' >&2
  exit 0
fi

# --- Read stdin JSON ---------------------------------------------------------

INPUT="$(cat)"

# Extract tool_name
TOOL_NAME=""
TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || true)"

# Only handle Agent and Task tool invocations
case "$TOOL_NAME" in
  Agent|Task)
    ;;
  *)
    exit 0
    ;;
esac

# --- Find newly-written research files ---------------------------------------

RESEARCH_DIR="${PROJECT_ROOT}/.claude/memory"

# Check mtime via stat and compare against current epoch minus window
NOW_EPOCH="$(date +%s 2>/dev/null || printf '0')"
CUTOFF_EPOCH=$(( NOW_EPOCH - CITATION_WINDOW_SECS ))

# Collect newly-written research files into array
NEW_RESEARCH_FILES=()

if [[ -d "$RESEARCH_DIR" ]]; then
  while IFS= read -r -d $'\0' research_file; do
    # Get file mtime (portable: macOS stat vs GNU stat)
    FILE_MTIME=0
    if stat -f '%m' "$research_file" > /dev/null 2>&1; then
      # macOS stat
      FILE_MTIME="$(stat -f '%m' "$research_file" 2>/dev/null || printf '0')"
    elif stat -c '%Y' "$research_file" > /dev/null 2>&1; then
      # GNU stat
      FILE_MTIME="$(stat -c '%Y' "$research_file" 2>/dev/null || printf '0')"
    fi

    if [[ "$FILE_MTIME" -ge "$CUTOFF_EPOCH" ]]; then
      NEW_RESEARCH_FILES+=("$research_file")
    fi
  done < <(find "$RESEARCH_DIR" -maxdepth 1 -name 'research-*.md' -print0 2>/dev/null || true)
fi

# No new research files -- nothing to check
if [[ "${#NEW_RESEARCH_FILES[@]}" -eq 0 ]]; then
  exit 0
fi

# --- Citation check script availability --------------------------------------

if [[ ! -f "$CITATION_CHECK" ]]; then
  printf 'WARN: teo-research-citation-check not found at %s -- citation check skipped (fail-open)\n' "$CITATION_CHECK" >&2
  exit 0
fi

if [[ ! -x "$CITATION_CHECK" ]]; then
  printf 'WARN: teo-research-citation-check not executable at %s -- citation check skipped (fail-open)\n' "$CITATION_CHECK" >&2
  exit 0
fi

# --- Helper: write to hook-failures.json -------------------------------------

write_hook_failure() {
  local verdict="$1"
  local research_file="$2"
  local details="${3:-}"

  mkdir -p "$TRACES_DIR" 2>/dev/null || true

  local timestamp
  timestamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%dT%H:%M:%SZ')"

  local entry
  entry="$(jq -n \
    --arg hook "teo-post-spawn-citation-check" \
    --arg ts "$timestamp" \
    --arg verdict_val "$verdict" \
    --arg file_val "$research_file" \
    --arg details_val "$details" \
    --arg tool "$TOOL_NAME" \
    '{
      "hook": $hook,
      "timestamp": $ts,
      "verdict": $verdict_val,
      "research_file": $file_val,
      "tool_name": $tool,
      "details": $details_val
    }' 2>/dev/null)" || return 0

  if [[ -z "$entry" ]]; then
    return 0
  fi

  # Atomic append to hook-failures.json
  local tmp_file
  tmp_file="$(mktemp "${HOOK_FAILURES_LOG}.tmp.XXXXXX" 2>/dev/null)" || return 0

  local existing="[]"
  if [[ -s "$HOOK_FAILURES_LOG" ]] && jq empty "$HOOK_FAILURES_LOG" > /dev/null 2>&1; then
    existing="$(cat "$HOOK_FAILURES_LOG")"
  fi

  if printf '%s' "$existing" | jq --argjson e "$entry" '. + [$e]' > "$tmp_file" 2>/dev/null; then
    mv "$tmp_file" "$HOOK_FAILURES_LOG"
  else
    rm -f "$tmp_file" 2>/dev/null || true
  fi
}

# --- Run citation check on each new research file ----------------------------

HARD_FAIL_FILES=()

for research_file in "${NEW_RESEARCH_FILES[@]}"; do
  # Invoke citation check; capture output and exit code
  CHECK_OUTPUT=""
  CHECK_EXIT=0
  CHECK_OUTPUT="$("$CITATION_CHECK" "$research_file" 2>&1)" || CHECK_EXIT=$?

  case "$CHECK_EXIT" in
    0)
      # CITATION_OK -- allow, no logging needed
      ;;
    1)
      # CITATION_SOFT_FAIL -- log to hook-failures.json, continue
      printf 'WARN: citation soft-fail on %s: %s\n' "$research_file" "$CHECK_OUTPUT" >&2
      write_hook_failure "CITATION_SOFT_FAIL" "$research_file" "$CHECK_OUTPUT"
      ;;
    2)
      # CITATION_HARD_FAIL -- log and collect for deny
      printf 'ERROR: citation hard-fail on %s: %s\n' "$research_file" "$CHECK_OUTPUT" >&2
      write_hook_failure "CITATION_HARD_FAIL" "$research_file" "$CHECK_OUTPUT"
      HARD_FAIL_FILES+=("$research_file")
      ;;
    *)
      # Unknown exit code -- treat as soft fail (fail-open)
      printf 'WARN: citation check unexpected exit %d on %s -- treating as soft-fail\n' "$CHECK_EXIT" "$research_file" >&2
      write_hook_failure "CITATION_SOFT_FAIL" "$research_file" "unexpected exit code: $CHECK_EXIT"
      ;;
  esac
done

# --- Emit deny JSON on hard fail ---------------------------------------------

if [[ "${#HARD_FAIL_FILES[@]}" -gt 0 ]]; then
  FAILED_LIST="${HARD_FAIL_FILES[*]}"

  REASON="BLOCK: Citation hard-fail detected in researcher output file(s): ${FAILED_LIST}. The researcher output references sources that could not be verified. Review hook-failures.json for details and correct the research file before Sage reads it."

  jq -n \
    --arg reason "$REASON" \
    '{
      "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": $reason,
        "type": "citation_hard_fail"
      }
    }'

  exit 2
fi

exit 0
