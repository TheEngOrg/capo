// src/ui/Output.tsx
//
// Pass 2: Render history items atomically using Ink Static component.
// Each item renders RouteIndicator + matching pipeline stub.

import React from 'react';
import { Static, Box } from 'ink';
import type { HistoryItem } from '../repl/types.js';
import { RouteIndicator } from './RouteIndicator.js';
import { MechanicalStub } from '../pipelines/MechanicalStub.js';
import { ArchitecturalStub } from '../pipelines/ArchitecturalStub.js';

export interface OutputProps {
  items: HistoryItem[];
}

function HistoryEntry({ item }: { item: HistoryItem }): React.ReactElement {
  const PipelineStub = item.decision.display_route === 'mechanical'
    ? MechanicalStub
    : ArchitecturalStub;
  return (
    <Box flexDirection="column">
      <RouteIndicator route={item.decision.display_route} />
      <PipelineStub input={item.input} decision={item.decision} />
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
