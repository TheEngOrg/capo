// src/cli/App.tsx
//
// Pass 2: Token issuance on first render, Ctrl+D handler, debug prop threading.
// Token is issued synchronously during first render so ErrorBoundary catches failures.

import React, { useRef, useEffect } from 'react';
import { useApp, useStdin } from 'ink';
import { ErrorBoundary } from '../ui/ErrorBoundary.js';
import { Session } from '../repl/Session.js';
import { issueIdentityToken } from '../security/identity.js';
import { writeAuditEvent } from '../audit/log.js';
import type { IdentityToken } from '../security/identity.js';

export interface AppProps {
  debug: boolean;
}

function AppInner({ debug }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdin } = useStdin();

  // Issue identity token once, synchronously on first render.
  // Using a ref so it only runs once but throws during render (ErrorBoundary catches it).
  const tokenRef = useRef<IdentityToken | null>(null);
  if (tokenRef.current === null) {
    // This throws synchronously if issuance fails — ErrorBoundary catches it.
    const issued = issueIdentityToken();
    if (debug) {
      writeAuditEvent({ type: 'token_issued', token_id: issued.token_id, timestamp: new Date().toISOString() });
    }
    tokenRef.current = issued;
  }

  const token = tokenRef.current;

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

  return <Session debug={debug} token_id={token.token_id} />;
}

export function App({ debug }: AppProps): React.ReactElement {
  return (
    <ErrorBoundary>
      <AppInner debug={debug} />
    </ErrorBoundary>
  );
}
