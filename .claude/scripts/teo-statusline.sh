#!/usr/bin/env bash
# ============================================================================
# teo-statusline.sh — CAPO statusline for Claude Code
# ============================================================================
# Outputs a single status line:
#   With .teo-for-claude-version:  CAPO v{capo} | {edition} | Capo: {capo_status}
#   Without (fallback):            CAPO v{version} | devMode | Capo: {capo_status}
#
# Wired via settings.json statusLine.command.
# Receives session JSON on stdin (discarded — not used here).
# ============================================================================

set -euo pipefail

# Discard stdin (Claude Code sends session JSON here)
cat > /dev/null || true

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
CLAUDE_DIR="$PROJECT_DIR/.claude"

# Read version — primary: .teo-for-claude-version, fallback: TEO_INSTALL.json, then TEO_PROJECT
CAPO_VERSION="unknown"
EDITION=""

# Primary: .teo-for-claude-version (partner install marker — capo_version field)
if [[ -f "$CLAUDE_DIR/.teo-for-claude-version" ]]; then
    _v=$(awk '/^capo_version:/ {print $NF}' "$CLAUDE_DIR/.teo-for-claude-version" 2>/dev/null || echo "")
    [[ -n "$_v" ]] && CAPO_VERSION="$_v"
    _ed=$(awk '/^edition:/ {print $NF}' "$CLAUDE_DIR/.teo-for-claude-version" 2>/dev/null || echo "")
    [[ -n "$_ed" ]] && EDITION="$_ed"
fi

# Secondary: TEO_INSTALL.json .version field (jq)
if [[ "$CAPO_VERSION" == "unknown" ]] && [[ -f "$CLAUDE_DIR/TEO_INSTALL.json" ]] && command -v jq >/dev/null 2>/dev/null; then
    _v=$(jq -r '.version // empty' "$CLAUDE_DIR/TEO_INSTALL.json" 2>/dev/null || echo "")
    [[ -n "$_v" ]] && CAPO_VERSION="$_v"
fi

# Fallback: TEO_PROJECT "Version:" key (awk) — covers teo-init format
if [[ "$CAPO_VERSION" == "unknown" ]] && [[ -f "$CLAUDE_DIR/TEO_PROJECT" ]]; then
    _v=$(awk '/^Version:/ {print $NF}' "$CLAUDE_DIR/TEO_PROJECT" 2>/dev/null || echo "")
    [[ -n "$_v" ]] && CAPO_VERSION="$_v"
fi

# Final fallback: already "unknown"

# Capo status: active if agent.md present
CAPO_STATUS="missing"
if [[ -f "$CLAUDE_DIR/agents/capo.md" ]]; then
    CAPO_STATUS="active"
fi

# Emit statusline
if [[ -n "$EDITION" ]]; then
    # Version file present: emit edition from .teo-for-claude-version
    echo "CAPO v${CAPO_VERSION} | ${EDITION} | Capo: ${CAPO_STATUS}"
else
    # Fallback: determine session status from TEO auth file
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
    fi
    echo "CAPO v${CAPO_VERSION} | ${SESSION_STATUS} | Capo: ${CAPO_STATUS}"
fi

exit 0
