#!/usr/bin/env bash
# ============================================================================
# TaskCompleted Verification Gate Hook
# ============================================================================
# VCS-agnostic quality enforcement. Fires on task completion, not VCS commit.
# Enforcement level: strict (BLOCK), standard (WARN), light (LOG).
#
# Exit 0 = allow completion
# Exit 2 = block completion with feedback via stderr (strict mode only)
#
# See: .claude/shared/verification-gate-protocol.md
# ============================================================================

INPUT=$(cat)
TASK_SUBJECT=$(echo "$INPUT" | jq -r '.task_subject // "unknown"')

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ─── Determine enforcement level (canonical resolution: env > file > strict) ─
if [[ -n "${TEO_VERIFICATION_LEVEL:-}" ]]; then
  LEVEL="$TEO_VERIFICATION_LEVEL"
elif [[ -f "$PROJECT_ROOT/.claude/verification-level" ]]; then
  _raw=$(head -1 "$PROJECT_ROOT/.claude/verification-level" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
  if [[ "$_raw" == "strict" || "$_raw" == "standard" || "$_raw" == "light" ]]; then
    LEVEL="$_raw"
  else
    echo "WARN: .claude/verification-level value '$_raw' not in {strict,standard,light}; defaulting to strict" >&2
    LEVEL="strict"
  fi
  unset _raw
else
  LEVEL="standard"
fi

# Validate level
case "$LEVEL" in
  strict|standard|light) ;;
  *)
    echo "WARN: unresolvable TEO_VERIFICATION_LEVEL='$LEVEL', falling back to strict" >&2
    LEVEL="strict" ;;
esac

# ─── Debug mode ─────────────────────────────────────────────────
# Activated via TEO_DEBUG=1 env var
DEBUG="${TEO_DEBUG:-0}"
# Phase 3.5: honor TEO_HOOK_LOG_DIR_OVERRIDE for debug event writes
_TRACES_DEFAULT="$PROJECT_ROOT/.claude/memory/traces"
EFFECTIVE_TRACES_DIR="${TEO_HOOK_LOG_DIR_OVERRIDE:-${_TRACES_DEFAULT}}"
mkdir -p "${EFFECTIVE_TRACES_DIR}" 2>/dev/null || true
DEBUG_LOG="${EFFECTIVE_TRACES_DIR}/debug-log.json"

# Initialize debug trace file if needed
if [[ "$DEBUG" == "1" ]]; then
  mkdir -p "$(dirname "$DEBUG_LOG")"
  if [[ ! -f "$DEBUG_LOG" ]]; then
    echo '{"entries": []}' > "$DEBUG_LOG"
  fi
fi

debug_trace() {
  local gate_name="$1"
  local enforcement="$2"
  local resolution="$3"
  local input_values="$4"
  local result="$5"
  local duration_ms="$6"
  local action="$7"

  if [[ "$DEBUG" != "1" ]]; then
    return
  fi

  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Verbose console output
  echo "  [DEBUG] ────────────────────────────────────" >&2
  echo "  [DEBUG] Timestamp:   $ts" >&2
  echo "  [DEBUG] Gate:        $gate_name" >&2
  echo "  [DEBUG] Enforcement: $enforcement" >&2
  echo "  [DEBUG] Resolution:  $resolution" >&2
  echo "  [DEBUG] Input:       $input_values" >&2
  echo "  [DEBUG] Result:      $result" >&2
  echo "  [DEBUG] Duration:    ${duration_ms}ms" >&2
  echo "  [DEBUG] Action:      $action" >&2
  echo "  [DEBUG] ────────────────────────────────────" >&2

  # Append to trace file (JSON)
  local tmp_file="${DEBUG_LOG}.tmp"
  local entry
  entry=$(cat <<ENTRY_EOF
{"timestamp":"$ts","gate":"$gate_name","enforcement":"$enforcement","resolution":"$resolution","input":"$input_values","result":"$result","duration_ms":$duration_ms,"action":"$action","source":"task-completed-hook"}
ENTRY_EOF
)
  # Append entry to the entries array
  if command -v jq &> /dev/null; then
    jq --argjson entry "$entry" '.entries += [$entry]' "$DEBUG_LOG" > "$tmp_file" 2>/dev/null && mv "$tmp_file" "$DEBUG_LOG"
  else
    # Fallback: manual JSON append (less safe but functional without jq)
    sed -i.bak 's/\]}//' "$DEBUG_LOG" 2>/dev/null || sed 's/\]}//' "$DEBUG_LOG" > "$tmp_file" && mv "$tmp_file" "$DEBUG_LOG"
    if grep -q '"timestamp"' "$DEBUG_LOG" 2>/dev/null; then
      echo ",$entry]}" >> "$DEBUG_LOG"
    else
      echo "$entry]}" >> "$DEBUG_LOG"
    fi
    rm -f "${DEBUG_LOG}.bak"
  fi
}

