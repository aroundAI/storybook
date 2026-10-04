import 'server-only';

import { z } from 'zod';

import { type AssetRow, mapRowToAsset } from '@kit/assets/types';
import { buildOpenClawManifest } from '@kit/episodes/lib/openclaw-manifest';
import {
  STUDIO_SHOT_COLUMNS,
  type StudioShotRow,
  shotFromRow,
} from '@kit/episodes/lib/shot-row';
import { fetchAllRows } from '@kit/shared/pagination';

import { defineTool } from '../../../registry';
import {
  AfterCursor,
  PAGING_NOTE,
  cursorArg,
  decodeCursor,
  limitArg,
  sceneWindow,
} from '../pagination';
import { type EpisodeRef, requireEpisodeInAccount } from '../read/scope';

type Page<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

/**
 * FILM-1909: the manifest the visual studio's "Export for OpenClaw" builds
 * (packages/features/episodes/src/lib/openclaw-manifest.ts), from the same
 * shot mapping the episode workspace uses, so an external video tool gets
 * the VEO prompts, frame descriptions, transitions and ingredient images
 * the web export carries. Read-only: video is rendered outside the app.
 */
export const getVeoManifestTool = defineTool({
  name: 'get_veo_manifest',
  title: 'Get VEO manifest',
  description: `The episode's video manifest for an external video tool, as the visual studio exports it: every shot in generation order with its VEO 3.1 prompt, first and last frame descriptions, transition (cut or continuation, and which shot's last frame a continuation inherits), frame strategy, location detail and the character and location reference images. The episode totals and summary cover every shot; the shots are ${PAGING_NOTE.charAt(0).toLowerCase()}${PAGING_NOTE.slice(1)} The unit is the scene: one page holds whole scenes.`,
  inputSchema: {
    episodeId: z.string().uuid().describe('The episode id.'),
    cursor: cursorArg,
    limit: limitArg,
  },
  scope: 'studio:read',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, context) {
    const client = context.principal.supabase;
    const episode = await requireEpisodeInAccount<
      EpisodeRef & { title: string }
    >(client, context.accountId, input.episodeId, 'id, title');

    const [shotRows, assetRows] = await Promise.all([
      fetchAllRows<StudioShotRow>(
        (from, to) =>
          client
            .from('shots')
            .select(STUDIO_SHOT_COLUMNS)
            .eq('episode_id', episode.id)
            .is('deleted_at', null)
            .order('sequence_number', { ascending: true })
            .order('id')
            .range(from, to) as unknown as Page<StudioShotRow>,
        'shots',
      ),
      fetchAllRows<AssetRow>(
        (from, to) =>
          client
            .from('assets')
            .select('*')
            .eq('project_id', episode.project.id)
            .in('type', ['character', 'location'])
            .is('deleted_at', null)
            .order('id')
            .range(from, to) as unknown as Page<AssetRow>,
        'assets',
      ),
    ]);

    const assets = assetRows.map(mapRowToAsset);
    const manifest = buildOpenClawManifest(
      {
        id: episode.id,
        title: episode.title,
        projectId: episode.project.id,
        shots: shotRows.map(shotFromRow),
      },
      assets.filter((asset) => asset.type === 'character'),
      assets.filter((asset) => asset.type === 'location'),
    );

    const after = decodeCursor(input.cursor, AfterCursor)?.after;
    const window = sceneWindow(
      manifest.shots.map((shot) => shot.scene),
      after,
      input.limit,
    );
    const inWindow = new Set(window.scenes);
    const shots = manifest.shots.filter((shot) => inWindow.has(shot.scene));

    return {
      text:
        manifest.shots.length === 0
          ? `Episode "${episode.title}" has no shots yet, so there is no manifest.`
          : `${shots.length} of ${manifest.shots.length} shots of "${episode.title}", scenes ${window.scenes[0]}-${window.scenes[window.scenes.length - 1]} of ${window.totalScenes}${window.nextCursor ? ' (more follow)' : ''}: ${manifest.summary.cutsCount} cuts, ${manifest.summary.continuationsCount} continuations.`,
      structuredContent: {
        version: manifest.version,
        generatedAt: manifest.generatedAt,
        episode: manifest.episode,
        summary: manifest.summary,
        shots,
        totalScenes: window.totalScenes,
        nextCursor: window.nextCursor,
        ...(manifest.shots.length === 0
          ? {
              note: 'No shots yet: the shot list stage has not run for this episode.',
            }
          : {}),
      },
    };
  },
});
