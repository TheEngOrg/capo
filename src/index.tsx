// src/index.tsx
//
// Binary entry point. Commander parses CLI args before Ink renders anything.
// --version and --help are handled by Commander (exits before render loop).
// If no flags trigger early exit, render <App /> in the Ink REPL loop.

import { parseArgs } from './cli/args.js';
import { render } from 'ink';
import React from 'react';
import { App } from './cli/App.js';
import { readSync } from 'fs';

// Commander handles --version and --help, calling process.exit() internally.
// parseArgs only returns if we should continue to the REPL.
try {
  if (process.env.TEO_FORCE_STARTUP_ERROR) {
    throw new Error(process.env.TEO_FORCE_STARTUP_ERROR);
  }
  const args = parseArgs(process.argv);

  if (!process.stdin.isTTY) {
    // Distinguish piped content from empty/EOF stdin (Ctrl+D, /dev/null).
    // readSync on fd 0 returns 0 at EOF (empty pipe) and >0 if data is waiting.
    // Empty pipe = let App receive EOF and exit cleanly with 0.
    // Piped content = caller is trying non-interactive use; reject honestly.
    //
    // NOTE: readSync blocks until a byte arrives or EOF. Slow producers will
    // delay startup, but teo requires interactive use — a pipe is already unsupported.
    const peekBuf = Buffer.alloc(1);
    let bytesRead = 0;
    try {
      bytesRead = readSync(0, peekBuf, 0, 1, null);
    } catch {
      // EAGAIN on non-blocking fd: treat as piped content (reject).
      bytesRead = 1;
    }
    if (bytesRead > 0) {
      process.stderr.write('teo: error: an interactive terminal is required\n');
      process.exit(1);
    }
  }

  render(<App debug={args.debug} />);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`teo: fatal error: ${message}\n`);
  process.exit(1);
}
