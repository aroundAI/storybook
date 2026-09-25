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
      all: false,
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
        '**/vite/**',
        '**/\x00*',
        'virtual:*',
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
      '@kit/shared/pagination': path.resolve(
        __dirname,
        '../../packages/shared/src/pagination/index.ts',
      ),
      '@kit/shared/vendors': path.resolve(
        __dirname,
        '../../packages/shared/src/vendors/index.ts',
      ),
      '@kit/shared/crypto': path.resolve(
        __dirname,
        '../../packages/shared/src/crypto/index.ts',
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
      '@kit/prompt-engine/llm-job-target': path.resolve(
        __dirname,
        '../../packages/features/prompt-engine/src/lib/server/llm-job-target.ts',
      ),
      '@kit/next/action-result': path.resolve(
        __dirname,
        '../../packages/next/src/refusals/action-result.ts',
      ),
      '@kit/next/refusals': path.resolve(
        __dirname,
        '../../packages/next/src/refusals/with-refusals.ts',
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
      '@kit/accounts/api': path.resolve(
        __dirname,
        '../../packages/features/accounts/src/server/api.ts',
      ),
      '@kit/team-accounts/api': path.resolve(
        __dirname,
        '../../packages/features/team-accounts/src/server/api.ts',
      ),
      '@kit/mailers': path.resolve(
        __dirname,
        '../../packages/mailers/core/src/index.ts',
      ),
      '@kit/episodes/lib/server/project-write-access': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/lib/server/project-write-access.ts',
      ),
      '@kit/episodes/lib/server/pdf-extractor': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/lib/server/pdf-extractor.ts',
      ),
      '@kit/episodes/agent/season-orchestrator': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/agent/season-orchestrator.ts',
      ),
      '@kit/episodes/agent/audio-cue-orchestrator': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/agent/audio-cue-orchestrator.ts',
      ),
      '@kit/episodes/lib': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/lib/index.ts',
      ),
      '@kit/film-studio-schemas/project': path.resolve(
        __dirname,
        '../../packages/features/film-studio-schemas/src/project.ts',
      ),
      '@kit/prompt-engine/server': path.resolve(
        __dirname,
        '../../packages/features/prompt-engine/src/lib/server/index.ts',
      ),
      '@kit/assets/upload-validation': path.resolve(
        __dirname,
        '../../packages/features/assets/src/lib/upload-validation.ts',
      ),
      '@kit/assets/upload': path.resolve(
        __dirname,
        '../../packages/features/assets/src/lib/upload/index.ts',
      ),
      '@kit/assets/lib': path.resolve(
        __dirname,
        '../../packages/features/assets/src/lib/index.ts',
      ),
      '@kit/storage/buckets': path.resolve(
        __dirname,
        '../../packages/features/storage/src/buckets.ts',
      ),
      '@kit/storage/client': path.resolve(
        __dirname,
        '../../packages/features/storage/src/client.ts',
      ),
      '@kit/storage/upload-paths': path.resolve(
        __dirname,
        '../../packages/features/storage/src/upload-paths.ts',
      ),
      '@kit/storage': path.resolve(
        __dirname,
        '../../packages/features/storage/src/index.ts',
      ),
      '@kit/ui/alert': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/alert.tsx',
      ),
      '@kit/ui/button': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/button.tsx',
      ),
      '@kit/ui/badge': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/badge.tsx',
      ),
      '@kit/ui/card': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/card.tsx',
      ),
      '@kit/ui/dropdown-menu': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/dropdown-menu.tsx',
      ),
      '@kit/ui/input': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/input.tsx',
      ),
      '@kit/ui/tabs': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/tabs.tsx',
      ),
      '@kit/ui/trans': path.resolve(
        __dirname,
        '../../packages/ui/src/makerkit/trans.tsx',
      ),
      '@kit/ui/utils': path.resolve(
        __dirname,
        '../../packages/ui/src/lib/utils/index.ts',
      ),
      '@kit/cms': path.resolve(
        __dirname,
        '../../packages/cms/core/src/index.ts',
      ),
      '@kit/i18n/server': path.resolve(
        __dirname,
        '../../packages/i18n/src/i18n.server.ts',
      ),
      '@kit/publishing/oauth/apps': path.resolve(
        __dirname,
        '../../packages/features/publishing/src/oauth/apps.ts',
      ),
      '@kit/publishing/lib/token-expiry': path.resolve(
        __dirname,
        '../../packages/features/publishing/src/lib/token-expiry.ts',
      ),
      '@kit': path.resolve(__dirname, '../../packages'),
      '~/lib/server/require-user-in-server-component': path.resolve(
        __dirname,
        './lib/server/require-user-in-server-component.ts',
      ),
      '~/lib': path.resolve(__dirname, './lib'),
      '~/config': path.resolve(__dirname, './config'),
      '~': path.resolve(__dirname, './app'),
      'server-only': path.resolve(__dirname, './__mocks__/server-only.ts'),
    },
  },
});
