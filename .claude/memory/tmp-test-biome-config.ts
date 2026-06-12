// tests/unit/biome-config.test.ts
//
// T-M3-10.1: biome.json exists in project root.
// T-M3-10.2: biome.json is valid JSON.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');

describe('Biome linter config (T-M3-10.1, T-M3-10.2)', () => {
  // T-M3-10.1 — biome.json exists in project root
  it('T-M3-10.1: biome.json must exist in project root', () => {
    const biomeConfig = resolve(rootDir, 'biome.json');
    expect(existsSync(biomeConfig), 'biome.json must exist in project root').toBe(true);
  });

  // T-M3-10.2 — biome.json is valid JSON
  it('T-M3-10.2: biome.json must be valid JSON', () => {
    const biomeConfig = resolve(rootDir, 'biome.json');
    const raw = readFileSync(biomeConfig, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
  });
});
