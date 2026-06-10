#!/usr/bin/env bash
# ============================================================================
# teo-statusline.sh — TEO statusline for Claude Code
# ============================================================================
# Outputs a single status line: TEO v{teo} | {session} | Sage: {sage}
#
# Wired via settings.json statusLine.command.
# Receives session JSON on stdin (discarded — not used here).
# ============================================================================

set -euo pipefail

# Discard stdin (Claude Code sends session JSON here)
cat > /dev/null || true

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
CLAUDE_DIR="$PROJECT_DIR/.claude"

# Read version — prefer TEO_INSTALL.json .version (jq), fallback TEO_PROJECT Version: (awk)
TEO_VERSION="unknown"

# Prefer TEO_INSTALL.json .version field (jq)
if [[ -f "$CLAUDE_DIR/TEO_INSTALL.json" ]] && command -v jq >/dev/null 2>/dev/null; then
    _v=$(jq -r '.version // empty' "$CLAUDE_DIR/TEO_INSTALL.json" 2>/dev/null || echo "")
    [[ -n "$_v" ]] && TEO_VERSION="$_v"
fi

# Fallback: TEO_PROJECT "Version:" key (awk) — covers teo-init format
if [[ "$TEO_VERSION" == "unknown" ]] && [[ -f "$CLAUDE_DIR/TEO_PROJECT" ]]; then
    _v=$(awk '/^Version:/ {print $NF}' "$CLAUDE_DIR/TEO_PROJECT" 2>/dev/null || echo "")
    [[ -n "$_v" ]] && TEO_VERSION="$_v"
fi

# Final fallback: already "unknown"

# Determine session status from the TEO auth file
SESSION_STATUS="devMode"
_basename="enterprise-session"
SESSION_FILE="$HOME/.claude/${_basename}.json"
if [[ -f "$SESSION_FILE" ]]; then
    if command -v jq >/dev/null 2>/dev/null; then
        DEV_MODE=$(jq -r '.devMode // false' "$SESSION_FILE" 2>/dev/null || echo "false")
        if [[ "$DEV_MODE" == "true" ]]; then
            SESSION_STATUS="devMode"
        else
            TIER=$(jq -r '.license.tier // "unknown"' "$SESSION_FILE" 2>/dev/null || echo "unknown")
            SESSION_STATUS="licensed ($TIER)"
        fi
    elif grep -q '"devMode".*true' "$SESSION_FILE" 2>/dev/null; then
        SESSION_STATUS="devMode"
    else
        SESSION_STATUS="licensed"
    fi
else
    SESSION_STATUS="devMode"
fi

# Sage status: active if agent.md present
SAGE_STATUS="missing"
if [[ -f "$CLAUDE_DIR/agents/sage/agent.md" ]]; then
    SAGE_STATUS="active"
fi

echo "TEO v${TEO_VERSION} | ${SESSION_STATUS} | Sage: ${SAGE_STATUS}"

exit 0