// src/pipelines/ArchitecturalStub.tsx
//
// Pass 1: Stub component. Renders placeholder text per staff-eng Section 4.3.
// Pass 2: No changes needed — locked wording defined in spec.

import React from 'react';
import { Text } from 'ink';
import type { PipelineProps } from './types.js';

export function ArchitecturalStub({ input }: PipelineProps): React.ReactElement {
  return <Text>[architectural stub] Received: {input}</Text>;
}
