#!/usr/bin/env bash
# ============================================================================
# TeammateIdle Quality Gate Hook
# ============================================================================
# Runs when an agent team teammate is about to go idle.
# Exit 0 = allow idle, Exit 2 = block idle with feedback via stderr
#
# Routing note (GH #358): enforcement warnings route to team-lead, not Sage.
# Sage orchestrates; team-lead enforces file hygiene and process compliance.
#
# Scope partitioning (GH #366): untracked files are partitioned into
# "your scope" (matching this agent's workstream_id) vs "other scope"
# (belonging to another SPAWN_REQUEST). Cross-story staging pressure is
# eliminated by making the distinction explicit in warning text.
# ============================================================================

INPUT=$(cat)

TEAMMATE_NAME=$(printf '%s' "$INPUT" | jq -r '.teammate_name // "unknown"')

# Resolve workstream_id — three sources in priority order:
# 1. Input payload (most reliable — runtime.spawn path sets this)
# 2. AGENT_IDENTITY_TOKEN env var (set by teo-issue-identity-token, may not reach hook)
# 3. teammate_name suffix: strip known role prefix (dev-|qa-|sage-|etc.) to get workstream_id
WORKSTREAM_ID=""

# Source 1: input payload
WORKSTREAM_ID=$(printf '%s' "$INPUT" | jq -r '.workstream_id // ""' 2>/dev/null || true)