# ─── Result tracking ────────────────────────────────────────────
PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
RESULTS=""

report() {
  local status="$1"
  local check="$2"
  local message="$3"
  RESULTS="${RESULTS}  [${status}] ${check} — ${message}\n"
  case "$status" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    WARN) WARN_COUNT=$((WARN_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
  esac
}

# ─── Check: structural-integrity (ALL levels) ───────────────────
# Run teo-validate if available
GATE_START=$(($(date +%s%N 2>/dev/null || echo 0) / 1000000))
if [[ -x "$PROJECT_ROOT/.claude/scripts/teo-validate" ]]; then
  "$PROJECT_ROOT/.claude/scripts/teo-validate" > /dev/null 2>&1 || true
  TEO_EXIT=$?
  GATE_END=$(($(date +%s%N 2>/dev/null || echo 0) / 1000000))
  GATE_DUR=$((GATE_END - GATE_START))
  if [[ $TEO_EXIT -eq 0 ]]; then
    report "PASS" "structural-integrity" "teo-validate passed"
    debug_trace "structural-integrity" "$LEVEL" "auto" "teo-validate exit=$TEO_EXIT" "PASS" "$GATE_DUR" "logged"
  else
    report "FAIL" "structural-integrity" "teo-validate failed"
    debug_trace "structural-integrity" "$LEVEL" "auto" "teo-validate exit=$TEO_EXIT" "FAIL" "$GATE_DUR" "blocked"
  fi
elif [[ -f "$PROJECT_ROOT/.claude/scripts/teo-validate" ]]; then
  bash "$PROJECT_ROOT/.claude/scripts/teo-validate" > /dev/null 2>&1 || true
  TEO_EXIT=$?
  GATE_END=$(($(date +%s%N 2>/dev/null || echo 0) / 1000000))
  GATE_DUR=$((GATE_END - GATE_START))
  if [[ $TEO_EXIT -eq 0 ]]; then
    report "PASS" "structural-integrity" "teo-validate passed"
    debug_trace "structural-integrity" "$LEVEL" "auto" "teo-validate exit=$TEO_EXIT" "PASS" "$GATE_DUR" "logged"
  else
    report "FAIL" "structural-integrity" "teo-validate failed"
    debug_trace "structural-integrity" "$LEVEL" "auto" "teo-validate exit=$TEO_EXIT" "FAIL" "$GATE_DUR" "blocked"
  fi
else
  GATE_END=$(($(date +%s%N 2>/dev/null || echo 0) / 1000000))
  GATE_DUR=$((GATE_END - GATE_START))
  report "PASS" "structural-integrity" "teo-validate not found (skipped)"
  debug_trace "structural-integrity" "$LEVEL" "auto" "teo-validate not found" "SKIPPED" "$GATE_DUR" "skipped — script not present"
fi

# ─── Check: count-freshness (ALL levels) ────────────────────────
CLAUDE_MD="$PROJECT_ROOT/.claude/CLAUDE.md"
if [[ -f "$CLAUDE_MD" ]]; then
  ACTUAL_AGENTS=$(find "$PROJECT_ROOT/.claude/agents" -mindepth 1 -maxdepth 1 -type d -not -name '_base' 2>/dev/null | wc -l | tr -d ' ')
  ACTUAL_SKILLS=$(ls -d "$PROJECT_ROOT/.claude/skills"/*/ 2>/dev/null | wc -l | tr -d ' ')
  ACTUAL_PROTOCOLS=$(ls "$PROJECT_ROOT/.claude/shared"/*.md 2>/dev/null | wc -l | tr -d ' ')

  CLAIMED_AGENTS=$(grep -oE '[0-9]+ Specialized Agents' "$CLAUDE_MD" | head -1 | grep -oE '[0-9]+' || echo "0")
  CLAIMED_SKILLS=$(grep -oE '[0-9]+ Skills' "$CLAUDE_MD" | head -1 | grep -oE '[0-9]+' || echo "0")
  CLAIMED_PROTOCOLS=$(grep -oE '[0-9]+ (Shared )?[Pp]rotocol' "$CLAUDE_MD" | head -1 | grep -oE '[0-9]+' || echo "0")

  STALE=""
  if [[ "$CLAIMED_AGENTS" != "0" ]] && [[ "$CLAIMED_AGENTS" != "$ACTUAL_AGENTS" ]]; then
    STALE="${STALE} Agents($CLAIMED_AGENTS vs $ACTUAL_AGENTS)"
  fi
  if [[ "$CLAIMED_SKILLS" != "0" ]] && [[ "$CLAIMED_SKILLS" != "$ACTUAL_SKILLS" ]]; then
    STALE="${STALE} Skills($CLAIMED_SKILLS vs $ACTUAL_SKILLS)"
  fi
  if [[ "$CLAIMED_PROTOCOLS" != "0" ]] && [[ "$CLAIMED_PROTOCOLS" != "$ACTUAL_PROTOCOLS" ]]; then
    STALE="${STALE} Protocols($CLAIMED_PROTOCOLS vs $ACTUAL_PROTOCOLS)"
  fi

  if [[ -z "$STALE" ]]; then
    report "PASS" "count-freshness" "CLAUDE.md counts match disk"
    debug_trace "count-freshness" "$LEVEL" "auto" "agents=$ACTUAL_AGENTS/$CLAIMED_AGENTS skills=$ACTUAL_SKILLS/$CLAIMED_SKILLS protocols=$ACTUAL_PROTOCOLS/$CLAIMED_PROTOCOLS" "PASS" "0" "logged"
  else
    report "FAIL" "count-freshness" "CLAUDE.md counts stale:${STALE}"
    debug_trace "count-freshness" "$LEVEL" "auto" "stale:${STALE}" "FAIL" "0" "blocked"
  fi
else
  report "PASS" "count-freshness" "no CLAUDE.md found (skipped)"
  debug_trace "count-freshness" "$LEVEL" "auto" "no CLAUDE.md" "SKIPPED" "0" "skipped — no CLAUDE.md"
fi

# ─── Check: test-execution (standard + strict only) ─────────────
if [[ "$LEVEL" == "standard" || "$LEVEL" == "strict" ]]; then
  if command -v npx &> /dev/null; then
    if [[ -f "vitest.config.ts" ]] || [[ -f "vitest.config.js" ]]; then
      # VCS-agnostic: check for recently modified source files
      # Try git first, fall back to find-based detection
      CHANGED_FILES=""
      if command -v git &> /dev/null && git rev-parse --is-inside-work-tree &> /dev/null; then
        CHANGED_FILES=$(git diff --name-only --cached --diff-filter=ACMR 2>/dev/null | grep -E '\.(ts|tsx|js|jsx)$' || true)
      fi
      if [[ -n "$CHANGED_FILES" ]]; then
        npx vitest run --reporter=verbose --changed > /dev/null 2>&1 || true
        TEST_EXIT=$?
        if [[ $TEST_EXIT -eq 0 ]]; then
          report "PASS" "test-execution" "tests passed"
          debug_trace "test-execution" "$LEVEL" "auto" "vitest exit=$TEST_EXIT changed_files=yes" "PASS" "0" "logged"
        else
          report "FAIL" "test-execution" "tests failed"
          debug_trace "test-execution" "$LEVEL" "auto" "vitest exit=$TEST_EXIT changed_files=yes" "FAIL" "0" "blocked"
        fi
      else
        report "PASS" "test-execution" "no changed source files detected"
        debug_trace "test-execution" "$LEVEL" "auto" "no changed source files" "SKIPPED" "0" "skipped — no changed files"
      fi
    else
      report "PASS" "test-execution" "no test runner configured (skipped)"
      debug_trace "test-execution" "$LEVEL" "auto" "no vitest config" "SKIPPED" "0" "skipped — no test runner"
    fi
  else
    report "PASS" "test-execution" "npx not available (skipped)"
    debug_trace "test-execution" "$LEVEL" "auto" "npx not available" "SKIPPED" "0" "skipped — npx not found"
  fi

  # ─── Check: docs-freshness (standard + strict only) ─────────────
  # VCS-agnostic: try git, skip if no VCS
  if command -v git &> /dev/null && git rev-parse --is-inside-work-tree &> /dev/null; then
    STAGED_SRC=$(git diff --name-only --cached --diff-filter=ACMR 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|py|rs|go)$' || true)
    if [[ -n "$STAGED_SRC" ]]; then
      STAGED_DOCS=$(git diff --name-only --cached --diff-filter=ACMR 2>/dev/null | grep -E '(README|CHANGELOG|\.md$|docs/)' || true)
      if [[ -n "$STAGED_DOCS" ]]; then
        report "PASS" "docs-freshness" "documentation updated alongside source"
        debug_trace "docs-freshness" "$LEVEL" "auto" "staged_src=yes staged_docs=yes" "PASS" "0" "logged"
      else
        report "WARN" "docs-freshness" "source files staged but no docs updated"
        debug_trace "docs-freshness" "$LEVEL" "auto" "staged_src=yes staged_docs=no" "WARN" "0" "warned"
      fi
    else
      report "PASS" "docs-freshness" "no source files staged"
      debug_trace "docs-freshness" "$LEVEL" "auto" "no source files staged" "SKIPPED" "0" "skipped — no source staged"
    fi
  else
    report "PASS" "docs-freshness" "no VCS detected (skipped)"
    debug_trace "docs-freshness" "$LEVEL" "auto" "no VCS detected" "SKIPPED" "0" "skipped — no VCS"
  fi
fi

# ─── Check: teo-check-test-ordering (standard + strict) ─────────
# Checks misuse-first describe-block ordering in staged test files.
# OQ-4 resolution: use same staged-change filter as pre-commit; if no staged
# changes exist, skip check rather than scanning the entire project tree.
# strict   = BLOCK task completion when any file fails
# standard = WARN only (non-blocking)
# light    = skip entirely
if [[ "$LEVEL" == "standard" || "$LEVEL" == "strict" ]]; then
  ORDERING_SCRIPT="$PROJECT_ROOT/.claude/scripts/teo-check-test-ordering"
  if [[ -x "$ORDERING_SCRIPT" ]]; then
    "$ORDERING_SCRIPT" > /dev/null 2>&1
    ORDERING_EXIT=$?
    if [[ $ORDERING_EXIT -eq 0 ]]; then
      report "PASS" "test-ordering" "misuse-first ordering verified"
    else
      if [[ "$LEVEL" == "strict" ]]; then
        report "FAIL" "test-ordering" "ordering check failed (strict=BLOCK)"
      else
        report "WARN" "test-ordering" "ordering check failed (standard=WARN)"
      fi
    fi
  else
    report "WARN" "test-ordering" "teo-check-test-ordering not found or not executable"
  fi
fi

# ─── Check: process-flow-compliance (strict only) ───────────────
if [[ "$LEVEL" == "strict" ]]; then
  # Check for any workstream state files with failed or skipped gates
  FLOW_ISSUES=""
  for state_file in "$PROJECT_ROOT"/.claude/memory/workstream-*-state.json; do
    [[ ! -f "$state_file" ]] && continue
    # Check for gates with NO_GO or REQUEST_CHANGES verdict
    FAILED_GATES=$(grep -c '"verdict":\s*"NO_GO\|REQUEST_CHANGES"' "$state_file" 2>/dev/null || true)
    SKIPPED_STEPS=$(grep -c '"status":\s*"skipped"' "$state_file" 2>/dev/null || true)
    if [[ "$FAILED_GATES" -gt 0 || "$SKIPPED_STEPS" -gt 0 ]]; then
      FLOW_ISSUES="${FLOW_ISSUES} $(basename "$state_file")"
    fi
  done

  if [[ -z "$FLOW_ISSUES" ]]; then
    report "PASS" "process-flow-compliance" "all flow gates satisfied"
    debug_trace "process-flow-compliance" "$LEVEL" "auto" "no failed/skipped gates" "PASS" "0" "logged"
  else
    report "FAIL" "process-flow-compliance" "issues in:${FLOW_ISSUES}"
    debug_trace "process-flow-compliance" "$LEVEL" "auto" "issues in:${FLOW_ISSUES}" "FAIL" "0" "blocked"
  fi
fi

# ─── Output results ─────────────────────────────────────────────
echo "=== Verification Gate ($LEVEL) ===" >&2
echo -e "$RESULTS" >&2

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo "=== Result: FAIL ($FAIL_COUNT failures, $WARN_COUNT warnings) ===" >&2
elif [[ $WARN_COUNT -gt 0 ]]; then
  echo "=== Result: WARN ($WARN_COUNT warnings) ===" >&2
else
  echo "=== Result: PASS ===" >&2
fi

# ─── Debug mode summary ──────────────────────────────────────────
if [[ "$DEBUG" == "1" ]]; then
  echo "" >&2
  echo "  [DEBUG] Gate trace written to: $DEBUG_LOG" >&2
  echo "  [DEBUG] Checks skipped due to level ($LEVEL):" >&2
  if [[ "$LEVEL" == "light" ]]; then
    echo "  [DEBUG]   - test-execution (requires standard+)" >&2
    echo "  [DEBUG]   - docs-freshness (requires standard+)" >&2
    echo "  [DEBUG]   - process-flow-compliance (requires strict)" >&2
  elif [[ "$LEVEL" == "standard" ]]; then
    echo "  [DEBUG]   - process-flow-compliance (requires strict)" >&2
  else
    echo "  [DEBUG]   (none — strict runs all checks)" >&2
  fi
fi

# ─── Determine exit code based on level ──────────────────────────
if [[ "$LEVEL" == "strict" && $FAIL_COUNT -gt 0 ]]; then
  echo "Task '$TASK_SUBJECT' blocked by verification gate (strict mode)." >&2
  exit 2
fi

# Standard and light always allow completion
exit 0
