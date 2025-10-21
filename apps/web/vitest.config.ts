import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '.next/',
        'coverage/',
        '*.config.*',
        '**/*.d.ts',
        '**/*.type.ts',
        '**/types.ts',
        '**/__tests__/**',
        '**/test/**',
        'lambda/**',
        'websocket/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@kit/shared/logger': path.resolve(
        __dirname,
        '../../packages/shared/src/logger/index.ts',
      ),
      '@kit/supabase/server-client': path.resolve(
        __dirname,
        '../../packages/supabase/src/clients/server-client.ts',
      ),
      '@kit/cache': path.resolve(
        __dirname,
        '../../packages/cache/src/index.ts',
      ),
      '@kit': path.resolve(__dirname, '../../packages'),
      '~': path.resolve(__dirname, './app'),
      'server-only': path.resolve(__dirname, './__mocks__/server-only.ts'),
    },
  },
});
