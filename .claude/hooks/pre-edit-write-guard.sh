#!/usr/bin/env bash
# ============================================================================
# pre-edit-write-guard.sh — TEO PreToolUse/Edit+Write Hook
# ============================================================================
# Fires on every Edit and Write tool invocation. Checks if the target file
# path is in the protected allowlist. If protected, requires a valid
# TEO_APPLY_EDIT_BYPASS env var (format: ^teo-ae-[0-9]+-[0-9]+$).
#
# Registration: .claude/settings.json hooks.PreToolUse[] matcher: "Edit" + "Write"
#
# stdin JSON shape (Claude Code PreToolUse/Edit):
#   {
#     "tool_name": "Edit",
#     "tool_input": {
#       "file_path": "<string>",
#       "old_string": "<string>",
#       "new_string": "<string>"
#     }
#   }
#
# stdin JSON shape (Claude Code PreToolUse/Write):
#   {
#     "tool_name": "Write",
#     "tool_input": {
#       "file_path": "<string>",
#       "content": "<string>"
#     }
#   }
#
# Logic:
#   1. Extract file_path from tool_input
#   2. Check if file_path is in protected allowlist
#   3. If NOT protected → ALLOW (exit 0)
#   4. If protected:
#      a. Read TEO_APPLY_EDIT_BYPASS env var
#      b. Validate against ^teo-ae-[0-9]+-[0-9]+$
#      c. If valid → write bypass-audit log, ALLOW (exit 0)
#      d. If invalid/missing → emit deny JSON, BLOCK (exit 2)
#
# Protected paths (hardcoded — matches teo-apply-edit built-in allowlist):
#   .claude/scripts/**  .claude/hooks/**  .claude/shared/**
#   docs/**  src/**  packages/**
#   package.json  tsconfig.json  vitest.config.ts  .eslintrc  .eslintrc.json
#   Extended by .claude/config/teo-allowlist.json additional_enforced_paths
#
# Fail-open cases (exit 0 with WARN):
#   - jq not found
#   - file_path missing from tool input
#   - tool_name not Edit or Write
#
# Exit codes:
#   0  ALLOW
#   2  BLOCK (deny)
#
# Bypass audit log: .claude/memory/traces/bypass-audit-YYYY-MM-DD.json
#
# See: .claude/shared/posix-write-contract.md
# See: docs/adr/ADR-037-mechanical-write-enforcement.md
# ============================================================================

set -uo pipefail

# ─── Protected allowlist (hardcoded — mirrors teo-apply-edit) ────────────────

PROTECTED_PREFIXES=(
  ".claude/scripts"
  ".claude/hooks"
  ".claude/shared"
  ".claude/agents"
  ".claude/settings.json"
  "docs"
  "src"
  "packages"
  "package.json"
  "tsconfig.json"
  "vitest.config.ts"
  ".eslintrc"
  ".eslintrc.json"
)

# ─── Environment ─────────────────────────────────────────────────────────────

# Resolve project root (TEO_PROJECT_ROOT overrides for tests)
if [[ -n "${TEO_PROJECT_ROOT:-}" ]]; then
  PROJECT_ROOT="$TEO_PROJECT_ROOT"
elif command -v git > /dev/null 2>&1; then
  PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")"
else
  PROJECT_ROOT="$PWD"
fi

# Resolve audit directory
if [[ -n "${TEO_AUDIT_DIR:-}" ]]; then
  AUDIT_DIR="$TEO_AUDIT_DIR"
else
  AUDIT_DIR="${PROJECT_ROOT}/.claude/memory/traces"
fi

# ─── Infrastructure checks ───────────────────────────────────────────────────

if ! command -v jq > /dev/null 2>&1; then
  printf 'WARN: jq not found -- pre-edit-write-guard check skipped (fail-open)\n' >&2
  exit 0
fi

# ─── Read stdin JSON ─────────────────────────────────────────────────────────

INPUT="$(cat)"

# Extract tool_name
TOOL_NAME=""
TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || true)"

# Only handle Edit and Write
case "$TOOL_NAME" in
  Edit|Write)
    ;;
  *)
    exit 0
    ;;
esac

# Extract file_path
FILE_PATH=""
FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null || true)"

# Fail-open: file_path missing
if [[ -z "$FILE_PATH" ]]; then
  printf 'WARN: file_path missing from %s tool input -- guard check skipped (fail-open)\n' "$TOOL_NAME" >&2
  exit 0
fi

