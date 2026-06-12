// tests/unit/llm-runtime.test.ts
//
// M3: LLM wrapper tests — T-M3-1.1 through 1.8, 3.4, 3.6, 8.1, 9.1, 9.2

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';

// ============================================================================
// Mock node:child_process at the module level (vi.mock is hoisted)
// ============================================================================

vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn(),
  };
});

import { spawn } from 'node:child_process';
import { buildPrompt } from '../../src/llm/context.js';
import { invokeClaude } from '../../src/llm/claude-runtime.js';
import { ArchitecturalStub } from '../../src/pipelines/ArchitecturalStub.js';
import { render } from 'ink-testing-library';

// Helper: create a mock child process that emits the given events
function makeMockChild(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  errorEvent?: Error;
}) {
  const child = {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    on: vi.fn(),
    kill: vi.fn(() => true),
    pid: 12345,
  };

  // Wire the 'close' and 'error' events on the child itself
  const childEmitter = new EventEmitter();
  child.on = childEmitter.on.bind(childEmitter) as typeof child.on;

  // Schedule async events
  setImmediate(() => {
    if (opts.stdout) {
      child.stdout.emit('data', Buffer.from(opts.stdout));
    }
    if (opts.stderr) {
      child.stderr.emit('data', Buffer.from(opts.stderr));
    }
    if (opts.errorEvent) {
      childEmitter.emit('error', opts.errorEvent);
    } else {
      childEmitter.emit('close', opts.exitCode ?? 0);
    }
  });

  return child;
}

beforeEach(() => {
  vi.mocked(spawn).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// T-M3-1.1 — ArchitecturalStub regression pin (GREEN before M3 replaces it)
// ============================================================================

describe('T-M3-1.1 — ArchitecturalStub stub marker (regression pin)', () => {
  it('ArchitecturalStub renders the stub marker text', () => {
    const decision = {
      route: 'ARCHITECTURAL' as const,
      display_route: 'architectural' as const,
      raw_input: 'explain the architecture',
    };
    const { lastFrame } = render(
      React.createElement(ArchitecturalStub, { input: 'explain the architecture', decision }),
    );
    const frame = lastFrame() ?? '';
    // This pin exists to flip RED if the stub text is removed from production paths.
    // Output.tsx no longer imports ArchitecturalStub — this tests the dead file only.
    expect(frame).toContain('[architectural stub] Received:');
  });
});

// ============================================================================
// T-M3-1.2 — empty/whitespace prompt must reject
// ============================================================================

describe('T-M3-1.2 — invokeClaude rejects empty input', () => {
  it('throws on empty string', async () => {
    await expect(invokeClaude('')).rejects.toThrow();
  });

  it('throws on whitespace-only string', async () => {
    await expect(invokeClaude('   ')).rejects.toThrow();
  });
});

// ============================================================================
// T-M3-1.3 — buildPrompt with no context
// ============================================================================

describe('T-M3-1.3 — buildPrompt serializes prompt with no context', () => {
  it('returns input string directly when context is empty', () => {
    const prompt = buildPrompt({ input: 'explain the classifier', context: [] });
    expect(prompt).toContain('explain the classifier');
    expect(prompt).not.toContain('Prior turn');
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// T-M3-1.4 — buildPrompt injects prior-turn context
// ============================================================================

describe('T-M3-1.4 — buildPrompt injects prior-turn context prefix', () => {
  it('includes prior turns before current input', () => {
    const prompt = buildPrompt({
      input: 'what about authentication?',
      context: [
        { role: 'user', content: 'what is the classifier?' },
        { role: 'assistant', content: 'The classifier routes inputs to MECHANICAL or ARCHITECTURAL.' },
      ],
    });

    expect(prompt).toContain('what is the classifier?');
    expect(prompt).toContain('The classifier routes inputs');
    expect(prompt).toContain('what about authentication?');

    const contextIdx = prompt.indexOf('what is the classifier?');
    const inputIdx = prompt.indexOf('what about authentication?');
    expect(contextIdx).toBeLessThan(inputIdx);
  });
});

// ============================================================================
// T-M3-1.5 — subprocess exits 0 → returns stdout
// ============================================================================

describe('T-M3-1.5 — invokeClaude: subprocess exits 0 returns stdout', () => {
  it('resolves with stdout content', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockChild({
      stdout: 'The classifier routes inputs using pattern matching.',
      exitCode: 0,
    }) as any);

    const result = await invokeClaude('explain the classifier');
    expect(result).toBe('The classifier routes inputs using pattern matching.');
    expect(result).not.toContain('[architectural stub]');
  });
});

// ============================================================================
// T-M3-1.6 — subprocess exits non-zero → throws
// ============================================================================

describe('T-M3-1.6 — invokeClaude: subprocess exits non-zero throws', () => {
  it('rejects with exit code and stderr info', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockChild({
      stderr: 'claude: error: authentication required',
      exitCode: 1,
    }) as any);

    await expect(invokeClaude('explain the classifier')).rejects.toThrow(
      /exit.*1|authentication required/i,
    );
  });
});

// ============================================================================
// T-M3-1.7 — subprocess invocation uses correct CLI flags
// ============================================================================

describe('T-M3-1.7 — invokeClaude uses correct CLI flags', () => {
  it('calls spawn with claude and required flags', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockChild({ stdout: 'ok', exitCode: 0 }) as any);

    await invokeClaude('explain the classifier');

    expect(vi.mocked(spawn)).toHaveBeenCalledOnce();
    const [cmd, args] = vi.mocked(spawn).mock.calls[0];
    expect(cmd).toBe('claude');
    expect(args).toContain('--print');
    expect(args).toContain('--output-format');
    expect(args).toContain('text');
  });
});

