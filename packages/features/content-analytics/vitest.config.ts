import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    // Not UTC, and the same zone `@kit/clickhouse` pins for the same
    // reason: a suite running in UTC cannot see a timestamp being read as
    // local time, because the two are the same instant there. This package
    // reads the same zone-less ClickHouse timestamps, and
    // `parseUtcTimestamp`'s guard proved the point by going red on a
    // developer machine and green on CI's UTC runner.
    env: { TZ: 'Pacific/Niue' },
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
