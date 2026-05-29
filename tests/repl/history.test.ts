import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendHistory, historyPath } from '../../src/repl/history.js';

// T-09/T-10 (SIGTERM/SIGKILL + history durability) are manual smoke tests.
// T-22, T-23, T-24 (REPL integration) are Phase 2b integration tests.
// These tests cover pure-logic history serialization: T-40 through T-46.

function uniqueTmpDir(): string {
  return join(tmpdir(), `teo-history-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function getHistoryPath(stateDir: string): string {
  return join(stateDir, 'teo', 'history');
}

function readLines(filePath: string): string[] {
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0);
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

describe('History (Pass 2)', () => {
  // =========================================================================
  // MISUSE — callers doing wrong things must fail cleanly
  // =========================================================================

  it('T-40 — non-writable history path throws or errors cleanly (does not silently no-op)', () => {
    // Redirect to a path inside a file (not a directory) to force a write error.
    // We create a FILE where the teo/ directory should be — appendFileSync will fail.
    mkdirSync(testStateDir, { recursive: true });
    const blockingFile = join(testStateDir, 'teo');
    writeFileSync(blockingFile, 'I am a file, not a directory');
    // appendHistory should throw (not silently swallow the error).
    expect(() => appendHistory('mechanical', 'show me the current directory')).toThrow();
  });

  it('T-41 — colon in input: line splits on FIRST colon only when re-read', () => {
    appendHistory('mechanical', 'list files in src: and also test:');

    const lines = readLines(getHistoryPath(testStateDir));
    expect(lines).toHaveLength(1);

    const line = lines[0];
    // The line must be: "mechanical: list files in src: and also test:"
    expect(line).toBe('mechanical: list files in src: and also test:');

    // Parser contract: split on first colon only
    const colonIndex = line.indexOf(':');
    const route = line.slice(0, colonIndex);
    const text = line.slice(colonIndex + 2); // skip ': '
    expect(route).toBe('mechanical');
    expect(text).toBe('list files in src: and also test:');
  });

  it('T-42 — newlines in input: exactly one new history line per submission', () => {
    appendHistory('architectural', 'first line\nsecond line');

    const fileContents = readFileSync(getHistoryPath(testStateDir), 'utf8');
    // The file should have exactly one entry — one \n-terminated record.
    // Either newlines are escaped or the text is truncated, but only ONE line total.
    const lines = fileContents.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
  });

  it('T-43 — unicode written with correct UTF-8 encoding (round-trip)', () => {
    const unicodeInput = 'help me build 日本語 support';
    appendHistory('architectural', unicodeInput);

    const lines = readLines(getHistoryPath(testStateDir));
    expect(lines).toHaveLength(1);

    const line = lines[0];
    expect(line).toBe(`architectural: ${unicodeInput}`);

    // Verify the file is valid UTF-8 by re-reading and confirming no corruption
    const colonIndex = line.indexOf(':');
    const text = line.slice(colonIndex + 2);
    expect(text).toBe(unicodeInput);
  });

  // =========================================================================
  // BOUNDARY — append behavior, XDG path resolution
  // =========================================================================

  it('T-44 — history file is appended to, not overwritten', () => {
    // Pre-populate with two entries
    mkdirSync(join(testStateDir, 'teo'), { recursive: true });
    const histFile = getHistoryPath(testStateDir);
    writeFileSync(histFile, 'mechanical: existing entry one\narchitectural: existing entry two\n', 'utf8');

    // Append a third
    appendHistory('mechanical', 'show me the current directory');

    const lines = readLines(histFile);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('mechanical: existing entry one');
    expect(lines[1]).toBe('architectural: existing entry two');
    expect(lines[2]).toBe('mechanical: show me the current directory');
  });

  it('XDG_STATE_HOME is honored: history written under XDG dir', () => {
    appendHistory('mechanical', 'show me the current directory');

    const expectedPath = getHistoryPath(testStateDir);
    expect(existsSync(expectedPath)).toBe(true);
  });

  it('teo/ directory is created if absent', () => {
    const teoDir = join(testStateDir, 'teo');
    expect(existsSync(teoDir)).toBe(false);

    appendHistory('mechanical', 'show me the current directory');

    expect(existsSync(teoDir)).toBe(true);
  });

  it('historyPath() returns a non-empty string under XDG_STATE_HOME', () => {
    const p = historyPath();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
    expect(p).toContain('teo');
    expect(p).toContain('history');
  });

  it('historyPath() includes XDG_STATE_HOME when set', () => {
    const p = historyPath();
    expect(p).toContain(testStateDir);
  });

  it('historyPath() falls back gracefully when XDG_STATE_HOME is unset', () => {
    delete process.env.XDG_STATE_HOME;
    const p = historyPath();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
    // Should resolve to ~/.local/state/teo/history
    expect(p).toContain('.local');
    expect(p).toContain('state');
    expect(p).toContain('teo');
    expect(p).toContain('history');
    // Restore for afterEach cleanup
    process.env.XDG_STATE_HOME = testStateDir;
  });

  // =========================================================================
  // GOLDEN — format correctness (T-45, T-46)
  // =========================================================================

  it('T-45 — format is exactly "<route>: <text>" (lowercase route, colon-space, verbatim input)', () => {
    appendHistory('mechanical', 'show me the current directory');

    const lines = readLines(getHistoryPath(testStateDir));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('mechanical: show me the current directory');
  });

  it('T-45 — route label is lowercase in history file', () => {
    appendHistory('mechanical', 'run the tests');
    appendHistory('architectural', 'design a caching layer');

    const lines = readLines(getHistoryPath(testStateDir));
    expect(lines[0]).toMatch(/^mechanical:/);
    expect(lines[1]).toMatch(/^architectural:/);
    // Must NOT be uppercase enum value
    expect(lines[0]).not.toMatch(/^MECHANICAL:/);
    expect(lines[1]).not.toMatch(/^ARCHITECTURAL:/);
  });

  it('T-46 — UNKNOWN-classified input written as "architectural:" not "unknown:"', () => {
    // UNKNOWN collapses to display_route: 'architectural' at classification time.
    // appendHistory receives the display_route — so it receives 'architectural'.
    // This test documents: the caller passes 'architectural' for UNKNOWN inputs,
    // and the file line must say "architectural: blorp the fleeb".
    appendHistory('architectural', 'blorp the fleeb');

    const lines = readLines(getHistoryPath(testStateDir));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('architectural: blorp the fleeb');
    expect(lines[0]).not.toMatch(/^unknown:/i);
  });

  it('each entry is terminated with a newline (JSONL-style)', () => {
    appendHistory('mechanical', 'git status');

    const raw = readFileSync(getHistoryPath(testStateDir), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('mechanical and architectural routes both write correctly', () => {
    appendHistory('mechanical', 'run the build');
    appendHistory('architectural', 'design a caching layer for a high-traffic API');

    const lines = readLines(getHistoryPath(testStateDir));
    expect(lines[0]).toBe('mechanical: run the build');
    expect(lines[1]).toBe('architectural: design a caching layer for a high-traffic API');
  });

  it('input text is written verbatim (no trimming)', () => {
    // Leading space in input must be preserved
    appendHistory('mechanical', ' show me the directory');

    const lines = readLines(getHistoryPath(testStateDir));
    expect(lines[0]).toBe('mechanical:  show me the directory');
  });
});
