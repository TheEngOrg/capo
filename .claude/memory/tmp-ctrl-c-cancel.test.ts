// tests/repl/ctrl-c-cancel.test.ts
//
// M3: Ctrl+C cancellation tests — T-M3-4.1 through 4.4

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { createSubprocessController } from '../../src/repl/SubprocessController.js';
import { createContextManager } from '../../src/context/manager.js';
import { App } from '../../src/cli/App.js';

// Mock the LLM runtime so App/Session renders without real claude calls
vi.mock('../../src/llm/claude-runtime.js', () => ({
  invokeClaude: vi.fn(() => new Promise(() => {})), // never resolves
}));

// Mock security/identity so token issuance works in tests
vi.mock('../../src/security/identity.js', () => ({
  issueIdentityToken: vi.fn(() => ({
    token_id: 'test-ctrl-c-token',
    session_id: '',
    issued_at: new Date().toISOString(),
    hmac: '',
  })),
}));

// Mock audit log
vi.mock('../../src/audit/log.js', () => ({
  writeAuditEvent: vi.fn(),
}));

// Mock history
vi.mock('../../src/repl/history.js', () => ({
  appendHistory: vi.fn(),
  historyPath: vi.fn(() => '/tmp/teo-test-history'),
}));

// Mock auth-probe so App doesn't fail on startup
vi.mock('../../src/cli/auth-probe.js', () => ({
  runAuthProbe: vi.fn(() => ({ ok: true, message: 'ok' })),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// T-M3-4.1 — Ctrl+C kills active subprocess
// ============================================================================

describe('T-M3-4.1 — Ctrl+C during active subprocess kills the child', () => {
  it('cancel() calls kill(SIGTERM) and clears the ref', () => {
    const controller = createSubprocessController();
    const mockChild = { pid: 12345, kill: vi.fn(() => true) };
    controller.setActiveProcess(mockChild);

    controller.cancel();

    expect(mockChild.kill).toHaveBeenCalledOnce();
    const killArg = mockChild.kill.mock.calls[0][0];
    expect(['SIGTERM', 'SIGKILL', undefined]).toContain(killArg);
    expect(controller.getActiveProcess()).toBeNull();
  });
});

// ============================================================================
// T-M3-4.2 — Ctrl+C with no active subprocess is a no-op
// ============================================================================

describe('T-M3-4.2 — Ctrl+C with no active subprocess is a no-op', () => {
  it('cancel() does not throw when no process is active', () => {
    const controller = createSubprocessController();
    expect(() => controller.cancel()).not.toThrow();
    expect(controller.getActiveProcess()).toBeNull();
  });
});

// ============================================================================
// T-M3-4.3 — interrupted turn is NOT added to context buffer
// ============================================================================

describe('T-M3-4.3 — interrupted turn is not committed', () => {
  it('abortCurrentTurn leaves history unchanged after cancel', () => {
    const ctx = createContextManager();
    const controller = createSubprocessController();
    const mockChild = { pid: 99, kill: vi.fn(() => true) };

    ctx.append({ role: 'user', content: 'prior successful input' });
    ctx.append({ role: 'assistant', content: 'prior successful output' });

    ctx.beginTurn('interrupted input');
    controller.setActiveProcess(mockChild);
    controller.cancel();
    ctx.abortCurrentTurn();

    const history = ctx.getHistory();
    expect(history).toHaveLength(2);
    expect(history.some(t => t.content === 'interrupted input')).toBe(false);
  });
});

// ============================================================================
// T-M3-4.4 — component-level Ctrl+C does not call process.exit
// ============================================================================

describe('T-M3-4.4 — component Ctrl+C handler does not call process.exit', () => {
  it('Ctrl+C does not exit the process, REPL prompt still visible', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    const { stdin, lastFrame } = render(React.createElement(App, { debug: false }));
    stdin.write('\x03'); // Ctrl+C raw byte

    expect(exitSpy).not.toHaveBeenCalled();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('teo>');

    exitSpy.mockRestore();
  });
});
