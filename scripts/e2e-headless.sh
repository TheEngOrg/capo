#!/usr/bin/env bash
# ============================================================================
# scripts/e2e-headless.sh — TEO Plugin LIVE E2E (headless, self-running)
# ============================================================================
# Runs the full real-runtime acceptance test as ONE deterministic command, so
# the loop is identical every run instead of re-typed prose steps.
#
#   1. Reinstall the plugin from the local marketplace (refresh the cache).
#   2. Assert asset counts (Agents/Skills/Hooks).
#   3. Snapshot + clear the ledger dir so we only see this run's output.
#   4. Invoke a real plugin skill headless via `claude -p` (faithful surface:
#      plugins load, hooks fire, skills expand, subagents spawn, -p waits).
#   5. Assert the side-effects: a FRESH ~/.teo/ledger/<id>.jsonl with a
#      SESSION_START whose command_input reflects the invoked command.
#
# Why `claude -p` (no --bare): it loads plugins + fires hooks + expands
# namespaced skills + spawns subagents — a faithful test of plugin behavior.
# `--bare` would skip all of that (false negatives) — never use it here.
#
# USAGE:  bash scripts/e2e-headless.sh
# EXIT:   0 = PASS, 1 = FAIL (with the failing assertion named).
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="${TEO_E2E_DIR:-$HOME/teo-ledger-test}"
LEDGER_DIR="$HOME/.teo/ledger"
FIXTURE_CMD="${TEO_E2E_CMD:-add an e2e_probe() function that returns \"e2e\" with a test}"
EXPECTED_AGENTS=21
EXPECTED_SKILLS=15
EXPECTED_HOOKS=6

fail() { echo "✘ E2E FAIL: $*"; exit 1; }

echo "=== TEO Plugin Headless E2E ==="
echo "Repo:     ${REPO_ROOT}"
echo "Test dir: ${TEST_DIR}"
echo ""

# --- Step 1: reinstall from local marketplace ------------------------------
echo "[1/5] Reinstalling plugin from local marketplace..."
cd "${REPO_ROOT}"
claude plugin marketplace update teo-marketplace >/dev/null 2>&1 || true
claude plugin uninstall teo >/dev/null 2>&1 || true
claude plugin install teo@teo-marketplace >/dev/null 2>&1 || fail "plugin install failed"
echo "    OK: installed"

# --- Step 2: assert asset counts -------------------------------------------
echo "[2/5] Asserting asset counts..."
DETAILS="$(claude plugin details teo 2>&1)" || fail "plugin details failed"
a=$(echo "$DETAILS" | grep -i 'Agents' | grep -oE '\([0-9]+\)' | tr -d '()' | head -1)
s=$(echo "$DETAILS" | grep -i 'Skills' | grep -oE '\([0-9]+\)' | tr -d '()' | head -1)
h=$(echo "$DETAILS" | grep -i 'Hooks'  | grep -oE '\([0-9]+\)' | tr -d '()' | head -1)
[ "$a" = "$EXPECTED_AGENTS" ] || fail "expected Agents (${EXPECTED_AGENTS}), got '${a}'"
[ "$s" = "$EXPECTED_SKILLS" ] || fail "expected Skills (${EXPECTED_SKILLS}), got '${s}'"
[ "$h" = "$EXPECTED_HOOKS" ]  || fail "expected Hooks (${EXPECTED_HOOKS}), got '${h}'"
echo "    OK: Agents(${a}) Skills(${s}) Hooks(${h})"

# --- Step 3: snapshot + clear the ledger -----------------------------------
echo "[3/5] Snapshotting + clearing ledger dir..."
mkdir -p "${LEDGER_DIR}"
STAMP="$(cd "${LEDGER_DIR}" && ls -1 *.jsonl 2>/dev/null | wc -l | tr -d ' ')"
# move any existing ledgers aside (don't delete — keep for forensics)
for f in "${LEDGER_DIR}"/*.jsonl; do
  [ -e "$f" ] || continue
  mv "$f" "${f}.pre-e2e.bak" 2>/dev/null || true
done
echo "    OK: cleared (${STAMP} prior ledger(s) moved to .pre-e2e.bak)"

# --- Step 4: invoke the plugin skill headless ------------------------------
echo "[4/5] Invoking /teo:teo build via claude -p (this spawns the pipeline)..."
mkdir -p "${TEST_DIR}"
cd "${TEST_DIR}"
# The hook fires at prompt expansion (before the pipeline). We only need the
# side-effect; cap the run so a long pipeline doesn't hang the gate.
timeout "${TEO_E2E_TIMEOUT:-420}" claude -p "/teo:teo build ${FIXTURE_CMD}" >/dev/null 2>&1 || true
echo "    OK: invocation returned (or timed out — checking side-effects)"

# --- Step 5: assert the ledger side-effect ---------------------------------
echo "[5/5] Asserting fresh ledger entry..."
shopt -s nullglob
fresh=( "${LEDGER_DIR}"/*.jsonl )
[ "${#fresh[@]}" -ge 1 ] || fail "no fresh ledger written — hook did not fire"

LEDGER="${fresh[0]}"
LINE1="$(head -1 "$LEDGER")"
echo "    ledger: ${LEDGER}"
echo "    first event: ${LINE1}"

echo "$LINE1" | jq -e '.phase=="PLAN" and .detail.event=="SESSION_START"' >/dev/null 2>&1 \
  || fail "first event is not a SESSION_START/PLAN entry"

CI="$(echo "$LINE1" | jq -r '.detail.command_input // ""')"
[ -n "$CI" ] || fail "command_input is EMPTY — hook is reading the wrong stdin field (session_id will collide across runs)"
case "$CI" in
  *e2e_probe*) : ;;  # reflects the fixture command
  *) fail "command_input '${CI}' does not reflect the invoked command" ;;
esac
echo "    OK: SESSION_START present, command_input='${CI}'"

echo ""
echo "✔ E2E PASS: hook fired, fresh signed ledger written, command_input reflects the build"
exit 0
