import baseConfig from '@kit/eslint-config/base.js';

/**
 * FILM-1912: past performance reaches a brief only through the reader the
 * caller puts on `ctx.performance`, built from `@kit/content-analytics`'s
 * services on the caller's client. ClickHouse has no row-level security,
 * and those services are `server-only`, which the LLM worker bundling this
 * package cannot load. `__tests__/import-boundary.test.ts` scans for the
 * same rule.
 *
 * The base rule's `paths` entry is repeated: a flat-config override replaces
 * the rule's options rather than merging them.
 */
export default [
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-i18next',
              importNames: ['Trans'],
              message: 'Please use `@kit/ui/trans` instead',
            },
          ],
          patterns: [
            {
              group: [
                '@kit/clickhouse',
                '@kit/clickhouse/*',
                '@kit/content-analytics',
                '@kit/content-analytics/*',
              ],
              message:
                '@kit/generation reads analytics only through ctx.performance (FILM-1912): ClickHouse has no RLS, and the analytics services are server-only.',
            },
          ],
        },
      ],
    },
  },
];
