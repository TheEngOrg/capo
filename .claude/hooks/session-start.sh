#!/usr/bin/env bash
# ============================================================================
# TEO Enterprise — SessionStart Hook
# ============================================================================
# Runs when Claude Code starts a new session. Outputs version info and
# checks enterprise readiness.
#
# Output goes to Claude's context as additional information.
# ============================================================================

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
CLAUDE_DIR="$PROJECT_DIR/.claude"

# Read TEO version from TEO_INSTALL.json (preferred) or TEO_PROJECT (fallback)
TEO_VERSION="not installed"

# Prefer TEO_INSTALL.json .version field (jq)
if [[ -f "$CLAUDE_DIR/TEO_INSTALL.json" ]] && command -v jq >/dev/null 2>/dev/null; then
    _v=$(jq -r '.version // empty' "$CLAUDE_DIR/TEO_INSTALL.json" 2>/dev/null || echo "")
    [[ -n "$_v" ]] && TEO_VERSION="$_v"
fi

# Fallback: TEO_PROJECT "TEO Version:" key (awk)
if [[ "$TEO_VERSION" == "not installed" ]] && [[ -f "$CLAUDE_DIR/TEO_PROJECT" ]]; then
    _v=$(awk '/^TEO Version:/ {print $NF}' "$CLAUDE_DIR/TEO_PROJECT" 2>/dev/null || echo "")
    [[ -n "$_v" ]] && TEO_VERSION="$_v"
fi

# Check enterprise session
SESSION_STATUS="no session"
SESSION_FILE="$HOME/.claude/enterprise-session.json"
  if [[ -f "$SESSION_FILE" ]]; then
      if command -v jq >/dev/null 2>/dev/null; then
          DEV_MODE=$(jq -r '.devMode // false' "$SESSION_FILE" 2>/dev/null || echo "false")
          if [[ "$DEV_MODE" == "true" ]]; then
              SESSION_STATUS="devMode"
          else
              TIER=$(jq -r '.license.tier // "unknown"' "$SESSION_FILE" 2>/dev/null || echo "unknown")
              SESSION_STATUS="licensed ($TIER)"
          fi
      elif command -v python3 >/dev/null 2>/dev/null; then
          DEV_MODE=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('devMode', False))" "$SESSION_FILE" 2>/dev/null || echo "False")
          if [[ "$DEV_MODE" == "True" ]]; then
              SESSION_STATUS="devMode"
          else
              TIER=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('license', {}).get('tier', 'unknown'))" "$SESSION_FILE" 2>/dev/null || echo "unknown")
              SESSION_STATUS="licensed ($TIER)"
          fi
      elif grep -q '"devMode".*true' "$SESSION_FILE" 2>/dev/null; then
          SESSION_STATUS="devMode"
      else
          SESSION_STATUS="licensed"
      fi
  fi

# Check Sage availability
SAGE_STATUS="not found"
if [[ -f "$CLAUDE_DIR/agents/sage/agent.md" ]]; then
    SAGE_STATUS="available"
fi

# Check font installation
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
echo "TEO Enterprise v${TEO_VERSION} | Session: ${SESSION_STATUS} | Sage: ${SAGE_STATUS} | Font: ${FONT_STATUS}"

exit 0
