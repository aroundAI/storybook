import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-54: replacing or deleting a project intro or an episode thumbnail must
 * delete the old stored file — and only a file inside that intro's project
 * or that thumbnail's episode.
 *
 * Before the fix the key was `pathname.split('/').slice(-2)`, which dropped
 * the `projects/<P>/` / `episodes/<E>/` prefix, so nothing was deleted; and
 * the delete ran before the row was saved, so a failed save would have lost
 * the file the row still pointed at, had the delete worked. The storage
 * adapter here issues R2-shaped public URLs (production), where the delete
 * runs with the app's own credentials.
 */

const PROJECT = '11111111-5400-4000-8000-00000000000a';
const OTHER_PROJECT = '11111111-5400-4000-8000-00000000000b';
const EPISODE = '11111111-5400-4000-8000-00000000000c';
const INTRO_ID = '11111111-5400-4000-8000-00000000000d';
const THUMB_ID = '11111111-5400-4000-8000-00000000000e';
const USER = '11111111-5400-4000-8000-00000000000f';
const CDN = 'https://cdn.example.com';

const url = (key: string) => `${CDN}/project-assets/${key}`;

const state = vi.hoisted(() => ({
  /** The row the action finds for (parent, language) or by id */
  existing: null as Record<string, unknown> | null,
  upsertError: null as { message: string } | null,
  /** Every storage delete and row write, in order */
  log: [] as string[],
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown) => unknown,
      options?: { schema?: { parse: (data: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options?.schema ? options.schema.parse(data) : data),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: async () => ({ data: { id: USER }, error: null }),
}));

vi.mock('@kit/projects/queries', () => ({
  canPerformProjectAction: async () => true,
}));

vi.mock('@kit/storage', async () => {
  const actual =
    await vi.importActual<typeof import('@kit/storage')>('@kit/storage');

  return {
    ...actual,
    getStorageAdapter: () => ({
      getPublicUrl: (bucket: string, path: string) =>
        `${CDN}/${bucket}/${path}`,
      delete: async (_bucket: string, path: string) => {
        state.log.push(`storage.delete ${path}`);
      },
    }),
  };
});

vi.mock('@kit/supabase/server-client', () => {
  function builder(table: string) {
    let op = 'select';
    const self: Record<string, unknown> = {
      select: () => self,
      eq: () => self,
      update: () => {
        op = 'update';
        return self;
      },
      upsert: (row: Record<string, unknown>) => {
        op = 'upsert';
        state.log.push(`${table}.upsert`);
        (self as { row?: unknown }).row = row;
        return self;
      },
      delete: () => {
        op = 'delete';
        state.log.push(`${table}.delete`);
        return self;
      },
      single: async () => {
        if (table === 'episodes') {
          return {
            data: {
              id: EPISODE,
              project: {
                id: PROJECT,
                project_members: [{ user_id: USER, role: 'owner' }],
              },
            },
            error: null,
          };
        }

        if (op === 'upsert') {
          return state.upsertError
            ? { data: null, error: state.upsertError }
            : {
                data: { id: 'new', ...(self as { row: object }).row },
                error: null,
              };
        }

        return { data: state.existing, error: null };
      },
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: null, error: null }),
    };

    return self;
  }

  return {
    getSupabaseServerClient: () => ({ from: builder }),
  };
});

const { uploadProjectIntroAction, deleteProjectIntroAction } = await import(
  '../src/server/intro-actions'
);
const { uploadEpisodeThumbnailAction, deleteEpisodeThumbnailAction } =
  await import('../src/server/thumbnail-actions');

const OLD_INTRO = `projects/${PROJECT}/assets/intros/en-1.mp4`;
const NEW_INTRO = `projects/${PROJECT}/assets/intros/en-2.mp4`;
const OLD_THUMB = `episodes/${EPISODE}/thumbnails/en-1.png`;
const NEW_THUMB = `episodes/${EPISODE}/thumbnails/en-2.png`;

