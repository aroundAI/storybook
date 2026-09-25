import eslintConfigApps from '@kit/eslint-config/apps.js';
import eslintConfigBase from '@kit/eslint-config/base.js';

export default [
  ...eslintConfigBase,
  ...eslintConfigApps,
  {
    // KB-66: an untyped client is valid TypeScript (its schema is `any`), so
    // tsc cannot refuse one; this does. Typed, a query that names a table,
    // RPC or selected column the database lacks fails `pnpm typecheck`.
    files: ['lambda/**/*.ts', 'websocket/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TSTypeReference[typeName.name='SupabaseClient']:not([typeArguments])",
          message: 'Type the client: SupabaseClient<Database> (KB-66).',
        },
        {
          selector:
            "CallExpression[callee.name='createClient']:not([typeArguments])",
          message: 'Type the client: createClient<Database>(…) (KB-66).',
        },
      ],
    },
  },
];
