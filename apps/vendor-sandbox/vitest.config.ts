import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(
        new URL('./__tests__/__mocks__/server-only.ts', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
  },
});
