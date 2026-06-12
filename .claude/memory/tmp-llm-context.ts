// src/llm/context.ts
//
// M3: Pure context/prompt builder. No FS, no process — pure string logic.

export interface ContextTurn {
  role: 'user' | 'assistant';
  content: string;
  route?: 'MECHANICAL' | 'ARCHITECTURAL';
}

/**
 * Build a prompt string for the claude CLI.
 * If context turns exist, prepends a markdown recap of the conversation.
 * The current user input appears at the end.
 */
export function buildPrompt(opts: { input: string; context: ContextTurn[] }): string {
  const { input, context } = opts;

  if (context.length === 0) {
    return input;
  }

  const lines: string[] = ['## Prior conversation\n'];
  for (const turn of context) {
    const label = turn.role === 'user' ? 'User' : 'Assistant';
    lines.push(`**${label}:** ${turn.content}\n`);
  }
  lines.push('\n## Current input\n');
  lines.push(input);

  return lines.join('');
}
