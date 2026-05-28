import React from 'react';
import { render, Box, Text } from 'ink';

const App = () => (
  <Box borderStyle="round">
    <Text color="green">SPIKE-002 render check</Text>
  </Box>
);

const { unmount } = render(<App />);
setTimeout(() => unmount(), 500);
