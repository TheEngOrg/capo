#!/usr/bin/env bash
# scripts/local-dev-install.sh — Install TEO plugin from local source for development
#
# Replaces the hand-maintained .claude/agents/ mirror. Run this after making changes
# to agents/, skills/, or hooks/ to pick up the updates in your local Claude Code session.
#
# Usage:
#   npm run dev:install          (via package.json script)
#   bash scripts/local-dev-install.sh   (direct)
#
# This registers the local repo as a "teo-marketplace" marketplace and installs from it.
# The marketplace registration is project-scoped (--scope local).
# The github-sourced "teo-marketplace" is unchanged — this is a dev-only local override.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== TEO Local Dev Install ==="
echo "Repo: ${REPO_ROOT}"
echo ""

echo "[1/3] Registering local source as teo-marketplace marketplace (--scope local)..."
if claude plugin marketplace add "${REPO_ROOT}" --scope local 2>/dev/null; then
  echo "    OK: teo-marketplace marketplace registered (or already registered)"
else
  # May already exist — try to continue
  echo "    INFO: marketplace add returned non-zero (may already be registered)"
fi
echo "    Refreshing teo-marketplace cache..."
claude plugin marketplace update teo-marketplace 2>/dev/null || true
echo ""

echo "[2/3] Uninstalling existing local teo (if any)..."
claude plugin uninstall teo 2>/dev/null || true
echo "    OK: clean slate"
echo ""

echo "[3/3] Installing teo from local source..."
if ! claude plugin install teo@teo-marketplace; then
  echo "FAIL: install from local source failed."
  echo "        Check that ${REPO_ROOT}/.claude-plugin/plugin.json is valid."
  exit 1
fi
echo "    OK: teo installed from local source"
echo ""
echo "Done. Restart Claude Code to pick up the updated plugin."
