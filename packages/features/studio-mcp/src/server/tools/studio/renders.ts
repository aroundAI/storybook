import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  DeliveryPackageObjectSchema,
  DeliveryPackageSchema,
  FinalizeRenderSchema,
  RENDER_THUMBNAIL_TYPES,
  RequestRenderUploadSchema,
  presetAllowsAspect,
} from '@kit/desktop-integration';
import {
  type DeliverEditResult,
  deliverEdit,
} from '@kit/desktop-integration/server';
import {
  type StorageAdapter,
  canWriteProjectKey,
  getStorageAdapter,
} from '@kit/storage';
import {
  PROJECT_ASSETS_BUCKET,
  episodeRenderCaptionsKey,
  episodeRenderFolder,
  episodeRenderKey,
  episodeRenderThumbnailKey,
  isUploadPath,
} from '@kit/storage/upload-paths';

import { McpToolError } from '../../../errors';
import type { McpPrincipal } from '../../../principal';
import { type McpToolDefinition, defineTool } from '../../../registry';
import { parseWith, refused } from '../validation';

/**
 * FILM-2003: StorybookStudio sends a finished cut back.
 *
 *   request_render_upload  a render row (uploading) and a presigned PUT for its file
 *   finalize_render        the stored file checked against what was signed; ready or failed
 *   deliver_edit           the one transaction that makes the episode ready
 *
 * Every read runs as the caller under RLS and is scoped to the bound team
 * before anything is signed: the storage adapter holds the app's own
 * credentials (FILM-1904 boundaries), and KB-28's project rule is asked
 * about each key as the caller.
 */

type Client = McpPrincipal['supabase'];

/** Upload URLs live an hour (the presign route's maximum). */
export const RENDER_UPLOAD_TTL_SECONDS = 3600;

/** Each tool takes the storage adapter from here, so a test can stand one in. */
export interface RenderToolDeps {
  storage(client: Client): StorageAdapter;
}

export const defaultRenderToolDeps: RenderToolDeps = {
  storage: (client) => getStorageAdapter(client),
};

interface SessionRow {
  id: string;
  user_id: string;
  status: string;
  episode: {
    id: string;
    project_id: string;
    deleted_at: string | null;
    project: { id: string; account_id: string };
  };
}

/** The edit session, in the bound team, as the caller sees it. */
async function requireSession(
  client: Client,
  accountId: string,
  sessionId: string,
): Promise<SessionRow> {
  const { data, error } = await client
    .from('edit_sessions')
    .select(
      'id, user_id, status, episode:episodes!inner(id, project_id, deleted_at, project:projects!inner(id, account_id))',
    )
    .eq('id', sessionId)
    .eq('episode.project.account_id', accountId)
    .maybeSingle();

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not read the edit session.');
  }

  const session = data as unknown as SessionRow | null;

  if (!session || session.episode.deleted_at) {
    throw new McpToolError(
      'NOT_FOUND',
      'No edit session with this id in your team.',
      { details: { sessionId } },
    );
  }

  return session;
}

function requireOwnOpenSession(session: SessionRow, userId: string) {
  if (session.user_id !== userId) {
    throw new McpToolError(
      'FORBIDDEN',
      'This edit session belongs to another user; only they can send renders for it.',
      { details: { sessionId: session.id } },
    );
  }

  if (session.status !== 'open') {
    throw new McpToolError(
      'VALIDATION_FAILED',
      `This edit session is ${session.status}. Open a new session with open_edit_session.`,
      { details: { sessionId: session.id, status: session.status } },
    );
  }
}

interface SignedPut {
  key: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresIn: number;
}

async function signPut(
  client: Client,
  storage: StorageAdapter,
  key: string,
  contentType: string,
  bytes: number,
): Promise<SignedPut> {
  // The presign route's two rules (KB-28): the key's shape, and the caller
  // writes the project it names
  if (!isUploadPath(PROJECT_ASSETS_BUCKET, key)) {
    throw new McpToolError('INTERNAL', 'The render key was refused.');
  }

  if (!(await canWriteProjectKey(client, key))) {
    throw new McpToolError(
      'FORBIDDEN',
      'You cannot upload to this project (project owner, admin or member only).',
    );
  }

  const signed = await storage.getSignedUploadUrl(PROJECT_ASSETS_BUCKET, key, {
    contentType,
    contentLength: bytes,
    expiresIn: RENDER_UPLOAD_TTL_SECONDS,
  });

  return {
    key,
    uploadUrl: signed.uploadUrl,
    method: 'PUT',
    headers: signed.headers,
    expiresIn: signed.expiresIn,
  };
}

