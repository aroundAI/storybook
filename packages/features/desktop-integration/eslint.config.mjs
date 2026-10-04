import baseConfig from '@kit/eslint-config/base.js';

/**
 * FILM-1906: ClickHouse has no row-level security, so an MCP tool must read
 * analytics only through `@kit/content-analytics`'s services, which prove
 * the scope on the principal's RLS-scoped client first. Any import of
 * `@kit/clickhouse` (root or subpath) from this package fails lint.
 * `__tests__/boundaries.test.ts` scans the sources for the same rule, so the
 * check also runs where lint is scoped out.
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
              group: ['@kit/clickhouse', '@kit/clickhouse/*'],
              message:
                'MCP tools never query ClickHouse directly (no RLS there). Call a @kit/content-analytics service, which checks the scope on the principal client first (FILM-1906).',
            },
          ],
        },
      ],
    },
  },
];
