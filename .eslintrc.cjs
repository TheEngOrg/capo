/**
 * ESLint config for the-eng-org monorepo.
 *
 * The critical rule: `no-restricted-imports` blocks any consumer
 * (anywhere outside @teo/core itself) from importing from
 * '@teo/core/internal/*' or deep paths. All cross-package imports
 * must go through the package's barrel (src/index.ts).
 *
 * This is the SOC2-relevant boundary enforcement per ADR-001
 * (greenfield package boundaries). The rule fails CI on every commit.
 */

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@teo/core/internal/*', '@teo/core/dist/*', '@teo/core/src/*'],
            message: 'Import from @teo/core barrel only. Internal module paths are not part of the public API.',
          },
          {
            group: ['../../../*', '../../../../*'],
            message: 'Cross-package relative imports are forbidden. Use workspace package imports (@teo/core).',
          },
        ],
      },
    ],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
  },
  overrides: [
    {
      files: ['packages/core/src/**/*.ts'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '*.config.js', '*.config.cjs'],
};
