#!/usr/bin/env node
/**
 * Copies StoryBook's shared contracts into StorybookStudio (Phase 20).
 *
 * The contracts are defined once, in
 * `packages/features/desktop-integration/src/*.schema.ts` (FILM-2001's edit
 * package, FILM-2004's brand and edit policy, FILM-2003's report, QA and
 * delivery schemas), plus every module those import by relative path,
 * followed transitively (FILM-2003's `render-presets.ts`), so the copies
 * always resolve. The fork is plain JavaScript (Electron + Vite),
 * so each is transpiled to `<name>.schema.mjs` with its types stripped and
 * its comments kept, relative imports pointing at the sibling `.mjs` files,
 * and written to `storybookstudio/src/studio/contracts/`. The fork needs
 * `zod` 3 as a dependency to load them.
 *
 * A drift test in each repo fails when a copy differs from what this script
 * would write (`desktop-integration/__tests__/studio-contracts.test.ts` here).
 *
 *   node scripts/sync-studio-contracts.mjs          # write the copies
 *   node scripts/sync-studio-contracts.mjs --check  # exit 1 if any differ
 *
 * It writes into the submodule's working tree only. Committing there is
 * the fork's business: a Studio task commits the copies in
 * aroundAI/storybookstudio and StoryBook bumps the pin.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_DIR = join(
  ROOT,
  'packages/features/desktop-integration/src',
);
export const SUBMODULE_DIR = join(ROOT, 'storybookstudio');
export const TARGET_DIR = join(SUBMODULE_DIR, 'src/studio/contracts');

/** The relative imports of one source, as file names in the same dir. */
function relativeImports(sourceDir, name) {
  const text = readFileSync(join(sourceDir, name), 'utf8');

  return [...text.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)].map(
    (match) => `${match[1].replace(/\.(?:m?js|ts)$/, '')}.ts`,
  );
}

/**
 * The contract sources, by file name: every `*.schema.ts`, and every module
 * they import by relative path, transitively. An import naming a file that
 * is not there is left out (it would fail the source's own typecheck).
 */
export function contractFiles(sourceDir = SOURCE_DIR) {
  const found = new Set(
    readdirSync(sourceDir).filter((name) => name.endsWith('.schema.ts')),
  );
  const queue = [...found];

  while (queue.length > 0) {
    for (const name of relativeImports(sourceDir, queue.shift())) {
      if (!found.has(name) && existsSync(join(sourceDir, name))) {
        found.add(name);
        queue.push(name);
      }
    }
  }

  return [...found].sort();
}

/** `brand.schema.ts` → `brand.schema.mjs` */
export function copyName(source) {
  return source.replace(/\.ts$/, '.mjs');
}

/** The JavaScript the fork keeps for one contract source. */
export function renderContract(source, sourceDir = SOURCE_DIR) {
  const input = readFileSync(join(sourceDir, source), 'utf8');
  const { outputText } = ts.transpileModule(input, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      removeComments: false,
      verbatimModuleSyntax: false,
    },
    fileName: source,
  });

  const body = outputText.replace(
    /(from\s+['"])(\.\/[^'"]+?)(['"])/g,
    (_match, open, spec, close) =>
      `${open}${spec.replace(/\.(?:m?js|ts)$/, '')}.mjs${close}`,
  );

  return `// GENERATED from aroundAI/storybook packages/features/desktop-integration/src/${source}
// by scripts/sync-studio-contracts.mjs. Do not edit: change the source in
// StoryBook and run the script again. Needs zod 3.
${body}`;
}

/** Whether the submodule is checked out (CI does not check it out). */
export function submoduleCheckedOut() {
  return existsSync(SUBMODULE_DIR) && readdirSync(SUBMODULE_DIR).length > 0;
}

/** Each contract whose copy is missing or differs from what would be written. */
export function driftedContracts(
  targetDir = TARGET_DIR,
  sourceDir = SOURCE_DIR,
) {
  return contractFiles(sourceDir).filter((source) => {
    const copy = join(targetDir, copyName(source));

    return (
      !existsSync(copy) ||
      readFileSync(copy, 'utf8') !== renderContract(source, sourceDir)
    );
  });
}

/** Writes every drifted copy into `targetDir`; returns their source names. */
export function writeContracts(targetDir = TARGET_DIR, sourceDir = SOURCE_DIR) {
  const drifted = driftedContracts(targetDir, sourceDir);

  mkdirSync(targetDir, { recursive: true });
  for (const source of drifted) {
    writeFileSync(
      join(targetDir, copyName(source)),
      renderContract(source, sourceDir),
    );
  }

  return drifted;
}

function main() {
  if (!submoduleCheckedOut()) {
    console.error(
      'storybookstudio/ is empty: run `git submodule update --init storybookstudio` first.',
    );
    process.exit(2);
  }

  if (process.argv.includes('--check')) {
    const drifted = driftedContracts();

    if (drifted.length > 0) {
      console.error(
        `Out of date in ${TARGET_DIR}: ${drifted.map(copyName).join(', ')}`,
      );
      process.exit(1);
    }
    console.log(`${contractFiles().length} contracts match.`);
    return;
  }

  const written = writeContracts();
  console.log(
    written.length > 0
      ? `Wrote ${written.map(copyName).join(', ')} to ${TARGET_DIR}.`
      : `${contractFiles().length} contracts already match.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
