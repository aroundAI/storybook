import { describe, expect, it, vi } from 'vitest';

/**
 * KB-95's sibling: once Delete really soft-deletes an asset, every reader
 * must skip it. The screenplay's cue matcher looked assets up by prompt hash
 * without `deleted_at is null`, so a deleted asset was linked to new cues
 * again. The fake client answers the way Postgres would: the only asset with
 * that prompt is deleted, so a query that filters it out finds nothing.
 */

const PROJECT = '55555555-5555-4555-8555-555555555555';
const EPISODE = '66666666-6666-4666-8666-666666666666';
const DELETED_ASSET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown) => unknown,
      options?: { schema?: { parse: (data: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options?.schema ? options.schema.parse(data) : data),
  checkRateLimit: () => undefined,
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: async () => ({ data: { id: 'u' }, error: null }),
}));

vi.mock('../src/server/sfx-actions', () => ({
  generateSfxAction: async () => ({ status: 'failed', error: 'not here' }),
}));

function query(table: string) {
  let hidesDeleted = false;

  const builder = {
    insert: () => builder,
    update: () => builder,
    select: () => builder,
    eq: () => builder,
    is: (column: string, value: unknown) => {
      if (column === 'deleted_at' && value === null) hidesDeleted = true;
      return builder;
    },
    single: async () => {
      if (table === 'audio_cues') {
        return { data: { id: 'cue-1' }, error: null };
      }
      return hidesDeleted
        ? { data: null, error: { message: 'no rows' } }
        : {
            data: {
              id: DELETED_ASSET,
              file_url: 'https://cdn.example.com/x.mp3',
              status: 'completed',
            },
            error: null,
          };
    },
    then: <R>(resolve: (value: { data: null; error: null }) => R) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
  };

  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ from: query }),
}));

describe('processAudioCuesAction (KB-95 sibling)', () => {
  it('does not match a cue to a deleted library asset', async () => {
    const { processAudioCuesAction } = await import(
      '../src/server/audio-cue-actions'
    );

    const result = await processAudioCuesAction({
      episodeId: EPISODE,
      projectId: PROJECT,
      sceneNumber: 1,
      sceneStartSeconds: 0,
      autoGenerate: false,
      audioCues: [
        { type: 'sfx', prompt: 'Door slam', startOffset: 0, duration: 1 },
      ],
    });

    expect(result.matched).toBe(0);
    expect(result.cues[0]).not.toMatchObject({ audioAssetId: DELETED_ASSET });
  });
});
