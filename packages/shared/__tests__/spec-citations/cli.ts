/**
 * KB-81. `pnpm specs:citations` lists spec citations that no longer point at
 * the code they name; `--fix` rewrites the ones that only moved. A moved
 * citation is a warning and does not fail the run; changed, gone or
 * past-the-end ones do (the merge queue, 2026-10-01).
 */
import { checkAll, describeCitation, fixMoved, triage } from './citations';

const fix = process.argv.includes('--fix');
const citations = checkAll();
const { warnings, failures } = triage(citations);

if (fix) {
  const fixed = fixMoved(warnings);
  console.log(`Rewrote ${fixed} moved citation(s).`);
} else {
  for (const c of warnings) console.log(`warning: ${describeCitation(c)}`);
}

for (const c of failures) console.log(describeCitation(c));
console.log(
  `${citations.length} citations checked; ${failures.length} need attention` +
    (fix
      ? '.'
      : `, ${warnings.length} moved (warnings; --fix re-points them).`),
);
process.exit(failures.length > 0 ? 1 : 0);
