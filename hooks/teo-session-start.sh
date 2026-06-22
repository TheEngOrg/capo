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

# Extract the command args from the hook JSON.
# UserPromptExpansion (slash_command) payload, VERIFIED 2026-06-21 by raw dump:
#   { "command_name": "teo:teo", "command_args": "<text after the slash command>",
#     "prompt": "/teo:teo <args>", "expansion_type": "slash_command", ... }
# The arg text is `command_args` (NOT command_input — that field does not exist).
COMMAND_INPUT=$(printf '%s' "$HOOK_INPUT" | jq -r '.command_args // ""' 2>/dev/null || true)

# Build the JSON arg for init-session
INIT_ARG=$(jq -n --arg ci "$COMMAND_INPUT" '{"command_input": $ci}')

# Invoke the TEO engine binary — it handles ledger write + env-file update.
# Propagate exit code: non-zero causes Claude to block the hook.
"${CLAUDE_PLUGIN_ROOT}/bin/teo-run.js" init-session "$INIT_ARG"
