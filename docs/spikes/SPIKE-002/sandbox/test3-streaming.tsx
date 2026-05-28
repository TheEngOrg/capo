import React, { useState, useEffect } from 'react';
import { render, Static, Box, Text } from 'ink';

const STREAM_TEXT = 'Routing request to engineering agent...';
const INTERVAL_MS = 50;

const App = () => {
  const [history] = useState(['[prev] Task dispatched to qa', '[prev] Gate passed']);
  const [streamed, setStreamed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i++;
      setStreamed(STREAM_TEXT.slice(0, i));
      if (i >= STREAM_TEXT.length) { clearInterval(t); setDone(true); }
    }, INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { if (done) process.exit(0); }, [done]);

  return (
    <Box flexDirection="column">
      <Static items={history}>
        {(item, i) => <Text key={i} dimColor>{item}</Text>}
      </Static>
      <Text color="cyan">&gt; {streamed}</Text>
    </Box>
  );
};

render(<App />);
