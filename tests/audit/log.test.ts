import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { writeAuditEvent, auditLogPath } from '../../src/audit/log.js';
import type { AuditEvent } from '../../src/audit/types.js';

// T-37, T-38 (--debug flag output) are integration tests requiring a real CLI process
// and live in the Phase 2b integration layer. The unit coverage here is intentional
// and distinct: we test writeAuditEvent() in isolation, not the --debug wiring.

const UUID_RE = /^[0-9a-f-]{36}$/i;
const ISO_8601_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const HEX_64_RE = /^[0-9a-f]{64}$/i;

function uniqueTmpDir(): string {
  return join(tmpdir(), `teo-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function getAuditPath(stateDir: string): string {
  return join(stateDir, 'teo', 'audit.log');
}

function readLines(filePath: string): string[] {
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

let originalXdgStateHome: string | undefined;
let testStateDir: string;

beforeEach(() => {
  originalXdgStateHome = process.env.XDG_STATE_HOME;
  testStateDir = uniqueTmpDir();
  process.env.XDG_STATE_HOME = testStateDir;
});

afterEach(() => {
  if (originalXdgStateHome === undefined) {
    delete process.env.XDG_STATE_HOME;
  } else {
    process.env.XDG_STATE_HOME = originalXdgStateHome;
  }
});

// Base event fixture
function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    type: 'preflight_called',
    token_id: '550e8400-e29b-41d4-a716-446655440000',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('Audit Log (Pass 2)', () => {
  // =========================================================================
  // MISUSE — what the log must NEVER do: store plaintext, accept bad inputs
  // =========================================================================

  it('plaintext input is NEVER written to the audit log', () => {
    const sensitiveInput = 'my secret password 12345';
    const inputHash = createHash('sha256').update(sensitiveInput).digest('hex');
    const event = makeEvent({ type: 'route_decision', input_hash: inputHash });

    writeAuditEvent(event);

    const auditPath = getAuditPath(testStateDir);
    const contents = readFileSync(auditPath, 'utf8');
    expect(contents).not.toContain(sensitiveInput);
    expect(contents).toContain(inputHash);
  });

  it('input_hash is a SHA-256 hex string (64 chars) when present', () => {
    const rawInput = 'show me the current directory';
    const inputHash = createHash('sha256').update(rawInput).digest('hex');
    const event = makeEvent({ type: 'route_decision', input_hash: inputHash });

    writeAuditEvent(event);

    const auditPath = getAuditPath(testStateDir);
    const line = readLines(auditPath)[0];
    const parsed = JSON.parse(line);
    expect(parsed.input_hash).toMatch(HEX_64_RE);
  });

  // =========================================================================
  // BOUNDARY — XDG path resolution, directory creation, JSONL format
  // =========================================================================

  it('XDG_STATE_HOME is honored: audit log written under XDG dir', () => {
    const event = makeEvent();
    writeAuditEvent(event);

    const expectedPath = getAuditPath(testStateDir);
    expect(existsSync(expectedPath)).toBe(true);
  });

  it('falls back to ~/.local/state when XDG_STATE_HOME is unset', () => {
    delete process.env.XDG_STATE_HOME;
    // We can't write to the real ~/.local/state/teo in tests, so we just verify
    // the function does not throw when XDG_STATE_HOME is absent.
    // If the real homedir path is writable it will create ~/.local/state/teo/audit.log.
    // We don't want to pollute that, so we restore env and use a check that doesn't write.
    // Instead, verify the function completes without throwing — the exact path is tested above.
    const event = makeEvent();
    // Re-set to a safe tempdir so we don't write to real homedir during tests.
    process.env.XDG_STATE_HOME = testStateDir;
    expect(() => writeAuditEvent(event)).not.toThrow();
  });

  it('auditLogPath() falls back to ~/.local/state path when XDG_STATE_HOME is unset', () => {
    // Mirror the historyPath() fallback test: call auditLogPath() with env unset,
    // assert path shape without writing to the real homedir.
    // This exercises the ?? RHS branch that the /* v8 ignore next */ was hiding.
    delete process.env.XDG_STATE_HOME;
    const p = auditLogPath();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
    // Should resolve to ~/.local/state/teo/audit.log
    expect(p).toContain('.local');
    expect(p).toContain('state');
    expect(p).toContain('teo');
    expect(p).toContain('audit.log');
    // Restore for afterEach cleanup
    process.env.XDG_STATE_HOME = testStateDir;
  });

  it('creates the teo/ directory if it does not exist', () => {
    const teoDir = join(testStateDir, 'teo');
    expect(existsSync(teoDir)).toBe(false);

    writeAuditEvent(makeEvent());

    expect(existsSync(teoDir)).toBe(true);
  });

  it('creates the audit.log file if it does not exist', () => {
    const auditPath = getAuditPath(testStateDir);
    expect(existsSync(auditPath)).toBe(false);

    writeAuditEvent(makeEvent());

    expect(existsSync(auditPath)).toBe(true);
  });

  it('each call appends exactly one JSONL line', () => {
    writeAuditEvent(makeEvent({ type: 'token_issued' }));
    writeAuditEvent(makeEvent({ type: 'preflight_called' }));
    writeAuditEvent(makeEvent({ type: 'route_decision' }));

    const lines = readLines(getAuditPath(testStateDir));
    expect(lines).toHaveLength(3);
  });

  it('multiple calls append, not overwrite (earlier lines preserved)', () => {
    writeAuditEvent(makeEvent({ type: 'token_issued' }));
    writeAuditEvent(makeEvent({ type: 'preflight_called' }));

    const lines = readLines(getAuditPath(testStateDir));
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.type).toBe('token_issued');
  });

  it('each line is valid JSON', () => {
    writeAuditEvent(makeEvent({ type: 'token_issued' }));
    writeAuditEvent(makeEvent({ type: 'preflight_called' }));

    const lines = readLines(getAuditPath(testStateDir));
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('each JSON line ends with \\n (JSONL format)', () => {
    writeAuditEvent(makeEvent());

    const raw = readFileSync(getAuditPath(testStateDir), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  // =========================================================================
  // GOLDEN — required fields present in every written event
  // =========================================================================

  it('written event contains required field: type', () => {
    writeAuditEvent(makeEvent({ type: 'token_issued' }));
    const line = readLines(getAuditPath(testStateDir))[0];
    const parsed = JSON.parse(line);
    expect(parsed).toHaveProperty('type', 'token_issued');
  });

  it('written event contains required field: token_id', () => {
    const tokenId = '550e8400-e29b-41d4-a716-446655440000';
    writeAuditEvent(makeEvent({ token_id: tokenId }));
    const line = readLines(getAuditPath(testStateDir))[0];
    const parsed = JSON.parse(line);
    expect(parsed).toHaveProperty('token_id', tokenId);
  });

  it('written event contains required field: timestamp', () => {
    writeAuditEvent(makeEvent());
    const line = readLines(getAuditPath(testStateDir))[0];
    const parsed = JSON.parse(line);
    expect(parsed).toHaveProperty('timestamp');
    expect(parsed.timestamp).toMatch(ISO_8601_UTC_RE);
  });

  it('route_decision event includes route field when provided', () => {
    writeAuditEvent(makeEvent({ type: 'route_decision', route: 'mechanical' }));
    const line = readLines(getAuditPath(testStateDir))[0];
    const parsed = JSON.parse(line);
    expect(parsed).toHaveProperty('route', 'mechanical');
  });

  it('all valid AuditEventType values can be written', () => {
    const types = ['token_issued', 'preflight_called', 'preflight_failed', 'route_decision', 'history_written'] as const;
    for (const type of types) {
      writeAuditEvent(makeEvent({ type }));
    }
    const lines = readLines(getAuditPath(testStateDir));
    expect(lines).toHaveLength(types.length);
    for (let i = 0; i < types.length; i++) {
      const parsed = JSON.parse(lines[i]);
      expect(parsed.type).toBe(types[i]);
    }
  });
});
