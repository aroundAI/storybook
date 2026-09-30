import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { isAssetInUse } from '../src/lib/server/asset.queries';

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(async () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

type CountResult = { count: number | null; error: { message: string } | null };

function useTables(results: Record<string, CountResult>) {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'or']) chain[m] = () => chain;
    chain.then = (resolve: (r: CountResult) => unknown) =>
      resolve(results[table] ?? { count: 0, error: null });
    return chain;
  });
  vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
  return from;
}

describe('isAssetInUse (FILM-201)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is false when nothing references the asset', async () => {
    useTables({});
    await expect(isAssetInUse('a')).resolves.toBe(false);
  });

  it.each([
    'dialogue_lines',
    'character_details',
    'episodes',
    'audio_assets',
    'caption_segments',
  ])('is true when %s references the asset', async (table) => {
    useTables({ [table]: { count: 1, error: null } });
    await expect(isAssetInUse('a')).resolves.toBe(true);
  });

  it('throws when a check fails, so a failed check cannot delete', async () => {
    useTables({
      dialogue_lines: { count: null, error: { message: 'timeout' } },
    });
    await expect(isAssetInUse('a')).rejects.toThrow(
      'Failed to check asset usage: timeout',
    );
  });

  it('throws when a later table fails even though earlier ones are clear', async () => {
    useTables({
      audio_assets: { count: null, error: { message: 'relation gone' } },
    });
    await expect(isAssetInUse('a')).rejects.toThrow('relation gone');
  });
});
