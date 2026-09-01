/**
 * Chunked video-id queries.
 *
 * `query_params` are serialized by @clickhouse/client into `param_<key>`
 * entries on the request URL, not into a request body — the client's own
 * `toSearchParams` carries a "TODO validate max length of the resulting
 * query". A UUID plus separator is roughly 40 bytes once encoded, so a list
 * in the tens of thousands crosses ClickHouse's default `http_max_uri_size`
 * (1 MB) and the request fails outright.
 *
 * Callers used to be capped implicitly at 1,000 ids by PostgREST's row
 * limit on the read that produced them. Now that those reads are paged, the
 * lists are unbounded, and the account large enough to need pagination is
 * exactly the one that would break. Every helper taking `videoIds` splits
 * the list here and merges the partial results.
 *
 * The merge is not one-size-fits-all, which is the trap:
 *
 * - Results keyed by video (a `Map<videoId, …>`, or rows carrying a
 *   `videoId`) are **disjoint across chunks**, so they concatenate or
 *   assign. Per-video ratios stay correct because every row for a video is
 *   computed inside that video's own chunk.
 * - Results grouped by something else (platform, date, traffic source) or
 *   reduced to a scalar **overlap across chunks** and must be summed.
 *   Summing is only valid because every numeric field in these shapes is
 *   itself a sum; a ratio would have to be recomputed from summed
 *   numerators and denominators instead.
 */

/**
 * Ids per ClickHouse request. 1,000 UUIDs is roughly 40 KB of URI — well
 * inside the 1 MB default — while keeping the number of round trips low.
 */
export const CLICKHOUSE_ID_CHUNK = 1_000;

/** Splits ids into request-sized chunks, deduplicating first. */
export function chunkVideoIds(videoIds: string[]): string[][] {
  const unique = Array.from(new Set(videoIds));
  const chunks: string[][] = [];

  for (let index = 0; index < unique.length; index += CLICKHOUSE_ID_CHUNK) {
    chunks.push(unique.slice(index, index + CLICKHOUSE_ID_CHUNK));
  }

  return chunks;
}

/** True when the list fits in one request, so callers can skip the merge. */
export function fitsOneChunk(videoIds: string[]): boolean {
  return videoIds.length <= CLICKHOUSE_ID_CHUNK;
}

/**
 * Runs `run` per chunk and concatenates. For row sets where each row
 * belongs to exactly one video, so no two chunks can produce the same row.
 */
export async function concatByChunk<T>(
  videoIds: string[],
  run: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];

  for (const chunk of chunkVideoIds(videoIds)) {
    rows.push(...(await run(chunk)));
  }

  return rows;
}

/**
 * Runs `run` per chunk and merges the Maps by assignment. Safe because a
 * video id appears in exactly one chunk, so keys never collide.
 */
export async function mergeMapsByChunk<V>(
  videoIds: string[],
  run: (chunk: string[]) => Promise<Map<string, V>>,
): Promise<Map<string, V>> {
  const merged = new Map<string, V>();

  for (const chunk of chunkVideoIds(videoIds)) {
    for (const [key, value] of await run(chunk)) {
      merged.set(key, value);
    }
  }

  return merged;
}

/**
 * Adds every numeric field of `row` into `target`, leaving non-numeric
 * fields (labels like platform or date) as first-seen.
 */
function addNumericFields<T extends object>(target: T, row: T): void {
  const into = target as Record<string, unknown>;

  for (const [field, value] of Object.entries(row)) {
    if (typeof value === 'number' && typeof into[field] === 'number') {
      into[field] = (into[field] as number) + value;
    }
  }
}

/**
 * Folds rows that share a key, summing their numeric fields.
 *
 * Only valid for shapes whose numbers are all sums. Do not use it on a row
 * carrying a ratio or an average — those would have to be recomputed from
 * summed components.
 */
export function sumRowsByKey<T extends object>(
  rows: T[],
  keyOf: (row: T) => string,
): T[] {
  const byKey = new Map<string, T>();

  for (const row of rows) {
    const key = keyOf(row);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...row });
      continue;
    }

    addNumericFields(existing, row);
  }

  return Array.from(byKey.values());
}

/**
 * Runs `run` per chunk and folds the results on `keyOf`, summing numeric
 * fields. For groupings that span videos — platform, date, traffic source.
 */
export async function sumByChunk<T extends object>(
  videoIds: string[],
  run: (chunk: string[]) => Promise<T[]>,
  keyOf: (row: T) => string,
): Promise<T[]> {
  return sumRowsByKey(await concatByChunk(videoIds, run), keyOf);
}

/**
 * Runs `run` per chunk and sums the scalar results field-wise.
 * `zero` supplies the identity, so an empty id list still returns a value.
 */
export async function sumTotalsByChunk<T extends object>(
  videoIds: string[],
  run: (chunk: string[]) => Promise<T>,
  zero: T,
): Promise<T> {
  const chunks = chunkVideoIds(videoIds);

  if (chunks.length === 0) return zero;

  const total = { ...zero };

  for (const chunk of chunks) {
    addNumericFields(total, await run(chunk));
  }

  return total;
}
