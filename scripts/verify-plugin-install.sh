#!/usr/bin/env bash
# =============================================================================
# scripts/verify-plugin-install.sh — TEO Plugin RELEASE Verification Gate
# =============================================================================
#
# PURPOSE
#   This is the mandatory pre-release verification gate for the TEO Claude Code
#   plugin. Run it before tagging any release. Wire it into WS-GO-07 (alpha
#   release gate) as a pre-tag step.
#
# WHY `claude plugin validate` ALONE IS INSUFFICIENT
#   validate and install use different validators. This exact mismatch caused
#   the WS-GO-02 regression:
#     - `"agents": "./agents/"` (directory string) → validate exited 0
#     - `"agents": "./agents/"` (directory string) → install rejected it at
#       runtime (Claude Code v2.1.185 schema requires individual .md paths or
#       an array, not a bare directory)
#     - Relative paths containing `../` passed validate but were rejected at
#       install (path traversal guard at install time)
#   This script catches both classes of failure by running the full install
#   sequence, not just the linter.
#
# LOCAL vs. PUBLIC marketplace.json
#   The committed marketplace.json uses `"source": "./"` — the LOCAL/DOGFOOD
#   form that resolves to the current working directory. This is correct for
#   private-repo dogfood testing and for this gate.
#   FOR PUBLIC RELEASE, `source` must be swapped to:
#     { "source": "github", "repo": "TheEngOrg/the-eng-org" }
#   This script verifies the local form. Do NOT push to the public marketplace
#   without that swap. See WS-GO-05 and the public-vs-local DECISION doc for
#   the resolution strategy.
#
# USAGE
#   First time:   chmod +x scripts/verify-plugin-install.sh
#   Direct run:   ./scripts/verify-plugin-install.sh
#   CI (no chmod needed):  bash scripts/verify-plugin-install.sh
#   Or wire via npm:  add "verify:plugin": "bash scripts/verify-plugin-install.sh" to package.json
#
# IDEMPOTENT — safe to re-run. Uninstalls teo before each install attempt so
# the install is always a fresh test.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_JSON="${REPO_ROOT}/.claude-plugin/plugin.json"

echo "=== TEO Plugin Release Verification Gate ==="
echo "Repo: ${REPO_ROOT}"
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
# Step 2: register/update local marketplace
# ---------------------------------------------------------------------------
echo "[2/5] Registering/updating local marketplace..."
cd "${REPO_ROOT}"
if claude plugin marketplace update teo-marketplace 2>/dev/null; then
  echo "    OK: marketplace updated (teo-marketplace already registered)"
else
  echo "    INFO: teo-marketplace not registered yet — adding now..."
  if ! claude plugin marketplace add .; then
    echo "✘ FAIL: marketplace — could not register local marketplace."
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
echo "[3/5] Cleaning existing teo installation (if any)..."
claude plugin uninstall teo 2>/dev/null || true
echo "    OK: clean slate ready"
echo ""

# ---------------------------------------------------------------------------
# Step 4: install from local marketplace
# ---------------------------------------------------------------------------
echo "[4/5] Installing teo from local marketplace..."
if ! claude plugin install teo@teo-marketplace; then
  echo "✘ FAIL: install — claude plugin install teo@teo-marketplace exited non-zero."
  echo "        This is the gate that catches validate-passing / install-failing bugs."
  exit 1
fi
echo "    OK: install succeeded"
echo ""

# ---------------------------------------------------------------------------
# Step 5: verify plugin details are resolvable post-install
# ---------------------------------------------------------------------------
echo "[5/5] Verifying installed plugin details..."
if ! claude plugin details teo; then
  echo "✘ FAIL: details — claude plugin details teo exited non-zero."
  echo "        Plugin installed but is not resolvable. Check plugin registry state."
  exit 1
fi
echo "    OK: details resolved"
echo ""

# ---------------------------------------------------------------------------
# PASS
# ---------------------------------------------------------------------------
echo "✔ PASS: teo plugin install verified"
echo ""
echo "NOTE: This verified the LOCAL marketplace.json (source: \"./\")."
echo "      Before public release, swap marketplace.json source to:"
echo "        { \"source\": \"github\", \"repo\": \"TheEngOrg/the-eng-org\" }"
echo "      and re-run this gate against the public marketplace."
exit 0