# Normalize path: strip leading ./ if present
FILE_PATH_NORM="${FILE_PATH#./}"
# Normalize absolute path: strip PROJECT_ROOT prefix to get repo-relative path
# This closes the absolute-path bypass vector (FU-18 Bug A).
# Example: /repo/src/foo.ts -> src/foo.ts
if [[ "$FILE_PATH_NORM" == "$PROJECT_ROOT/"* ]]; then
  FILE_PATH_NORM="${FILE_PATH_NORM#"$PROJECT_ROOT/"}"
elif [[ "$FILE_PATH_NORM" == "$PROJECT_ROOT" ]]; then
  # Exact match on project root itself -- treat as root-relative empty string
  FILE_PATH_NORM=""
fi

# Canonicalize path to close traversal bypass (WS-SEC-03).
# Resolves .. segments without requiring the path to exist on disk.
# After canonicalization, re-relativize against PROJECT_ROOT to get a clean repo-relative path.
# Fail-open: if no canonicalization tool is available, continue with existing FILE_PATH_NORM.
#
# Tool priority:
#   1. realpath --canonicalize-missing  (GNU coreutils — Linux/CI)
#   2. python3 os.path.normpath         (portable fallback — macOS)
_canon_path() {
  local p="$1"
  # Try GNU realpath first (resolves symlinks + .. without path existing)
  if command -v realpath > /dev/null 2>&1 && \
     realpath --canonicalize-missing / > /dev/null 2>&1; then
    realpath --canonicalize-missing "$p" 2>/dev/null || printf '%s' "$p"
  elif command -v python3 > /dev/null 2>&1; then
    # os.path.normpath collapses .. without requiring path to exist (no symlink resolution)
    printf '%s' "$p" | python3 -c "import os.path,sys; print(os.path.normpath(sys.stdin.read().strip()),end='')" 2>/dev/null || printf '%s' "$p"
  else
    printf '%s' "$p"
  fi
}

