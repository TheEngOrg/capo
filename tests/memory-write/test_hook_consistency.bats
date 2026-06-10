#!/usr/bin/env bats
# test_hook_consistency.bats — Section 5: phantom-citation killed
# WS-ORCH-FIX memory-write tooling QA spec Section 5

setup() {
  PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
  HOOK_FILE="$PROJECT_ROOT/.claude/hooks/teo-sage-constraint.sh"
  SCRIPTS_DIR="$PROJECT_ROOT/.claude/scripts"
  SETTINGS_FILE="$PROJECT_ROOT/.claude/settings.json"
}

@test "hook_error_message_names_resolve_on_disk" {
  # Extract all mg-memory-* or teo-memory-* names cited in the hook
  CITED="$(grep -o 'mg-memory-[a-z-]*\|teo-memory-[a-z-]*' "$HOOK_FILE" | sort -u)"
  [ -n "$CITED" ] || { echo "No memory tool names found in hook — unexpected" >&2; return 1; }

  for name in $CITED; do
    if [ ! -f "$SCRIPTS_DIR/$name" ]; then
      echo "FAIL: phantom citation — '$name' cited in hook but NOT on disk at $SCRIPTS_DIR/$name" >&2
      return 1
    fi
  done
}

@test "settings_json_bash_allowlist_matches_installed_scripts" {
  # Every Bash allow entry for mg-memory-* must resolve to an existing file
  # Dead entries (allow entry exists, file does not) = FAIL
  # Missing entries (file exists, allow entry missing) = FAIL for the four core tools
  #
  # Note: mg-memory-settings-insert is a Surface-2 tool for writing settings.json;
  # its own allow-entry registration requires the same tool that doesn't exist yet
  # (bootstrap). It is noted as BLOCKED for manual addition post-review.
  # Only the four core memory tools are checked here.

  CORE_TOOLS="mg-memory-write mg-memory-append mg-memory-patch-section mg-memory-read"

  # Get all allow entries for mg-memory-* from settings.json
  ALLOW_ENTRIES="$(jq -r '.permissions.allow[] | select(startswith("Bash(.claude/scripts/mg-memory-")) | ltrimstr("Bash(") | rtrimstr(":*)") ' \
    "$SETTINGS_FILE" 2>/dev/null)"

  # Check each allow entry resolves to a file (dead-entry check)
  while IFS= read -r entry; do
    [ -z "$entry" ] && continue
    script_name="$(basename "$entry")"
    if [ ! -f "$SCRIPTS_DIR/$script_name" ]; then
      echo "FAIL: dead allow entry — $entry in settings.json but $SCRIPTS_DIR/$script_name not on disk" >&2
      return 1
    fi
  done <<< "$ALLOW_ENTRIES"

  # Check each of the four core tools has an allow entry (missing-entry check)
  for script_name in $CORE_TOOLS; do
    run jq -e --arg n "$script_name" \
      '[.permissions.allow[] | select(contains($n))] | length > 0' \
      "$SETTINGS_FILE"
    if [ "$status" -ne 0 ]; then
      echo "FAIL: missing allow entry — $script_name exists on disk but not in settings.json" >&2
      return 1
    fi
  done

  # mg-memory-settings-insert allow entry: BLOCKED (bootstrap problem)
  # The entry needs manual addition to settings.json via:
  #   .claude/scripts/mg-memory-settings-insert --hook-command \
  #     ".claude/scripts/mg-memory-settings-insert" --matcher "Bash" \
  #     --settings-file .claude/settings.json
  # This is a post-review step pending staff-eng + security sign-off.
}

@test "hook_error_message_does_not_cite_phantom_names" {
  # After build with Option B (mg-* namespace), the hook cites mg-memory-* names
  # and those scripts exist on disk. No phantom names should remain.
  CITED="$(grep -o 'mg-memory-[a-z-]*\|teo-memory-[a-z-]*' "$HOOK_FILE" | sort -u)"

  phantom_count=0
  for name in $CITED; do
    if [ ! -f "$SCRIPTS_DIR/$name" ]; then
      echo "phantom: $name" >&2
      phantom_count=$((phantom_count + 1))
    fi
  done
  [ "$phantom_count" -eq 0 ]
}

@test "all_four_memory_tools_exist_on_disk" {
  for name in mg-memory-write mg-memory-append mg-memory-patch-section mg-memory-read; do
    [ -f "$SCRIPTS_DIR/$name" ] || {
      echo "FAIL: $name not on disk" >&2; return 1
    }
  done
}

@test "all_four_memory_tools_are_executable" {
  for name in mg-memory-write mg-memory-append mg-memory-patch-section mg-memory-read; do
    [ -x "$SCRIPTS_DIR/$name" ] || {
      echo "FAIL: $name not executable" >&2; return 1
    }
  done
}

@test "settings_insert_tool_exists_on_disk" {
  [ -f "$SCRIPTS_DIR/mg-memory-settings-insert" ] || {
    echo "FAIL: mg-memory-settings-insert not on disk" >&2; return 1
  }
}
