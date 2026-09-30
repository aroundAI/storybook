import { describe, expect, it, vi } from 'vitest';

import type { ActionResult } from '@kit/next/action-result';

import { bulkTagInChunks, chunkPublishIds } from '../src/lib/bulk-tag';

type BulkTagRequest = {
  publishIds: string[];
  tagIds: string[];
  replace: false;
};

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `publish-${index}`);

describe('bulkTagInChunks', () => {
  it('sends a long selection in calls the action accepts', async () => {
    const send = vi.fn(
      async (_request: BulkTagRequest): Promise<ActionResult<null>> => ({
        ok: true,
        data: null,
      }),
    );

    const outcome = await bulkTagInChunks(
      { publishIds: ids(1200), tagIds: ['tag-1'] },
      send,
    );

    expect(
      send.mock.calls.map(([request]) => request.publishIds.length),
    ).toEqual([500, 500, 200]);
    expect(outcome).toEqual({ ok: true, taggedCount: 1200 });
  });

  it('stops at the first refusal and says how many were already tagged', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: null })
      .mockResolvedValueOnce({
        ok: false,
        error: 'Tag belongs to another account.',
      });

    const outcome = await bulkTagInChunks(
      { publishIds: ids(1200), tagIds: ['tag-1'] },
      send,
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({
      ok: false,
      error: 'Tag belongs to another account.',
      taggedCount: 500,
    });
  });

  it('never replaces existing tags', async () => {
    const send = vi.fn(
      async (_request: BulkTagRequest): Promise<ActionResult<null>> => ({
        ok: true,
        data: null,
      }),
    );

    await bulkTagInChunks({ publishIds: ids(1), tagIds: ['tag-1'] }, send);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ replace: false }),
    );
  });
});

describe('chunkPublishIds', () => {
  it('keeps every id exactly once', () => {
    const chunks = chunkPublishIds(ids(1001));

    expect(chunks.map((chunk) => chunk.length)).toEqual([500, 500, 1]);
    expect(chunks.flat()).toEqual(ids(1001));
  });
});
