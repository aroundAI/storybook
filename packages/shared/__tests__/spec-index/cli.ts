/**
 * `pnpm specs:index` lists every way `specs/INDEX.md`'s rows disagree with
 * the spec files, then prints the totals by phase and by scope. INDEX.md
 * stores no count; `--write` removes one that crept back (a `(N specs)`
 * heading, a Progress Tracker or By scope table) and changes nothing else.
 * `--specs <dir>` checks another tree, e.g. an old commit's `git archive`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  SPECS_DIR,
  analyse,
  checkIndex,
  formatTotals,
  repoSources,
  withoutCounts,
} from './tracker';

const args = process.argv.slice(2);
const write = args.includes('--write');
const at = args.indexOf('--specs');
const specsDir = at === -1 ? SPECS_DIR : resolve(args[at + 1] ?? '');
const indexFile = join(specsDir, 'INDEX.md');
const sources = repoSources(specsDir);

let markdown = readFileSync(indexFile, 'utf8');
if (write) {
  const rows = withoutCounts(markdown);
  if (rows !== markdown) {
    writeFileSync(indexFile, rows);
    console.log(`Removed the stored counts from ${indexFile}.`);
  }
  markdown = rows;
}

console.log(formatTotals(analyse(markdown, sources).totals));
console.log('');

const problems = checkIndex(markdown, sources);
for (const problem of problems) console.log(problem);
console.log(
  problems.length === 0
    ? 'specs/INDEX.md agrees with the spec files.'
    : `${problems.filter((p) => !p.startsWith('Run `')).length} problem(s).`,
);
process.exit(problems.length > 0 ? 1 : 0);
