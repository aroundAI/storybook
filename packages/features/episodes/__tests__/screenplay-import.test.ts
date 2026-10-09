import { describe, expect, it } from 'vitest';

import { OptimisticLockError } from '../src/lib/status-workflow';
import { importScreenplay } from '../src/server/screenplay-import.service';

/**
 * FILM-2205: a finished script stored as the screenplay, in one write, in
 * the shape the screenplay stage commits.
 */
const SCRIPT = `INT. LIGHTHOUSE - NIGHT

Rain on the glass.

MARA
The tide is turning.
`;

function fakeClient(episode: Record<string, unknown> | null, updated = true) {
  const writes: Array<Record<string, unknown>> = [];
  const read = {
    eq: () => read,
    is: () => read,
    maybeSingle: async () => ({ data: episode, error: null }),
  };
  const client = {
    from: () => ({
      select: () => read,
      update: (row: Record<string, unknown>) => {
        writes.push(row);
        const chain = {
          eq: () => chain,
          is: () => chain,
          select: () => chain,
          maybeSingle: async () => ({
            data: updated ? { id: 'e', version: 4, status: row.status } : null,
            error: null,
          }),
        };
        return chain;
      },
    }),
  };

  return {
    client: client as unknown as Parameters<typeof importScreenplay>[0],
    writes,
  };
}

describe('importScreenplay', () => {
  it('stores the scenes as the stage commits them, moves a draft to storyboard, and stamps the origin', async () => {
    const fake = fakeClient({
      id: 'e',
      status: 'draft',
      version: 3,
      generation_origin: { story: { kind: 'server' } },
    });

    const result = await importScreenplay(fake.client, {
      episodeId: 'e',
      script: SCRIPT,
    });

    expect(result).toEqual({
      ok: true,
      data: { episodeId: 'e', scenes: 1, version: 4, status: 'storyboard' },
    });

    const write = fake.writes[0] as {
      screenplay_data: {
        scenes: Array<{ heading: string }>;
        totalDialogueLines: number;
        metadata: { characters: string[]; locations: string[] };
        generatedBy: { model: string; provider: string };
      };
      status: string;
      generation_origin: Record<string, { kind: string; via?: string }>;
    };

    expect(write.status).toBe('storyboard');
    expect(write.screenplay_data.scenes[0]?.heading).toBe(
      'INT. LIGHTHOUSE - NIGHT',
    );
    expect(write.screenplay_data).toMatchObject({
      totalDialogueLines: 1,
      metadata: { characters: ['MARA'], locations: ['LIGHTHOUSE'] },
      generatedBy: { model: 'import:fountain', provider: 'human' },
    });
    expect(write.generation_origin.story).toEqual({ kind: 'server' });
    expect(write.generation_origin.screenplay).toMatchObject({
      kind: 'human',
      via: 'import',
    });
  });

  it('keeps a status already past storyboard', async () => {
    const fake = fakeClient({
      id: 'e',
      status: 'editing',
      version: 3,
      generation_origin: {},
    });

    await importScreenplay(fake.client, { episodeId: 'e', script: SCRIPT });

    expect(fake.writes[0]).toMatchObject({ status: 'editing' });
  });

  it('refuses a script that reads as no scenes, writing nothing', async () => {
    const fake = fakeClient({ id: 'e', status: 'draft', version: 3 });

    const result = await importScreenplay(fake.client, {
      episodeId: 'e',
      script: '   ',
    });

    expect(result).toEqual({ ok: false, refusal: 'The script is empty.' });
    expect(fake.writes).toHaveLength(0);
  });

  it('refuses a version that moved on before writing', async () => {
    const fake = fakeClient({ id: 'e', status: 'draft', version: 5 });

    await expect(
      importScreenplay(fake.client, {
        episodeId: 'e',
        script: SCRIPT,
        version: 4,
      }),
    ).rejects.toBeInstanceOf(OptimisticLockError);
    expect(fake.writes).toHaveLength(0);
  });
});
