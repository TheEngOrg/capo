#!/usr/bin/env bash
# TEO Partner Edition — Block --no-verify and signing-bypass git flags.
# Prevents bypassing git hooks or commit signing via flag injection.
# ADR-034 OQ-C: exit 2 + stderr is the correct Claude Code PreToolUse block signal.

set -euo pipefail

input="$(cat)"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || true)"

# Strip everything inside single- or double-quoted strings before flag checking.
# This prevents false positives when --no-verify or --no-gpg-sign appear inside
# a commit message passed via -m "..." or -m '...'.
stripped="$(printf '%s' "$command" | sed "s/\"[^\"]*\"//g; s/'[^']*'//g")"

# Block --no-verify as a bare git flag (must follow "git <subcommand>", outside quotes).
if printf '%s' "$stripped" | grep -qE '(^|[[:space:]])git[[:space:]].*--no-verify([[:space:]]|$)'; then
    printf 'Blocked: --no-verify bypasses required review gates (commit-msg, pre-commit). Fix the underlying issue instead of skipping hooks.\n' >&2
    exit 2
fi

# Block commit-signing bypass flags.
if printf '%s' "$stripped" | grep -qE '(^|[[:space:]])git[[:space:]].*(--no-gpg-sign|-c[[:space:]]+commit.gpgsign=false)'; then
    printf 'Blocked: bypassing commit signing violates signed-commit policy.\n' >&2
    exit 2
fi

exit 0
