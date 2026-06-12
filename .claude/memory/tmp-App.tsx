// src/cli/App.tsx
//
// M3: Wire subprocessController.cancel() in Ctrl+C handler.

import React, { useRef, useEffect } from 'react';
import { useApp, useStdin, useInput } from 'ink';
import { ErrorBoundary } from '../ui/ErrorBoundary.js';
import { Session } from '../repl/Session.js';
import { issueIdentityToken } from '../security/identity.js';
import { writeAuditEvent } from '../audit/log.js';
import type { IdentityToken } from '../security/identity.js';
import type { SubprocessController } from '../repl/SubprocessController.js';

export interface AppProps {
  debug: boolean;
}

function AppInner({ debug }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdin } = useStdin();

  // Issue identity token once, synchronously on first render.
  const tokenRef = useRef<IdentityToken | null>(null);
  if (tokenRef.current === null) {
    const issued = issueIdentityToken();
    if (debug) {
      writeAuditEvent({ type: 'token_issued', token_id: issued.token_id, timestamp: new Date().toISOString() });
      process.stderr.write('[debug] token_issued: ' + issued.token_id + '\n');
    }
    tokenRef.current = issued;
  }

  const token = tokenRef.current;

  // Hold reference to the subprocess controller from Session.
  const subprocessControllerRef = useRef<SubprocessController | null>(null);

  const handleSubprocessController = useRef((ctrl: SubprocessController) => {
    subprocessControllerRef.current = ctrl;
  }).current;

  // Ctrl+C: cancel any in-flight subprocess, then no-op (keep REPL alive).
  // Ctrl+D: call exit() + process.exit(0) for clean interactive EOF handling.
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      // Cancel any in-flight LLM subprocess.
      subprocessControllerRef.current?.cancel();
      // No-op — REPL must survive interrupt.
      return;
    }
    if (key.ctrl && input === 'd') {
      exit();
      process.exit(0);
    }
  });

  // Ctrl+D: listen for stdin end event → exit cleanly.
  useEffect(() => {
    if (!stdin) return;
    const handleEnd = () => {
      exit();
      process.exit(0);
    };
    stdin.on('end', handleEnd);
    return () => {
      stdin.off('end', handleEnd);
    };
  }, [stdin, exit]);

  return <Session debug={debug} token_id={token.token_id} onSubprocessController={handleSubprocessController} />;
}

export function App({ debug }: AppProps): React.ReactElement {
  return (
    <ErrorBoundary>
      <AppInner debug={debug} />
    </ErrorBoundary>
  );
}
