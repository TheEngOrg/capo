#!/usr/bin/env bash
# scripts/test-scripts.sh
#
# QA spec: marketplace-name-fix + release-script-hardening workstream
#
# Covers two fixes:
#   Fix 1 — local-dev-install.sh: replace teo@teo-local with teo@teo-marketplace,
#            add marketplace update step, fix stale comment
#   Fix 2 — release.sh: add marketplace update step (new step 15), push the old
#            step 15 reminder to step 16, mention asset count verification in the echo
#
# Run from repo root:
#   bash scripts/test-scripts.sh
#
# Tests are written BEFORE the fix; they FAIL on the current scripts and PASS
# after the fix is applied. Exit code 0 = all pass, 1 = at least one failure.

set -uo pipefail

PASS=0
FAIL=0
LOCAL_INSTALL="scripts/local-dev-install.sh"
RELEASE="scripts/release.sh"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
pass() {
  echo "PASS: $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL: $1"
  FAIL=$((FAIL + 1))
}

assert_not_match() {
  local test_name="$1"
  local pattern="$2"
  local file="$3"
  if grep -qE "$pattern" "$file" 2>/dev/null; then
    fail "$test_name — pattern '$pattern' was found in $file (should be absent)"
  else
    pass "$test_name"
  fi
}

assert_match() {
  local test_name="$1"
  local pattern="$2"
  local file="$3"
  if grep -qE "$pattern" "$file" 2>/dev/null; then
    pass "$test_name"
  else
    fail "$test_name — pattern '$pattern' not found in $file (should be present)"
  fi
}

# ---------------------------------------------------------------------------
# Preflight: confirm both files exist before running assertions
# ---------------------------------------------------------------------------
if [ ! -f "$LOCAL_INSTALL" ]; then
  echo "ERROR: $LOCAL_INSTALL not found. Run from repo root." >&2
  exit 1
fi
if [ ! -f "$RELEASE" ]; then
  echo "ERROR: $RELEASE not found. Run from repo root." >&2
  exit 1
fi

echo "=== TEO shell-script fix specs ==="
echo "Testing: $LOCAL_INSTALL"
echo "Testing: $RELEASE"
echo ""

# ---------------------------------------------------------------------------
# Fix 1 — local-dev-install.sh
# ---------------------------------------------------------------------------
echo "-- Fix 1: local-dev-install.sh --"

# T1: No 'plugin install' invocation should reference teo-local
assert_not_match \
  "T1: plugin install does not use teo-local" \
  "plugin install.*teo-local" \
  "$LOCAL_INSTALL"

# T2: Script must install from teo@teo-marketplace
assert_match \
  "T2: plugin install uses teo@teo-marketplace" \
  "teo@teo-marketplace" \
  "$LOCAL_INSTALL"

# T3: Script must call 'marketplace update teo-marketplace' to refresh the cache
assert_match \
  "T3: marketplace update teo-marketplace call present" \
  "marketplace update teo-marketplace" \
  "$LOCAL_INSTALL"

# T4: The top-of-file comment must not still say 'teo-local' marketplace
assert_not_match \
  "T4: header comment does not reference teo-local marketplace" \
  "#.*This registers.*teo-local" \
  "$LOCAL_INSTALL"

echo ""

# ---------------------------------------------------------------------------
# Fix 2 — release.sh
# ---------------------------------------------------------------------------
echo "-- Fix 2: release.sh --"

# T5: Script must include a 'marketplace update teo-marketplace' step
assert_match \
  "T5: marketplace update teo-marketplace step present" \
  "marketplace update teo-marketplace" \
  "$RELEASE"

# T6: Script must have a [15/ step AND a [16/ step — the original ended at [15/,
#     adding the marketplace update shifts the old step 15 reminder to step 16
assert_match \
  "T6: step [15/ exists in release.sh" \
  "\[15/" \
  "$RELEASE"

assert_match \
  "T6b: step [16/ exists in release.sh (old reminder shifted)" \
  "\[16/" \
  "$RELEASE"

# T7: The final reminder echo must mention verify-plugin-install.sh AND asset counts
assert_match \
  "T7: reminder echo references verify-plugin-install.sh" \
  "verify-plugin-install\.sh" \
  "$RELEASE"

assert_match \
  "T7b: reminder echo references asset counts" \
  "(asset count|Agents/Skills/Hooks|asset)" \
  "$RELEASE"

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
TOTAL=$((PASS + FAIL))
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
