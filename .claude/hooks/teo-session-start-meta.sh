#!/usr/bin/env bash
# ============================================================================
# TEO Session Start Meta Hook — SessionStart hook
# ============================================================================
# Fires when Claude Code starts a new session. Does two things:
#
# 1. Writes a session record to .claude/memory/traces/meta.json so other
#    trace files have a grounding session context (P0 remediation 2026-04-19).
#
# 2. Resets the tool-call counter for the new session.
#
# Note: sage-direct-override write was removed 2026-04-23 (ADR-037 Wave 2 A4).
# teo-context-checkpoint.sh now falls back to SESSION_ACTIVE marker when
# sage-direct-override is absent (commit 4ac8a2c), making the write unnecessary.
#
# Hook protocol (SessionStart):
#   stdin:  JSON with session metadata (session_id field)
#   stdout: text or empty (informational only)
#   exit:   always 0
#
# Origin: 2026-04-19 — P0 observability remediation (devops-engineer)
# ============================================================================
set -uo pipefail

INPUT=$(cat)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRACES_DIR="$PROJECT_ROOT/.claude/memory/traces"

mkdir -p "$TRACES_DIR"

# ─── Extract session ID from hook input ─────────────────────────
SESSION_ID=""
if command -v jq &>/dev/null; then
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo "")
fi
# Fallback: use PPID as proxy for session identity
if [[ -z "$SESSION_ID" ]]; then
  SESSION_ID="ppid-$PPID"
fi

# ─── 1. Reset context counter for new session ───────────────────
# Prevent counter from carrying over stale counts if the file already exists.
printf '0' > "$TRACES_DIR/sage-tool-call-count"

# ─── 2. Write session meta record ───────────────────────────────
SCRIPT="$PROJECT_ROOT/.claude/scripts/teo-session-meta-write"
if [[ -x "$SCRIPT" ]]; then
  "$SCRIPT" "$SESSION_ID" 2>/dev/null || true
fi

# ─── 3. Write AGENT_ID session marker ───────────────────────────
AGENT_ID="${AGENT_IDENTITY_TOKEN:-}"
if [[ -z "$AGENT_ID" ]] && command -v jq &>/dev/null; then
  AGENT_ID=$(printf '%s' "$INPUT" | jq -r '.agent_id // ""' 2>/dev/null || true)
fi
if [[ -z "$AGENT_ID" ]]; then
  AGENT_ID="session-${SESSION_ID}"
fi
if [[ -n "$SESSION_ID" ]]; then
  printf '%s' "$AGENT_ID" > "$TRACES_DIR/agent-id-${SESSION_ID}"
fi


echo "TEO session meta recorded: $SESSION_ID"
exit 0
