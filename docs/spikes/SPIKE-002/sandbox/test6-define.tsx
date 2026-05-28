declare const RELEASE_PUBLIC_KEY: string;
import { render, Text, Box } from 'ink';
import React from 'react';

const App = () => (
  <Box flexDirection="column">
    <Text>Key length: {RELEASE_PUBLIC_KEY.length}</Text>
    <Text>Starts with: {RELEASE_PUBLIC_KEY.slice(0, 27)}</Text>
    <Text>Contains newline: {String(RELEASE_PUBLIC_KEY.includes('\n'))}</Text>
    <Text>Base64 padding present: {String(RELEASE_PUBLIC_KEY.includes('='))}</Text>
  </Box>
);

render(<App />);
setTimeout(() => process.exit(0), 500);
