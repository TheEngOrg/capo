// src/ui/Prompt.tsx
//
// Pass 1: Stub — renders "teo> " prefix only, no real TextInput.
// Pass 2: Wire ink-text-input and onSubmit callback.

import React from 'react';
import { Text } from 'ink';

export interface PromptProps {
  onSubmit: (value: string) => void;
}

export function Prompt(_props: PromptProps): React.ReactElement {
  // Pass 2: render TextInput with "teo> " prefix via ink-text-input.
  return <Text>teo&gt; (stub)</Text>;
}
