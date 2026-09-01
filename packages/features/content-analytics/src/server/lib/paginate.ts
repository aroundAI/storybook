import 'server-only';

/**
 * Exhaustive reads against PostgREST.
 *
 * PostgREST caps every response at `db-max-rows` (this project sets
 * `max_rows = 1000` in `apps/web/supabase/config.toml`, and production
 * enforces it for the service-role client too). The cap is applied by
 * returning a short body with HTTP 200 and no error, so an unbounded
 * `.select()` looks identical to a complete result. Any read whose
 * correctness depends on seeing every row has to page through explicitly.
 */

/** Rows requested per page. Deliberately below the server cap. */
const PAGE_SIZE = 500;

/**
 * Safety valve. A runaway loop against a growing table would page forever;
 * this turns that into a loud failure instead.
 */
const MAX_ROWS = 100_000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Drains a PostgREST query page by page.
 *
 * The caller supplies a range-bounded query. Progress is measured by the
 * rows actually returned rather than by `PAGE_SIZE`, so the loop stays
 * correct if the server cap is lower than the page size or changes later.
 *
 * The query MUST carry a deterministic `.order()` on a unique column.
 * Range pagination over an unordered query can skip or repeat rows, because
 * Postgres is free to return them in a different order for each request.
 */
export async function forEachPage<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  handle: (batch: T[]) => Promise<void> | void,
  label = 'query',
): Promise<number> {
  let seen = 0;

  for (;;) {
    const { data, error } = await page(seen, seen + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Paginated read failed (${label}): ${error.message}`);
    }

    const batch = data ?? [];

    if (batch.length === 0) break;

    seen += batch.length;

    if (seen > MAX_ROWS) {
      throw new Error(
        `Paginated read exceeded ${MAX_ROWS} rows (${label}); refusing to continue`,
      );
    }

    await handle(batch);
  }

  return seen;
}

/** Collects every page into one array. Prefer `forEachPage` for large reads. */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  label = 'query',
): Promise<T[]> {
  const rows: T[] = [];

  await forEachPage<T>(
    page,
    (batch) => {
      rows.push(...batch);
    },
    label,
  );

  return rows;
}

/**
 * Ids per `.in(...)` filter.
 *
 * This is a separate ceiling from the row cap: a filter list is serialized
 * into the request URI, so a long one fails with a 414 rather than being
 * truncated. It bites at a different threshold and needs its own chunking.
 */
const IN_CHUNK_SIZE = 200;

/**
 * Runs a query once per chunk of ids and concatenates the results.
 *
 * Each chunk is drained with `fetchAllRows`, because a chunk of N ids can
 * still match far more than N rows on a one-to-many table (`publish_tags`
 * being the case that motivated this).
 */
export async function fetchAllByIds<T>(
  ids: string[],
  page: (
    chunk: string[],
    from: number,
    to: number,
  ) => PromiseLike<PageResult<T>>,
  label = 'query',
): Promise<T[]> {
  if (ids.length === 0) return [];

  const rows: T[] = [];

  for (let index = 0; index < ids.length; index += IN_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + IN_CHUNK_SIZE);

    rows.push(
      ...(await fetchAllRows<T>(
        (from, to) => page(chunk, from, to),
        `${label} chunk ${index / IN_CHUNK_SIZE}`,
      )),
    );
  }

  return rows;
}

/** Splits a list into fixed-size chunks, for callers that batch writes. */
export function chunkIds(ids: string[], size = IN_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];

  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }

  return chunks;
}
