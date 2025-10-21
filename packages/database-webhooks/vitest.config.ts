import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      SUPABASE_DB_WEBHOOK_SECRET: 'test-webhook-secret-123',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '**/*.test.ts', '**/*.config.ts'],
    },
  },
});
