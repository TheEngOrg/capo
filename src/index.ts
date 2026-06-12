#!/usr/bin/env node
/**
 * TEO 5 binary entry point. Parses argv via commander and dispatches to a core
 * verb. All real work lives in src/core; this is the thin CLI shell.
 */
import { buildProgram } from "./cli/teo.js";

buildProgram().parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`teo: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
