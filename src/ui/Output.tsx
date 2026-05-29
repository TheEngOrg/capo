// src/ui/Output.tsx
//
// Pass 1: Stub — renders nothing for empty history, placeholder for items.
// Pass 2: Render Static + per-item RouteIndicator + pipeline stub output.

import React from 'react';
import { Text } from 'ink';
import type { HistoryItem } from '../repl/types.js';

export interface OutputProps {
  items: HistoryItem[];
}

export function Output({ items }: OutputProps): React.ReactElement {
  if (items.length === 0) {
    return <Text></Text>;
  }
  // Pass 2: render using Ink Static component for atomicity.
  return <Text>{items.length} item(s) (stub)</Text>;
}