# Build absolute path for canonicalization: if already absolute, use as-is; else prefix PROJECT_ROOT
if [[ "$FILE_PATH_NORM" == /* ]]; then
  _ABS_FOR_CANON="$FILE_PATH_NORM"
else
  _ABS_FOR_CANON="${PROJECT_ROOT}/${FILE_PATH_NORM}"
fi
_CANON="$(_canon_path "$_ABS_FOR_CANON")"
# Re-relativize: strip PROJECT_ROOT prefix
if [[ "$_CANON" == "$PROJECT_ROOT/"* ]]; then
  FILE_PATH_NORM="${_CANON#"$PROJECT_ROOT/"}"
elif [[ "$_CANON" == "$PROJECT_ROOT" ]]; then
  FILE_PATH_NORM=""
else
  # Resolved outside project root — treat as non-protected (no prefix match possible)
  FILE_PATH_NORM="$_CANON"
fi
unset _ABS_FOR_CANON _CANON

# ─── Check extension enforcement paths ───────────────────────────────────────

ALLOWLIST_CONFIG="${PROJECT_ROOT}/.claude/config/teo-allowlist.json"
EXTENDED_ENFORCED=()

if [[ -f "$ALLOWLIST_CONFIG" ]]; then
  # Validate config schema_version
  CONFIG_SCHEMA_VER=""
  CONFIG_SCHEMA_VER="$(jq -r '.schema_version // ""' "$ALLOWLIST_CONFIG" 2>/dev/null || true)"
  if [[ "$CONFIG_SCHEMA_VER" == "1.0.0" ]]; then
    # Load additional_enforced_paths — skip entries with path traversal
    while IFS= read -r ext_path; do
      if [[ -z "$ext_path" ]] || [[ "$ext_path" == "null" ]]; then
        continue
      fi
      # Strip trailing /**
      ext_path_clean="${ext_path%/**}"
      # Skip path traversal in extension entries
      if printf '%s' "$ext_path_clean" | grep -qE '(^|/)\.\.(/|$)'; then
        printf 'WARN: skipping extension enforced path with traversal: %s\n' "$ext_path_clean" >&2
        continue
      fi
      EXTENDED_ENFORCED+=("$ext_path_clean")
    done < <(jq -r '.additional_enforced_paths[]? // empty' "$ALLOWLIST_CONFIG" 2>/dev/null || true)
  fi
fi

# ─── Check if path is protected ──────────────────────────────────────────────

is_protected() {
  local path="$1"
  local prefix
  # Check built-in protected list
  for prefix in "${PROTECTED_PREFIXES[@]}"; do
    if [[ "$path" == "$prefix" ]] || [[ "$path" == "$prefix/"* ]]; then
      return 0
    fi
  done
  # Check extension enforced list (guard against empty array with set -u)
  if [[ "${#EXTENDED_ENFORCED[@]}" -gt 0 ]]; then
    for prefix in "${EXTENDED_ENFORCED[@]}"; do
      if [[ "$path" == "$prefix" ]] || [[ "$path" == "$prefix/"* ]]; then
        return 0
      fi
    done
  fi
  return 1
}

# If path is not protected, allow
if ! is_protected "$FILE_PATH_NORM"; then
  exit 0
fi

# ─── Protected path: check bypass env var ────────────────────────────────────

BYPASS_VAL="${TEO_APPLY_EDIT_BYPASS:-}"

# Validate bypass format: ^teo-ae-[0-9]+-[0-9]+$
BYPASS_VALID=false
if [[ -n "$BYPASS_VAL" ]]; then
  if printf '%s' "$BYPASS_VAL" | grep -qE '^teo-ae-[0-9]+-[0-9]+$'; then
    BYPASS_VALID=true
  fi
fi

if [[ "$BYPASS_VALID" == "true" ]]; then
  # ─── Write bypass-audit log ───────────────────────────────────────────────

  # Extract PID from bypass value (second segment after teo-ae-)
  BYPASS_PID=""
  BYPASS_PID="$(printf '%s' "$BYPASS_VAL" | grep -oE '^teo-ae-[0-9]+' | grep -oE '[0-9]+$' || true)"

  # Generate execution_id from bypass value components
  BYPASS_EXEC_ID="$(printf '%s' "$BYPASS_VAL" | sed 's/^teo-ae-//' 2>/dev/null || printf '%s' "$BYPASS_VAL")"

  TIMESTAMP=""
  TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%dT%H:%M:%SZ')"
  DATE_SUFFIX=""
  DATE_SUFFIX="$(date -u '+%Y-%m-%d' 2>/dev/null || date '+%Y-%m-%d')"

  BYPASS_LOG="${AUDIT_DIR}/bypass-audit-${DATE_SUFFIX}.json"

  mkdir -p "$AUDIT_DIR" 2>/dev/null || true

  HAS_FLOCK=true
  if ! command -v flock > /dev/null 2>&1; then
    HAS_FLOCK=false
  fi

  ENTRY=""
  ENTRY="$(jq -n \
    --arg exec_id "$BYPASS_EXEC_ID" \
    --argjson pid_val "${BYPASS_PID:-0}" \
    --arg path_val "$FILE_PATH_NORM" \
    --arg ts_val "$TIMESTAMP" \
    --arg bypass_redacted "teo-ae-[pid]-[timestamp]" \
    '{
      "execution_id": $exec_id,
      "pid": $pid_val,
      "path": $path_val,
      "timestamp": $ts_val,
      "bypass_value": $bypass_redacted
    }' 2>/dev/null)" || true

  if [[ -n "$ENTRY" ]]; then
    LOCK_FILE="${BYPASS_LOG}.lock"
    TMP_LOG=""
    TMP_LOG="$(mktemp "${BYPASS_LOG}.tmp.XXXXXX" 2>/dev/null)" || true

    if [[ -n "$TMP_LOG" ]]; then
      if [[ "$HAS_FLOCK" == "true" ]]; then
        (
          flock -x -w 10 9 2>/dev/null || true
          EXISTING="[]"
          if [[ -s "$BYPASS_LOG" ]] && jq empty "$BYPASS_LOG" > /dev/null 2>&1; then
            EXISTING="$(cat "$BYPASS_LOG")"
          fi
          printf '%s' "$EXISTING" | jq --argjson entry "$ENTRY" '. + [$entry]' > "$TMP_LOG" 2>/dev/null || true
          mv "$TMP_LOG" "$BYPASS_LOG" 2>/dev/null || true
        ) 9>"$LOCK_FILE"
        rm -f "$LOCK_FILE" 2>/dev/null || true
      else
        EXISTING="[]"
        if [[ -s "$BYPASS_LOG" ]] && jq empty "$BYPASS_LOG" > /dev/null 2>&1; then
          EXISTING="$(cat "$BYPASS_LOG")"
        fi
        printf '%s' "$EXISTING" | jq --argjson entry "$ENTRY" '. + [$entry]' > "$TMP_LOG" 2>/dev/null || true
        mv "$TMP_LOG" "$BYPASS_LOG" 2>/dev/null || true
      fi
    fi
  fi

  # Allow the operation
  exit 0
fi

# ─── No valid bypass: BLOCK the operation ────────────────────────────────────

REASON="BLOCK: Direct ${TOOL_NAME} on protected path '${FILE_PATH_NORM}' is not allowed. Use teo-apply-edit to modify protected files. Set TEO_APPLY_EDIT_BYPASS=teo-ae-\$\$-\$(date +%s) only from within teo-apply-edit."

jq -n \
  --arg reason "$REASON" \
  '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $reason
    }
  }'

exit 2
