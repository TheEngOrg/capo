// Pass 1 stub — implementation lands in Pass 2
// End-to-end REPL flow: PM Section 7 scenario steps.
// Spec reference: M1-implementation-spec.md §1 (tests/integration/golden.test.ts), M1-test-specs.md Sections 2-5.
// Note: these tests require the compiled binary or a full ink-testing-library render loop — they are integration-level,
// not isolated unit tests. The binary must be compiled before these run.

import { describe, it } from 'vitest';

describe.skip('Golden path: PM Section 7 smoke scenario (Pass 2)', () => {
  it('Step 1 — teo --version prints version string matching package.json', () => {
    // TODO Pass 2: T-04 — spawn binary with --version, compare stdout to package.json#version exactly
  });

  it('Step 2 — teo opens REPL with teo> prompt within 2000ms', () => {
    // TODO Pass 2: T-06, T-14 — subprocess with EOF stdin; assert prompt rendered and exit 0
  });

  it('Step 3 — "show me the current directory" routes to [→ mechanical] with stub text', () => {
    // TODO Pass 2: T-22, T-31 — ink-testing-library submit; assert label and "[mechanical stub] Received: show me the current directory"
  });

  it('Step 4 — "design a caching layer for a high-traffic API" routes to [→ architectural] with stub text', () => {
    // TODO Pass 2: T-23, T-32 — ink-testing-library submit; assert label and "[architectural stub] Received: ..."
  });

  it('Step 5 — "blorp the fleeb" routes to [→ architectural], not [→ unknown]', () => {
    // TODO Pass 2: T-21, T-24 — UNKNOWN input must display as architectural, never as unknown
  });

  it('Step 6 — Ctrl+D exits with code 0', () => {
    // TODO Pass 2: T-14 — send EOF to stdin subprocess, assert exit code 0, no stack trace in stderr
  });

  it('Step 7 — history file has three entries in <route>: <text> format after steps 3-5', () => {
    // TODO Pass 2: T-44, T-45, T-46 — read history file, assert 3 lines, correct format, step-5 entry is "architectural: blorp the fleeb"
  });

  it('Step 8 — --debug output shows token issuance and preflight calls', () => {
    // TODO Pass 2: T-37, T-38 — start with --debug, submit 3 inputs, assert 1 token_issued + 3 preflight_called in debug output
  });
});
