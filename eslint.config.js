import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['**/*.svelte.ts'],
    languageOptions: {
      parser: ts.parser,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      // The rule doesn't differentiate external (http://) links from in-app
      // routes, so it false-positives on every doi.org / wormbase.org deep
      // link. We rely on convention (resolve() for in-app, raw http for
      // external) rather than fighting per-line disables.
      'svelte/no-navigation-without-resolve': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      '.svelte-kit/',
      'build/',
      '.wrangler/',
      '.cache/',
      'static/data/',
      // Generated WASM artifacts; rebuilt by scripts/build-wasm-cran.sh and CI.
      'scripts/wasm-cran/',
    ],
  },
);
