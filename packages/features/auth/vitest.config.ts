import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, 'src/__mocks__/server-only.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    env: {
      CAPTCHA_SECRET_TOKEN: 'test-secret-token',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '**/*.test.ts',
        '**/*.config.ts',
        'src/components/**',
      ],
    },
  },
});
