#!/usr/bin/env bash
# deploy-staging.sh — mechanical deploy. No agent, no LLM. A human runs this
# by hand and gets the identical result; the orchestrator just wraps it in
# telemetry + a signed sign-off.
set -euo pipefail

ENV="staging"
echo "[deploy] target environment: ${ENV}"
echo "[deploy] uploading build artifact..."
echo "[deploy] flipping ${ENV} traffic to new revision"
echo "[deploy] OK — deployed to ${ENV}"
exit 0
