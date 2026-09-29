import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sanitizeFilename } from '../src/lib/upload-only-format';

/**
 * FILM-713. Upload-only mode hands the creator a package to upload by hand,
 * then records where it ended up. upload-only-actions.test.ts covers the
 * pure helpers; this covers the two actions around them: the export package
 * an episode produces for a platform, and the publish record written when
 * the creator says they uploaded it. Supabase is stubbed at the client.
 */

const EPISODE = '7a7a7a7a-0000-4000-8000-000000000001';
const PUBLISH = '7a7a7a7a-0000-4000-8000-000000000002';

const state = vi.hoisted(() => ({
  episode: null as Record<string, unknown> | null,
  episodeError: null as { code: string; message: string } | null,
  existingPublish: null as { id: string } | null,
  writeError: null as { message: string } | null,
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));
vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options?: { schema?: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options?.schema ? options.schema.parse(data) : data, {
        id: 'user-1',
      }),
}));

function query(table: string) {
  let mode: 'select' | 'insert' | 'update' = 'select';

  const builder = {
    select: () => builder,
    eq: () => builder,
    insert: (row: Record<string, unknown>) => {
      mode = 'insert';
      state.inserted.push(row);
      return builder;
    },
    update: (row: Record<string, unknown>) => {
      mode = 'update';
      state.updated.push(row);
      return builder;
    },
    single: async () => {
      if (table === 'episodes') {
        return { data: state.episode, error: state.episodeError };
      }

      if (mode !== 'select' && state.writeError) {
        return { data: null, error: state.writeError };
      }

      return {
        data: { id: state.existingPublish?.id ?? PUBLISH },
        error: null,
      };
    },
    maybeSingle: async () => ({ data: state.existingPublish, error: null }),
  };

  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ from: query }),
}));

const { generateExportPackageAction, markAsExternallyUploadedAction } =
  await import('../src/server/upload-only-actions');

const episode = (over: Record<string, unknown> = {}) => ({
  id: EPISODE,
  title: 'Harbour at dusk!',
  description: 'The harbour, slowly.',
  final_video_url: 'https://cdn.example.com/harbour.mp4',
  thumbnail_url: 'https://cdn.example.com/harbour.jpg',
  duration_seconds: 95,
  publishes: [],
  ...over,
});

beforeEach(() => {
  state.episode = episode();
  state.episodeError = null;
  state.existingPublish = null;
  state.writeError = null;
  state.inserted = [];
  state.updated = [];
});

