import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BRAND_DEFAULTS } from '../src/brand.schema';
import { EDIT_POLICY_DEFAULTS } from '../src/edit-policy.schema';

/**
 * Phase 20: the shared contracts are defined here and copied into
 * StorybookStudio, which is plain JavaScript, by
 * `scripts/sync-studio-contracts.mjs`: each `*.schema.ts` becomes a
 * `*.schema.mjs` with its types stripped.
 *
 * 1. The generated JavaScript is loaded and used: it parses the committed
 *    edit-package fixtures and the brand/policy defaults exactly as the
 *    TypeScript does. This runs everywhere, CI included.
 * 2. When `storybookstudio/` is checked out, every copy in
 *    `src/studio/contracts/` must equal what the script would write. CI
 *    does not check the submodule out, so there it is skipped and says why.
 *
 *   git submodule update --init storybookstudio
 *   node scripts/sync-studio-contracts.mjs
 */

interface SyncScript {
  SUBMODULE_DIR: string;
  TARGET_DIR: string;
  contractFiles(): string[];
  copyName(source: string): string;
  driftedContracts(targetDir?: string): string[];
  writeContracts(targetDir?: string): string[];
}

const SCRIPT = join(__dirname, '../../../../scripts/sync-studio-contracts.mjs');
const SOURCE_DIR = join(__dirname, '../src');
const SCRATCH = join(__dirname, '../node_modules/.cache/studio-contracts');
const FIXTURES = join(__dirname, '../fixtures/edit-package');

const load = async () =>
  (await import(/* @vite-ignore */ pathToFileURL(SCRIPT).href)) as SyncScript;

const contracts = readdirSync(SOURCE_DIR)
  .filter((name) => name.endsWith('.schema.ts'))
  .sort();
const submodule = join(__dirname, '../../../../storybookstudio');
const checkedOut = existsSync(submodule) && readdirSync(submodule).length > 0;

describe('the shared contracts', () => {
  it('are the files the fork copies, and import only zod and each other', async () => {
    const sync = await load();

    expect(sync.contractFiles()).toEqual(contracts);
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
        (match) => match[1]!,
      );

      for (const spec of imports) {
        // A copy lives alone in contracts/: anything else would not resolve.
        expect(
          spec === 'zod' ||
            (spec.startsWith('./') &&
              contracts.includes(`${spec.slice(2)}.ts`)),
          `${name} imports ${spec}`,
        ).toBe(true);
      }
    }
  });

  it('as the fork’s JavaScript, parse the fixtures and defaults as the TypeScript does', async () => {
    const sync = await load();
    rmSync(SCRATCH, { recursive: true, force: true });
    const written = sync.writeContracts(SCRATCH);

    expect(written).toEqual(contracts);
    expect(sync.driftedContracts(SCRATCH)).toEqual([]);

    const copy = async (name: string) =>
      import(
        /* @vite-ignore */ pathToFileURL(join(SCRATCH, sync.copyName(name)))
          .href
      );
    const { EditPackageSchema } = await copy('edit-package.schema.ts');
    const { BrandSchema } = await copy('brand.schema.ts');
    const { EditPolicySchema } = await copy('edit-policy.schema.ts');

    for (const fixture of ['5-shots', '20-shots', '60-shots']) {
      const json = JSON.parse(
        readFileSync(join(FIXTURES, `${fixture}.json`), 'utf8'),
      );
      const parsed = EditPackageSchema.safeParse(json);

      expect(parsed.error, fixture).toBeUndefined();
      expect(parsed.data).toEqual(json);
    }
    expect(BrandSchema.parse({})).toEqual(BRAND_DEFAULTS);
    expect(EditPolicySchema.parse({})).toEqual(EDIT_POLICY_DEFAULTS);

    const text = readFileSync(join(SCRATCH, 'edit-package.schema.mjs'), 'utf8');
    expect(text).toMatch(/^\/\/ GENERATED from aroundAI\/storybook/);
    expect(text).toContain("from './brand.schema.mjs'");
    expect(text).not.toMatch(/export type /);
  });

  if (!checkedOut) {
    it.skip('match their copies in storybookstudio/ (submodule not checked out; run `git submodule update --init storybookstudio`)', () => {});
    return;
  }

  it('match their copies in storybookstudio/src/studio/contracts (run node scripts/sync-studio-contracts.mjs)', async () => {
    const sync = await load();

    expect(sync.driftedContracts().map(sync.copyName)).toEqual([]);
  });
});
