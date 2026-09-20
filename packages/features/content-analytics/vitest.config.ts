import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    /**
     * A fixed zone that is not UTC, because some of this package's date
     * handling is only wrong when the two differ.
     *
     * `parseUtcTimestamp` exists because ClickHouse returns
     * `'YYYY-MM-DD HH:MM:SS'` with no zone and `new Date()` reads that as
     * *local* time. On a machine whose local time is UTC those two
     * readings are the same instant, so the test for it passes either way
     * — which is what happened: the mutation guard for that parser went
     * red on a developer machine in Asia/Kolkata and stayed green in CI,
     * on a UTC runner, reporting that the fix was unnecessary.
     */
    env: { TZ: 'Asia/Kolkata' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.config.ts',
      ],
    },
  },
  resolve: {
    alias: {
      'server-only': resolve(__dirname, 'src/__mocks__/server-only.ts'),
    },
  },
});
