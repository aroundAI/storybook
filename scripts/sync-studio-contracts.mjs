#!/usr/bin/env node
/**
 * Copies StoryBook's shared contracts into StorybookStudio (Phase 20).
 *
 * The contracts are defined once, in
 * `packages/features/desktop-integration/src/*.schema.ts` (FILM-2001's edit
 * package, FILM-2004's brand and edit policy, FILM-2003's report and QA
 * schemas when they land). The fork keeps byte-identical copies in
 * `storybookstudio/src/studio/contracts/`, and a drift test in each repo
 * fails when the two differ
 * (`desktop-integration/__tests__/studio-contracts.test.ts` here).
 *
 *   node scripts/sync-studio-contracts.mjs          # copy
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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_DIR = join(
  ROOT,
  'packages/features/desktop-integration/src',
);
export const SUBMODULE_DIR = join(ROOT, 'storybookstudio');
export const TARGET_DIR = join(SUBMODULE_DIR, 'src/studio/contracts');

/** The contract files, by name: every `*.schema.ts` in the source dir. */
export function contractFiles() {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.schema.ts'))
    .sort();
}

/** Whether the submodule is checked out (CI does not check it out). */
export function submoduleCheckedOut() {
  return (
    existsSync(SUBMODULE_DIR) && readdirSync(SUBMODULE_DIR).length > 0
  );
}

/** Each contract whose copy is missing or differs. */
export function driftedContracts() {
  return contractFiles().filter((name) => {
    const copy = join(TARGET_DIR, name);

    return (
      !existsSync(copy) ||
      readFileSync(copy, 'utf8') !== readFileSync(join(SOURCE_DIR, name), 'utf8')
    );
  });
}

function main() {
  if (!submoduleCheckedOut()) {
    console.error(
      'storybookstudio/ is empty: run `git submodule update --init storybookstudio` first.',
    );
    process.exit(2);
  }

  const drifted = driftedContracts();

  if (process.argv.includes('--check')) {
    if (drifted.length > 0) {
      console.error(`Out of date in ${TARGET_DIR}: ${drifted.join(', ')}`);
      process.exit(1);
    }
    console.log(`${contractFiles().length} contracts match.`);
    return;
  }

  mkdirSync(TARGET_DIR, { recursive: true });
  for (const name of drifted) {
    writeFileSync(
      join(TARGET_DIR, name),
      readFileSync(join(SOURCE_DIR, name), 'utf8'),
    );
  }
  console.log(
    drifted.length > 0
      ? `Copied ${drifted.join(', ')} to ${TARGET_DIR}.`
      : `${contractFiles().length} contracts already match.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
