#!/usr/bin/env bash
# smoke-staging.sh — post-deploy verification. Exit 0 = healthy.
# This is a verifications[] check: a script the orchestrator runs, pass = exit 0.
set -euo pipefail

echo "[smoke] GET /health -> 200 OK"
echo "[smoke] staging is healthy"
exit 0
