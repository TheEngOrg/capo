#!/usr/bin/env bash
# ============================================================================
# teo-prompt-router.sh — TEO UserPromptSubmit Hook (WS-HOOK-01)
# ============================================================================
# Fires on every UserPromptSubmit. Pattern-matches /teo prefixed prompts.
# Utility keywords and bare /teo exit 0 (no injection).
# Substantive /teo prompts inject additionalContext naming teo:capo.
# Non-/teo prompts exit 0 immediately.
#
# Exit codes:
#   0  always (this hook never blocks, only injects context)
# ============================================================================

set -uo pipefail

# Read stdin JSON
input="$(cat)"

# Extract prompt field — if jq not available, fail-open
if ! command -v jq &>/dev/null; then
  exit 0
fi

prompt="$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null)"

# Empty or null prompt — pass through
if [ -z "$prompt" ]; then
  exit 0
fi

# Not a /teo prompt — pass through immediately
if [[ "$prompt" != /teo* ]]; then
  exit 0
fi

# Extract the argument portion after "/teo"
arg="${prompt#/teo}"
# Trim leading whitespace
arg="${arg#"${arg%%[! ]*}"}"

# Bare /teo with no arguments
if [ -z "$arg" ]; then
  exit 0
fi

# Utility keywords — no injection
case "$arg" in
  help|status|version|list|stop)
    exit 0
    ;;
esac

# Forward-compat stub: TEO_VALIDATE_ARTIFACT=1 enables artifact validation (off by default)
if [[ "${TEO_VALIDATE_ARTIFACT:-}" == "1" ]]; then
  # Stub: validation path registered but not yet enforced
  : # no-op for now
fi

# Substantive /teo prompt — inject additionalContext
printf '%s\n' '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "CAPO_DIRECTIVE: route this prompt to teo:capo for orchestration"
  }
}'
exit 0
