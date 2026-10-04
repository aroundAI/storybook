import type { SupabaseClient } from '@supabase/supabase-js';

import { describe, expect, it } from 'vitest';

import type { Database } from '@kit/supabase/database';

import { BRAND_DEFAULTS, applyBrandPatch } from '../src';
import { brandAssetIds, findForeignBrandAssetIds } from '../src/server';

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/** Answers the assets read with the rows of `ownIds`, recording filters. */
function fakeAssets(ownIds: string[]) {
  const filters: unknown[][] = [];
  const chain = {
    select: () => chain,
    in: (...args: unknown[]) => (filters.push(['in', ...args]), chain),
    eq: (...args: unknown[]) => (filters.push(['eq', ...args]), chain),
    is: (...args: unknown[]) => {
      filters.push(['is', ...args]);
      const asked = filters.find((f) => f[0] === 'in')?.[2] as string[];
      return Promise.resolve({
        data: asked.filter((id) => ownIds.includes(id)).map((id) => ({ id })),
        error: null,
      });
    },
  };

  return {
    client: { from: () => chain } as unknown as SupabaseClient<Database>,
    filters,
  };
}

describe('findForeignBrandAssetIds', () => {
  it('reads nothing when the brand names no asset', async () => {
    const fake = fakeAssets([]);

    expect(
      await findForeignBrandAssetIds(fake.client, PROJECT, BRAND_DEFAULTS),
    ).toEqual([]);
    expect(fake.filters).toEqual([]);
  });

  it("names the ids that are not the project's live assets", async () => {
    const brand = applyBrandPatch(BRAND_DEFAULTS, {
      logo: { assetId: OWN },
      introAssetId: OTHER,
      outroAssetId: OWN,
    });
    const fake = fakeAssets([OWN]);

    expect(brandAssetIds(brand)).toEqual([OWN, OTHER]);
    expect(await findForeignBrandAssetIds(fake.client, PROJECT, brand)).toEqual(
      [OTHER],
    );
    expect(fake.filters).toEqual([
      ['in', 'id', [OWN, OTHER]],
      ['eq', 'project_id', PROJECT],
      ['is', 'deleted_at', null],
    ]);
  });
});