beforeEach(() => {
  state.existing = null;
  state.upsertError = null;
  state.log = [];
});

function replaceIntro() {
  return uploadProjectIntroAction({
    projectId: PROJECT,
    language: 'en',
    videoUrl: url(NEW_INTRO),
    durationSeconds: 5,
  });
}

function replaceThumbnail() {
  return uploadEpisodeThumbnailAction({
    episodeId: EPISODE,
    language: 'en',
    thumbnailUrl: url(NEW_THUMB),
  });
}

describe('replacing an intro', () => {
  it('deletes the old file by its full key, after the row is saved', async () => {
    state.existing = { id: INTRO_ID, video_url: url(OLD_INTRO) };

    const result = await replaceIntro();

    expect(result.success).toBe(true);
    expect(state.log).toEqual([
      'project_intros.upsert',
      `storage.delete ${OLD_INTRO}`,
    ]);
  });

  it('keeps the old file when the row cannot be saved', async () => {
    state.existing = { id: INTRO_ID, video_url: url(OLD_INTRO) };
    state.upsertError = { message: 'nope' };

    const result = await replaceIntro();

    expect(result.success).toBe(false);
    expect(state.log).toEqual(['project_intros.upsert']);
  });

  it("never deletes a file in another project's folder", async () => {
    state.existing = {
      id: INTRO_ID,
      video_url: url(`projects/${OTHER_PROJECT}/assets/intros/en-1.mp4`),
    };

    const result = await replaceIntro();

    expect(result.success).toBe(true);
    expect(state.log).toEqual(['project_intros.upsert']);
  });
});

describe('deleting an intro', () => {
  it('deletes its file by the full key', async () => {
    state.existing = { video_url: url(OLD_INTRO) };

    const result = await deleteProjectIntroAction({
      introId: INTRO_ID,
      projectId: PROJECT,
    });

    expect(result.success).toBe(true);
    expect(state.log).toEqual([
      `storage.delete ${OLD_INTRO}`,
      'project_intros.delete',
    ]);
  });

  it("never deletes a file in another project's folder", async () => {
    state.existing = {
      video_url: url(`projects/${OTHER_PROJECT}/assets/intros/en-1.mp4`),
    };

    await deleteProjectIntroAction({ introId: INTRO_ID, projectId: PROJECT });

    expect(state.log).toEqual(['project_intros.delete']);
  });
});

describe('replacing a thumbnail', () => {
  it('deletes the old file by its full key, after the row is saved', async () => {
    state.existing = { id: THUMB_ID, thumbnail_url: url(OLD_THUMB) };

    const result = await replaceThumbnail();

    expect(result.success).toBe(true);
    expect(state.log).toEqual([
      'episode_thumbnails.upsert',
      `storage.delete ${OLD_THUMB}`,
    ]);
  });

  it('keeps the old file when the row cannot be saved', async () => {
    state.existing = { id: THUMB_ID, thumbnail_url: url(OLD_THUMB) };
    state.upsertError = { message: 'nope' };

    const result = await replaceThumbnail();

    expect(result.success).toBe(false);
    expect(state.log).toEqual(['episode_thumbnails.upsert']);
  });

  it("never deletes a file in another episode's folder", async () => {
    state.existing = {
      id: THUMB_ID,
      thumbnail_url: url(`projects/${PROJECT}/assets/covers/cover-1.png`),
    };

    await replaceThumbnail();

    expect(state.log).toEqual(['episode_thumbnails.upsert']);
  });
});

describe('deleting a thumbnail', () => {
  it('deletes its file by the full key', async () => {
    state.existing = { thumbnail_url: url(OLD_THUMB) };

    const result = await deleteEpisodeThumbnailAction({
      thumbnailId: THUMB_ID,
      episodeId: EPISODE,
    });

    expect(result.success).toBe(true);
    expect(state.log).toEqual([
      `storage.delete ${OLD_THUMB}`,
      'episode_thumbnails.delete',
    ]);
  });
});
