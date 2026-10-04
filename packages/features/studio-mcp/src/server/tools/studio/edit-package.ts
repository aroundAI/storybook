import 'server-only';

import { z } from 'zod';

import { getEditPackage } from '@kit/desktop-integration/server';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';

/**
 * FILM-2001: one call hands StorybookStudio an episode to edit. Reads run
 * with the principal's RLS client only (no service role under `tools/`);
 * the media URLs are signed for keys that came out of those rows and lie
 * in the episode's own project. The result is the package itself, and its
 * text is a summary: the signed URLs never go into a log line, an error
 * message or the `mcp_tool_calls` row (which holds no result at all).
 */
export const getEditPackageTool = defineTool({
  name: 'get_edit_package',
  title: 'Get edit package',
  description:
    'Everything StorybookStudio needs to open one episode as a rough cut, validated by EditPackageSchema (storybook-edit-package/1): scenes, shots with timing, trims, transitions and frames, dialogue with audio, music/SFX/ambience, captions by language, characters with reference images, shorts candidates, dubbed lines, retention hints, brand and edit policy. Every media entry is a presigned GET valid for 1 hour with its size and MIME type (and SHA-256 where StoryBook recorded one), or `url: null` with a `mediaReason`. Pass the `etag` of a package you hold as `ifNoneMatch` to get `{unchanged: true, etag}` instead.',
  inputSchema: {
    episodeId: z
      .string()
      .uuid()
      .describe('The episode id (from list_episodes).'),
    ifNoneMatch: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The etag of the package you already have.'),
  },
  scope: 'studio:read',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, context) {
    let result: Awaited<ReturnType<typeof getEditPackage>>;

    try {
      result = await getEditPackage(context.principal.supabase, {
        accountId: context.accountId,
        episodeId: input.episodeId,
        ifNoneMatch: input.ifNoneMatch ?? null,
      });
    } catch {
      // Not rethrown: the route logs an INTERNAL error's cause, and a
      // failure past the reads (a package that fails its own schema) could
      // carry a signed URL in its message.
      throw new McpToolError(
        'INTERNAL',
        'Could not build the edit package. Try again; if it keeps failing, report the request id.',
      );
    }

    if (result.status === 'not_found') {
      throw new McpToolError(
        'NOT_FOUND',
        'No episode with this id in your team (deleted episodes are not visible).',
        { details: { episodeId: input.episodeId } },
      );
    }

    if (result.status === 'unchanged') {
      return {
        text: `Unchanged since ${result.etag}.`,
        structuredContent: { unchanged: true, etag: result.etag },
      };
    }

    const { editPackage } = result;
    const media = [
      ...editPackage.shots.flatMap((s) => [s.video, s.firstFrame, s.lastFrame]),
      ...editPackage.dialogue.map((d) => d.audio),
      ...editPackage.audioTracks.map((t) => t.media),
      ...editPackage.characters.flatMap((c) => c.referenceImages),
      ...editPackage.dubbed.flatMap((d) => d.lines.map((l) => l.audio)),
    ];
    const signed = media.filter((entry) => entry.url !== null).length;

    return {
      text: `Edit package for episode #${editPackage.episode.number} "${editPackage.episode.title}" (${editPackage.etag}): ${editPackage.shots.length} shots, ${editPackage.dialogue.length} dialogue lines, ${editPackage.audioTracks.length} audio tracks, ${editPackage.captions.length} caption tracks, ${editPackage.dubbed.length} dubbed languages; ${signed} of ${media.length} media signed until ${editPackage.urlsExpireAt}.`,
      structuredContent: editPackage as unknown as Record<string, unknown>,
    };
  },
});
