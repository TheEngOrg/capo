// src/cli/args.ts
//
// parseArgs() uses Commander to handle --version, --help, --debug flags.
// Commander exits the process for --version and --help before Ink renders.
//
// Version string: imported as a static JSON module so Bun's bundler can inline
// it into the compiled binary (createRequire path fails in --compile output).

import { Command } from 'commander';
import pkg from '../../package.json' with { type: 'json' };

export interface ParsedArgs {
  version: boolean;
  help: boolean;
  debug: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const program = new Command();

  program
    .name('teo')
    .description('TEO — Team Orchestration for Claude Code')
    .version(pkg.version, '-v, --version', 'print version and exit')
    .helpOption('-h, --help', 'print help and exit')
    .option('--debug', 'enable debug output (audit log + matched patterns to stderr)', false);

  program.parse(argv);

  const opts = program.opts<{ debug: boolean }>();

  return {
    version: false, // Commander already handled --version (calls process.exit)
    help: false,    // Commander already handled --help (calls process.exit)
    debug: opts.debug,
  };
}