export function createRequestRenderUploadTool(
  deps: RenderToolDeps = defaultRenderToolDeps,
) {
  return defineTool({
    name: 'request_render_upload',
    title: 'Request a render upload',
    description:
      "Starts sending one finished render of an episode back from StorybookStudio. Takes the open edit session (from open_edit_session), the preset (youtube_16x9, shorts_9x16, tiktok_9x16, reels_9x16, square_1x1 or master), the language, the aspect (16:9, 9:16 or 1:1; each preset has its own, master any), the exact size in bytes and the content type (video/mp4, at most 500 MB). Records the render as uploading and returns {renderId, key, uploadUrl, method, headers}: PUT the file to uploadUrl within an hour with exactly those headers and that many bytes, then call finalize_render. Optionally signs a thumbnail (image/jpeg, png or webp, at most 10 MB) and captions (text/vtt, at most 2 MB) for the same render. Only the session's own user may call it.",
    inputSchema: RequestRenderUploadSchema.shape,
    scope: 'studio:write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(rawInput, context) {
      const input = parseWith(RequestRenderUploadSchema, rawInput);
      const client = context.principal.supabase;

      if (!presetAllowsAspect(input.preset, input.aspect)) {
        throw refused(
          `A ${input.preset} render is not ${input.aspect}.`,
          'aspect',
        );
      }

      const session = await requireSession(
        client,
        context.accountId,
        input.sessionId,
      );
      requireOwnOpenSession(session, context.principal.userId);

      const projectId = session.episode.project_id;
      const episodeId = session.episode.id;
      const renderId = randomUUID();
      const key = episodeRenderKey(projectId, episodeId, renderId);

      const { error } = await client.from('episode_renders').insert({
        id: renderId,
        episode_id: episodeId,
        edit_session_id: session.id,
        preset: input.preset,
        language: input.language,
        aspect: input.aspect,
        file_path: key,
        file_size_bytes: input.bytes,
        created_by: context.principal.userId,
      });

      if (error) {
        // RLS: a viewer, or a session that closed since it was read
        if (error.code === '42501') {
          throw new McpToolError(
            'FORBIDDEN',
            'You cannot add renders to this episode (project owner, admin or member, in your own open session).',
          );
        }

        throw new McpToolError('INTERNAL', 'Could not record the render.');
      }

      const storage = deps.storage(client);

      try {
        const video = await signPut(
          client,
          storage,
          key,
          input.contentType,
          input.bytes,
        );
        const thumbnail = input.thumbnail
          ? await signPut(
              client,
              storage,
              episodeRenderThumbnailKey(
                projectId,
                episodeId,
                renderId,
                input.thumbnail.contentType,
              ),
              input.thumbnail.contentType,
              input.thumbnail.bytes,
            )
          : undefined;
        const captions = input.captions
          ? await signPut(
              client,
              storage,
              episodeRenderCaptionsKey(projectId, episodeId, renderId),
              input.captions.contentType,
              input.captions.bytes,
            )
          : undefined;

        return {
          text: `Render ${renderId} (${input.preset}, ${input.language}) is uploading. PUT ${input.bytes} bytes to uploadUrl within ${Math.round(video.expiresIn / 60)} minutes, then call finalize_render.`,
          structuredContent: {
            renderId,
            episodeId,
            status: 'uploading',
            ...video,
            ...(thumbnail && { thumbnail }),
            ...(captions && { captions }),
          },
        };
      } catch (signError) {
        await failRender(client, renderId, 'The upload could not be signed');

        throw signError;
      }
    },
  });
}

async function failRender(client: Client, renderId: string, reason: string) {
  await client
    .from('episode_renders')
    .update({ status: 'failed', failure_reason: reason })
    .eq('id', renderId)
    .eq('status', 'uploading');
}

interface RenderRow {
  id: string;
  status: string;
  created_by: string | null;
  file_path: string;
  file_size_bytes: number | null;
  file_url: string | null;
  duration_seconds: number | null;
  preset: string;
  language: string;
  episode: {
    id: string;
    project_id: string;
    project: { account_id: string };
  };
}

/** The sidecar key the Studio names must be the one signed for this render. */
function sidecarKey(
  render: RenderRow,
  key: string | undefined,
  kind: 'thumbnail' | 'captions',
): string | undefined {
  if (key === undefined) return undefined;

  const { project_id: projectId, id: episodeId } = render.episode;
  const allowed =
    kind === 'captions'
      ? [episodeRenderCaptionsKey(projectId, episodeId, render.id)]
      : RENDER_THUMBNAIL_TYPES.map((type) =>
          episodeRenderThumbnailKey(projectId, episodeId, render.id, type),
        );

  if (!allowed.includes(key)) {
    throw refused(
      `${kind}Key must be the key request_render_upload returned for this render (under ${episodeRenderFolder(projectId, episodeId)}).`,
      `${kind}Key`,
    );
  }

  return key;
}

