// src/repl/Session.tsx
//
// Pass 1: Stub component — renders placeholder only.
// Pass 2: Implement full REPL loop per staff-eng Section 5.

import React from 'react';
import { Text } from 'ink';

export interface SessionProps {
  debug: boolean;
}

export function Session(_props: SessionProps): React.ReactElement {
  // Pass 2: render <Output items={history} /> and <Prompt onSubmit={handleSubmit} />.
  return <Text>teo session (stub)</Text>;
}
