#!/usr/bin/env bash
set -euo pipefail

# SessionStart hook — emits a version banner as additional context.
# The plugin system loads agents (including capo.md) automatically.
# This hook does NOT inject a "read capo.md" directive — that was the
# pre-plugin overlay mode and is no longer needed.

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
VERSION=""
if [[ -n "$PLUGIN_ROOT" ]] && [[ -f "${PLUGIN_ROOT}/plugin.json" ]]; then
  VERSION="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "${PLUGIN_ROOT}/plugin.json" 2>/dev/null | grep -o '"[^"]*"$' | tr -d '"')"
fi

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"CAPO plugin active%s. Use /teo <request> to start."}}\n' \
  "${VERSION:+ v${VERSION}}"
