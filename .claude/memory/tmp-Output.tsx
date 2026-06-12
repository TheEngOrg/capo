// src/ui/Output.tsx
//
// M3: Render output text instead of ArchitecturalStub; keep MechanicalStub.
// ArchitecturalStub import removed — dead file left on disk.

import React from 'react';
import { Static, Box, Text } from 'ink';
import type { HistoryItem } from '../repl/types.js';
import { RouteIndicator } from './RouteIndicator.js';
import { MechanicalStub } from '../pipelines/MechanicalStub.js';

export interface OutputProps {
  items: HistoryItem[];
}

function HistoryEntry({ item }: { item: HistoryItem }): React.ReactElement {
  if (item.decision.display_route === 'mechanical') {
    return (
      <Box flexDirection="column">
        <RouteIndicator route={item.decision.display_route} />
        <MechanicalStub input={item.input} decision={item.decision} />
      </Box>
    );
  }

  // ARCHITECTURAL route: render output text based on status.
  let content: React.ReactElement;
  if (item.status === 'pending') {
    content = <Text dimColor>⠋ thinking…</Text>;
  } else if (item.status === 'error') {
    content = <Text color="red">{item.output ?? 'An error occurred.'}</Text>;
  } else {
    content = <Text>{item.output ?? ''}</Text>;
  }

  return (
    <Box flexDirection="column">
      <RouteIndicator route={item.decision.display_route} />
      {content}
    </Box>
  );
}

export function Output({ items }: OutputProps): React.ReactElement {
  if (items.length === 0) {
    return <React.Fragment />;
  }
  return (
    <Static items={items}>
      {(item, index) => (
        <HistoryEntry key={index} item={item} />
      )}
    </Static>
  );
}
