import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { updateCharacterAction } from '../src/lib/server/character.mutations';

/**
 * FILM-202. A character is updated by one call to
 * `update_character_with_details`, so a failed details write cannot leave the
 * asset half-updated (the action used to update the asset, commit, then upsert
 * the details).
 */

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));
vi.mock('@kit/supabase/require-user', () => ({
  requireUser: vi.fn(async () => ({ data: { id: 'user-1' }, error: null })),
}));
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(async () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));
vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      fn: (data: unknown) => unknown,
      options?: { schema?: { parse: (v: unknown) => unknown } },
    ) =>
    async (data: unknown) =>
      fn(options?.schema ? options.schema.parse(data) : data),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../src/lib/element-prompt/cache', () => ({
  invalidatePromptCache: vi.fn(),
}));

const ASSET = '22222222-2222-4222-8222-222222222222';

const row = {
  id: ASSET,
  project_id: '11111111-1111-4111-8111-111111111111',
  type: 'character',
  name: 'Mara II',
  description: null,
  file_url: null,
  thumbnail_url: null,
  metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  character_details: {
    physical_attributes: null,
    personality: 'bold',
    element_prompt: null,
    reference_images: null,
    elevenlabs_voice_id: null,
  },
};

function client(rpc: { error: { message: string; code?: string } | null }) {
  const writes: string[] = [];
  const rpcFn = vi.fn(async () => ({ data: null, ...rpc }));
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) chain[m] = () => chain;
    for (const m of ['insert', 'update', 'upsert']) {
      chain[m] = () => {
        writes.push(`${m} ${table}`);
        return chain;
      };
    }
    chain.single = async () => ({ data: row, error: null });
    return chain;
  });

  vi.mocked(getSupabaseServerClient).mockReturnValue({
    rpc: rpcFn,
    from,
  } as never);

  return { rpc: rpcFn, writes };
}

beforeEach(() => vi.clearAllMocks());

describe('updateCharacterAction', () => {
  it('sends the asset, details and attribute changes in one call, and writes nothing else', async () => {
    const { rpc, writes } = client({ error: null });

    const result = await updateCharacterAction({
      assetId: ASSET,
      name: 'Mara II',
      personality: 'bold',
      backstory: 'raised at the gate',
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('update_character_with_details', {
      p_asset_id: ASSET,
      p_asset_patch: { name: 'Mara II' },
      p_details_patch: { personality: 'bold' },
      p_attributes_patch: { backstory: 'raised at the gate' },
    });
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ ok: true });
  });

  it('turns an empty file URL into a null the database clears', async () => {
    const { rpc } = client({ error: null });

    await updateCharacterAction({ assetId: ASSET, fileUrl: '' });

    expect(rpc).toHaveBeenCalledWith(
      'update_character_with_details',
      expect.objectContaining({ p_asset_patch: { file_url: null } }),
    );
  });

  it('refuses a duplicate name as a value the form can show', async () => {
    client({
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      },
    });

    const result = await updateCharacterAction({
      assetId: ASSET,
      name: 'Mara',
    });

    expect(result).toMatchObject({
      ok: false,
      error:
        'A character named "Mara" already exists in this project. Choose a different name.',
    });
  });

  it('refuses a caller who may not write the project', async () => {
    client({
      error: { code: '42501', message: 'Access denied' },
    });

    const result = await updateCharacterAction({
      assetId: ASSET,
      name: 'Mara',
    });

    expect(result).toMatchObject({
      ok: false,
      error: "You can't change this character.",
    });
  });

  it('reports any other failure and returns no character', async () => {
    client({ error: { message: 'boom' } });

    await expect(
      updateCharacterAction({ assetId: ASSET, name: 'Mara' }),
    ).rejects.toThrow('Failed to update character: boom');
  });
});
