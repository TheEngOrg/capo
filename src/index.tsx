// src/index.tsx
//
// Binary entry point. Commander parses CLI args before Ink renders anything.
// --version and --help are handled by Commander (exits before render loop).
// If no flags trigger early exit, render <App /> in the Ink REPL loop.

import { parseArgs } from './cli/args.js';
import { render } from 'ink';
import React from 'react';
import { App } from './cli/App.js';

// Commander handles --version and --help, calling process.exit() internally.
// parseArgs only returns if we should continue to the REPL.
try {
  const args = parseArgs(process.argv);

  render(<App debug={args.debug} />);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`teo: fatal error: ${message}\n`);
  process.exit(1);
}
