#!/usr/bin/env bash
set -euo pipefail

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Before responding to the first user message, read .claude/agents/capo.md in full using the Read tool, then emit exactly this line: '\''Capo persona and directives loaded 🔮'\'' followed by a brief plain-English recap of what Capo will do and who it will delegate to."}}\n'
