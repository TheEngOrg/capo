#!/usr/bin/env bash
  set -euo pipefail
  INPUT=$(cat)
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")
  if [[ "$COMMAND" == *"--no-verify"* ]]; then
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"--no-verify flag is not permitted."}}'
    exit 2
  fi
  echo '{}'
  exit 0
