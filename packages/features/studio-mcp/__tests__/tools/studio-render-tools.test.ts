import { describe, expect, it, vi } from 'vitest';

import type { StorageAdapter } from '@kit/storage';

import {
  RENDER_UPLOAD_TTL_SECONDS,
  createFinalizeRenderTool,
  createRequestRenderUploadTool,
  deliverEditTool,
} from '../../src/server/tools/studio/renders';
import { type FakeDb, contextFor, fakeClient } from '../helpers/fake-postgrest';

/**
 * FILM-2003's three tools, against an in-memory PostgREST and a stand-in
 * storage adapter: what each reads, writes, signs and refuses. The SQL
 * (RLS, deliver_edit's transaction) is pgTAP's: episode-renders.test.sql.
 */
const TEAM = { id: '22222222-2222-4222-8222-222222222222', slug: 'team-a' };
const OTHER_TEAM = '99999999-9999-4999-8999-999999999999';
const ME = '00000000-0000-4000-8000-00000000u001';
const SOMEONE = '00000000-0000-4000-8000-00000000u002';
const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EPISODE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const OTHER_SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
const CLOSED_SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccc03';
const FOREIGN_SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccc04';
const RENDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
const KEY = `projects/${PROJECT}/episodes/${EPISODE}/renders/${RENDER}.mp4`;

const episode = (accountId = TEAM.id) => ({
  id: EPISODE,
  project_id: PROJECT,
  deleted_at: null,
  project: { id: PROJECT, account_id: accountId },
});

function db(extra: FakeDb = {}): FakeDb {
  return {
    edit_sessions: [
      { id: SESSION, user_id: ME, status: 'open', episode: episode() },
      {
        id: OTHER_SESSION,
        user_id: SOMEONE,
        status: 'open',
        episode: episode(),
      },
      {
        id: CLOSED_SESSION,
        user_id: ME,
        status: 'delivered',
        episode: episode(),
      },
      {
        id: FOREIGN_SESSION,
        user_id: ME,
        status: 'open',
        episode: episode(OTHER_TEAM),
      },
    ],
    episode_renders: [
      {
        id: RENDER,
        status: 'uploading',
        created_by: ME,
        file_path: KEY,
        file_size_bytes: 48211,
        file_url: null,
        duration_seconds: null,
        preset: 'youtube_16x9',
        language: 'en',
        episode: {
          id: EPISODE,
          project_id: PROJECT,
          project: { account_id: TEAM.id },
        },
      },
    ],
    ...extra,
  };
}

function fakeStorage(stat: Record<string, number | null> = {}) {
  return {
    getSignedUploadUrl: vi.fn(
      async (
        _bucket: string,
        path: string,
        request: {
          contentType: string;
          contentLength: number;
          expiresIn?: number;
        },
      ) => ({
        uploadUrl: `https://r2.test/${path}?X-Amz-Signature=sig`,
        publicUrl: `https://cdn.test/project-assets/${path}`,
        expiresIn: request.expiresIn ?? 900,
        headers: { 'Content-Type': request.contentType },
      }),
    ),
    getPublicUrl: (bucket: string, path: string) =>
      `https://cdn.test/${bucket}/${path}`,
    stat: vi.fn(async (_bucket: string, path: string) => {
      const size = stat[path];
      return size === undefined || size === null
        ? null
        : { bytes: size, contentType: 'video/mp4' };
    }),
  } as unknown as StorageAdapter & {
    getSignedUploadUrl: ReturnType<typeof vi.fn>;
    stat: ReturnType<typeof vi.fn>;
  };
}

function setup(
  options: {
    storage?: ReturnType<typeof fakeStorage>;
    writer?: boolean;
    db?: FakeDb;
  } = {},
) {
  const client = fakeClient(options.db ?? db(), {
    rpc: { can_write_project_storage: options.writer ?? true },
  });
  const storage = options.storage ?? fakeStorage();
  const deps = { storage: () => storage };

  return {
    client,
    storage,
    context: contextFor(client, TEAM),
    request: createRequestRenderUploadTool(deps),
    finalize: createFinalizeRenderTool(deps),
  };
}

const UPLOAD = {
  sessionId: SESSION,
  preset: 'youtube_16x9',
  language: 'en',
  aspect: '16:9',
  bytes: 48211,
  contentType: 'video/mp4',
};

