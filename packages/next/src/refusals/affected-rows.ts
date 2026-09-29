import { readFailed, whyNoRow } from '@kit/shared/rows';

import { ActionRefusal } from './action-result';

/**
 * The rows a DELETE or UPDATE reports having changed, or an `ActionRefusal`
 * when it changed none (KB-61).
 *
 * RLS does not raise on a write it filters out: PostgREST answers
 * `{ data: [], error: null }`, exactly as for a write that worked. So a write
 * whose success the user is told about must end in `.select('id')` and pass
 * its `data` here:
 *
 *   const { data, error } = await client.from('t').delete().eq('id', id).select('id');
 *   if (error) throw …;
 *   requireAffectedRows(data, 'Nothing was deleted: …');
 *
 * Without `.select()` the data is `null`, which is refused too — a forgotten
 * `.select()` then fails every time instead of passing every time.
 */
export function requireAffectedRows<T>(
  rows: T[] | null | undefined,
  refusal: string,
): T[] {
  if (!rows || rows.length === 0) {
    throw new ActionRefusal(refusal);
  }

  return rows;
}

/**
 * The row a `.single()` read found, an `ActionRefusal` when there is none, or
 * the read's own error, thrown as the crash it is (KB-138).
 *
 * `if (error || !row) throw new ActionRefusal('… not found')` told the user a
 * statement timeout was a missing row (KB-137), and a refusal never reaches
 * monitoring. `.single()` reports no row as `PGRST116`; anything else is a
 * failed read.
 *
 *   const post = requireRow(
 *     await client.from('social_posts').select('id').eq('id', id).single(),
 *     'Social post not found',
 *   );
 */
export function requireRow<
  R extends {
    data: unknown;
    error: { code?: string; message: string } | null;
  },
>(result: R, notFound: string): NonNullable<R['data']> {
  const { data, error } = result;

  if (readFailed(error)) {
    throw new Error(whyNoRow(error, notFound));
  }

  if (!data) {
    throw new ActionRefusal(notFound);
  }

  return data as NonNullable<R['data']>;
}
