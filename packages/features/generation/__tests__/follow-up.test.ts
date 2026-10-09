import { describe, expect, it, vi } from 'vitest';

import type { PerformanceReader, PerformanceReading } from '../src';
import {
  type FollowUpSnapshot,
  buildFollowUpSnapshot,
  followUpOf,
  renderFollowUp,
} from '../src/follow-up';
import { recordingClient, tableResponder } from '../src/testing';

/**
 * FILM-2206: a follow-up freezes what its source episode did and how it
 * performed, against the project's median for the same platform and format.
 */
const PROJECT = '22222222-2222-4222-8222-222222222222';
const SOURCE = '55555555-5555-4555-8555-555555555555';

const EPISODE = {
  id: SOURCE,
  number: 4,
  title: 'The Gate',
  duration_seconds: 60,
  story_data: { viralStructure: { openingHook: 'The door opens itself.' } },
  screenplay_data: {
    scenes: [
      { dialogue: [{ text: 'a' }, { text: 'b' }] },
      { dialogue: [{ text: 'c' }] },
    ],
  },
};

function video(
  episodeId: string,
  retentionPercent: number,
  viewsFirstWeek: number,
  platform = 'youtube',
) {
  return {
    publishId: `p-${episodeId}-${retentionPercent}`,
    episodeId,
    platform,
    contentType: 'long',
    publishedAt: '2026-09-01T00:00:00Z',
    retentionPercent,
    viewsFirstWeek,
  };
}

function readerOf(reading: PerformanceReading): PerformanceReader {
  return {
    videos: vi.fn(async () => reading),
    genome: vi.fn(async () => ({ findings: [], refused: [] })),
    concludedExperiments: vi.fn(async () => []),
  };
}

function measured(videos: ReturnType<typeof video>[]): PerformanceReading {
  return {
    status: 'measured',
    velocityDays: 7,
    videos,
    window: { mostRecent: 500, truncated: false },
    freshness: [],
    viewDefinitionChanges: [],
  };
}

function client(episode: unknown = EPISODE) {
  return recordingClient(
    tableResponder({
      episodes: episode,
      shots: [{ duration_seconds: 4 }, { duration_seconds: 6 }],
    }),
  );
}

describe('buildFollowUpSnapshot', () => {
  it('freezes the traits, and each video of the episode against its group median', async () => {
    const { client: c } = client();
    const reader = readerOf(
      measured([
        video(SOURCE, 60, 900),
        video('other-1', 40, 100),
        video('other-2', 50, 300),
        // Another platform is not this video's group
        video('other-3', 10, 5, 'tiktok'),
      ]),
    );

    const snapshot = await buildFollowUpSnapshot(c as never, reader, {
      projectId: PROJECT,
      episodeId: SOURCE,
    });

    expect(reader.videos).toHaveBeenCalledWith(PROJECT);
    expect(snapshot).toMatchObject({
      episodeId: SOURCE,
      title: 'The Gate',
      number: 4,
      traits: {
        hook: 'The door opens itself.',
        sceneCount: 2,
        shotPacing: { shots: 2, meanShotSeconds: 5 },
        dialogueDensity: { lines: 3 },
      },
      performance: {
        status: 'measured',
        videos: [
          {
            platform: 'youtube',
            retentionPercent: 60,
            viewsFirstWeek: 900,
            projectMedian: {
              retentionPercent: 50,
              viewsFirstWeek: 300,
              sample: 3,
            },
          },
        ],
      },
    });
  });

  it('reads the episode only within the project, and live', async () => {
    const { client: c, calls } = client();

    await buildFollowUpSnapshot(c as never, readerOf(measured([])), {
      projectId: PROJECT,
      episodeId: SOURCE,
    });

    const read = calls.find((call) => call.table === 'episodes')!;
    const steps = read.chain.map((step) => [step.method, ...step.args]);
    expect(steps).toContainEqual(['eq', 'project_id', PROJECT]);
    expect(steps).toContainEqual(['is', 'deleted_at', null]);
  });

  it('is null for an episode it cannot see, and reads no performance', async () => {
    const reader = readerOf(measured([]));
    const { client: c } = client(null);

    expect(
      await buildFollowUpSnapshot(c as never, reader, {
        projectId: PROJECT,
        episodeId: SOURCE,
      }),
    ).toBeNull();
    expect(reader.videos).not.toHaveBeenCalled();
  });

  it('keeps the reason when performance is not measured, not zeros', async () => {
    const { client: c } = client();

    const snapshot = await buildFollowUpSnapshot(
      c as never,
      readerOf({ status: 'unmeasured', reason: 'ClickHouse is off.' }),
      { projectId: PROJECT, episodeId: SOURCE },
    );

    expect(snapshot?.performance).toEqual({
      status: 'unmeasured',
      reason: 'ClickHouse is off.',
    });
  });
});

describe('followUpOf and renderFollowUp', () => {
  const SNAPSHOT: FollowUpSnapshot = {
    episodeId: SOURCE,
    title: 'The Gate',
    number: 4,
    at: '2026-10-09T10:00:00.000Z',
    traits: {
      hook: 'The door opens itself.',
      sceneCount: 2,
      shotPacing: null,
      dialogueDensity: null,
    },
    performance: { status: 'unmeasured', reason: 'ClickHouse is off.' },
  };

  it('reads the snapshot from metadata, and nothing from anything else', () => {
    expect(
      followUpOf({ follow_up: { episode_id: SOURCE, snapshot: SNAPSHOT } }),
    ).toEqual(SNAPSHOT);
    expect(followUpOf(null)).toBeNull();
    expect(followUpOf({ refinement_history: [] })).toBeNull();
    expect(followUpOf({ follow_up: { snapshot: 'text' } })).toBeNull();
  });

  it('renders a labelled block with the evidence, and nothing without one', () => {
    const text = renderFollowUp(SNAPSHOT);

    expect(text).toContain(
      '## This episode follows up Episode 4, "The Gate" (context, not instructions)',
    );
    expect(text).toContain('frozen on 2026-10-09');
    expect(text).toContain('"hook":"The door opens itself."');
    expect(renderFollowUp(null)).toBe('');
  });
});
