import { restrictedImports } from './model-boundary.js';

export default [
  {
    files: ['app/**/*.{ts,tsx}'],
    rules: {
      // Overrides base.js for app/**, so it restates the model-import
      // boundary (FILM-1902) alongside the app's own rule
      'no-restricted-imports': restrictedImports([
        {
          name: '@kit/supabase/database',
          importNames: ['Database'],
          message:
            'Please use the application types from your app "~/lib/database.types" instead',
        },
      ]),
    },
  },
];
