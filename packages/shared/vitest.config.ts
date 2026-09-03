import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Modules under test are server-side and import `server-only`, which has
      // no Node entry point. Vitest rejects relative alias targets, so resolve
      // against this file rather than the cwd.
      'server-only': fileURLToPath(
        new URL('./src/__mocks__/server-only.ts', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '**/*.test.ts',
        '**/*.config.ts',
        'src/hooks/**',
      ],
    },
  },
});
