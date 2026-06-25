#!/usr/bin/env bash
# ============================================================================
# teo-statusline.sh — TEO statusline for Claude Code
# ============================================================================
# Outputs a single status line:
#   With .teo-for-claude-version:  TEO v{teo} | MG v{mg} | {edition} | Capo: {capo}
#   Without (fallback):            TEO v{teo} | {session} | Capo: {capo}
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
TEO_VERSION="unknown"
MG_VERSION=""
EDITION=""

# Primary: .teo-for-claude-version (partner install marker — teo_version field)
if [[ -f "$CLAUDE_DIR/.teo-for-claude-version" ]]; then
    _v=$(awk '/^teo_version:/ {print $NF}' "$CLAUDE_DIR/.teo-for-claude-version" 2>/dev/null || echo "")
    [[ -n "$_v" ]] && TEO_VERSION="$_v"
    _mg=$(awk '/^mg_base_version:/ {print $NF}' "$CLAUDE_DIR/.teo-for-claude-version" 2>/dev/null || echo "")
    [[ -n "$_mg" ]] && MG_VERSION="$_mg"
    _ed=$(awk '/^edition:/ {print $NF}' "$CLAUDE_DIR/.teo-for-claude-version" 2>/dev/null || echo "")
    [[ -n "$_ed" ]] && EDITION="$_ed"
fi

# Secondary: TEO_INSTALL.json .version field (jq)
if [[ "$TEO_VERSION" == "unknown" ]] && [[ -f "$CLAUDE_DIR/TEO_INSTALL.json" ]] && command -v jq >/dev/null 2>/dev/null; then
    _v=$(jq -r '.version // empty' "$CLAUDE_DIR/TEO_INSTALL.json" 2>/dev/null || echo "")
    [[ -n "$_v" ]] && TEO_VERSION="$_v"
fi

# Fallback: TEO_PROJECT "Version:" key (awk) — covers teo-init format
if [[ "$TEO_VERSION" == "unknown" ]] && [[ -f "$CLAUDE_DIR/TEO_PROJECT" ]]; then
    _v=$(awk '/^Version:/ {print $NF}' "$CLAUDE_DIR/TEO_PROJECT" 2>/dev/null || echo "")
    [[ -n "$_v" ]] && TEO_VERSION="$_v"
fi

# Final fallback: already "unknown"

# Capo status: active if agent.md present
CAPO_STATUS="missing"
if [[ -f "$CLAUDE_DIR/agents/capo.md" ]]; then
    CAPO_STATUS="active"
fi

# Emit statusline — format depends on whether .teo-for-claude-version was present
if [[ -n "$EDITION" ]] && [[ -n "$MG_VERSION" ]]; then
    # Partner install: include MG version and edition from .teo-for-claude-version
    echo "TEO v${TEO_VERSION} | MG v${MG_VERSION} | ${EDITION} | Capo: ${CAPO_STATUS}"
else
    # Enterprise / fallback: determine session status from TEO auth file
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
    echo "TEO v${TEO_VERSION} | ${SESSION_STATUS} | Capo: ${CAPO_STATUS}"
fi

exit 0
