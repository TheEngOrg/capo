// src/pipelines/types.ts

import type { RouteDecision } from '../classifier/types.js';

export interface PipelineProps {
  input: string;
  decision: RouteDecision;
}
