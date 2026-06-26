#!/usr/bin/env bash
# WS-SANDBOX-E2E implementation — validate-plugin.sh
# Implements the QA spec at .claude/memory/go-signals/ws-sandbox-e2e-qa-spec.json
# STEP-2-VALIDATE: validates plugin.json manifest fields + filesystem asset counts.
# Run from the repo root: bash sandbox/scripts/validate-plugin.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

PLUGIN_JSON="${REPO_ROOT}/.claude-plugin/plugin.json"
AGENTS_DIR="${REPO_ROOT}/.claude/agents"
SKILLS_DIR="${REPO_ROOT}/.claude/skills"

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  echo "PASS: $*"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "FAIL: $*"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

warn() {
  echo "WARNING: $*"
}

# --- Preflight: required binaries ---

if ! command -v claude &>/dev/null; then
  fail "claude CLI not found"
  exit 1
fi
pass "claude CLI found"

if ! command -v jq &>/dev/null; then
  fail "jq not found"
  exit 1
fi
pass "jq found"

# --- Check 1: claude plugin validate ---

if claude plugin validate "${PLUGIN_JSON}" &>/dev/null; then
  pass "claude plugin validate passed"
else
  fail "validate — 'claude plugin validate ${PLUGIN_JSON}' exited non-zero"
  exit 1
fi

# --- Check 2: required top-level fields ---

for field in name version skills hooks; do
  if jq -e --arg f "$field" 'has($f)' "${PLUGIN_JSON}" &>/dev/null; then
    pass "plugin.json has required field: ${field}"
  else
    fail "plugin.json missing required field: ${field}"
  fi
done

# --- Check 3: agents field MUST be present and must be a string (not an array) ---
# Arrays produce Agents(0) silently on install; a directory string is the working format.

AGENTS_FIELD_TYPE=$(jq -r 'if has("agents") then (.agents | type) else "missing" end' "${PLUGIN_JSON}")
if [ "${AGENTS_FIELD_TYPE}" = "string" ]; then
  pass "plugin.json agents field is a directory string (correct)"
elif [ "${AGENTS_FIELD_TYPE}" = "array" ]; then
  fail "agents field is an array — arrays produce Agents(0) on install; use a directory string"
else
  fail "agents field missing from plugin.json — must be a directory string pointing to agents dir"
fi

# --- Check 4: agent .md file count ---

AGENT_COUNT=$(find "${AGENTS_DIR}" -maxdepth 1 -name "*.md" | wc -l | tr -d ' ')
if [ "${AGENT_COUNT}" -eq 21 ]; then
  pass "agent count == 21"
else
  fail "expected 21 agents, got ${AGENT_COUNT}"
fi

# --- Check 5: skill directory count ---

SKILL_COUNT=$(find "${SKILLS_DIR}" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')
if [ "${SKILL_COUNT}" -eq 15 ]; then
  pass "skill count == 15"
else
  fail "expected 15 skills, got ${SKILL_COUNT}"
fi

# --- Summary ---

if [ "${FAIL_COUNT}" -eq 0 ]; then
  echo "PASS: all checks passed"
  exit 0
else
  echo "FAIL: ${FAIL_COUNT} check(s) failed"
  exit 1
fi
