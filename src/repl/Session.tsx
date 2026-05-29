// src/repl/Session.tsx
//
// Pass 2: Full REPL loop — owns history state, wires useSubmit, renders Output + Prompt.

import React, { useState, useCallback } from 'react';
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
