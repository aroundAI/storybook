import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Deliberately not UTC. ClickHouse hands back timestamps in two
    // zone-less formats that V8 parses differently — 'YYYY-MM-DD HH:MM:SS'
    // as local, 'YYYY-MM-DD' as UTC — so a suite running in UTC cannot see
    // the skew between them. Production runs on Lambda in UTC, which is
    // exactly why that bug reached review unnoticed.
    env: { TZ: 'Pacific/Niue' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '**/*.test.ts',
        '**/*.config.ts',
        'src/migrations/',
      ],
    },
  },
});
