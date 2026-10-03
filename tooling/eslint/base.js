import eslint from '@eslint/js';
import turboConfig from 'eslint-config-turbo/flat';
import tsEsLint from 'typescript-eslint';

import { restrictedImports } from './model-boundary.js';
import nextConfig from './nextjs.js';

export default tsEsLint.config(
  eslint.configs.recommended,
  nextConfig,
  turboConfig,
  {
    settings: {
      react: {
        version: '19.0',
      },
    },
    languageOptions: {
      parserOptions: {
        warnOnUnsupportedTypeScriptVersion: false,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/triple-slash-reference': 'off',
      'react/react-in-jsx-scope': 'off',
      'import/no-anonymous-default-export': 'off',
      'import/named': 'off',
      'import/namespace': 'off',
      'import/default': 'off',
      'import/no-unresolved': 'off',
      'import/no-named-as-default-member': 'off',
      'import/no-named-as-default': 'off',
      'import/no-cycle': 'off',
      'import/no-unused-modules': 'off',
      'import/no-deprecated': 'off',
      'turbo/no-undeclared-env-vars': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The Trans rule, and the model-import boundary (FILM-1902): see
      // model-boundary.js; apps.js carries the same for app/**
      'no-restricted-imports': restrictedImports(),
    },
  },
  {
    ignores: [
      '**/node_modules',
      '**/database.types.ts',
      '**/.next',
      '**/.open-next',
      '**/public',
      'dist',
      'pnpm-lock.yaml',
      '**/__tests__/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/vitest.setup.ts',
      '**/vitest.config.ts',
    ],
  },
);
