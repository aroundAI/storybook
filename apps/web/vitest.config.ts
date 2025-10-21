import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        // Inline AWS SDK packages to avoid import resolution issues
        inline: [
          '@aws-sdk/client-sesv2',
          '@aws-sdk/client-cloudwatch',
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-apigatewaymanagementapi',
          '@aws-sdk/client-ssm',
        ],
      },
    },
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
      '@kit/billing': path.resolve(
        __dirname,
        '../../packages/billing/core/src/index.ts',
      ),
      '@kit/billing-gateway': path.resolve(
        __dirname,
        '../../packages/billing/gateway/src/index.ts',
      ),
      '@kit/next/routes': path.resolve(
        __dirname,
        '../../packages/next/src/routes/index.ts',
      ),
      '@kit/supabase/server-admin-client': path.resolve(
        __dirname,
        '../../packages/supabase/src/clients/server-admin-client.ts',
      ),
      '@kit/database-webhooks': path.resolve(
        __dirname,
        '../../packages/database-webhooks/src/index.ts',
      ),
      '@kit/monitoring/server': path.resolve(
        __dirname,
        '../../packages/monitoring/api/src/server.ts',
      ),
      '@kit/supabase/auth': path.resolve(
        __dirname,
        '../../packages/supabase/src/auth-callback.service.ts',
      ),
      '@kit/next/actions': path.resolve(
        __dirname,
        '../../packages/next/src/actions/index.ts',
      ),
      '@kit/auth/captcha/server': path.resolve(
        __dirname,
        '../../packages/features/auth/src/captcha/server/index.ts',
      ),
      '@kit/supabase/require-user': path.resolve(
        __dirname,
        '../../packages/supabase/src/require-user.ts',
      ),
      '@kit': path.resolve(__dirname, '../../packages'),
      '~/config': path.resolve(__dirname, './config'),
      '~': path.resolve(__dirname, './app'),
      'server-only': path.resolve(__dirname, './__mocks__/server-only.ts'),
    },
  },
});
