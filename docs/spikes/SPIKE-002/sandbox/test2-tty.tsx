import React, { useState } from 'react';
import { render, Text, useInput } from 'ink';

const App = () => {
  const [last, setLast] = useState('(none)');
  useInput((input, key) => {
    if (key.ctrl && input === 'c') process.exit(0);
    const label = key.upArrow ? 'ArrowUp'
      : key.downArrow ? 'ArrowDown'
      : key.escape ? 'Escape'
      : JSON.stringify(input);
    setLast(label);
  });
  return <Text>Last key: {last}</Text>;
};

render(<App />);
