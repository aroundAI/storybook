import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 20: the shared contracts are defined here and copied verbatim into
 * StorybookStudio by `scripts/sync-studio-contracts.mjs`. This fails when a
 * copy in `storybookstudio/src/studio/contracts/` is missing or differs.
 *
 * CI does not check the submodule out, so with an empty `storybookstudio/`
 * the comparison is skipped (and says so); the copies are still checked by
 * the fork's own drift test. Locally:
 *
 *   git submodule update --init storybookstudio
 *   node scripts/sync-studio-contracts.mjs
 */

const ROOT = join(__dirname, '../../../..');
const SOURCE_DIR = join(__dirname, '../src');
const SUBMODULE_DIR = join(ROOT, 'storybookstudio');
const TARGET_DIR = join(SUBMODULE_DIR, 'src/studio/contracts');

const contracts = readdirSync(SOURCE_DIR)
  .filter((name) => name.endsWith('.schema.ts'))
  .sort();
const checkedOut =
  existsSync(SUBMODULE_DIR) && readdirSync(SUBMODULE_DIR).length > 0;

describe('the shared contracts', () => {
  it('are the files the fork copies, and import only zod and each other', () => {
    expect(contracts).toEqual(
      expect.arrayContaining([
        'brand.schema.ts',
        'edit-package.schema.ts',
        'edit-policy.schema.ts',
      ]),
    );

    for (const name of contracts) {
      const source = readFileSync(join(SOURCE_DIR, name), 'utf8');
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
        (match) => match[1],
      );

      for (const spec of imports) {
        // A copy lives alone in contracts/: anything else would not resolve.
        expect(
          spec === 'zod' ||
            (spec!.startsWith('./') &&
              contracts.includes(`${spec!.slice(2)}.ts`)),
          `${name} imports ${spec}`,
        ).toBe(true);
      }
    }
  });

  if (!checkedOut) {
    it.skip('match their copies in storybookstudio/ (submodule not checked out; run `git submodule update --init storybookstudio`)', () => {});
    return;
  }

  it.each(contracts)(
    '%s matches its copy in storybookstudio/src/studio/contracts (run node scripts/sync-studio-contracts.mjs)',
    (name) => {
      const copy = join(TARGET_DIR, name);

      expect(existsSync(copy), `${copy} is missing`).toBe(true);
      expect(readFileSync(copy, 'utf8')).toBe(
        readFileSync(join(SOURCE_DIR, name), 'utf8'),
      );
    },
  );
});
