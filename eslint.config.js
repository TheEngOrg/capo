// eslint.config.js — ESLint flat config (ESLint v9+, ESM)
// Uses typescript-eslint for TypeScript-aware linting.
// eslint-config-prettier disables any formatting rules that conflict with Prettier.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Base recommended rules for JS
  js.configs.recommended,

  // TypeScript-aware (type-checked) rules for all src/ TypeScript files.
  // Uses tsconfig.lint.json which extends tsconfig.json and adds test files.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.ts"],
  })),

  // Parser + project settings for type-checked rules on src/ (non-test)
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.lint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // non-null assertion (!) is used intentionally in topo-sort (queue.shift()!)
      "@typescript-eslint/no-non-null-assertion": "off",

      // Type assertions are occasionally needed when Zod-inferred types are
      // structurally identical but TypeScript can't prove equivalence.
      // runner.ts uses `plan.tasks as TEOTask[]` — redundant but harmless.
      // We keep the check as a warning rather than error so CI doesn't block
      // on existing annotated casts in product code.
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",

      // Unused vars: error, but allow _ prefix for intentional ignores
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // no-unnecessary-condition is used with an explicit disable comment in
      // validate.ts for the "directive" in plan guard (intentional dead-code guard).
      // Keeping the rule ON so future accidental dead-code is caught.
      "@typescript-eslint/no-unnecessary-condition": "error",

      // Floating promises: warn
      "@typescript-eslint/no-floating-promises": "warn",

      // Require await in async functions
      "@typescript-eslint/require-await": "error",

      // Unsafe assignments/calls from `any` typed values: warn only
      // (tightened to error once the codebase matures)
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
    },
  },

  // Test file overrides — relax rules that are intentionally violated in test
  // harnesses (throwing literals, async functions without await for stubs, etc.)
  {
    files: ["src/**/*.test.ts"],
    rules: {
      // Test stubs frequently throw raw strings/literals for simplicity
      "@typescript-eslint/only-throw-error": "off",

      // Executor stubs in tests are often declared async for type compatibility
      // but don't need await internally — these are intentional test stubs
      "@typescript-eslint/require-await": "off",

      // Unused imports from vitest (vi, beforeEach etc.) may be named in
      // destructuring imports for clarity but not all used in every test file
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Type assertions in tests are often used for narrowing test data
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },

  // For config files at root (vitest.config.ts, eslint.config.js, etc.)
  // — syntax-only, no type-checking (they aren't in tsconfig.json scope)
  {
    files: ["*.config.ts", "*.config.js", "scripts/**/*.mjs"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Prettier: disable formatting rules that conflict with Prettier.
  // Must be last so it overrides everything above.
  prettierConfig,

  // Global ignores
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  }
);
