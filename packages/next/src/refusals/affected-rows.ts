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
