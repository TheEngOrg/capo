#!/usr/bin/env bash
# ============================================================================
# TEO Partner Edition — SessionStart Hook
# ============================================================================
# Runs when Claude Code starts a new session. Outputs version info and
# checks Capo availability.
#
# Output goes to Claude's context as additional information.
# ============================================================================

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
CLAUDE_DIR="$PROJECT_DIR/.claude"

# Read versions + edition — primary: .teo-for-claude-version; fallback: TEO_PROJECT
TEO_VERSION="unknown"
EDITION=""
if [[ -f "$CLAUDE_DIR/.teo-for-claude-version" ]]; then
    TEO_VERSION=$(awk '/^capo_version:/ {print $NF}' "$CLAUDE_DIR/.teo-for-claude-version" 2>/dev/null || echo "unknown")
    EDITION=$(awk '/^edition:/ {print $NF}' "$CLAUDE_DIR/.teo-for-claude-version" 2>/dev/null || echo "")
    [[ -z "$TEO_VERSION" ]] && TEO_VERSION="unknown"
elif [[ -f "$CLAUDE_DIR/TEO_PROJECT" ]]; then
    TEO_VERSION=$(awk '/^TEO Version:/ {print $NF}' "$CLAUDE_DIR/TEO_PROJECT" 2>/dev/null || echo "unknown")
fi

# Session status derived from edition field (defaults to "unknown" if absent)
SESSION_STATUS="${EDITION:-unknown}"

# Check Capo availability (capo-availability status: active when agent.md present)
CAPO_STATUS="pending (loads on first message)"
if [[ -f "$CLAUDE_DIR/agents/capo.md" ]]; then
    CAPO_STATUS="pending (loads on first message)"
else
    CAPO_STATUS="missing"
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
echo "TEO v${TEO_VERSION} | Session: ${SESSION_STATUS} | Capo: ${CAPO_STATUS}"
if [[ "$FONT_STATUS" == "not installed" ]]; then
    echo "Note: TEOSageGlyph font not installed — glyph rendering may fall back to plain text."
fi

exit 0
