// src/llm/claude-runtime.ts
//
// M3: Async LLM invocation via claude CLI subprocess.
// Uses async spawn (NOT spawnSync) — spawnSync blocks the Ink render loop.

import { spawn } from 'node:child_process';
import { buildPrompt } from './context.js';
import type { ContextTurn } from './context.js';

export type { ContextTurn };

export interface ClaudeRuntimeOptions {
  debug?: boolean;
}

/**
 * Invoke the claude CLI with the given input and conversation context.
 * Returns the full stdout output as a string on success.
 * Throws on empty input, non-zero exit, or spawn errors.
 */
export async function invokeClaude(
  input: string,
  context: ContextTurn[] = [],
  opts?: ClaudeRuntimeOptions,
): Promise<string> {
  if (input.trim() === '') {
    throw new Error('invokeClaude: input must not be empty');
  }

  const prompt = buildPrompt({ input, context });

  const args = [
    '--print',
    '--output-format',
    'text',
    '--dangerously-skip-permissions',
    prompt,
  ];

  if (opts?.debug) {
    process.stderr.write(`[debug] llm_invoke: claude ${args.slice(0, 3).join(' ')} <prompt>\n`);
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn('claude', args);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`invokeClaude: claude exited with code ${code ?? 'null'}. stderr: ${stderr}`));
      }
    });

    child.on('error', (err: Error) => {
      reject(new Error(`invokeClaude: spawn error: ${err.message}`));
    });
  });
}
