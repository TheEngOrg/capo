// src/security/keys.ts
//
// RELEASE_PUBLIC_KEY is injected via `bun build --define` at compile time.
// At runtime in dev (non-compiled), the global may be undefined — treated as empty string.
// Pass 1: stub declaration. Pass 2: no change needed — this is the M1 spec.
//
// ADR-0005 OQ-3: verify long-PEM --define behavior before M1 release build is cut.
//
// Coverage: this file is excluded from Vitest coverage (vitest.config.ts **/keys.ts).
// RELEASE_PUBLIC_KEY is a compile-time --define inject that cannot be set under
// Vitest/Node, making the try/catch branches impossible to exercise headlessly.

declare const RELEASE_PUBLIC_KEY: string;

export function getReleasePublicKey(): string {
  // In compiled binary: RELEASE_PUBLIC_KEY is replaced by --define.
  // In dev/test: fall back to empty string.
  try {
    return RELEASE_PUBLIC_KEY;
  } catch {
    return '';
  }
}
