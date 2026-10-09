import 'server-only';

import {
  type StageKey as StudioStageKey,
  deriveStageViews,
} from '@kit/episodes/lib/stage-state';

import { McpToolError } from '../../../errors';
import type { McpPrincipal } from '../../../principal';

type Client = McpPrincipal['supabase'];

/** The generation stages that read an earlier studio stage, by the studio stage they write. */
const STUDIO_STAGE: Partial<Record<string, StudioStageKey>> = {
  screenplay: 'screenplay',
  shots: 'shots',
  audio_cues: 'audio',
};

/**
 * FILM-2204: no stage is locked, so a generator checks its own inputs. A run
 * whose stage reads output the episode does not have is refused with
 * MISSING_INPUTS naming those stages, before anything is opened. The rule is
 * deriveStageViews, the one the web workspace reads.
 */
export async function refuseMissingInputs(
  client: Client,
  generationStage: string,
  episodeId: string | undefined,
) {
  const studioStage = STUDIO_STAGE[generationStage];

  if (!studioStage || !episodeId) return;

  const [episode, shots, cues] = await Promise.all([
    client
      .from('episodes')
      .select(
        'status, story_data, screenplay_data, shot_list, final_video_url, skipped_stages',
      )
      .eq('id', episodeId)
      .is('deleted_at', null)
      .maybeSingle(),
    client
      .from('shots')
      .select('id', { count: 'exact', head: true })
      .eq('episode_id', episodeId)
      .is('deleted_at', null),
    client
      .from('audio_cues')
      .select('id', { count: 'exact', head: true })
      .eq('episode_id', episodeId),
  ]);

  // An unreadable episode is the target resolver's to report
  if (episode.error || !episode.data || shots.error || cues.error) return;

  const view = deriveStageViews({
    status: episode.data.status,
    storyData: episode.data.story_data,
    screenplayData: episode.data.screenplay_data,
    shotList: episode.data.shot_list,
    shotCount: shots.count ?? 0,
    audioCueCount: cues.count ?? 0,
    finalVideoUrl: episode.data.final_video_url,
    skippedStages: episode.data.skipped_stages,
  }).find((candidate) => candidate.key === studioStage);

  if (view && !view.canGenerate) {
    throw new McpToolError(
      'MISSING_INPUTS',
      `The ${generationStage} stage reads the ${view.missing.join(' and ')}, which this episode does not have yet. Generate or write ${view.missing.length === 1 ? 'it' : 'them'} first, or start from what you have (a script or a finished video).`,
      { details: { stage: generationStage, missing: view.missing } },
    );
  }
}
