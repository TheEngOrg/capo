// tests/unit/coverage-config.test.ts
//
// T-M3-9.3, T-M3-9.4, T-M3-9.5 — Coverage gate config validation.
// These tests are RED until the M3 directories are added to vitest.config.ts include.
// They turn GREEN when Spawn 0 adds the entries.

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');

describe('Coverage config validation (T-M3-9.3, 9.4, 9.5)', () => {
  // T-M3-9.3 — All new M3 source directories are in the coverage include list
  it('T-M3-9.3: vitest.config.ts includes all M3 source directories', async () => {
    // Dynamic import resolves through vitest's ESM
    const configModule = await import(resolve(rootDir, 'vitest.config.ts'));
    const config = configModule.default as {
      test?: { coverage?: { include?: string[] } };
    };

    const coverageInclude = config.test?.coverage?.include ?? [];

    expect(
      coverageInclude.some((p: string) => p.includes('src/llm')),
      'src/llm must be in coverage.include'
    ).toBe(true);

    expect(
      coverageInclude.some((p: string) => p.includes('src/mechanical')),
      'src/mechanical must be in coverage.include'
    ).toBe(true);

    expect(
      coverageInclude.some((p: string) => p.includes('src/context')),
      'src/context must be in coverage.include'
    ).toBe(true);

    // Spinner — either src/spinner or src/ui (but src/ui is currently excluded
    // so src/spinner is the correct choice per Decision 3)
    const hasSpinnerDir =
      coverageInclude.some((p: string) => p.includes('src/spinner')) ||
      coverageInclude.some((p: string) => p.includes('src/ui') && !p.includes('exclude'));

    expect(
      hasSpinnerDir,
      'src/spinner must be in coverage.include (NOT src/ui which is excluded)'
    ).toBe(true);
  });

  // T-M3-9.4 — None of the new M3 modules appear in the coverage exclude list
  it('T-M3-9.4: new M3 source directories are NOT in the coverage exclude list', async () => {
    const configModule = await import(resolve(rootDir, 'vitest.config.ts'));
    const config = configModule.default as {
      test?: { coverage?: { exclude?: string[] } };
    };

    const coverageExclude = config.test?.coverage?.exclude ?? [];

    expect(
      coverageExclude.some((p: string) => p.includes('src/llm')),
      'src/llm must NOT appear in coverage.exclude'
    ).toBe(false);

    expect(
      coverageExclude.some((p: string) => p.includes('src/mechanical')),
      'src/mechanical must NOT appear in coverage.exclude'
    ).toBe(false);

    expect(
      coverageExclude.some((p: string) => p.includes('src/context')),
      'src/context must NOT appear in coverage.exclude'
    ).toBe(false);
  });

  // T-M3-9.5 — LLM wrapper module thresholds are set to 100%
  it('T-M3-9.5: LLM wrapper module thresholds are configured at 100%', async () => {
    const configModule = await import(resolve(rootDir, 'vitest.config.ts'));
    const config = configModule.default as {
      test?: {
        coverage?: {
          thresholds?: Record<
            string,
            { lines?: number; functions?: number; branches?: number; statements?: number }
          >;
        };
      };
    };

    const thresholds = config.test?.coverage?.thresholds ?? {};

    // Find the LLM threshold — either by exact key or wildcard
    const llmThreshold =
      thresholds['**/llm/claude-runtime.ts'] ??
      thresholds['**/llm/**'] ??
      null;

    expect(
      llmThreshold,
      '**/llm/claude-runtime.ts threshold must be defined in vitest.config.ts'
    ).not.toBeNull();

    expect(llmThreshold?.lines).toBe(100);
    expect(llmThreshold?.functions).toBe(100);
    expect(llmThreshold?.branches).toBe(100);
    expect(llmThreshold?.statements).toBe(100);
  });
});