describe('generateExportPackageAction', () => {
  it('builds the package for a platform from the episode', async () => {
    const result = await generateExportPackageAction({
      episodeId: EPISODE,
      platform: 'youtube',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toMatchObject({
      episodeId: EPISODE,
      platform: 'youtube',
      video: {
        url: 'https://cdn.example.com/harbour.mp4',
        filename: `${sanitizeFilename('Harbour at dusk!')}.mp4`,
        format: 'mp4',
        duration: 95,
      },
      thumbnail: {
        url: 'https://cdn.example.com/harbour.jpg',
        dimensions: { width: 1280, height: 720 },
      },
      metadata: { title: 'Harbour at dusk!' },
    });
    expect(result.data.video.filename).toBe('harbour_at_dusk.mp4');
  });

  it('prefers the platform’s own record over the episode, and ignores another platform’s', async () => {
    state.episode = episode({
      publishes: [
        {
          platform: 'tiktok',
          title: 'TikTok title',
          tags: ['tt'],
          description: 'tiktok words',
        },
        {
          platform: 'youtube',
          title: 'YouTube title',
          tags: ['harbour', 'dusk'],
          description: 'youtube words',
          metadata: { category: 'Travel' },
        },
      ],
    });

    const result = await generateExportPackageAction({
      episodeId: EPISODE,
      platform: 'youtube',
    });

    expect(result.ok && result.data.metadata).toMatchObject({
      title: 'YouTube title',
      tags: ['harbour', 'dusk'],
      category: 'Travel',
    });
  });

  it('leaves the thumbnail out when the episode has none', async () => {
    state.episode = episode({ thumbnail_url: null });

    const result = await generateExportPackageAction({
      episodeId: EPISODE,
      platform: 'tiktok',
    });

    expect(result.ok && result.data.thumbnail).toBeNull();
  });

  it.each(['youtube', 'tiktok', 'instagram', 'facebook'] as const)(
    'gives %s seven numbered upload steps',
    async (platform) => {
      const result = await generateExportPackageAction({
        episodeId: EPISODE,
        platform,
      });

      expect(
        result.ok && result.data.uploadInstructions.map((s) => s.step),
      ).toEqual([1, 2, 3, 4, 5, 6, 7]);
    },
  );

  it('refuses when the video has not been finalised', async () => {
    state.episode = episode({ final_video_url: null });

    await expect(
      generateExportPackageAction({ episodeId: EPISODE, platform: 'youtube' }),
    ).resolves.toEqual({
      ok: false,
      error: 'Video is not ready. Please finalize the video first.',
    });
  });

  it('refuses an episode that does not exist', async () => {
    state.episode = null;
    state.episodeError = { code: 'PGRST116', message: 'no rows' };

    await expect(
      generateExportPackageAction({ episodeId: EPISODE, platform: 'youtube' }),
    ).resolves.toEqual({ ok: false, error: 'Episode not found' });
  });

  it('rejects a platform upload-only mode does not cover, without building a package', async () => {
    await expect(
      generateExportPackageAction({
        episodeId: EPISODE,
        platform: 'twitter' as never,
      }),
    ).rejects.toThrow('Invalid enum value');
  });
});

describe('markAsExternallyUploadedAction', () => {
  it('records the upload as a publish with no OAuth connection', async () => {
    await expect(
      markAsExternallyUploadedAction({
        episodeId: EPISODE,
        platform: 'youtube',
        platformUrl: 'https://www.youtube.com/watch?v=abc123DEF45',
      }),
    ).resolves.toEqual({ publishId: PUBLISH });

    expect(state.inserted).toEqual([
      expect.objectContaining({
        episode_id: EPISODE,
        platform: 'youtube',
        platform_url: 'https://www.youtube.com/watch?v=abc123DEF45',
        platform_content_id: 'abc123DEF45',
        platform_connection_id: null,
        status: 'published',
        metadata: { upload_method: 'external' },
      }),
    ]);
    expect(state.updated).toEqual([]);
  });

  it('updates the platform’s existing publish instead of adding a second', async () => {
    state.existingPublish = { id: 'existing-publish' };

    await expect(
      markAsExternallyUploadedAction({
        episodeId: EPISODE,
        platform: 'youtube',
        platformUrl: 'https://www.youtube.com/watch?v=abc123DEF45',
      }),
    ).resolves.toEqual({ publishId: 'existing-publish' });

    expect(state.inserted).toEqual([]);
    expect(state.updated).toEqual([
      expect.objectContaining({
        status: 'published',
        platform_content_id: 'abc123DEF45',
        metadata: { upload_method: 'external' },
      }),
    ]);
  });

  it('keeps the link even when no content id can be read from it', async () => {
    await markAsExternallyUploadedAction({
      episodeId: EPISODE,
      platform: 'tiktok',
      platformUrl: 'https://www.tiktok.com/@someone',
    });

    expect(state.inserted[0]).toMatchObject({
      platform_url: 'https://www.tiktok.com/@someone',
      platform_content_id: null,
    });
  });

  it('fails when the record cannot be written', async () => {
    state.writeError = { message: 'boom' };

    await expect(
      markAsExternallyUploadedAction({
        episodeId: EPISODE,
        platform: 'youtube',
        platformUrl: 'https://www.youtube.com/watch?v=abc123DEF45',
      }),
    ).rejects.toThrow('Failed to create publish record');
  });

  it('rejects a link that is not a URL, and writes nothing', async () => {
    await expect(async () =>
      markAsExternallyUploadedAction({
        episodeId: EPISODE,
        platform: 'youtube',
        platformUrl: 'my video',
      }),
    ).rejects.toThrow('Please enter a valid URL');

    expect(state.inserted).toEqual([]);
    expect(state.updated).toEqual([]);
  });
});
