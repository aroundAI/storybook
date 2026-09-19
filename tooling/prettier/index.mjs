/** @typedef  {import("prettier").Config} PrettierConfig */
import { fileURLToPath } from 'node:url';

/**
 * The stylesheet Tailwind v4 reads its class order from.
 *
 * Without it, prettier-plugin-tailwindcss decides the order from whichever
 * `tailwindcss` it happens to resolve from the directory Prettier runs in —
 * so the same file was left alone when formatted from its package and
 * re-sorted when formatted from the repo root. Absolute, from this file's
 * own location, so it resolves the same from anywhere.
 */
const tailwindStylesheet = fileURLToPath(
  new URL('../../apps/web/styles/globals.css', import.meta.url),
);

/** @type { PrettierConfig } */
const config = {
  tabWidth: 2,
  useTabs: false,
  semi: true,
  printWidth: 80,
  singleQuote: true,
  arrowParens: 'always',
  importOrder: [
    '/^(?!.*\\.css).*/',
    '^server-only$',
    '^react$',
    '^react-dom$',
    '^next$',
    '^next/(.*)$',
    '^@supabase/supabase-js$',
    '^@supabase/gotrue-js$',
    '<THIRD_PARTY_MODULES>',
    '^@kit/(.*)$', // package imports
    '^~/(.*)$', // app-specific imports
    '^[./]', // relative imports
  ],
  tailwindFunctions: ['tw', 'clsx', 'cn', 'cva'],
  tailwindStylesheet,
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
  plugins: [
    '@trivago/prettier-plugin-sort-imports',
    'prettier-plugin-tailwindcss',
  ],
};

export default config;
