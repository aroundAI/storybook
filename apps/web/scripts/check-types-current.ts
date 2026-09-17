/**
 * Fails when the committed types do not match a fresh generation — but only
 * for the `public` schema, which is the part this repo's migrations own.
 *
 * `CLAUDE.md` has told people to run typegen after a migration since this
 * repo began, and nothing checked. FILM-1608 then shipped a
 * `database.types.ts` that had been *hand-spliced* rather than generated,
 * because the documented command produced a worse file than CI's toolchain
 * (the CLI devDependency was 2.40.7 while CI pinned 2.117.0). Both halves of
 * that are fixed; this is what stops it recurring.
 *
 * ## Why only `public`
 *
 * A first version of this check diffed the whole generated file and failed on
 * its first CI run, on a single column:
 *
 *     +          versioning_status: string      (storage.buckets)
 *
 * CI sets `SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io`; a developer's machine
 * pulls the same services from `public.ecr.aws`. The two registries serve
 * different storage-api builds, so `storage.buckets` genuinely has a
 * different shape in the two places. Neither is wrong, and neither is
 * something a migration in this repo can change.
 *
 * Comparing the whole file therefore gates on the vendor's release schedule.
 * Comparing `public` gates on exactly what we control: if a migration added a
 * column and nobody regenerated, this fails; if Supabase shipped a new
 * storage column, it does not.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TYPES_FILE = join(import.meta.dirname, '../lib/database.types.ts');
const PACKAGE_TYPES_FILE = join(
  import.meta.dirname,
  '../../../packages/supabase/src/database.types.ts',
);

/**
 * The `public: { ... }` block, from its opening line to the next schema key
 * at the same indentation.
 *
 * Indentation-based rather than brace-counting because the generated file is
 * machine-formatted with a stable two-space-per-level shape, and a schema key
 * is the only thing that appears at exactly two spaces inside `Database`.
 */
function publicSchema(source: string, label: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === '  public: {');

  if (start === -1) {
    throw new Error(`Could not find the public schema block in ${label}`);
  }

  const end = lines.findIndex(
    (line, index) =>
      index > start && /^ {2}[a-z_]+: \{$/.test(line) && line !== '  public: {',
  );

  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

function generate(): string {
  return execFileSync('supabase', ['gen', 'types', 'typescript', '--local'], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 64e6,
  });
}

const committed = readFileSync(TYPES_FILE, 'utf8');
const packageCopy = readFileSync(PACKAGE_TYPES_FILE, 'utf8');

// The two copies are written by the same command and must never diverge; a
// mismatch here means someone edited one of them.
if (committed !== packageCopy) {
  console.error(
    'apps/web/lib/database.types.ts and packages/supabase/src/database.types.ts differ.\n' +
      "Run 'pnpm supabase:web:typegen', which writes both.",
  );
  process.exit(1);
}

const fresh = generate();
const committedPublic = publicSchema(committed, 'the committed types');
const freshPublic = publicSchema(fresh, 'the freshly generated types');

if (committedPublic === freshPublic) {
  const tables = (committedPublic.match(/^ {6}[a-z_]+: \{$/gm) ?? []).length;

  console.log(
    `Types check: the public schema matches a fresh generation (${tables} tables and functions).`,
  );

  process.exit(0);
}

const committedLines = new Set(committedPublic.split('\n'));
const freshLines = new Set(freshPublic.split('\n'));

const missing = [...freshLines].filter((line) => !committedLines.has(line));
const extra = [...committedLines].filter((line) => !freshLines.has(line));

console.error(
  "database.types.ts is stale or hand-edited. Run 'pnpm supabase:web:typegen' and commit the result.\n",
);

if (missing.length > 0) {
  console.error('In the database but not in the committed types:');
  for (const line of missing.slice(0, 20)) console.error(`  + ${line.trim()}`);
}

if (extra.length > 0) {
  console.error('\nIn the committed types but not in the database:');
  for (const line of extra.slice(0, 20)) console.error(`  - ${line.trim()}`);
}

process.exit(1);
