/**
 * KB-81. `pnpm specs:citations` lists spec citations that no longer point at
 * the code they name; `--fix` rewrites the ones that only moved.
 */
import { checkAll, describeCitation, fixMoved } from './citations';

const fix = process.argv.includes('--fix');
const citations = checkAll();
const drifted = citations.filter((c) => c.verdict.kind !== 'ok');

if (fix) {
  const fixed = fixMoved(drifted);
  console.log(`Rewrote ${fixed} moved citation(s).`);
}

const left = drifted.filter((c) => !fix || c.verdict.kind !== 'moved');
for (const c of left) console.log(describeCitation(c));
console.log(
  `${citations.length} citations checked; ${left.length} need attention.`,
);
process.exit(left.length > 0 ? 1 : 0);
