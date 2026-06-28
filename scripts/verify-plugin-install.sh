#!/usr/bin/env bash
# =============================================================================
# scripts/verify-plugin-install.sh — CAPO Plugin RELEASE Verification Gate
# =============================================================================
#
# PURPOSE
#   This is the mandatory pre-release verification gate for the CAPO Claude Code
#   plugin. Run it before tagging any release. Wire it into WS-GO-07 (alpha
#   release gate) as a pre-tag step.
#
# WHY THE VALIDATE STEP ALONE IS INSUFFICIENT
#   validate and install use different validators. This exact mismatch caused
#   the WS-GO-02 regression:
#     - An explicit array of individual .md file paths passes the validate linter
#       but produces Agents(0) silently at install time — the array format is not
#       the working format even though the linter accepts it.
#     - `"agents": "./src/plugin/agents/"` (directory string) is the WORKING format:
#       the linter accepts it AND install correctly loads all agents from the directory.
#     - Relative paths containing `../` passed the linter but were rejected at
#       install (path traversal guard at install time)
#   This script catches both classes of failure by running the full install
#   sequence, not just the linter.
#
# BUILD BEFORE VALIDATE
#   Step 0 builds the plugin artifact first (produces plugin/.claude-plugin/plugin.json).
#   The SOURCE manifest at .claude-plugin/plugin.json has "agents": "./src/plugin/agents/"
#   which the validate command REJECTS ("agents: Invalid input"). The built artifact
#   has the agents field stripped and passes both validate and install.
#   Always build before validating.
#
# MARKETPLACE SOURCE
#   The committed marketplace.json uses the GitHub source form:
#     { "source": "github", "repo": "TheEngOrg/capo" }
#   This script verifies the PUBLIC github-sourced form against a real install.
#   This IS the canonical pre-tag gate — run it before tagging any release.
#
# USAGE
#   First time:   chmod +x scripts/verify-plugin-install.sh
#   Direct run:   ./scripts/verify-plugin-install.sh
#   CI (no chmod needed):  bash scripts/verify-plugin-install.sh
#   Or wire via npm:  add "verify:plugin": "bash scripts/verify-plugin-install.sh" to package.json
#
# IDEMPOTENT — safe to re-run. Uninstalls capo before each install attempt so
# the install is always a fresh test.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_JSON="${REPO_ROOT}/plugin/.claude-plugin/plugin.json"

echo "=== CAPO Plugin Release Verification Gate ==="
echo "Repo: ${REPO_ROOT}"
echo ""

# ---------------------------------------------------------------------------
# Step 0: build the plugin artifact so plugin/.claude-plugin/plugin.json exists
# ---------------------------------------------------------------------------
echo "[0/5] Building plugin artifact..."
cd "${REPO_ROOT}"
if ! npm run build:plugin; then
  echo "✘ FAIL: build — npm run build:plugin exited non-zero."
  echo "        Fix build errors before releasing."
  exit 1
fi
echo "    OK: plugin artifact built (plugin/.claude-plugin/plugin.json ready)"
echo ""

# ---------------------------------------------------------------------------
# Step 1: validate the plugin manifest
# ---------------------------------------------------------------------------
echo "[1/5] Validating plugin manifest..."
if ! claude plugin validate "${PLUGIN_JSON}"; then
  echo "✘ FAIL: validate — claude plugin validate exited non-zero."
  echo "        Fix plugin.json before releasing."
  exit 1
fi
echo "    OK: validate passed"
echo ""

# ---------------------------------------------------------------------------
# Step 2: register/update github marketplace
# ---------------------------------------------------------------------------
echo "[2/5] Registering/updating github marketplace..."
cd "${REPO_ROOT}"
if claude plugin marketplace update teo-marketplace 2>/dev/null; then
  echo "    OK: marketplace updated (teo-marketplace already registered)"
