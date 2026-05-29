// src/repl/Session.tsx
//
// Pass 2: Full REPL loop — owns history state, wires useSubmit, renders Output + Prompt.

import React, { useState, useCallback, useRef } from 'react';
import { Box } from 'ink';
import { Output } from '../ui/Output.js';
import { Prompt } from '../ui/Prompt.js';
import { useSubmit } from './useSubmit.js';
import type { HistoryItem } from './types.js';

export interface SessionProps {
  debug: boolean;
  token_id?: string;
}

export function Session({ debug, token_id = '' }: SessionProps): React.ReactElement {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Debug: write session_start to stderr on first render when debug=true.
  // Same pattern as App.tsx's token_issued write — synchronous during render
  // so the debug stream is immediately visible on startup.
  const debugInitRef = useRef(false);
  if (!debugInitRef.current) {
    debugInitRef.current = true;
    if (debug) {
      process.stderr.write('[debug] session_start: ' + token_id + '\n');
    }
  }

  const onHistory = useCallback((item: HistoryItem) => {
    setHistory(prev => [...prev, item]);
  }, []);

  const handleSubmit = useSubmit({ token_id, debug, onHistory });

  return (
    <Box flexDirection="column">
      <Output items={history} />
      <Prompt onSubmit={handleSubmit} />
    </Box>
  );
}
