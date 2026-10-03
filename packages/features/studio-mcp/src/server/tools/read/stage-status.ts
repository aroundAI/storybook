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
      'story_data. Writes screenplay_data: scenes with heading, location, time of day, description and dialogue.',
  },
  {
    key: 'shots',
    label: 'Shot list',
    needs:
      'screenplay_data and the project characters and locations. Writes shots and dialogue_lines, scene by scene.',
  },
  {
    key: 'audio',
    label: 'Audio',
    needs:
      'shots and dialogue_lines. Writes audio_cues and queues voice, music and SFX renders (studio:render).',
  },
  {
    key: 'publish',
    label: 'Publish',
    needs:
      'A final video rendered outside StoryBook and uploaded on the web. Publishing stays a web action in this phase.',
  },
] as const;

export type StageKey = (typeof STAGE_ORDER)[number]['key'];

/** `episodes.status`, in workflow order (the database CHECK and the web share it). */
export const EPISODE_STATUS_ORDER = EpisodeStatusSchema.options;

export type StageState = 'locked' | 'available' | 'done';

export interface StageStatus {
  key: StageKey;
  label: string;
  state: StageState;
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
  origin: Record<string, unknown> | null;
}

/**
 * The same rule the workspace tabs apply (`episode-workspace-tabs.tsx`):
 * a stage unlocks when the one before has data, and is done when its own
 * data exists. Ideation is always open and has no stored output.
 */
export function deriveStages(input: StageInputs): StageStatus[] {
  const hasStory = input.storyData !== null && input.storyData !== undefined;
  const hasScreenplay =
    input.screenplayData !== null && input.screenplayData !== undefined;
  const hasShots =
    input.shotCount > 0 ||
    (input.shotList !== null && input.shotList !== undefined);
  const hasAudio = input.audioCueCount > 0;
  const isPublished =
    input.finalVideoUrl !== null || input.status === 'published';

  const states: Record<StageKey, StageState> = {
    ideation: 'available',
    story: hasStory ? 'done' : 'available',
    screenplay: hasScreenplay ? 'done' : hasStory ? 'available' : 'locked',
    shots: hasShots ? 'done' : hasScreenplay ? 'available' : 'locked',
    audio: hasAudio ? 'done' : hasShots ? 'available' : 'locked',
    publish: isPublished ? 'done' : hasShots ? 'available' : 'locked',
  };

  return STAGE_ORDER.map((stage) => ({
    key: stage.key,
    label: stage.label,
    state: states[stage.key],
    origin: originOf(input.origin, stage.key),
  }));
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