// ============================================================================
// T-M3-3.4 — context prompt prefix is prepended before current input
// ============================================================================

describe('T-M3-3.4 — context prefix appears before current input in buildPrompt', () => {
  it('context content comes before current input', () => {
    const prompt = buildPrompt({
      input: 'how does it work?',
      context: [
        { role: 'user', content: 'what is the classifier?' },
        { role: 'assistant', content: 'It routes inputs.' },
      ],
    });

    expect(prompt.indexOf('what is the classifier?')).toBeLessThan(prompt.indexOf('how does it work?'));
    expect(prompt).toContain('It routes inputs.');
    expect(prompt).toContain('how does it work?');
  });
});

// ============================================================================
// T-M3-3.6 — two-turn coherence via invokeClaude
// ============================================================================

describe('T-M3-3.6 — two-turn coherence via buildPrompt', () => {
  it('second invocation includes first turn context in prompt', async () => {
    vi.mocked(spawn)
      .mockReturnValueOnce(makeMockChild({ stdout: 'The classifier uses regex patterns.', exitCode: 0 }) as any)
      .mockReturnValueOnce(makeMockChild({ stdout: 'MECHANICAL patterns are evaluated first.', exitCode: 0 }) as any);

    const turn1 = await invokeClaude('what is the classifier?', []);
    const turn2 = await invokeClaude('how does it work?', [
      { role: 'user', content: 'what is the classifier?' },
      { role: 'assistant', content: turn1 },
    ]);

    expect(turn1).toBe('The classifier uses regex patterns.');
    // Second invocation must have received the first-turn context in its prompt
    const secondCall = vi.mocked(spawn).mock.calls[1];
    const secondArgs = secondCall[1] as string[];
    const promptArg = secondArgs[secondArgs.length - 1]; // last arg is the prompt
    expect(promptArg).toContain('The classifier uses regex patterns.');
    expect(turn2).toBe('MECHANICAL patterns are evaluated first.');
  });
});

// ============================================================================
// T-M3-8.1 — stub marker absent from invokeClaude output
// ============================================================================

describe('T-M3-8.1 — ARCHITECTURAL output must not contain stub marker', () => {
  it('invokeClaude result contains no stub marker', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockChild({
      stdout: 'The classifier is responsible for routing user inputs.',
      exitCode: 0,
    }) as any);

    const result = await invokeClaude('explain the classifier', []);
    expect(result).not.toContain('[architectural stub]');
    expect(result).not.toContain('[mechanical stub]');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// T-M3-9.1 — module exports required interface
// ============================================================================

describe('T-M3-9.1, T-M3-9.2 — LLM module exports', () => {
  it('invokeClaude is a function', async () => {
    const llmModule = await import('../../src/llm/claude-runtime.js');
    expect(typeof llmModule.invokeClaude).toBe('function');
  });

  it('buildPrompt is exported from context module', async () => {
    const contextModule = await import('../../src/llm/context.js');
    expect(typeof contextModule.buildPrompt).toBe('function');
  });
});
