/**
 * Vitest configuration for audio-generation package
 *
 * Note: This package uses happy-dom environment and React plugin because it
 * contains React components (AudioPlayer, Waveform) that require DOM testing.
 * This differs from other feature packages that use 'node' environment for
 * server-side business logic testing only.
 *
 * The @kit/ui path aliases are required to resolve UI component imports
 * during component testing.
 */
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // React plugin required for JSX transformation in component tests
  plugins: [react()],
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, 'src/__mocks__/server-only.ts'),
      // UI component mock aliases for component testing
      // These use mock implementations instead of real shadcn components
      // to avoid complex dependency chains (class-variance-authority, tailwind-merge, etc.)
      '@kit/ui/badge': path.resolve(__dirname, 'src/__mocks__/@kit/ui/badge.tsx'),
      '@kit/ui/button': path.resolve(__dirname, 'src/__mocks__/@kit/ui/button.tsx'),
      '@kit/ui/checkbox': path.resolve(__dirname, 'src/__mocks__/@kit/ui/checkbox.tsx'),
      '@kit/ui/input': path.resolve(__dirname, 'src/__mocks__/@kit/ui/input.tsx'),
      '@kit/ui/select': path.resolve(__dirname, 'src/__mocks__/@kit/ui/select.tsx'),
      '@kit/ui/sonner': path.resolve(__dirname, 'src/__mocks__/@kit/ui/sonner.ts'),
      '@kit/ui/utils': path.resolve(__dirname, 'src/__mocks__/@kit/ui/utils.ts'),
      // Keep original aliases for slider and spinner (used by AudioPlayer tests)
      '@kit/ui/slider': path.resolve(
        __dirname,
        '../../../packages/ui/src/shadcn/slider.tsx',
      ),
      '@kit/ui/spinner': path.resolve(
        __dirname,
        '../../../packages/ui/src/makerkit/spinner.tsx',
      ),
    },
  },
  test: {
    globals: true,
    // happy-dom required for React component testing (vs 'node' for server-side only)
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Components are included in coverage since they have tests
      exclude: [
        'node_modules/',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.config.ts',
      ],
    },
  },
});
