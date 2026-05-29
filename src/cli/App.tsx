// src/cli/App.tsx
//
// <App /> is the top-level Ink component. Renders ErrorBoundary + Session.
// Pass 1: Stub — renders placeholder.
// Pass 2: Add Ctrl+D useEffect for clean exit, token issuance, debug prop threading.

import React from 'react';
import { Text } from 'ink';
import { ErrorBoundary } from '../ui/ErrorBoundary.js';
import { Session } from '../repl/Session.js';

export interface AppProps {
  debug: boolean;
}

export function App({ debug }: AppProps): React.ReactElement {
  return (
    <ErrorBoundary>
      <Session debug={debug} />
    </ErrorBoundary>
  );
}
