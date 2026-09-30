import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildMemoryContext = vi.fn();
vi.mock('@kit/episodes/lib/canon/memory-context-builder', () => ({
  buildMemoryContext: (...args: unknown[]) => buildMemoryContext(...args),
}));

import { runValidationCheckpoint } from '../utils/validation-checkpoint';

const canonWithDeadMara = {
  projectId: 'p',
  episodeNumber: 4,
  immutableEvents: [
    {
      id: 'ev1',
      eventType: 'death',
      eventKey: 'character:mara:dead',
      description: 'Mara died in episode 3',
    },
  ],
  characterStates: [],
  activeThreads: [],
  recentSummaries: [],
  sources: [],
  metadata: { projectType: 'series' },
};

const marasScene = {
  premise: 'x',
  episodeNumber: 4,
  characters: [{ characterId: 'c1', name: 'Mara', role: 'lead' }],
  scenes: [{ sceneNumber: 1, summary: 'x', charactersPresent: ['c1'] }],
};

function fakeSupabase(insert = vi.fn(async () => ({ error: null }))) {
  const from = vi.fn(() => ({ insert }));
  return { client: { from } as never, from, insert };
}

describe('runValidationCheckpoint writes validation_runs (FILM-1003)', () => {
  beforeEach(() => {
    buildMemoryContext.mockReset();
    buildMemoryContext.mockResolvedValue(canonWithDeadMara);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('logs one row for a flexible run that found a violation', async () => {
    const { client, from, insert } = fakeSupabase();

    const result = await runValidationCheckpoint(
      {
        checkpoint: 'STORY',
        enforcement: 'flexible',
        projectId: 'p',
        episodeNumber: 4,
        supabase: client,
      },
      { plotSkeleton: marasScene },
    );

    expect(result.passed).toBe(true);
    expect(from).toHaveBeenCalledWith('validation_runs');
    expect(insert).toHaveBeenCalledTimes(1);
    const row = (insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      project_id: 'p',
      episode_number: 4,
      checkpoint: 'STORY',
      enforcement: 'flexible',
      passed: true,
      summary: { errors: 1 },
    });
    expect(row.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'CANON_001', severity: 'error' }),
      ]),
    );
  });

  it('logs the failing strict run before it throws', async () => {
    const { client, insert } = fakeSupabase();

    await expect(
      runValidationCheckpoint(
        {
          checkpoint: 'STORY',
          enforcement: 'strict',
          projectId: 'p',
          episodeNumber: 4,
          supabase: client,
        },
        { plotSkeleton: marasScene },
      ),
    ).rejects.toThrow('Canon validation failed at STORY');

    expect(insert).toHaveBeenCalledTimes(1);
    expect((insert.mock.calls[0] as unknown[])[0]).toMatchObject({
      passed: false,
      enforcement: 'strict',
    });
  });

  it('continues when the row cannot be written', async () => {
    const { client } = fakeSupabase(
      vi.fn(async () => ({ error: { message: 'boom' } })) as never,
    );

    const result = await runValidationCheckpoint(
      {
        checkpoint: 'SCREENPLAY',
        enforcement: 'flexible',
        projectId: 'p',
        episodeNumber: 4,
        supabase: client,
      },
      { sceneBlocks: [{ sceneNumber: 1, content: 'a quiet room' }] },
    );

    expect(result.canonAvailable).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      '[Validation Checkpoint] Could not log the run:',
      { message: 'boom' },
    );
  });

  it('continues when the insert throws', async () => {
    const { client } = fakeSupabase(
      vi.fn(async () => {
        throw new Error('network');
      }) as never,
    );

    const result = await runValidationCheckpoint(
      {
        checkpoint: 'STORY',
        enforcement: 'flexible',
        projectId: 'p',
        episodeNumber: 4,
        supabase: client,
      },
      { plotSkeleton: marasScene },
    );

    expect(result.canonAvailable).toBe(true);
  });

  it('logs nothing when there is no content for the checkpoint', async () => {
    const { client, insert } = fakeSupabase();

    await runValidationCheckpoint(
      {
        checkpoint: 'STORY',
        enforcement: 'flexible',
        projectId: 'p',
        episodeNumber: 4,
        supabase: client,
      },
      {},
    );

    expect(insert).not.toHaveBeenCalled();
  });
});
