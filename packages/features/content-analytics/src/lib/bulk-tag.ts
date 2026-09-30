import type { ActionResult } from '@kit/next/action-result';

import { BULK_TAG_MAX_PUBLISHES } from './schemas/taxonomy.schema';

export type BulkTagOutcome =
  | { ok: true; taggedCount: number }
  | { ok: false; error: string; taggedCount: number };

interface BulkTagRequest {
  publishIds: string[];
  tagIds: string[];
  replace: false;
}

/**
 * Applies tags to any number of publishes in calls the action accepts.
 *
 * The action caps a call at BULK_TAG_MAX_PUBLISHES, so a longer selection is
 * sent in chunks, one after another. The first refusal stops the run and
 * reports how many publishes were already tagged, so a half-applied
 * selection is stated rather than left for the user to find.
 */
export async function bulkTagInChunks(
  input: { publishIds: string[]; tagIds: string[] },
  send: (request: BulkTagRequest) => Promise<ActionResult<unknown>>,
): Promise<BulkTagOutcome> {
  let taggedCount = 0;

  for (
    let start = 0;
    start < input.publishIds.length;
    start += BULK_TAG_MAX_PUBLISHES
  ) {
    const chunk = input.publishIds.slice(start, start + BULK_TAG_MAX_PUBLISHES);
    const result = await send({
      publishIds: chunk,
      tagIds: input.tagIds,
      replace: false,
    });

    if (!result.ok) {
      return { ok: false, error: result.error, taggedCount };
    }

    taggedCount += chunk.length;
  }

  return { ok: true, taggedCount };
}

/** Splits ids into runs the publish-tags read accepts. */
export function chunkPublishIds(publishIds: string[]): string[][] {
  const chunks: string[][] = [];

  for (
    let start = 0;
    start < publishIds.length;
    start += BULK_TAG_MAX_PUBLISHES
  ) {
    chunks.push(publishIds.slice(start, start + BULK_TAG_MAX_PUBLISHES));
  }

  return chunks;
}
