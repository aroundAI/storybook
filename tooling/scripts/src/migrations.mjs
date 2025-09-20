import { execSync } from 'node:child_process';

export function checkPendingMigrations() {
  try {
    console.info('\x1b[34m%s\x1b[0m', 'Checking for pending migrations...');

    const output = execSync('pnpm --filter web supabase migration list', {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    const lines = output.split('\n');

    // Skip header lines
    const migrationLines = lines.slice(4);

    const pendingMigrations = migrationLines
      .filter((line) => {
        const [local, remote] = line.split('│').map((s) => s.trim());
        return local !== '' && remote === '';
      })
      .map((line) => (line.split('│')[0] ?? '').trim());

    if (pendingMigrations.length > 0) {
      console.log(
        '\x1b[33m%s\x1b[0m',
        '⚠️  There are pending migrations that need to be applied:',
      );

      pendingMigrations.forEach((migration) => console.log(`  - ${migration}`));

      console.log(
        '\nSome functionality may not work as expected until these migrations are applied.',
      );

      console.log(
        '\nAfter testing the migrations in your local environment and ideally in a staging environment, please run "pnpm --filter web supabase db push" to apply them to your database. If you have any questions, please open a support ticket.',
      );
    } else {
      console.log('\x1b[32m%s\x1b[0m', '✅ All migrations are up to date.');
    }
  } catch (error) {
    console.log(
      '\x1b[33m%s\x1b[0m',
      "💡 Info: Project not yet linked to a remote Supabase project. Migration checks skipped - this is expected for new projects. Link your project when you're ready to sync with Supabase.\n",
    );
  }
}
