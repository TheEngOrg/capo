// src/ui/Prompt.tsx
//
// Pass 2: Renders "teo> " prefix + ink-text-input TextInput.
// Calls onSubmit on Enter and clears the input field.

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

export interface PromptProps {
  onSubmit: (value: string) => void;
}

export function Prompt({ onSubmit }: PromptProps): React.ReactElement {
  const [value, setValue] = useState('');

  const handleSubmit = (submitted: string): void => {
    setValue('');
    onSubmit(submitted);
  };

  return (
    <Box>
      <Text>teo&gt; </Text>
      <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
    </Box>
  );
}
