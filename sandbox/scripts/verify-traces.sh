#!/usr/bin/env bash
# WS-SANDBOX-E2E implementation — verify-traces.sh
# Implements the QA spec at .claude/memory/go-signals/ws-sandbox-e2e-qa-spec.json
# STEP-4-VERIFY-TRACES: verifies post-task pipeline state after STEP-3A.
# Run from the repo root: bash sandbox/scripts/verify-traces.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SAGE_RESULT="${REPO_ROOT}/.claude/memory/pipeline/sage-result.json"
FIXTURE="${REPO_ROOT}/sandbox/fixtures/broken-readme.md"
FIXTURE_ORIG="${REPO_ROOT}/sandbox/fixtures/broken-readme.md.original"
MEMORY_DIR="${REPO_ROOT}/.claude/memory"
PIPELINE_DIR="${REPO_ROOT}/.claude/memory/pipeline"

FAIL_COUNT=0

pass() {
  echo "PASS: $*"
}

fail() {
  echo "FAIL: $*"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

# --- Check 1: sage-result.json exists ---

if [ ! -f "${SAGE_RESULT}" ]; then
  echo "FAIL: sage-result.json missing — run STEP-3A first"
  exit 1
fi
pass "sage-result.json exists"

# --- Check 2: sage-result.json is valid JSON ---

if ! jq . "${SAGE_RESULT}" &>/dev/null; then
  echo "FAIL: sage-result.json is not valid JSON"
  exit 1
fi
pass "sage-result.json is valid JSON"

# --- Check 3: status field present ---

if ! jq -e '.status' "${SAGE_RESULT}" &>/dev/null; then
  echo "FAIL: sage-result.json missing 'status' field"
  exit 1
fi
pass "sage-result.json has 'status' field"

# --- Check 4: completed_steps is a non-empty array ---

if ! jq -e '.completed_steps | length > 0' "${SAGE_RESULT}" &>/dev/null; then
  echo "FAIL: completed_steps is empty or missing"
  exit 1
fi
pass "completed_steps is non-empty"

# --- Check 5: fixture was modified (differs from .original) ---

if diff -q "${FIXTURE}" "${FIXTURE_ORIG}" &>/dev/null; then
  echo "FAIL: fixture not modified — STEP-3A may not have run"
  exit 1
fi
pass "fixture file was modified"

# --- Check 6: typo 'teh' is absent from fixture ---

if grep -q "teh " "${FIXTURE}"; then
  echo "FAIL: typo still present in fixture"
  exit 1
fi
pass "typo 'teh' is absent from fixture"

# --- Check 7: at least one non-pipeline JSON file in .claude/memory/ (best-effort) ---

NON_PIPELINE_COUNT=$(find "${MEMORY_DIR}" -name "*.json" -not -path "${PIPELINE_DIR}/*" 2>/dev/null | wc -l | tr -d ' ')
if [ "${NON_PIPELINE_COUNT}" -eq 0 ]; then
  echo "WARN: no workstream state files found outside pipeline/ (best-effort check)"
fi

# --- Check 8: explicitly do NOT check HMAC ledger ---

echo "NOTE: HMAC ledger not checked — runtime engine not wired to plugin path"

# --- Summary ---

if [ "${FAIL_COUNT}" -eq 0 ]; then
  echo "PASS: all E2E trace checks complete"
  exit 0
else
  echo "FAIL: ${FAIL_COUNT} check(s) failed"
  exit 1
fi
