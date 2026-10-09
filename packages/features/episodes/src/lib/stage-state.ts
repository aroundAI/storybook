/**
 * What each studio stage of an episode holds, and whether its generator has
 * what it reads (FILM-2201). The one copy of the rule: the web workspace and
 * the MCP `get_episode` both read it, so they cannot disagree.
 *
 * A stage is never locked. It is done, empty, or skipped by the user; a
 * generator whose inputs are missing says which, and the action refuses.
 * Pure: safe on the client and the server.
 */
export const STAGE_KEYS = [
  'ideation',
  'story',
  'screenplay',
  'shots',
  'audio',
  'video',
  'publish',
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

/** The stages a user can mark skipped (`episodes.skipped_stages`). */
export const SKIPPABLE_STAGES = [
  'ideation',
  'story',
  'screenplay',
  'shots',
  'audio',
] as const satisfies readonly StageKey[];

export type SkippableStage = (typeof SKIPPABLE_STAGES)[number];

export type StageState = 'done' | 'empty' | 'skipped';

export interface StageView {
  key: StageKey;
  state: StageState;
  /**
   * The stage's generator has every input it reads. False for `video`,
   * which is rendered in StorybookStudio or uploaded, never generated here.
   */
  canGenerate: boolean;
  /** The stages whose output the generator (or, for publish, the publish) still needs. */
  missing: StageKey[];
}

export interface StageInputs {
  status: string;
  storyData: unknown;
  screenplayData: unknown;
  shotList: unknown;
  shotCount: number;
  audioCueCount: number;
  finalVideoUrl: string | null;
  /** Ready `episode_renders` rows. */
  readyRenderCount?: number;
  /** Entries in `episodes.localized_videos`. */
  localizedVideoCount?: number;
  /** Publishes recorded for a video uploaded outside StoryBook. */
  externalPublishCount?: number;
  skippedStages?: readonly string[];
}

const present = (value: unknown) => value !== null && value !== undefined;

/** The episode has a video a publish can send: a render, a final or localized video. */
export function hasVideo(input: StageInputs) {
  return (
    (input.readyRenderCount ?? 0) > 0 ||
    present(input.finalVideoUrl) ||
    (input.localizedVideoCount ?? 0) > 0
  );
}

/** Publish has something to work with: a video, or a publish already made elsewhere. */
export function canPublish(input: StageInputs) {
  return hasVideo(input) || (input.externalPublishCount ?? 0) > 0;
}

export function deriveStageViews(input: StageInputs): StageView[] {
  const has: Record<StageKey, boolean> = {
    ideation: false,
    story: present(input.storyData),
    screenplay: present(input.screenplayData),
    shots: input.shotCount > 0 || present(input.shotList),
    audio: input.audioCueCount > 0,
    video: hasVideo(input),
    publish:
      input.status === 'published' || (input.externalPublishCount ?? 0) > 0,
  };

  const needs: Record<StageKey, StageKey[]> = {
    ideation: [],
    story: [],
    screenplay: ['story'],
    shots: ['screenplay'],
    audio: ['shots'],
    video: [],
    publish: canPublish(input) ? [] : ['video'],
  };

  const skipped = new Set(input.skippedStages ?? []);

  return STAGE_KEYS.map((key) => {
    const missing = needs[key].filter((need) => !has[need]);
    const state: StageState = has[key]
      ? 'done'
      : skipped.has(key)
        ? 'skipped'
        : 'empty';

    return {
      key,
      state,
      canGenerate: key !== 'video' && missing.length === 0,
      missing,
    };
  });
}
