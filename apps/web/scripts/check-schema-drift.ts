/**
 * Fails when the committed types describe a table no migration creates.
 *
 * This is the signature of the drift that reached production undetected in
 * #240: `manual_tasks`, `compilations` and `compilation_segments` existed
 * there, and in `database.types.ts` — because the types were regenerated
 * against a database that had them — while no migration on `main` created
 * any of the three. Every fresh database silently differed from production,
 * and nothing noticed for six weeks.
 *
 * It deliberately needs no production credentials. The types file is a
 * fingerprint of whichever database it was last generated against, so
 * comparing it to the migrations catches the same class of problem without
 * reaching outside the repo.
 *
 * The reverse direction — a migration whose table is missing from the types —
 * is not checked here: that just means the types are stale, which is
 * harmless and self-correcting on the next typegen.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dirname, '../supabase/migrations');
const TYPES_FILE = join(import.meta.dirname, '../lib/database.types.ts');

/** Tables the platform provides rather than our migrations. */
const NOT_OURS = new Set(['schema_migrations']);

function tablesInTypes(): string[] {
  const source = readFileSync(TYPES_FILE, 'utf8');

  // The `public` schema's Tables block, up to the next schema key.
  const start = source.indexOf('  public: {');
  const tablesAt = source.indexOf('Tables: {', start);
  const end = source.indexOf('\n    Views: {', tablesAt);

  if (start === -1 || tablesAt === -1 || end === -1) {
    throw new Error('Could not locate public.Tables in database.types.ts');
  }

  const block = source.slice(tablesAt, end);

  return [...block.matchAll(/^ {6}([a-z_][a-z0-9_]*): \{$/gm)]
    .map((m) => m[1]!)
    .filter((name) => !NOT_OURS.has(name));
}

function tablesInMigrations(): Set<string> {
  const created = new Set<string>();

  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('.sql'),
  )) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

    for (const m of sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi,
    )) {
      created.add(m[1]!.toLowerCase());
    }
  }

  return created;
}

const declared = tablesInTypes();
const created = tablesInMigrations();
const orphans = declared.filter((t) => !created.has(t));

if (orphans.length > 0) {
  console.error(
    `\nSchema drift: ${orphans.length} table(s) are declared in ` +
      `database.types.ts but created by no migration.\n`,
  );

  for (const table of orphans) {
    console.error(`  - ${table}`);
  }

  console.error(
    '\nThe types were generated against a database that has these and the ' +
      'migrations do not create them, so every fresh database differs from ' +
      'the one they came from.\n' +
      'Either add the migration, or regenerate the types against a database ' +
      'built only from migrations.\n',
  );

  process.exit(1);
}

console.log(
  `Schema drift check: ${declared.length} tables declared, all created by a migration.`,
);
