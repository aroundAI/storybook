import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, 'src/__mocks__/server-only.ts'),
      '@kit/ui': path.resolve(__dirname, '../../../packages/ui/src'),
      '@kit/ui/button': path.resolve(
        __dirname,
        '../../../packages/ui/src/shadcn/button.tsx',
      ),
      '@kit/ui/slider': path.resolve(
        __dirname,
        '../../../packages/ui/src/shadcn/slider.tsx',
      ),
      '@kit/ui/spinner': path.resolve(
        __dirname,
        '../../../packages/ui/src/makerkit/spinner.tsx',
      ),
      '@kit/ui/utils': path.resolve(
        __dirname,
        '../../../packages/ui/src/lib/utils/index.ts',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
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
});
