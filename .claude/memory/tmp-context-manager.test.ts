// tests/unit/context-manager.test.ts
//
// M3: Context manager tests — T-M3-3.1 through 3.5

import { describe, it, expect } from 'vitest';
import { createContextManager } from '../../src/context/manager.js';

// ============================================================================
// T-M3-3.1 — no cross-session contamination
// ============================================================================

describe('T-M3-3.1 — context buffer does not leak between sessions', () => {
  it('two independent managers do not share state', () => {
    const ctx1 = createContextManager();
    const ctx2 = createContextManager();
    ctx1.append({ role: 'user', content: 'session 1 input' });

    expect(ctx2.getHistory()).toHaveLength(0);
    expect(ctx1.getHistory()).toHaveLength(1);
  });
});

// ============================================================================
// T-M3-3.2 — failed turn is NOT added to context buffer
// ============================================================================

describe('T-M3-3.2 — failed turn is not committed', () => {
  it('failCurrentTurn discards the pending turn', () => {
    const ctx = createContextManager();
    ctx.append({ role: 'user', content: 'prior successful input' });
    ctx.append({ role: 'assistant', content: 'prior successful output' });

    ctx.beginTurn('failing input');
    ctx.failCurrentTurn();

    const history = ctx.getHistory();
    expect(history).toHaveLength(2);
    expect(history.some(t => t.content === 'failing input')).toBe(false);
  });
});

// ============================================================================
// T-M3-3.3 — context serializes all prior turns in correct order
// ============================================================================

describe('T-M3-3.3 — context serializes turns in chronological order', () => {
  it('serializeForPrompt preserves turn order', () => {
    const ctx = createContextManager();
    ctx.append({ role: 'user', content: 'Turn 1 input' });
    ctx.append({ role: 'assistant', content: 'Turn 1 output' });
    ctx.append({ role: 'user', content: 'Turn 2 input' });
    ctx.append({ role: 'assistant', content: 'Turn 2 output' });

    const prefix = ctx.serializeForPrompt();

    const t1InputIdx = prefix.indexOf('Turn 1 input');
    const t1OutputIdx = prefix.indexOf('Turn 1 output');
    const t2InputIdx = prefix.indexOf('Turn 2 input');
    const t2OutputIdx = prefix.indexOf('Turn 2 output');

    expect(t1InputIdx).toBeLessThan(t1OutputIdx);
    expect(t1OutputIdx).toBeLessThan(t2InputIdx);
    expect(t2InputIdx).toBeLessThan(t2OutputIdx);

    expect(prefix).toContain('Turn 1 input');
    expect(prefix).toContain('Turn 2 output');
  });
});

// ============================================================================
// T-M3-3.4 — context prompt prefix is prepended before current input (via buildPrompt)
// (tested in llm-runtime.test.ts as well; this test exercises the manager's serialize)
// ============================================================================

describe('T-M3-3.4 — context serialization has content from all turns', () => {
  it('serializeForPrompt contains all turn content', () => {
    const ctx = createContextManager();
    ctx.append({ role: 'user', content: 'first question' });
    ctx.append({ role: 'assistant', content: 'first answer' });

    const prefix = ctx.serializeForPrompt();
    expect(prefix).toContain('first question');
    expect(prefix).toContain('first answer');
  });
});

// ============================================================================
// T-M3-3.5 — mixed MECHANICAL and ARCHITECTURAL turns preserved
// ============================================================================

describe('T-M3-3.5 — mixed route turns preserved in context', () => {
  it('MECHANICAL route turns appear in serializeForPrompt', () => {
    const ctx = createContextManager();
    ctx.append({ role: 'user', content: 'git status', route: 'MECHANICAL' });
    ctx.append({ role: 'assistant', content: 'On branch main\n1 file changed', route: 'MECHANICAL' });

    const prefix = ctx.serializeForPrompt();
    expect(prefix).toContain('git status');
    expect(prefix).toContain('On branch main');
  });
});

// ============================================================================
// Additional: commitTurn and abortCurrentTurn behavior
// ============================================================================

describe('commitTurn — adds both user and assistant turns', () => {
  it('commitTurn appends user+assistant to history', () => {
    const ctx = createContextManager();
    ctx.beginTurn('my question');
    ctx.commitTurn('the answer', 'ARCHITECTURAL');

    const history = ctx.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: 'user', content: 'my question' });
    expect(history[1]).toMatchObject({ role: 'assistant', content: 'the answer' });
  });
});

describe('abortCurrentTurn — discards pending turn', () => {
  it('abortCurrentTurn leaves history unchanged', () => {
    const ctx = createContextManager();
    ctx.append({ role: 'user', content: 'prior successful input' });
    ctx.append({ role: 'assistant', content: 'prior successful output' });

    ctx.beginTurn('interrupted input');
    ctx.abortCurrentTurn();

    const history = ctx.getHistory();
    expect(history).toHaveLength(2);
    expect(history.some(t => t.content === 'interrupted input')).toBe(false);
  });
});
