// tests/unit/tsconfig-strict.test.ts
//
// T-M3-11.2 — tsconfig.json has strict mode enabled.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');

describe('TypeScript config (T-M3-11.2)', () => {
  it('T-M3-11.2: tsconfig.json has strict mode enabled', () => {
    const tsconfigPath = resolve(rootDir, 'tsconfig.json');
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
      compilerOptions?: Record<string, unknown>;
    };

    expect(
      tsconfig.compilerOptions?.strict,
      'tsconfig.json must have compilerOptions.strict = true'
    ).toBe(true);
  });
});