export function createFinalizeRenderTool(
  deps: RenderToolDeps = defaultRenderToolDeps,
) {
  return defineTool({
    name: 'finalize_render',
    title: 'Finalize an uploaded render',
    description:
      "Confirms a render after its PUT. Checks that the file is stored at the render's key with the exact size it was signed for, records the duration and the QA result ({pass, issues[{type, severity 0-1, timeRange, scene, detail, repairIntent?}]}) and marks the render ready. A missing or wrong-sized file marks it failed with the reason, and returns VALIDATION_FAILED; request a new upload then. Pass thumbnailKey and captionsKey when request_render_upload signed them and they were uploaded. Calling it again on a ready render returns it unchanged.",
    inputSchema: FinalizeRenderSchema.shape,
    scope: 'studio:write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(rawInput, context) {
      const input = parseWith(FinalizeRenderSchema, rawInput);
      const client = context.principal.supabase;

      const { data, error } = await client
        .from('episode_renders')
        .select(
          'id, status, created_by, file_path, file_size_bytes, file_url, duration_seconds, preset, language, episode:episodes!inner(id, project_id, project:projects!inner(account_id))',
        )
        .eq('id', input.renderId)
        .eq('episode.project.account_id', context.accountId)
        .maybeSingle();

      if (error) {
        throw new McpToolError('INTERNAL', 'Could not read the render.');
      }

      const render = data as unknown as RenderRow | null;

      if (!render) {
        throw new McpToolError(
          'NOT_FOUND',
          'No render with this id in your team.',
          { details: { renderId: input.renderId } },
        );
      }

      if (render.created_by !== context.principal.userId) {
        throw new McpToolError(
          'FORBIDDEN',
          'Only the user who requested this render can finalize it.',
        );
      }

      if (render.status === 'ready') {
        return finalized(render);
      }

      if (render.status !== 'uploading') {
        throw new McpToolError(
          'VALIDATION_FAILED',
          `This render is ${render.status}; request a new upload.`,
          { details: { renderId: render.id, status: render.status } },
        );
      }

      const thumbnailKey = sidecarKey(render, input.thumbnailKey, 'thumbnail');
      const captionsKey = sidecarKey(render, input.captionsKey, 'captions');
      const storage = deps.storage(client);

      if (!storage.stat) {
        throw new McpToolError(
          'INTERNAL',
          'The storage provider cannot check an upload.',
        );
      }

      for (const [field, key] of [
        ['thumbnailKey', thumbnailKey],
        ['captionsKey', captionsKey],
      ] as const) {
        if (key && !(await storage.stat(PROJECT_ASSETS_BUCKET, key))) {
          throw refused(`Nothing was uploaded to ${field} ${key}.`, field);
        }
      }

      const stored = await storage.stat(
        PROJECT_ASSETS_BUCKET,
        render.file_path,
      );
      const reason = !stored
        ? `No file was uploaded to ${render.file_path}`
        : stored.size !== render.file_size_bytes
          ? `The stored file is ${stored.size} bytes; the upload was signed for ${render.file_size_bytes}`
          : null;

      if (reason) {
        await failRender(client, render.id, reason);

        throw new McpToolError(
          'VALIDATION_FAILED',
          `${reason}. The render is failed; request a new upload.`,
          {
            details: { renderId: render.id, status: 'failed', reason },
          },
        );
      }

      const url = (key: string | undefined) =>
        key ? storage.getPublicUrl(PROJECT_ASSETS_BUCKET, key) : null;

      const { data: updated, error: updateError } = await client
        .from('episode_renders')
        .update({
          status: 'ready',
          file_url: url(render.file_path),
          file_size_bytes: stored!.size,
          duration_seconds: input.durationSeconds,
          qa: input.qa,
          thumbnail_url: url(thumbnailKey),
          captions_url: url(captionsKey),
        })
        // RLS admits the update only while the render is uploading in an
        // open session of the caller's
        .eq('id', render.id)
        .select(
          'id, status, created_by, file_path, file_size_bytes, file_url, duration_seconds, preset, language',
        )
        .maybeSingle();

      if (updateError) {
        throw new McpToolError('INTERNAL', 'Could not finalize the render.');
      }

      if (!updated) {
        throw new McpToolError(
          'VALIDATION_FAILED',
          'The render can no longer be finalized: its edit session is not open.',
          { details: { renderId: render.id } },
        );
      }

      return finalized({ ...render, ...updated }, input.qa.pass);
    },
  });
}

