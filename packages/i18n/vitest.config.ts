import { defineConfig } from 'vitest/config';

export default defineConfig({
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
        'src/i18n-provider.tsx', // React component, tested in integration
        'src/i18n.client.ts', // Browser-specific, tested in e2e
      ],
    },
  },
});
