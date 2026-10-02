// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  removedOutlineIds,
  useGeneratedOutlines,
} from '../src/components/batch-episode-creator/use-generated-outlines';
import type { EpisodeOutline } from '../src/lib/schemas/batch-episode.schema';

/**
 * FILM-1901 part B: the preview holds outlines whose rows the season_outline
 * commit already created. Removing one, or cancelling the preview, discards
 * the rows the user did not keep; reordering and editing discard nothing;
 * confirming keeps them (the create action updates them).
 */

const PROJECT = '22222222-2222-4222-8222-222222222222';

function outline(id: string, number: number): EpisodeOutline {
  return {
    id,
    number,
    title: `Episode ${number}`,
    premise: 'A premise long enough to pass.',
    mainPlot: 'A main plot long enough to pass the minimum length.',
    arcPosition: 'setup',
  };
}

const A = outline('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1);
const B = outline('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2);
const C = outline('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 3);

describe('removedOutlineIds', () => {
  it('names the ids that were in the preview and are no longer', () => {
    expect(removedOutlineIds([A, B, C], [A, C])).toEqual([B.id]);
  });

  it('names nothing for a reorder, an edit or an outline without a row', () => {
    expect(removedOutlineIds([A, B], [B, A])).toEqual([]);
    expect(removedOutlineIds([A, B], [{ ...A, title: 'Renamed' }, B])).toEqual(
      [],
    );
    expect(removedOutlineIds([{ ...A, id: undefined }, B], [B])).toEqual([]);
  });
});

describe('useGeneratedOutlines', () => {
  function setup() {
    const discard = vi.fn(async () => ({ ok: true as const, data: null }));
    const hook = renderHook(() =>
      useGeneratedOutlines({ projectId: PROJECT, discard }),
    );
    act(() => hook.result.current.show([A, B, C]));
    return { discard, hook };
  }

  it('discards the row of an outline removed in the preview', async () => {
    const { discard, hook } = setup();

    await act(async () => hook.result.current.replace([A, C]));

    expect(hook.result.current.episodes).toEqual([A, C]);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledWith({
      projectId: PROJECT,
      episodeIds: [B.id],
    });
  });

  it('discards nothing for a reorder or an edit', async () => {
    const { discard, hook } = setup();

    await act(async () => hook.result.current.replace([C, B, A]));
    await act(async () =>
      hook.result.current.replace([{ ...C, title: 'Renamed' }, B, A]),
    );

    expect(discard).not.toHaveBeenCalled();
  });

  it('discards every remaining row when the preview is cancelled, and empties it', async () => {
    const { discard, hook } = setup();
    await act(async () => hook.result.current.replace([A, C]));

    await act(async () => hook.result.current.cancel());

    expect(hook.result.current.episodes).toEqual([]);
    expect(discard).toHaveBeenLastCalledWith({
      projectId: PROJECT,
      episodeIds: [A.id, C.id],
    });
  });

  it('keeps every row when the user confirms, and empties the preview', async () => {
    const { discard, hook } = setup();

    act(() => hook.result.current.keep());

    expect(hook.result.current.episodes).toEqual([]);
    expect(discard).not.toHaveBeenCalled();
  });

  it('reports a discard that failed, without losing the preview state', async () => {
    const onDiscardFailed = vi.fn();
    const discard = vi.fn(async () => ({
      ok: false as const,
      error: "The generated episodes weren't removed",
    }));
    const hook = renderHook(() =>
      useGeneratedOutlines({ projectId: PROJECT, discard, onDiscardFailed }),
    );
    act(() => hook.result.current.show([A, B]));

    await act(async () => hook.result.current.replace([A]));

    expect(hook.result.current.episodes).toEqual([A]);
    expect(onDiscardFailed).toHaveBeenCalledWith(
      "The generated episodes weren't removed",
    );
  });
});
