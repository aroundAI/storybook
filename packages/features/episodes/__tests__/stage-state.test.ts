import { describe, expect, it } from 'vitest';

import {
  STAGE_KEYS,
  type StageInputs,
  canPublish,
  deriveStageViews,
} from '../src/lib/stage-state';

/**
 * FILM-2201: one rule for what a stage holds and what its generator needs,
 * read by the web workspace and the MCP get_episode. No stage is locked.
 */
const empty: StageInputs = {
  status: 'draft',
  storyData: null,
  screenplayData: null,
  shotList: null,
  shotCount: 0,
  audioCueCount: 0,
  finalVideoUrl: null,
};

const byKey = (input: StageInputs) =>
  Object.fromEntries(deriveStageViews(input).map((view) => [view.key, view]));

describe('deriveStageViews', () => {
  it('lists every stage, in workspace order', () => {
    expect(deriveStageViews(empty).map((view) => view.key)).toEqual([
      ...STAGE_KEYS,
    ]);
  });

  it('leaves a new episode empty everywhere, never locked', () => {
    const views = deriveStageViews(empty);

    expect(views.map((view) => view.state)).toEqual(
      STAGE_KEYS.map(() => 'empty'),
    );
    expect(byKey(empty).screenplay).toMatchObject({
      canGenerate: false,
      missing: ['story'],
    });
    expect(byKey(empty).story).toMatchObject({
      canGenerate: true,
      missing: [],
    });
    expect(byKey(empty).publish).toMatchObject({
      canGenerate: false,
      missing: ['video'],
    });
  });

  it('marks each stage done from its own output', () => {
    const views = byKey({
      ...empty,
      storyData: { logline: 'x' },
      screenplayData: { scenes: [] },
      shotCount: 4,
      audioCueCount: 2,
      finalVideoUrl: 'https://cdn/final.mp4',
      status: 'published',
    });

    for (const key of STAGE_KEYS.filter((k) => k !== 'ideation')) {
      expect(views[key]?.state, key).toBe('done');
    }
    // Ideas are discussed, not stored: ideation has no output to be done with
    expect(views.ideation?.state).toBe('empty');
  });

  it('counts a shot_list without shot rows as shots', () => {
    expect(byKey({ ...empty, shotList: [] }).shots?.state).toBe('done');
  });

  it('lets a generator run once the stage it reads has output, skipped or not', () => {
    const views = byKey({
      ...empty,
      screenplayData: { scenes: [] },
      skippedStages: ['ideation', 'story'],
    });

    expect(views.ideation?.state).toBe('skipped');
    expect(views.story?.state).toBe('skipped');
    expect(views.shots).toMatchObject({
      state: 'empty',
      canGenerate: true,
      missing: [],
    });
  });

  it('shows a skipped stage as done once it has output', () => {
    const views = byKey({
      ...empty,
      storyData: { logline: 'x' },
      skippedStages: ['story'],
    });

    expect(views.story?.state).toBe('done');
  });

  it('never offers to generate the video stage', () => {
    const views = byKey({ ...empty, shotCount: 3, audioCueCount: 3 });

    expect(views.video).toMatchObject({
      state: 'empty',
      canGenerate: false,
      missing: [],
    });
  });

  it('opens publish with a video and nothing before it', () => {
    const views = byKey({ ...empty, readyRenderCount: 1 });

    expect(views.video?.state).toBe('done');
    expect(views.publish).toMatchObject({
      state: 'empty',
      canGenerate: true,
      missing: [],
    });
  });

  it('counts a publish made elsewhere as publish done', () => {
    const views = byKey({ ...empty, externalPublishCount: 1 });

    expect(views.publish).toMatchObject({ state: 'done', canGenerate: true });
  });
});

describe('canPublish', () => {
  it.each([
    ['no video', {}, false],
    ['shots but no video', { shotCount: 5 }, false],
    ['a ready render', { readyRenderCount: 1 }, true],
    ['a final video', { finalVideoUrl: 'https://cdn/v.mp4' }, true],
    ['a localized video', { localizedVideoCount: 1 }, true],
    ['an external publish', { externalPublishCount: 1 }, true],
  ] as const)('%s → %s', (_, patch, expected) => {
    expect(canPublish({ ...empty, ...patch })).toBe(expected);
  });
});
