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
      // Workspace packages that leave React to their consumer (@kit/ui,
      // @kit/email-templates) cannot resolve `react/jsx-dev-runtime` from
      // their own directory. This app is the consumer: point them at its
      // React, so a test renders them as the app does.
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
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
      '@kit/shared/rows': path.resolve(
        __dirname,
        '../../packages/shared/src/rows/index.ts',
      ),
      '@kit/shared/prompt-sanitiser': path.resolve(
        __dirname,
        '../../packages/shared/src/prompt-sanitiser/index.ts',
      ),
      '@kit/shared/duration-scaling': path.resolve(
        __dirname,
        '../../packages/shared/src/duration-scaling/index.ts',
      ),
      // The gateway (FILM-1902) and what it imports from prompt-engine
      '@kit/ai-gateway/lambda-prompts': path.resolve(
        __dirname,
        '../../packages/ai-gateway/src/prompts/lambda-registry.ts',
      ),
      '@kit/ai-gateway': path.resolve(
        __dirname,
        '../../packages/ai-gateway/src/index.ts',
      ),
      '@kit/prompt-engine/normalize-llm-output': path.resolve(
        __dirname,
        '../../packages/features/prompt-engine/src/lib/normalize-llm-output.ts',
      ),
      '@kit/prompt-engine/types': path.resolve(
        __dirname,
        '../../packages/features/prompt-engine/src/lib/types.ts',
      ),
      '@kit/prompt-engine/prompt-registry': path.resolve(
        __dirname,
        '../../packages/features/prompt-engine/src/lib/server/prompt-registry.ts',
      ),
      '@kit/agent': path.resolve(
        __dirname,
        '../../packages/agent/src/index.ts',
      ),
      '@kit/llm': path.resolve(__dirname, '../../packages/llm/src/index.ts'),
      '@kit/generation/testing': path.resolve(
        __dirname,
        '../../packages/features/generation/src/testing/index.ts',
      ),
      '@kit/generation/canon': path.resolve(
        __dirname,
        '../../packages/features/generation/src/canon/index.ts',
      ),
      '@kit/generation/episode-rows': path.resolve(
        __dirname,
        '../../packages/features/generation/src/episode-rows.ts',
      ),
      '@kit/generation/formatters': path.resolve(
        __dirname,
        '../../packages/features/generation/src/formatters.ts',
      ),
      '@kit/generation/project-type': path.resolve(
        __dirname,
        '../../packages/features/generation/src/project-type.ts',
      ),
      '@kit/generation/slug': path.resolve(
        __dirname,
        '../../packages/features/generation/src/slug.ts',
      ),
      '@kit/generation': path.resolve(
        __dirname,
        '../../packages/features/generation/src/index.ts',
      ),
      '@kit/prompt-engine/prompts': path.resolve(
        __dirname,
        '../../packages/features/prompt-engine/src/prompts',
      ),
      '@kit/prompt-engine/schemas': path.resolve(
        __dirname,
        '../../packages/features/prompt-engine/src/schemas/index.ts',
      ),
      '@kit/ui/navigation-schema': path.resolve(
        __dirname,
        '../../packages/ui/src/makerkit/navigation-config.schema.ts',
      ),
      '@kit/supabase/server-client': path.resolve(
        __dirname,
        '../../packages/supabase/src/clients/server-client.ts',
      ),
      // The LLM worker's usage logging (FILM-1902) builds its client here
      '@kit/supabase/lambda-admin-client': path.resolve(
        __dirname,
        '../../packages/supabase/src/clients/lambda-admin-client.ts',
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
      '@kit/prompt-engine/schemas': path.resolve(
        __dirname,
        '../../packages/features/prompt-engine/src/schemas/index.ts',
      ),
      '@kit/prompt-engine/render-template': path.resolve(
        __dirname,
        '../../packages/features/prompt-engine/src/lib/render-template.ts',
      ),
      '@kit/prompt-engine/llm-job-target': path.resolve(
        __dirname,
        '../../packages/features/prompt-engine/src/lib/server/llm-job-target.ts',
      ),
      '@kit/prompt-engine/llm-job-payloads': path.resolve(
        __dirname,
        '../../packages/features/prompt-engine/src/lib/llm-job-payloads.ts',
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
      '@kit/supabase/hooks/use-supabase': path.resolve(
        __dirname,
        '../../packages/supabase/src/hooks/use-supabase.ts',
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
      '@kit/episodes/schemas/shot-list': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/lib/schemas/shot-list.schema.ts',
      ),
      '@kit/episodes/lib/server/project-write-access': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/lib/server/project-write-access.ts',
      ),
      '@kit/episodes/lib/server/pdf-extractor': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/lib/server/pdf-extractor.ts',
      ),
      '@kit/episodes/agent/shot-orchestrator': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/agent/shot-orchestrator.ts',
      ),
      '@kit/episodes/agent/season-orchestrator': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/agent/season-orchestrator.ts',
      ),
      '@kit/episodes/agent/audio-cue-orchestrator': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/agent/audio-cue-orchestrator.ts',
      ),
      '@kit/episodes/agent/ideation-orchestrator': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/agent/ideation-orchestrator.ts',
      ),
      '@kit/episodes/agent/story-orchestrator': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/agent/story-orchestrator.ts',
      ),
      '@kit/episodes/agent/screenplay-orchestrator': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/agent/screenplay-orchestrator.ts',
      ),
      '@kit/episodes/agent/shot-orchestrator': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/agent/shot-orchestrator.ts',
      ),
      '@kit/episodes/agent/audio-cue-orchestrator': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/agent/audio-cue-orchestrator.ts',
      ),
      '@kit/episodes/agent/translation-orchestrator': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/agent/translation-orchestrator.ts',
      ),
      '@kit/episodes/lib/canon/memory-context-builder': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/lib/canon/memory-context-builder.ts',
      ),
      '@kit/episodes/lib/canon/memory-rows': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/lib/canon/memory-rows.ts',
      ),
      '@kit/episodes/lib/canon/store-episode-memory': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/lib/canon/store-episode-memory.ts',
      ),
      '@kit/episodes/lib/canon/continuity-validator': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/lib/canon/continuity-validator.ts',
      ),
      '@kit/episodes/lib/canon/validation-checkpoint': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/lib/canon/validation-checkpoint.ts',
      ),
      '@kit/episodes/agent/stage-writers': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/agent/stage-writers/index.ts',
      ),
      '@kit/episodes/components/origin-badge': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/components/origin-badge.tsx',
      ),
      '@kit/episodes/server': path.resolve(
        __dirname,
        '../../packages/features/episodes/src/server/index.ts',
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
      // The scheduled-reports cron's imports (KB-74's route test mocks them)
      '@kit/content-analytics/lib/csv-generator': path.resolve(
        __dirname,
        '../../packages/features/content-analytics/src/lib/csv-generator.ts',
      ),
      '@kit/content-analytics/lib/report-summary': path.resolve(
        __dirname,
        '../../packages/features/content-analytics/src/lib/report-summary.ts',
      ),
      '@kit/content-analytics/lib/pdf-generator': path.resolve(
        __dirname,
        '../../packages/features/content-analytics/src/lib/pdf-generator.tsx',
      ),
      '@kit/content-analytics/server/report-storage': path.resolve(
        __dirname,
        '../../packages/features/content-analytics/src/server/report-storage.ts',
      ),
      // FILM-2001: the edit package's retention read. Must sit above
      // '@kit/content-analytics/server', which would otherwise rewrite it as
      // a path under server/index.ts.
      '@kit/content-analytics/server/diagnostics-service': path.resolve(
        __dirname,
        '../../packages/features/content-analytics/src/server/diagnostics-service.ts',
      ),
      '@kit/content-analytics/lib/raw-export-generator': path.resolve(
        __dirname,
        '../../packages/features/content-analytics/src/lib/raw-export-generator.ts',
      ),
      '@kit/content-analytics/lib/video-log-cells': path.resolve(
        __dirname,
        '../../packages/features/content-analytics/src/lib/video-log-cells.ts',
      ),
      '@kit/content-analytics/server': path.resolve(
        __dirname,
        '../../packages/features/content-analytics/src/server/index.ts',
      ),
      '@kit/clickhouse/server': path.resolve(
        __dirname,
        '../../packages/clickhouse/src/server/index.ts',
      ),
      '@kit/clickhouse': path.resolve(
        __dirname,
        '../../packages/clickhouse/src/index.ts',
      ),
      // The workers' SDK copy, as lambda/tsconfig.json's `paths` reads it:
      // SST installs it into the bundle, so apps/web does not depend on it
      '@aws-sdk/client-s3': path.resolve(
        __dirname,
        '../../packages/features/storage/node_modules/@aws-sdk/client-s3',
      ),
      '@kit/audio-generation/dub-episode': path.resolve(
        __dirname,
        '../../packages/features/audio-generation/src/lib/dub-episode.ts',
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
      '@kit/ui/alert-dialog': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/alert-dialog.tsx',
      ),
      '@kit/ui/sonner': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/sonner.tsx',
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
      '@kit/ui/sheet': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/sheet.tsx',
      ),
      '@kit/ui/tabs': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/tabs.tsx',
      ),
      '@kit/ui/page': path.resolve(
        __dirname,
        '../../packages/ui/src/makerkit/page.tsx',
      ),
      '@kit/ui/textarea': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/textarea.tsx',
      ),
      '@kit/ui/tooltip': path.resolve(
        __dirname,
        '../../packages/ui/src/shadcn/tooltip.tsx',
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
      '@kit/publishing/lib/takedown': path.resolve(
        __dirname,
        '../../packages/features/publishing/src/lib/takedown.ts',
      ),
      '@kit/publishing/oauth/analytics-scopes': path.resolve(
        __dirname,
        '../../packages/features/publishing/src/oauth/analytics-scopes.ts',
      ),
      '@kit/publishing/oauth/meta': path.resolve(
        __dirname,
        '../../packages/features/publishing/src/oauth/meta/index.ts',
      ),
      '@kit/publishing/providers/facebook': path.resolve(
        __dirname,
        '../../packages/features/publishing/src/providers/facebook/index.ts',
      ),
      '@kit/publishing/providers/instagram': path.resolve(
        __dirname,
        '../../packages/features/publishing/src/providers/instagram/index.ts',
      ),
      '@kit/publishing/lib/youtube-declaration': path.resolve(
        __dirname,
        '../../packages/features/publishing/src/lib/youtube-declaration.ts',
      ),
      '@kit/publishing/oauth/tiktok': path.resolve(
        __dirname,
        '../../packages/features/publishing/src/oauth/tiktok/index.ts',
      ),
      '@kit/publishing/oauth/twitter': path.resolve(
        __dirname,
        '../../packages/features/publishing/src/oauth/twitter/index.ts',
      ),
      // The publish worker imports these by their package paths (FILM-717's
      // worker test drives its handler).
      '@kit/publishing/lib': path.resolve(
        __dirname,
        '../../packages/features/publishing/src/lib',
      ),
      '@kit/publishing/server/oauth-app-credentials': path.resolve(
        __dirname,
        '../../packages/features/publishing/src/server/oauth-app-credentials.ts',
      ),
      '@kit/audit-logs/server': path.resolve(
        __dirname,
        '../../packages/audit-logs/src/server/index.ts',
      ),
      '@kit/desktop-integration/server': path.resolve(
        __dirname,
        '../../packages/features/desktop-integration/src/server/index.ts',
      ),
      '@kit/desktop-integration': path.resolve(
        __dirname,
        '../../packages/features/desktop-integration/src/index.ts',
      ),
      '@kit': path.resolve(__dirname, '../../packages'),
      '~/lib/server/require-user-in-server-component': path.resolve(
        __dirname,
        './lib/server/require-user-in-server-component.ts',
      ),
      '~/lib': path.resolve(__dirname, './lib'),
      '~/config': path.resolve(__dirname, './config'),
      '~/components': path.resolve(__dirname, './components'),
      '~': path.resolve(__dirname, './app'),
      'server-only': path.resolve(__dirname, './__mocks__/server-only.ts'),
    },
  },
});
