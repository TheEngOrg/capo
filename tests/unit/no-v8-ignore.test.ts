// tests/unit/no-v8-ignore.test.ts
//
// T-M3-12.1 — grep src/ for v8-ignore or c8-ignore directives finds zero matches.
// No new v8/c8 coverage exclusions are permitted in src/.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');

interface IgnoreHit {
  file: string;
  line: number;
  text: string;
}

function findIgnoreDirectives(dir: string): IgnoreHit[] {
  const hits: IgnoreHit[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      hits.push(...findIgnoreDirectives(full));
    } else if (['.ts', '.tsx'].includes(extname(entry.name))) {
      const lines = readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (/v8[-\s]ignore|c8[-\s]ignore/i.test(line)) {
          hits.push({ file: full, line: idx + 1, text: line.trim() });
        }
      });
    }
  }
  return hits;
}

describe('No v8/c8 ignore directives in src/ (T-M3-12.1)', () => {
  it('T-M3-12.1: zero v8-ignore or c8-ignore directives found in src/', () => {
    const srcDir = resolve(rootDir, 'src');
    const hits = findIgnoreDirectives(srcDir);

    expect(
      hits,
      `v8/c8 ignore directives found in src/:\n${hits.map(h => `  ${h.file}:${h.line}: ${h.text}`).join('\n')}`
    ).toHaveLength(0);
  });
});
