#!/usr/bin/env bash
# ============================================================================
# TEO — UserPromptExpansion Hook: teo-session-start.sh (WS-GO-05a)
# ============================================================================
# Fires on UserPromptExpansion events whose prompt matches "teo".
# Reads hook stdin JSON, extracts command_input, calls teo-run.js init-session.
# teo-run.js writes TEO_SESSION_ID directly to $CLAUDE_ENV_FILE (if set).
# Propagates the exit code from teo-run.js — non-zero blocks the hook.
# ============================================================================

set -euo pipefail

# Read the full hook input JSON from stdin (Claude passes it as a JSON object)
HOOK_INPUT=$(cat)

# Extract command_input from the hook JSON.
# UserPromptExpansion delivers { "command_name": "<matched command>", "command_input": "<arg text>", ... }
COMMAND_INPUT=$(printf '%s' "$HOOK_INPUT" | jq -r '.command_input // ""' 2>/dev/null || true)

# Build the JSON arg for init-session
INIT_ARG=$(jq -n --arg ci "$COMMAND_INPUT" '{"command_input": $ci}')

# Invoke the TEO engine binary — it handles ledger write + env-file update.
# Propagate exit code: non-zero causes Claude to block the hook.
"${CLAUDE_PLUGIN_ROOT}/bin/teo-run.js" init-session "$INIT_ARG"
