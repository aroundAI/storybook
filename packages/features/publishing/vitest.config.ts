import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '**/*.test.ts', '**/*.config.ts'],
    },
  },
  resolve: {
    alias: {
      'server-only': resolve(__dirname, './__mocks__/server-only.ts'),
    },
  },
});
