#!/usr/bin/env bash
# =============================================================================
# clean-teo-settings.sh — strip stale TEO residue from project settings.json
# =============================================================================
# Removes from each affected settings.json:
#   - the entire "hooks" block (points at deleted .claude/hooks/*.sh = the errors)
#   - the "statusLine" block (points at deleted teo-statusline.sh)
#   - any "teo-*" entries in permissions.allow (teo-statusline, teo-smoke-install, etc.)
# KEEPS: permissions.allow (generic entries) + permissions.deny + everything else.
#
# Safe: backs up each file to <file>.bak-teo before editing. Idempotent.
# Requires: jq
# Run:  bash clean-teo-settings.sh           (dry-run: shows what would change)
#       bash clean-teo-settings.sh --apply   (actually writes)
# =============================================================================
set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

FILES=(
  "$HOME/personal/rivermark/.claude/settings.json"
  "$HOME/personal/agent-tools/pr-gaunt/TheEngOrg-attempt-1/.claude/settings.json"
  "$HOME/personal/agent-tools/wonton-context/.claude/settings.json"
  "$HOME/personal/wonton-web-works/byazaki-portfolio/.claude/settings.json"
  "$HOME/personal/wonton-web-works/wonton-docs/.claude/settings.json"
  "$HOME/personal/wonton-web-works/.claude/settings.json"
  "$HOME/personal/wonton-web-works/fite-fite-times/.claude/settings.json"
  "$HOME/personal/wonton-web-works/test-game/.claude/settings.json"
  "$HOME/personal/wonton-web-works/wonton/.claude/settings.json"
  "$HOME/personal/wonton-web-works/soil-and-soul-online/.claude/settings.json"
  "$HOME/personal/wonton-web-works/wonton-games/test-game/.claude/settings.json"
  "$HOME/work/agent-research/DMOS/.claude/settings.json"
  "$HOME/work/bentobox/.claude/settings.json"
  "$HOME/work/ea-dashboard/ea-dashboard/.claude/settings.json"
  "$HOME/work/thinkworks/sam-app/.claude/settings.json"
  "$HOME/work/thinkworks/.claude/settings.json"
)

# jq program:
#  - delete .hooks and .statusLine
#  - filter permissions.allow to drop any entry containing "teo" (case-insensitive)
JQ_PROG='
  del(.hooks)
  | del(.statusLine)
  | if .permissions.allow then
      .permissions.allow |= map(select(ascii_downcase | contains("teo") | not))
    else . end
'

for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "SKIP (missing): $f"
    continue
  fi
  if ! jq empty "$f" 2>/dev/null; then
    echo "SKIP (invalid JSON — fix by hand): $f"
    continue
  fi
  new="$(jq "$JQ_PROG" "$f")"
  if [ "$APPLY" = "1" ]; then
    cp "$f" "$f.bak-teo"
    printf '%s\n' "$new" > "$f"
    echo "CLEANED: $f   (backup: $f.bak-teo)"
  else
    if diff -q <(jq . "$f") <(printf '%s\n' "$new") >/dev/null 2>&1; then
      echo "no-change: $f"
    else
      echo "WOULD CLEAN: $f"
    fi
  fi
done

echo ""
if [ "$APPLY" = "1" ]; then
  echo "Done. Backups are at <file>.bak-teo. Restart any open Claude Code sessions."
  echo "To remove backups once you're happy: find ~ -name 'settings.json.bak-teo' -delete"
else
  echo "DRY RUN. Re-run with --apply to write changes:  bash clean-teo-settings.sh --apply"
fi
