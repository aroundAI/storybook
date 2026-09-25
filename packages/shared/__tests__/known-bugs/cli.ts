/**
 * `pnpm specs:known-bugs` prints the register's Open and Fixed tables from the
 * front matter of `specs/known-bugs/KB-<n>.md`. Read-only: nothing is written,
 * so there is no shared table for PRs to conflict on.
 *
 *   --open   only the Open table (partial KBs included, marked)
 *   --fixed  only the Fixed table
 *   --ids    one line per status with its ids, for scripts and diffs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  KNOWN_BUGS_DIR,
  type KnownBug,
  fixedTable,
  kbNumber,
  loadKnownBugs,
} from './register';

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const bugs = loadKnownBugs();
const flag = (name: string) => process.argv.includes(name);
const cell = (text: string) => text.replace(/\|/g, '\\|');

function printOpen(list: KnownBug[]) {
  const open = list.filter((bug) => bug.status !== 'fixed');
  console.log(`## Open (${open.length})\n`);
  console.log('| ID | Severity | Bug | Found |');
  console.log('|---|---|---|---|');
  for (const bug of open) {
    const id = bug.status === 'partial' ? `${bug.id} (part fixed)` : bug.id;
    console.log(
      `| ${id} | ${bug.severity} | ${cell(bug.title)} | ${bug.found} |`,
    );
  }
}

function printFixed(list: KnownBug[]) {
  const rows = fixedTable(list).sort(
    (a, b) =>
      kbNumber(a.ids[0]!.replace(/ .*/, '')) -
      kbNumber(b.ids[0]!.replace(/ .*/, '')),
  );
  const fixed = list.filter((bug) => bug.status === 'fixed').length;
  console.log(`## Fixed (${fixed}, plus partial fixes)\n`);
  console.log('| ID | Bug | Fixed in |');
  console.log('|---|---|---|');
  for (const row of rows) {
    console.log(
      `| ${row.ids.join(', ')} | ${cell(row.summary)} | ${row.fixedIn} |`,
    );
  }
  const preNumbering = readFileSync(
    join(KNOWN_BUGS_DIR, '_pre-numbering.md'),
    'utf8',
  )
    .split('\n')
    .filter((line) => line.startsWith('| — '));
  for (const line of preNumbering) console.log(line);
}

if (flag('--ids')) {
  for (const status of ['open', 'partial', 'fixed'] as const) {
    const ids = bugs.filter((b) => b.status === status).map((b) => b.id);
    console.log(`${status} (${ids.length}): ${ids.join(' ')}`);
  }
} else {
  const both = !flag('--open') && !flag('--fixed');
  if (both || flag('--open')) printOpen(bugs);
  if (both) console.log('');
  if (both || flag('--fixed')) printFixed(bugs);
}