function finalized(
  render: Pick<
    RenderRow,
    | 'id'
    | 'preset'
    | 'language'
    | 'file_url'
    | 'file_size_bytes'
    | 'duration_seconds'
  >,
  qaPass?: boolean,
) {
  return {
    text: `Render ${render.id} (${render.preset}, ${render.language}) is ready${qaPass === false ? ', with QA issues' : ''}.`,
    structuredContent: {
      renderId: render.id,
      status: 'ready',
      preset: render.preset,
      language: render.language,
      fileUrl: render.file_url,
      bytes: render.file_size_bytes,
      durationSeconds:
        render.duration_seconds === null
          ? null
          : Number(render.duration_seconds),
    },
  };
}

/** The refusal deliver_edit returned, as the error contract. */
function deliveryRefusal(
  result: Exclude<DeliverEditResult, { ok: true }>,
): McpToolError {
  switch (result.code) {
    case 'NOT_FOUND':
      return new McpToolError(
        'NOT_FOUND',
        'No edit session with this id in your team.',
      );
    case 'FORBIDDEN':
      return new McpToolError(
        'FORBIDDEN',
        result.reason === 'published'
          ? 'This episode is published. Only a project owner or admin may deliver a new cut over it.'
          : result.reason === 'session'
            ? 'This edit session belongs to another user; only they can deliver it.'
            : 'A project viewer cannot deliver an edit.',
        { details: { ...result } },
      );
    case 'TARGET_CHANGED':
      return new McpToolError(
        'TARGET_CHANGED',
        `The episode changed in StoryBook during the edit (now version ${result.currentVersion}; this cut was made against ${result.expectedVersion}). Re-sync the edit package, then deliver again; finalized renders can be listed again.`,
        {
          details: {
            currentVersion: result.currentVersion,
            expectedVersion: result.expectedVersion,
            // FILM-2001's package etag, once get_edit_package lands
            etag: null,
          },
        },
      );
    case 'VALIDATION_FAILED': {
      const message =
        result.reason === 'not_ready'
          ? 'Every listed render must be one of yours for this episode, finalized and ready.'
          : result.reason === 'primary'
            ? 'Exactly one render must be primary.'
            : result.reason === 'session'
              ? `This edit session is ${result.status}.`
              : 'The delivery was refused.';

      return new McpToolError('VALIDATION_FAILED', message, {
        details: { ...result },
      });
    }
  }
}

export const deliverEditTool = defineTool({
  name: 'deliver_edit',
  title: 'Deliver the edit',
  description:
    "Sends the finished edit back: takes the open edit session, the episode version the Studio edited (episodeVersion from open_edit_session), the renders (ids from request_render_upload, each finalized and ready, exactly one primary), the explain-why report ({versions[], finalDuration, aiOps, userOps, explain{scenes[]}}) and the delivery's QA result. In one step the primary render becomes the episode's video (final_video_url and the master video asset) and its language's publish target, the episode's older renders are superseded, the session is closed as delivered with the report, and the episode moves to ready for the publish flow; nothing is published. TARGET_CHANGED when the episode changed in StoryBook during the edit: re-sync and deliver again. A project viewer cannot deliver; over a published episode only a project owner or admin can.",
  inputSchema: DeliveryPackageObjectSchema.shape,
  scope: 'studio:write',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(rawInput, context) {
    const delivery = parseWith(DeliveryPackageSchema, rawInput);
    const client = context.principal.supabase;

    // the bound team first: a session elsewhere is NOT_FOUND
    await requireSession(client, context.accountId, delivery.sessionId);

    let result: DeliverEditResult;

    try {
      result = await deliverEdit(client, delivery);
    } catch {
      throw new McpToolError('INTERNAL', 'Could not deliver the edit.');
    }

    if (!result.ok) {
      throw deliveryRefusal(result);
    }

    return {
      text: `Delivered: the episode is ready (version ${result.episodeVersion}) with render ${result.primaryRenderId} as its video; ${result.superseded} older render(s) superseded.`,
      structuredContent: { ...result },
    };
  },
});

export function createStudioRenderTools(
  deps: RenderToolDeps = defaultRenderToolDeps,
): McpToolDefinition[] {
  return [
    createRequestRenderUploadTool(deps),
    createFinalizeRenderTool(deps),
    deliverEditTool,
  ] as unknown as McpToolDefinition[];
}

export const studioRenderTools = createStudioRenderTools();
