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

# Block git commit -n (short form of --no-verify, scoped to git commit only).
# Must NOT block git log -n 5, echo -n, or other non-commit git subcommands.
# Two-step: confirm it is a git commit invocation, then check for standalone -n flag.
if printf '%s' "$stripped" | grep -qE '(^|[[:space:]])git[[:space:]]+commit([[:space:]]|$)'; then
    if printf '%s' "$stripped" | grep -qE '(^|[[:space:]])-n([[:space:]]|$)'; then
        printf 'Blocked: -n is shorthand for --no-verify and bypasses required git hooks. Fix the underlying issue instead.\n' >&2
        exit 2
    fi
fi

# Block git config core.hooksPath (overrides hook directory, bypassing all hook enforcement).
if printf '%s' "$stripped" | grep -qE '(^|[[:space:]])git[[:space:]]+config[[:space:]].*core\.hooksPath'; then
    printf 'Blocked: setting core.hooksPath overrides hook enforcement. This is not allowed.\n' >&2
    exit 2
fi

exit 0
