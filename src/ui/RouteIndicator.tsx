// src/ui/RouteIndicator.tsx
//
// Pass 1: Stub renders dim placeholder. Pass 2: real dim styling per spec.

import React from 'react';
import { Text } from 'ink';
import type { DisplayRoute } from '../classifier/types.js';

export interface RouteIndicatorProps {
  route: DisplayRoute;
}

export function RouteIndicator({ route }: RouteIndicatorProps): React.ReactElement {
  // Pass 2: apply Ink dimColor prop per staff-eng Section 5.
  return <Text dimColor>[→ {route}]</Text>;
}
