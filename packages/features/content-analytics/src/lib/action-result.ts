/**
 * What a mutation action returns (FILM-1610 review 4, G1).
 *
 * A refusal is returned, not thrown. A production build replaces the message
 * of an error thrown from a server action with a generic sentence ("An error
 * occurred in the Server Components render…"), so a thrown "this experiment
 * was changed by someone else" reaches the user as that sentence. Only a
 * dev server passes the real message through — which is why every E2E run
 * showed the right text and production would not have.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * A refusal the user should read as written: a rule they ran into, worded
 * for them. Any other error is logged and replaced by a generic message, so
 * database and ClickHouse details never reach the page.
 */
export class ActionRefusal extends Error {
  override name = 'ActionRefusal';
}

/**
 * Client side: the data of a successful result, or a thrown Error carrying
 * the refusal — so a caller keeps one `catch` for a refusal and for a
 * request that never arrived.
 */
export async function unwrap<T>(
  result: ActionResult<T> | Promise<ActionResult<T>>,
): Promise<T> {
  const settled = await result;

  if (!settled.ok) {
    throw new Error(settled.error);
  }

  return settled.data;
}
