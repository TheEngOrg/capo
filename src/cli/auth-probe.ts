// src/cli/auth-probe.ts
//
// Startup probe: validates that the `claude` CLI is installed and accessible.
// Called in src/index.tsx BEFORE the Ink render loop.
//
// NOTE on spawnSync vs async spawn (staff-eng risk flag #2):
//   This function uses spawnSync for the auth probe only. The probe runs BEFORE
//   the Ink render loop starts, so there is no render loop to block. This is
//   the one place where spawnSync is safe -- we are in startup, not in a React hook.
//   Production pipeline calls (LLM dispatch, mechanical executor) in later spawns
//   MUST use async spawn. The auth probe is a deliberate exception.

import { spawnSync } from 'node:child_process';

export interface AuthProbeResult {
  ok: boolean;
  message: string;
}

export function runAuthProbe(): AuthProbeResult {
  const result = spawnSync('claude', ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
  });

  if (result.status === 0) {
    return { ok: true, message: 'claude CLI is available' };
  }

  if (result.error) {
    return {
      ok: false,
      message:
        "teo: error: claude CLI not found. Run 'claude auth' to install and authenticate the claude CLI.",
    };
  }

  return {
    ok: false,
    message:
      "teo: error: claude CLI is not authenticated. Run 'claude auth' to authenticate.",
  };
}

