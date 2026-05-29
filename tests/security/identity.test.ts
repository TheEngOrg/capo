import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { issueIdentityToken } from '../../src/security/identity.js';

// T-34 (identity token issuance failure surfaces to user) is also referenced in
// tests/repl/useSubmit.test.ts (Phase 2b) which tests the integration layer where the
// error propagates to the UI. The unit coverage here is intentional and distinct
// (different abstraction layer: token shape vs. error propagation).

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const HEX_64_RE = /^[0-9a-f]{64}$/i;

describe('Identity (Pass 2)', () => {
  // =========================================================================
  // MISUSE — issueIdentityToken() must never produce a token that passes preflight
  // with non-UUID-shaped token_id or a missing HMAC (T-36 prep).
  // =========================================================================

  it('T-36 prep — token_id must be a UUID v4 (not a placeholder)', () => {
    const token = issueIdentityToken();
    expect(token.token_id).toMatch(UUID_V4_RE);
  });

  it('T-36 prep — session_id must be a UUID v4 (not a placeholder)', () => {
    const token = issueIdentityToken();
    expect(token.session_id).toMatch(UUID_V4_RE);
  });

  it('T-36 prep — hmac must not be the placeholder string', () => {
    const token = issueIdentityToken();
    expect(token.hmac).not.toBe('placeholder-hmac');
  });

  it('T-36 prep — token_id must not be the placeholder string', () => {
    const token = issueIdentityToken();
    expect(token.token_id).not.toBe('placeholder-token-id');
  });

  // =========================================================================
  // BOUNDARY — structural correctness and uniqueness (T-34 prep)
  // =========================================================================

  it('T-34 prep — token has all required fields: token_id, session_id, issued_at, hmac', () => {
    const token = issueIdentityToken();
    expect(token).toHaveProperty('token_id');
    expect(token).toHaveProperty('session_id');
    expect(token).toHaveProperty('issued_at');
    expect(token).toHaveProperty('hmac');
  });

  it('token_id is a valid UUID v4', () => {
    const token = issueIdentityToken();
    expect(token.token_id).toMatch(UUID_V4_RE);
  });

  it('session_id is a valid UUID v4', () => {
    const token = issueIdentityToken();
    expect(token.session_id).toMatch(UUID_V4_RE);
  });

  it('issued_at is a parseable ISO-8601 UTC timestamp', () => {
    const token = issueIdentityToken();
    expect(token.issued_at).toMatch(ISO_8601_UTC_RE);
    const parsed = Date.parse(token.issued_at);
    expect(Number.isNaN(parsed)).toBe(false);
  });

  it('issued_at is approximately now (within 5 seconds)', () => {
    const before = Date.now();
    const token = issueIdentityToken();
    const after = Date.now();
    const issued = Date.parse(token.issued_at);
    expect(issued).toBeGreaterThanOrEqual(before - 1000);
    expect(issued).toBeLessThanOrEqual(after + 1000);
  });

  it('hmac is a 64-character hex string (SHA-256 output)', () => {
    const token = issueIdentityToken();
    expect(token.hmac).toMatch(HEX_64_RE);
  });

  it('two successive calls produce different token_ids (uniqueness)', () => {
    const a = issueIdentityToken();
    const b = issueIdentityToken();
    expect(a.token_id).not.toBe(b.token_id);
  });

  it('two successive calls produce different session_ids (uniqueness)', () => {
    const a = issueIdentityToken();
    const b = issueIdentityToken();
    expect(a.session_id).not.toBe(b.session_id);
  });

  it('two successive calls produce different hmac values', () => {
    const a = issueIdentityToken();
    const b = issueIdentityToken();
    // Because token_id and session_id differ, HMACs must differ.
    expect(a.hmac).not.toBe(b.hmac);
  });

  // =========================================================================
  // GOLDEN — HMAC structural integrity
  // =========================================================================

  it('hmac is non-empty', () => {
    const token = issueIdentityToken();
    expect(token.hmac.length).toBeGreaterThan(0);
  });

  it('hmac is a hex string (only hex characters)', () => {
    const token = issueIdentityToken();
    expect(token.hmac).toMatch(/^[0-9a-f]+$/i);
  });

  it('issueIdentityToken() does not throw', () => {
    expect(() => issueIdentityToken()).not.toThrow();
  });

  it('each call returns a fresh object (no shared reference)', () => {
    const a = issueIdentityToken();
    const b = issueIdentityToken();
    // Different objects — not the same reference
    expect(a).not.toBe(b);
  });
});