describe('request_render_upload', () => {
  it('records an uploading render and signs a one-hour PUT for its own key, size and type', async () => {
    const { request, context, client, storage } = setup();

    const result = await request.handler(UPLOAD as never, context);
    const out = result.structuredContent as Record<string, unknown>;
    const renderId = out.renderId as string;
    const key = `projects/${PROJECT}/episodes/${EPISODE}/renders/${renderId}.mp4`;

    expect(out).toMatchObject({ status: 'uploading', key, method: 'PUT' });
    expect(out.uploadUrl).toBe(`https://r2.test/${key}?X-Amz-Signature=sig`);
    expect(storage.getSignedUploadUrl).toHaveBeenCalledWith(
      'project-assets',
      key,
      {
        contentType: 'video/mp4',
        contentLength: 48211,
        expiresIn: RENDER_UPLOAD_TTL_SECONDS,
      },
    );
    expect(RENDER_UPLOAD_TTL_SECONDS).toBe(3600);
    expect(client.writes).toEqual([
      {
        table: 'episode_renders',
        op: 'insert',
        payload: {
          id: renderId,
          episode_id: EPISODE,
          edit_session_id: SESSION,
          preset: 'youtube_16x9',
          language: 'en',
          aspect: '16:9',
          file_path: key,
          file_size_bytes: 48211,
          created_by: ME,
        },
      },
    ]);
  });

  it('signs the thumbnail and captions beside the render', async () => {
    const { request, context, storage } = setup();

    const result = await request.handler(
      {
        ...UPLOAD,
        thumbnail: { bytes: 900, contentType: 'image/png' },
        captions: { bytes: 300, contentType: 'text/vtt' },
      } as never,
      context,
    );
    const out = result.structuredContent as {
      renderId: string;
      thumbnail: { key: string };
      captions: { key: string };
    };
    const folder = `projects/${PROJECT}/episodes/${EPISODE}/renders/`;

    expect(out.thumbnail.key).toBe(`${folder}${out.renderId}-thumb.png`);
    expect(out.captions.key).toBe(`${folder}${out.renderId}.vtt`);
    expect(storage.getSignedUploadUrl).toHaveBeenCalledWith(
      'project-assets',
      out.captions.key,
      { contentType: 'text/vtt', contentLength: 300, expiresIn: 3600 },
    );
  });

  it.each([
    ['a preset outside the list', { preset: 'instagram_4x5' }],
    [
      'an aspect the preset does not render',
      { preset: 'tiktok_9x16', aspect: '16:9' },
    ],
    ['another container', { contentType: 'video/webm' }],
  ])('refuses %s before writing anything', async (_label, change) => {
    const { request, context, client, storage } = setup();

    await expect(
      request.handler({ ...UPLOAD, ...change } as never, context),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(client.writes).toEqual([]);
    expect(storage.getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['a session in another team', FOREIGN_SESSION, 'NOT_FOUND'],
    ['another user’s session', OTHER_SESSION, 'FORBIDDEN'],
    ['a session that is over', CLOSED_SESSION, 'VALIDATION_FAILED'],
  ])('refuses %s', async (_label, sessionId, code) => {
    const { request, context, client } = setup();

    await expect(
      request.handler({ ...UPLOAD, sessionId } as never, context),
    ).rejects.toMatchObject({ code });
    expect(client.writes).toEqual([]);
  });

  it('signs nothing when the caller cannot write the project, and fails the render', async () => {
    const { request, context, client, storage } = setup({ writer: false });

    await expect(
      request.handler(UPLOAD as never, context),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(storage.getSignedUploadUrl).not.toHaveBeenCalled();
    expect(client.writes.at(-1)).toMatchObject({
      table: 'episode_renders',
      op: 'update',
      payload: {
        status: 'failed',
        failure_reason: 'The upload could not be signed',
      },
    });
  });
});

const QA = { pass: true, issues: [] };

describe('finalize_render', () => {
  it('marks the render ready when the stored file is the signed size', async () => {
    const storage = fakeStorage({ [KEY]: 48211 });
    const { finalize, context, client } = setup({ storage });

    const result = await finalize.handler(
      { renderId: RENDER, durationSeconds: 91.2, qa: QA } as never,
      context,
    );

    expect(storage.stat).toHaveBeenCalledWith('project-assets', KEY);
    expect(client.writes).toEqual([
      {
        table: 'episode_renders',
        op: 'update',
        payload: {
          status: 'ready',
          file_url: `https://cdn.test/project-assets/${KEY}`,
          file_size_bytes: 48211,
          duration_seconds: 91.2,
          qa: QA,
          thumbnail_url: null,
          captions_url: null,
        },
      },
    ]);
    expect(result.structuredContent).toMatchObject({
      renderId: RENDER,
      status: 'ready',
      fileUrl: `https://cdn.test/project-assets/${KEY}`,
    });
  });

  it.each([
    ['missing', null, `No file was uploaded to ${KEY}`],
    [
      'the wrong size',
      1000,
      'The stored file is 1000 bytes; the upload was signed for 48211',
    ],
  ])(
    'fails a render whose file is %s, with the reason',
    async (_label, size, reason) => {
      const { finalize, context, client } = setup({
        storage: fakeStorage({ [KEY]: size }),
      });

      await expect(
        finalize.handler(
          { renderId: RENDER, durationSeconds: 1, qa: QA } as never,
          context,
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { renderId: RENDER, status: 'failed', reason },
      });
      expect(client.writes).toEqual([
        {
          table: 'episode_renders',
          op: 'update',
          payload: { status: 'failed', failure_reason: reason },
        },
      ]);
    },
  );

  it('refuses a sidecar key that is not this render’s', async () => {
    const { finalize, context, client } = setup({
      storage: fakeStorage({ [KEY]: 48211 }),
    });

    await expect(
      finalize.handler(
        {
          renderId: RENDER,
          durationSeconds: 1,
          qa: QA,
          captionsKey: `projects/${PROJECT}/assets/x/other.vtt`,
        } as never,
        context,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(client.writes).toEqual([]);
  });

  it('stores the thumbnail and captions URLs when both were uploaded', async () => {
    const folder = `projects/${PROJECT}/episodes/${EPISODE}/renders/`;
    const storage = fakeStorage({
      [KEY]: 48211,
      [`${folder}${RENDER}-thumb.jpg`]: 10,
      [`${folder}${RENDER}.vtt`]: 10,
    });
    const { finalize, context, client } = setup({ storage });

    await finalize.handler(
      {
        renderId: RENDER,
        durationSeconds: 1,
        qa: QA,
        thumbnailKey: `${folder}${RENDER}-thumb.jpg`,
        captionsKey: `${folder}${RENDER}.vtt`,
      } as never,
      context,
    );

    expect(client.writes[0]?.payload).toMatchObject({
      thumbnail_url: `https://cdn.test/project-assets/${folder}${RENDER}-thumb.jpg`,
      captions_url: `https://cdn.test/project-assets/${folder}${RENDER}.vtt`,
    });
  });

  it('lets only the render’s creator finalize it', async () => {
    const rows = db();
    rows.episode_renders![0]!.created_by = SOMEONE;
    const { finalize, context, storage } = setup({ db: rows });

    await expect(
      finalize.handler(
        { renderId: RENDER, durationSeconds: 1, qa: QA } as never,
        context,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(storage.stat).not.toHaveBeenCalled();
  });

  it('returns a ready render unchanged, without checking storage again', async () => {
    const rows = db();
    Object.assign(rows.episode_renders![0]!, {
      status: 'ready',
      file_url: 'https://cdn.test/x.mp4',
      duration_seconds: '91.2',
    });
    const { finalize, context, client, storage } = setup({ db: rows });

    const result = await finalize.handler(
      { renderId: RENDER, durationSeconds: 1, qa: QA } as never,
      context,
    );

    expect(result.structuredContent).toMatchObject({
      status: 'ready',
      durationSeconds: 91.2,
    });
    expect(storage.stat).not.toHaveBeenCalled();
    expect(client.writes).toEqual([]);
  });

  it('is NOT_FOUND for a render of another team', async () => {
    const rows = db();
    rows.episode_renders![0]!.episode = {
      id: EPISODE,
      project_id: PROJECT,
      project: { account_id: OTHER_TEAM },
    };
    const { finalize, context } = setup({ db: rows });

    await expect(
      finalize.handler(
        { renderId: RENDER, durationSeconds: 1, qa: QA } as never,
        context,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

const REPORT = {
  versions: [
    {
      id: 'v1',
      label: 'Rough cut',
      parentId: null,
      createdAt: '2026-10-04T10:00:00Z',
      origin: 'rough_cut',
    },
    {
      id: 'v2',
      label: 'AI cut',
      parentId: 'v1',
      createdAt: '2026-10-04T10:05:00Z',
      origin: 'ai',
    },
  ],
  finalDuration: 91.2,
  aiOps: 34,
  userOps: 3,
  explain: { scenes: [] },
};

const DELIVERY = {
  sessionId: SESSION,
  episodeVersion: 14,
  renders: [{ renderId: RENDER, primary: true }],
  report: REPORT,
  qa: QA,
};

function deliverSetup(answer: unknown) {
  const rpc = vi.fn(() => answer);
  const client = fakeClient(
    {
      ...db(),
      edit_events: [
        {
          id: 1,
          edit_session_id: SESSION,
          ts: '2026-10-04T10:01:00Z',
          type: 'plan_proposed',
          data: { planId: 'p1' },
        },
        {
          id: 2,
          edit_session_id: SESSION,
          ts: '2026-10-04T10:02:00Z',
          type: 'qa_run',
          data: { pass: true },
        },
        // another session's event is not counted
        {
          id: 3,
          edit_session_id: OTHER_SESSION,
          ts: '2026-10-04T10:03:00Z',
          type: 'qa_run',
          data: { pass: true },
        },
      ],
    },
    { rpc: { deliver_edit: rpc } },
  );

  return { rpc, client, context: contextFor(client, TEAM) };
}

describe('deliver_edit', () => {
  it('passes the package and a summary of the report and the events to deliver_edit', async () => {
    const { rpc, context } = deliverSetup({
      ok: true,
      episodeId: EPISODE,
      episodeStatus: 'ready',
      episodeVersion: 16,
      finalVideoUrl: 'https://cdn.test/x.mp4',
      masterVideoAssetId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      primaryRenderId: RENDER,
      renderIds: [RENDER],
      superseded: 1,
      sessionId: SESSION,
    });

    const result = await deliverEditTool.handler(DELIVERY as never, context);

    expect(rpc).toHaveBeenCalledWith({
      p_session_id: SESSION,
      p_episode_version: 14,
      p_renders: [{ renderId: RENDER, primary: true }],
      p_report: REPORT,
      p_qa: QA,
      p_summary: {
        versions: 2,
        finalDuration: 91.2,
        aiOps: 34,
        userOps: 3,
        plansProposed: 1,
        plansApproved: 0,
        qaRuns: 1,
      },
    });
    expect(result.structuredContent).toMatchObject({
      ok: true,
      episodeStatus: 'ready',
      episodeVersion: 16,
    });
  });

  it('answers a version mismatch with TARGET_CHANGED and the current version', async () => {
    const { context } = deliverSetup({
      ok: false,
      code: 'TARGET_CHANGED',
      currentVersion: 15,
      expectedVersion: 14,
    });

    await expect(
      deliverEditTool.handler(DELIVERY as never, context),
    ).rejects.toMatchObject({
      code: 'TARGET_CHANGED',
      retryable: false,
      details: { currentVersion: 15, expectedVersion: 14, etag: null },
    });
  });

  it.each([
    [{ ok: false, code: 'FORBIDDEN', role: 'viewer' }, 'FORBIDDEN', /viewer/],
    [
      { ok: false, code: 'FORBIDDEN', role: 'member', reason: 'published' },
      'FORBIDDEN',
      /published/,
    ],
    [
      {
        ok: false,
        code: 'VALIDATION_FAILED',
        reason: 'not_ready',
        renders: [],
      },
      'VALIDATION_FAILED',
      /ready/,
    ],
    [{ ok: false, code: 'NOT_FOUND' }, 'NOT_FOUND', /session/],
  ])('maps the refusal %j', async (answer, code, message) => {
    const { context } = deliverSetup(answer);

    await expect(
      deliverEditTool.handler(DELIVERY as never, context),
    ).rejects.toMatchObject({
      code,
      message: expect.stringMatching(message),
    });
  });

  it('refuses two primary renders before asking the database', async () => {
    const { rpc, context } = deliverSetup({ ok: true });

    await expect(
      deliverEditTool.handler(
        {
          ...DELIVERY,
          renders: [
            { renderId: RENDER, primary: true },
            { renderId: 'dddddddd-dddd-4ddd-8ddd-dddddddddd02', primary: true },
          ],
        } as never,
        context,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND for a session in another team, before asking the database', async () => {
    const { rpc, context } = deliverSetup({ ok: true });

    await expect(
      deliverEditTool.handler(
        { ...DELIVERY, sessionId: FOREIGN_SESSION } as never,
        context,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