else
  echo "    INFO: teo-marketplace not registered yet — adding now..."
  if ! claude plugin marketplace add TheEngOrg/capo; then
    echo "✘ FAIL: marketplace — could not register github marketplace."
    echo "        Ensure .claude-plugin/marketplace.json is present and valid."
    exit 1
  fi
  echo "    Registered. Running update..."
  if ! claude plugin marketplace update teo-marketplace; then
    echo "✘ FAIL: marketplace update — registered but update failed."
    exit 1
  fi
  echo "    OK: marketplace registered and updated"
fi
echo ""

# ---------------------------------------------------------------------------
# Step 3: clean slate — uninstall any existing teo installation
# ---------------------------------------------------------------------------
echo "[3/5] Cleaning existing capo installation (if any)..."
claude plugin uninstall capo 2>/dev/null || true
echo "    OK: clean slate ready"
echo ""

# ---------------------------------------------------------------------------
# Step 4: install from github marketplace
# ---------------------------------------------------------------------------
echo "[4/5] Installing capo from github marketplace..."
if ! claude plugin install capo@teo-marketplace; then
  echo "✘ FAIL: install — claude plugin install capo@teo-marketplace exited non-zero."
  echo "        This is the gate that catches validate-passing / install-failing bugs."
  exit 1
fi
echo "    OK: install succeeded"
echo ""

# ---------------------------------------------------------------------------
# Step 5: verify plugin details are resolvable post-install AND asset counts
# ---------------------------------------------------------------------------
echo "[5/5] Verifying installed plugin details and asset counts..."
DETAILS_OUTPUT="$(claude plugin details capo 2>&1)" || {
  echo "✘ FAIL: details — claude plugin details capo exited non-zero."
  echo "        Plugin installed but is not resolvable. Check plugin registry state."
  exit 1
}
echo "${DETAILS_OUTPUT}"

# Parse counts from lines like "  Agents (21)  name1, name2 ..."
# grep is robust to leading whitespace; capture the integer inside parens.
AGENTS_COUNT="$(echo "${DETAILS_OUTPUT}" | grep -i 'Agents' | grep -oE '\([0-9]+\)' | tr -d '()' | head -1)"
SKILLS_COUNT="$(echo "${DETAILS_OUTPUT}" | grep -i 'Skills' | grep -oE '\([0-9]+\)' | tr -d '()' | head -1)"
HOOKS_COUNT="$(echo "${DETAILS_OUTPUT}"  | grep -i 'Hooks'  | grep -oE '\([0-9]+\)' | tr -d '()' | head -1)"

PASS=true

if [ "${AGENTS_COUNT}" = "23" ]; then
  echo "    OK: Agents (23) confirmed"
else
  echo "✘ FAIL: expected Agents (23), got '${AGENTS_COUNT}'"
  PASS=false
fi

if [ "${SKILLS_COUNT}" = "15" ]; then
  echo "    OK: Skills (15) confirmed"
else
  echo "✘ FAIL: expected Skills (15), got '${SKILLS_COUNT}'"
  PASS=false
fi

if [ "${HOOKS_COUNT}" = "3" ]; then
  echo "    OK: Hooks (3 event types) confirmed"
else
  echo "✘ FAIL: expected Hooks (3 event types), got '${HOOKS_COUNT}'"
  PASS=false
fi

if [ "${PASS}" != "true" ]; then
  echo ""
  echo "✘ FAIL: asset count mismatch — plugin.json or agents/ directory structure is wrong."
  echo "        Agents(0) is the classic symptom of nested paths (agents/<name>/agent.md)"
  echo "        instead of flat paths (agents/<name>.md). Fix and re-run."
  exit 1
fi
echo "    OK: all asset counts verified"
echo ""

# ---------------------------------------------------------------------------
# PASS
# ---------------------------------------------------------------------------
echo "✔ PASS: capo plugin install verified"
echo ""
echo "NOTE: This verified the PUBLIC github-sourced marketplace (TheEngOrg/capo)."
echo "      This is the canonical pre-tag gate. Run before tagging any release."
exit 0
