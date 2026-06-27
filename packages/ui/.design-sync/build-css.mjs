import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '.cache');
const pkgRoot = '/Users/xuryax/Work/code/storybook/node_modules/.pnpm/@tailwindcss+postcss@4.1.13/node_modules';

const postcss = (await import(resolve(pkgRoot, 'postcss/lib/postcss.mjs'))).default;
const tailwindcss = (await import(resolve(pkgRoot, '@tailwindcss/postcss/dist/index.mjs'))).default;

const inputPath = resolve(here, 'tw-input.css');
const css = readFileSync(inputPath, 'utf8');
const outputPath = join(outDir, 'compiled-theme.css');

const result = await postcss([tailwindcss({ base: here })]).process(css, {
  from: inputPath,
  to: outputPath,
});

mkdirSync(outDir, { recursive: true });
writeFileSync(outputPath, result.css);
console.log(`wrote ${result.css.length} bytes to ${outputPath}`);
