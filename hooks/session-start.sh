#!/usr/bin/env bash
# ============================================================================
# TEO Partner Edition — SessionStart Hook
# ============================================================================
# Runs when Claude Code starts a new session. Outputs version info and
# checks Sage availability.
#
# Output goes to Claude's context as additional information.
# ============================================================================

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
CLAUDE_DIR="$PROJECT_DIR/.claude"

# Read versions + edition — primary: .teo-for-claude-version; fallback: TEO_PROJECT
TEO_VERSION="unknown"
MG_VERSION="unknown"
EDITION=""
if [[ -f "$CLAUDE_DIR/.teo-for-claude-version" ]]; then
    TEO_VERSION=$(awk '/^teo_version:/ {print $NF}' "$CLAUDE_DIR/.teo-for-claude-version" 2>/dev/null || echo "unknown")
    MG_VERSION=$(awk '/^mg_base_version:/ {print $NF}' "$CLAUDE_DIR/.teo-for-claude-version" 2>/dev/null || echo "unknown")
    EDITION=$(awk '/^edition:/ {print $NF}' "$CLAUDE_DIR/.teo-for-claude-version" 2>/dev/null || echo "")
    [[ -z "$TEO_VERSION" ]] && TEO_VERSION="unknown"
    [[ -z "$MG_VERSION" ]] && MG_VERSION="unknown"
elif [[ -f "$CLAUDE_DIR/TEO_PROJECT" ]]; then
    TEO_VERSION=$(awk '/^TEO Version:/ {print $NF}' "$CLAUDE_DIR/TEO_PROJECT" 2>/dev/null || echo "unknown")
    MG_VERSION=$(awk '/^MG Base:/ {print $NF}' "$CLAUDE_DIR/TEO_PROJECT" 2>/dev/null || echo "unknown")
fi

# Session status derived from edition field (defaults to "unknown" if absent)
SESSION_STATUS="${EDITION:-unknown}"

# Check Sage availability (sage-availability status: active when agent.md present)
SAGE_STATUS="pending (loads on first message)"
if [[ -f "$CLAUDE_DIR/agents/sage/agent.md" ]]; then
    SAGE_STATUS="pending (loads on first message)"
else
    SAGE_STATUS="missing"
fi

# Check font installation (TEOSageGlyph)
FONT_STATUS="not installed"
case "$(uname -s)" in
    Darwin)
        [[ -f "$HOME/Library/Fonts/TEOSageGlyph.ttf" ]] && FONT_STATUS="installed"
        ;;
    Linux)
        [[ -f "$HOME/.local/share/fonts/TEOSageGlyph.ttf" ]] && FONT_STATUS="installed"
        ;;
esac

# Output version banner (goes to Claude's context)
echo "TEO v${TEO_VERSION} | Session: ${SESSION_STATUS} | Sage: ${SAGE_STATUS}"
if [[ "$FONT_STATUS" == "not installed" ]]; then
    echo "Note: TEOSageGlyph font not installed — glyph rendering may fall back to plain text."
fi

exit 0
