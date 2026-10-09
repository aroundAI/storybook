import { deriveStageViews } from '@kit/episodes/lib/stage-state';
import { EpisodeStatusSchema } from '@kit/episodes/schemas';

/**
 * The studio's stages, in the order the episode workspace shows them, with
 * what each one needs. The same list drives `get_episode`'s stage status
 * and `get_workflow_guide` (FILM-1905).
 */
export const STAGE_ORDER = [
  {
    key: 'ideation',
    label: 'Ideation',
    needs:
      'A project and an episode with a title. Ideas are discussed, not stored: nothing is written until the story stage.',
  },
  {
    key: 'story',
    label: 'Story',
    needs:
      'The episode title, logline (description), target duration and content style, plus the project genre, audience and style, and the project characters and locations. Writes story_data.',
  },
  {
    key: 'screenplay',
    label: 'Screenplay',
    needs:
      'Generating it reads story_data. Writes screenplay_data: scenes with heading, location, time of day, description and dialogue. Or import a finished script instead of a story.',
  },
  {
    key: 'shots',
    label: 'Shot list',
    needs:
      'Generating it reads screenplay_data and the project characters and locations. Writes shots and dialogue_lines, scene by scene.',
  },
  {
    key: 'audio',
    label: 'Audio',
    needs:
      'Generating it reads shots and dialogue_lines. Writes audio_cues and queues voice, music and SFX renders (studio:render).',
  },
  {
    key: 'video',
    label: 'Video',
    needs:
      'A finished video: delivered from StorybookStudio, uploaded with request_episode_video_upload and finalize_episode_video, or uploaded on the web. Never generated here, and needs no earlier stage.',
  },
  {
    key: 'publish',
    label: 'Publish',
    needs:
      'A video, or a video already on a platform (link_published_video). Publishing to a platform stays a web action; publishReadiness says what it will have.',
  },
] as const;

export type StageKey = (typeof STAGE_ORDER)[number]['key'];

/** `episodes.status`, in workflow order (the database CHECK and the web share it). */
export const EPISODE_STATUS_ORDER = EpisodeStatusSchema.options;

/** FILM-2204: no stage is locked; a generator names the inputs it lacks */
export type StageState = 'done' | 'empty' | 'skipped';

export interface StageStatus {
  key: StageKey;
  label: string;
  state: StageState;
  /** The stage's generator has every input it reads (false for video, which is never generated) */
  canGenerate: boolean;
  /** The stages it still needs, in order */
  missing: StageKey[];
  /** From episodes.generation_origin, keyed by FILM-1903's stage keys; null until a commit stamps the stage. */
  origin: Record<string, unknown> | null;
}

export interface StageInputs {
  status: string;
  storyData: unknown;
  screenplayData: unknown;
  shotList: unknown;
  finalVideoUrl: string | null;
  shotCount: number;
  dialogueLineCount: number;
  audioCueCount: number;
  localizedVideoCount?: number;
  externalPublishCount?: number;
  skippedStages?: readonly string[];
  origin: Record<string, unknown> | null;
}

/**
 * Each studio stage as done, empty or skipped, with what its generator
 * still needs: deriveStageViews from @kit/episodes, the rule the web
 * workspace reads (FILM-2201), with the stage's recorded origin.
 */
export function deriveStages(input: StageInputs): StageStatus[] {
  const views = new Map(
    deriveStageViews({
      status: input.status,
      storyData: input.storyData,
      screenplayData: input.screenplayData,
      shotList: input.shotList,
      shotCount: input.shotCount,
      audioCueCount: input.audioCueCount,
      finalVideoUrl: input.finalVideoUrl,
      localizedVideoCount: input.localizedVideoCount,
      externalPublishCount: input.externalPublishCount,
      skippedStages: input.skippedStages,
    }).map((view) => [view.key, view]),
  );

  return STAGE_ORDER.map((stage) => {
    const view = views.get(stage.key)!;

    return {
      key: stage.key,
      label: stage.label,
      state: view.state,
      canGenerate: view.canGenerate,
      missing: view.missing,
      origin: originOf(input.origin, stage.key),
    };
  });
}

/**
 * `episodes.generation_origin` is keyed by FILM-1903's stage keys
 * (`StageKeySchema` in @kit/generation); the studio stage reads the first
 * key present, a refinement counting as the stage it refined.
 */
const ORIGIN_KEYS: Record<StageKey, readonly string[]> = {
  ideation: ['ideation'],
  story: ['story', 'story_refinement'],
  screenplay: ['screenplay', 'screenplay_refinement'],
  shots: ['shots'],
  audio: ['audio_cues'],
  video: [],
  publish: ['publish_metadata'],
};

function originOf(
  origin: Record<string, unknown> | null,
  key: StageKey,
): Record<string, unknown> | null {
  for (const originKey of ORIGIN_KEYS[key]) {
    const value = origin?.[originKey];

    if (value && typeof value === 'object') {
      return value as Record<string, unknown>;
    }
  }

  return null;
}
