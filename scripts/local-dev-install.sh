#!/usr/bin/env bash
# scripts/local-dev-install.sh — Build + install TEO plugin from local source for development
#
# Replaces the hand-maintained .claude/agents/ mirror. Run this after making changes
# to agents/, skills/, or hooks/ to pick up the updates in your local Claude Code session.
#
# Usage:
#   npm run dev:install          (via package.json script)
#   bash scripts/local-dev-install.sh   (direct)
#
# Flow:
#   1. Build plugin/ artifact from src/plugin/ (npm run build:plugin)
#   2. Register plugin/ directory as "teo-marketplace" marketplace (--scope local)
#   3. Uninstall existing capo + reinstall from the built plugin/
#
# The plugin loader expects agents/*.md at the root of the registered directory.
# The repo root can't serve as the plugin root directly — src/plugin/ is the source
# and plugin/ is the built flat layout that the loader needs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_DIR="${REPO_ROOT}/plugin"

echo "=== TEO Local Dev Install ==="
echo "Repo: ${REPO_ROOT}"
echo ""

echo "[1/4] Building plugin/ artifact from src/plugin/..."
if ! npm run build:plugin --prefix "${REPO_ROOT}"; then
  echo "FAIL: npm run build:plugin failed."
  echo "        Check scripts/build-plugin.mjs for errors."
  exit 1
fi
echo "    OK: plugin/ built at ${PLUGIN_DIR}"
echo ""

echo "[2/4] Registering plugin/ as teo-marketplace marketplace (--scope local)..."
if claude plugin marketplace add "${PLUGIN_DIR}" --scope local 2>/dev/null; then
  echo "    OK: teo-marketplace marketplace registered (or already registered)"
else
  # May already exist — try to continue
  echo "    INFO: marketplace add returned non-zero (may already be registered)"
fi
echo "    Refreshing teo-marketplace cache..."
claude plugin marketplace update teo-marketplace 2>/dev/null || true
echo ""

echo "[3/4] Uninstalling existing local capo (if any)..."
claude plugin uninstall capo 2>/dev/null || true
echo "    OK: clean slate"
echo ""

echo "[4/4] Installing capo from local source..."
if ! claude plugin install capo@teo-marketplace; then
  echo "FAIL: install from local source failed."
  echo "        Check that ${PLUGIN_DIR}/.claude-plugin/plugin.json is valid."
  exit 1
fi
echo "    OK: capo installed from local source"
echo ""
echo "Done. Restart Claude Code to pick up the updated plugin."
