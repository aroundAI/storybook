import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Each subscriber rule is written once, in `@kit/clickhouse`'s
 * `lib/subscriber-vocabulary.ts` (FILM-1617).
 *
 * Round eight's bug was a fourth copy of "which sources are measured" that a
 * redefinition updated three copies of and missed. This fails the build on a
 * new copy anywhere the surfaces live, and says which shared function to use.
 */

const REPO = resolve(__dirname, '../../../..');

const ROOTS = [
  'packages/features/content-analytics/src',
  'packages/features/publishing/src',
  'apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/publish',
];

const RULES: Array<{ pattern: RegExp; use: string }> = [
  {
    // Deciding measured vs reconstructed from a source literal.
    pattern: /['"](interpolated|constrained)['"]/,
    use: 'isMeasuredSource() from @kit/clickhouse',
  },
  {
    // A local ranking of sources, as the SOURCE_RANK that went wrong.
    pattern: /Record<\s*SubscriberSource\s*,\s*number\s*>/,
    use: 'weakestSource() from @kit/clickhouse',
  },
  {
    // The rounding error bound, derived by hand.
    pattern: /roundingStep(\s*\?\?\s*0\s*\))?\s*-\s*1\b/,
    use: 'roundingErrorOf() from @kit/clickhouse',
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      return entry === '__tests__' || entry === 'node_modules'
        ? []
        : sourceFiles(path);
    }

    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)
      ? [path]
      : [];
  });
}

describe('subscriber rules are defined once', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(join(REPO, root)));

  it('finds the files it guards', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(RULES.map((rule) => [rule.use, rule] as const))(
    'no local copy — use %s',
    (_use, rule) => {
      const copies = files.flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ line, index }))
          // Prose may name a source; only code copies the rule.
          .filter(
            ({ line }) =>
              rule.pattern.test(line) && !/^\s*(\*|\/\/)/.test(line),
          )
          .map(
            ({ line, index }) =>
              `${relative(REPO, file)}:${index + 1}  ${line.trim()}`,
          ),
      );

      expect(copies, `Use ${rule.use} instead of:`).toEqual([]);
    },
  );
});
