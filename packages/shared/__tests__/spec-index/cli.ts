/**
 * `pnpm specs:index` lists every way `specs/INDEX.md` disagrees with the spec
 * files; `--write` rewrites its counts (the Progress Tracker, By scope and the
 * `(N specs)` headings) and then lists what is left, which needs a person.
 * `--specs <dir>` checks another tree, e.g. an old commit's `git archive`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SPECS_DIR, analyse, checkIndex, repoSources } from './tracker';

const args = process.argv.slice(2);
const write = args.includes('--write');
const at = args.indexOf('--specs');
const specsDir = at === -1 ? SPECS_DIR : resolve(args[at + 1] ?? '');
const indexFile = join(specsDir, 'INDEX.md');
const sources = repoSources(specsDir);

let markdown = readFileSync(indexFile, 'utf8');
if (write) {
  const { rendered } = analyse(markdown, sources);
  if (rendered !== markdown) {
    writeFileSync(indexFile, rendered);
    console.log(`Rewrote the counts in ${indexFile}.`);
  }
  markdown = rendered;
}

const problems = checkIndex(markdown, sources);
for (const problem of problems) console.log(problem);
console.log(
  problems.length === 0
    ? 'specs/INDEX.md agrees with the spec files.'
    : `${problems.filter((p) => !p.startsWith('Run `')).length} problem(s).`,
);
process.exit(problems.length > 0 ? 1 : 0);
