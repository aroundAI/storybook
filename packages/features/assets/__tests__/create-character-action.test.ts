import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { createCharacterAction } from '../src/lib/server/character.mutations';

/**
 * FILM-202. A character is an asset plus its details, made in one call to
 * `create_character_with_details` so a failure between the two leaves nothing
 * behind, whoever the caller is. (The action used to insert the asset, then
 * the details, then delete the asset on failure, which a plain project member
 * could not do: character-create-rollback.test.sql.)
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

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';

const row = {
  id: ASSET,
  project_id: PROJECT,
  type: 'character',
  name: 'Mara',
  description: null,
  file_url: null,
  thumbnail_url: null,
  metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  character_details: {
    physical_attributes: null,
    personality: null,
    element_prompt: null,
    reference_images: null,
    elevenlabs_voice_id: null,
  },
};

function client(rpc: { data: unknown; error: { message: string } | null }) {
  const inserts: string[] = [];
  const rpcFn = vi.fn(async () => rpc);
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) chain[m] = () => chain;
    chain.insert = () => {
      inserts.push(table);
      return chain;
    };
    chain.single = async () => ({ data: row, error: null });
    return chain;
  });

  vi.mocked(getSupabaseServerClient).mockReturnValue({
    rpc: rpcFn,
    from,
  } as never);

  return { rpc: rpcFn, inserts };
}

beforeEach(() => vi.clearAllMocks());

describe('createCharacterAction', () => {
  it('creates the asset and its details in one call, and nothing else', async () => {
    const { rpc, inserts } = client({ data: ASSET, error: null });

    const result = await createCharacterAction({
      projectId: PROJECT,
      name: 'Mara',
      description: 'A guard',
      fileUrl: 'https://cdn.example.com/f.png',
      personality: 'stern',
      elementPrompt: 'a guard',
      voiceAssetId: 'voice-1',
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'create_character_with_details',
      expect.objectContaining({
        p_project_id: PROJECT,
        p_name: 'Mara',
        p_description: 'A guard',
        p_personality: 'stern',
        p_element_prompt: 'a guard',
        p_elevenlabs_voice_id: 'voice-1',
        p_file_url: 'https://cdn.example.com/f.png',
        p_thumbnail_url: undefined,
      }),
    );
    // No separate insert into assets or character_details to half-fail.
    expect(inserts).toEqual([]);
    expect(result).toMatchObject({ ok: true });
  });

  it('turns the structured fields into physical_attributes', async () => {
    const { rpc } = client({ data: ASSET, error: null });

    await createCharacterAction({
      projectId: PROJECT,
      name: 'Mara',
      backstory: 'raised at the gate',
    });

    expect(rpc).toHaveBeenCalledWith(
      'create_character_with_details',
      expect.objectContaining({
        p_physical_attributes: {
          physicalAttributes: null,
          personalityTraits: null,
          clothingStyle: null,
          backstory: 'raised at the gate',
        },
      }),
    );
  });

  it('refuses a duplicate name in the project as a value the form can show', async () => {
    client({
      data: null,
      error: {
        message:
          'Failed to create character: duplicate key value violates unique constraint "assets_project_id_type_name_key"',
      },
    });

    const result = await createCharacterAction({
      projectId: PROJECT,
      name: 'Mara',
    });

    expect(result).toMatchObject({
      ok: false,
      error:
        'A character named "Mara" already exists in this project. Choose a different name.',
    });
  });

  it('reports any other failure and returns no character', async () => {
    client({
      data: null,
      error: { message: 'Failed to create character: boom' },
    });

    await expect(
      createCharacterAction({ projectId: PROJECT, name: 'Mara' }),
    ).rejects.toThrow(
      'Failed to create character: Failed to create character: boom',
    );
  });
});
