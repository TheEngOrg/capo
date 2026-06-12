// src/repl/Session.tsx
//
// M3: Wire ContextManager, SubprocessController, isLoading state.

import React, { useState, useCallback, useRef } from 'react';
import { Box } from 'ink';
import { Output } from '../ui/Output.js';
import { Prompt } from '../ui/Prompt.js';
import { useSubmit } from './useSubmit.js';
import { createContextManager } from '../context/manager.js';
import { createSubprocessController } from './SubprocessController.js';
import type { HistoryItem } from './types.js';
import type { SubprocessController } from './SubprocessController.js';

export interface SessionProps {
  debug: boolean;
  token_id?: string;
  /** Optional: exposed for App.tsx to wire Ctrl+C → cancel() */
  onSubprocessController?: (ctrl: SubprocessController) => void;
}

export function Session({ debug, token_id = '', onSubprocessController }: SessionProps): React.ReactElement {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const contextManagerRef = useRef(createContextManager());
  const subprocessControllerRef = useRef(createSubprocessController());

  // Debug: write session_start to stderr on first render when debug=true.
  const debugInitRef = useRef(false);
  if (!debugInitRef.current) {
    debugInitRef.current = true;
    if (debug) {
      process.stderr.write('[debug] session_start: ' + token_id + '\n');
    }
    // Expose subprocessController to parent (App.tsx) for Ctrl+C wiring.
    if (onSubprocessController) {
      onSubprocessController(subprocessControllerRef.current);
    }
  }

  const onHistory = useCallback((item: HistoryItem) => {
    setHistory(prev => [...prev, item]);
  }, []);

  const handleSubmit = useSubmit({
    token_id,
    debug,
    onHistory,
    contextManager: contextManagerRef.current,
    subprocessController: subprocessControllerRef.current,
  });

  return (
    <Box flexDirection="column">
      <Output items={history} />
      <Prompt onSubmit={handleSubmit} />
    </Box>
  );
}