# Source 2: AGENT_IDENTITY_TOKEN env var
if [[ -z "$WORKSTREAM_ID" ]] && [[ -n "${AGENT_IDENTITY_TOKEN:-}" ]]; then
  PADDED=$(printf '%s' "$AGENT_IDENTITY_TOKEN" | sed 's/-/+/g; s/_/\//g')
  MOD=$((${#PADDED} % 4))
  if [[ $MOD -eq 2 ]]; then PADDED="${PADDED}=="; fi
  if [[ $MOD -eq 3 ]]; then PADDED="${PADDED}="; fi
  DECODED=$(printf '%s' "$PADDED" | base64 -D 2>/dev/null || printf '%s' "$PADDED" | base64 -d 2>/dev/null || true)
  WORKSTREAM_ID=$(printf '%s' "$DECODED" | jq -r '.workstream_id // ""' 2>/dev/null || true)
fi

# Source 3: strip role prefix from teammate_name (e.g. "dev-sprint5-b1" → "sprint5-b1")
if [[ -z "$WORKSTREAM_ID" ]] && [[ -n "$TEAMMATE_NAME" ]]; then
  WORKSTREAM_ID=$(printf '%s' "$TEAMMATE_NAME" \
    | sed 's/^dev-//; s/^qa-//; s/^sage-//; s/^staff-engineer-//; s/^security-engineer-//; s/^engineering-manager-//; s/^product-manager-//')
  # If nothing was stripped (name == workstream_id or name has no known prefix), keep as-is
  # If the result equals the original name and contains no hyphen, it's a bare role — clear it
  if [[ "$WORKSTREAM_ID" == "$TEAMMATE_NAME" ]] || [[ "$WORKSTREAM_ID" =~ ^(dev|qa|sage|team-lead|unknown)$ ]]; then
    WORKSTREAM_ID=""
  fi
fi

# ─── Debounce ───────────────────────────────────────────────────────────────
# Suppress re-emission if the same warning fired within 600s (10m) for same teammate.
DEBOUNCE_FILE=""
PROJECT_ROOT="$(pwd)"
while [[ "$PROJECT_ROOT" != "/" ]] && [[ ! -d "$PROJECT_ROOT/.claude/memory" ]]; do
  PROJECT_ROOT="$(dirname "$PROJECT_ROOT")"
done
if [[ -d "$PROJECT_ROOT/.claude/memory" ]]; then
  DEBOUNCE_FILE="$PROJECT_ROOT/.claude/memory/.teammate-idle-debounce.json"
fi

check_debounce() {
  local key="$1"
  local now
  now=$(date +%s)
  if [[ -n "$DEBOUNCE_FILE" ]] && [[ -f "$DEBOUNCE_FILE" ]]; then
    local last
    # Support both legacy flat-int entries and new object entries {workstream_id, files, timestamp}
    last=$(jq -r --arg k "$key" '
      (.[$k] // 0)
      | if type == "object" then (.timestamp // 0) else . end
    ' "$DEBOUNCE_FILE" 2>/dev/null || echo "0")
    local elapsed=$(( now - last ))
    if [[ $elapsed -lt 600 ]]; then
      return 0  # debounced
    fi
  fi
  return 1  # not debounced
}

write_debounce() {
  local key="$1"
  local files="${2:-}"
  local now
  now=$(date +%s)
  if [[ -n "$DEBOUNCE_FILE" ]]; then
    local existing="{}"
    if [[ -f "$DEBOUNCE_FILE" ]]; then
      existing=$(cat "$DEBOUNCE_FILE" 2>/dev/null || echo "{}")
    fi
    # Build files JSON array from newline-delimited input (empty array if none)
    local files_json="[]"
    if [[ -n "$files" ]]; then
      files_json=$(printf '%s' "$files" | jq -R -s 'split("\n") | map(select(length > 0))' 2>/dev/null || echo "[]")
    fi
    printf '%s' "$existing" \
      | jq --arg k "$key" \
           --arg ws "$WORKSTREAM_ID" \
           --argjson files "$files_json" \
           --argjson t "$now" \
           '.[$k] = {workstream_id: $ws, files: $files, timestamp: $t}' \
      > "${DEBOUNCE_FILE}.tmp.$$" 2>/dev/null \
      && mv "${DEBOUNCE_FILE}.tmp.$$" "$DEBOUNCE_FILE" 2>/dev/null || true
  fi
}

# ─── Gate 1: TypeScript compilation errors ──────────────────────────────────
if command -v npx &> /dev/null && [ -f "tsconfig.json" ]; then
  TSC_OUTPUT=$(npx tsc --noEmit 2>&1)
  if [ $? -ne 0 ]; then
    DEBOUNCE_KEY="tsc:${TEAMMATE_NAME}"
    if ! check_debounce "$DEBOUNCE_KEY"; then
      echo "[team-lead] TypeScript compilation errors found (triggered by $TEAMMATE_NAME going idle). Please fix before going idle:" >&2
      printf '%s\n' "$TSC_OUTPUT" | head -20 >&2
      write_debounce "$DEBOUNCE_KEY"
    fi
    exit 2
  fi
fi

# ─── Gate 2: Untracked test files ───────────────────────────────────────────
ALL_UNTRACKED=$(git ls-files --others --exclude-standard '*.test.ts' '*.test.tsx' '*.spec.ts' '*.spec.tsx' 2>/dev/null)

if [ -n "$ALL_UNTRACKED" ]; then
  # Partition files by scope when workstream_id is known
  if [[ -n "$WORKSTREAM_ID" ]]; then
    # Classify files as other-scope only when they appear in another workstream's
    # debounce record (positive signal). Without an explicit ownership registry,
    # all untracked files default to own-scope to avoid false cross-story pressure.
    OTHER_SCOPE=""
    OWN_SCOPE=""
    if [[ -n "$DEBOUNCE_FILE" ]] && [[ -f "$DEBOUNCE_FILE" ]]; then
      while IFS= read -r f; do
        # Check debounce file for a foreign-workstream entry that claimed this file
        CLAIMED_BY=$(jq -r --arg f "$f" 'to_entries[]
          | select(.value.files? and (.value.workstream_id? != null)
            and (.value.workstream_id != $ENV.WORKSTREAM_ID)
            and ([.value.files[] | select(. == $f)] | length > 0))
          | .value.workstream_id' "$DEBOUNCE_FILE" 2>/dev/null | head -1 || true)
        if [[ -n "$CLAIMED_BY" ]]; then
          OTHER_SCOPE="${OTHER_SCOPE}${f}"$'\n'
        else
          OWN_SCOPE="${OWN_SCOPE}${f}"$'\n'
        fi
      done <<< "$ALL_UNTRACKED"
    else
      OWN_SCOPE="$ALL_UNTRACKED"$'\n'
    fi
    OWN_SCOPE="${OWN_SCOPE%$'\n'}"
    OTHER_SCOPE="${OTHER_SCOPE%$'\n'}"

    DEBOUNCE_KEY="untracked:${TEAMMATE_NAME}:${WORKSTREAM_ID}"
    if ! check_debounce "$DEBOUNCE_KEY"; then
      if [[ -n "$OTHER_SCOPE" ]]; then
        echo "[team-lead] Untracked test files from OTHER workstreams detected (triggered by $TEAMMATE_NAME going idle). Do NOT stage these — they belong to another SPAWN_REQUEST:" >&2
        printf '%s\n' "$OTHER_SCOPE" >&2
      fi
      if [[ -n "$OWN_SCOPE" ]]; then
        echo "[team-lead] Untracked test files within your SPAWN_REQUEST scope detected (triggered by $TEAMMATE_NAME going idle). Await COMMIT_DIRECTIVE from sage/team-lead before any git add:" >&2
        printf '%s\n' "$OWN_SCOPE" >&2
      fi
      write_debounce "$DEBOUNCE_KEY" "$OWN_SCOPE"
    fi
  else
    # No identity token — fall back to softened prior behavior (no staging imperative)
    DEBOUNCE_KEY="untracked:${TEAMMATE_NAME}:noscope"
    if ! check_debounce "$DEBOUNCE_KEY"; then
      echo "[team-lead] Untracked test files detected (triggered by $TEAMMATE_NAME going idle). Review scope before staging — await COMMIT_DIRECTIVE from sage/team-lead:" >&2
      printf '%s\n' "$ALL_UNTRACKED" >&2
      write_debounce "$DEBOUNCE_KEY" "$ALL_UNTRACKED"
    fi
  fi
  exit 2
fi

# All gates passed
exit 0
