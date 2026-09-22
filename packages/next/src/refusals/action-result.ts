/**
 * What a mutation action returns (FILM-1610 review 4, G1; KB-6).
 *
 * A refusal is returned, not thrown. A production build replaces the message
 * of an error thrown from a server action with a generic sentence ("An error
 * occurred in the Server Components render…"), so a thrown "this experiment
 * was changed by someone else" reaches the user as that sentence. Only a
 * dev server passes the real message through — which is why every E2E run
 * showed the right text and production would not have.
 *
 * Safe to import from a client component: nothing here is server-only.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * A refusal the user should read as written: a rule they ran into, worded
 * for them. Write its message for the page — never a database or vendor
 * error string, which a production build was incidentally hiding.
 */
export class ActionRefusal extends Error {
  override name = 'ActionRefusal';
}

/**
 * Client side: the data of a successful result, or a thrown `ActionRefusal`
 * carrying the refusal — so a caller keeps one `catch` for a refusal and for
 * a request that never arrived.
 */
export async function unwrap<T>(
  result: ActionResult<T> | Promise<ActionResult<T>>,
): Promise<T> {
  const settled = await result;

  if (!settled.ok) {
    throw new ActionRefusal(settled.error);
  }

  return settled.data;
}

/**
 * Client side: what to show for a caught error. A refusal reads as written;
 * anything else gets `fallback`, because the message of an error that
 * crossed from a server action is the generic sentence in production and
 * internal detail in development — neither is for the page.
 */
export function refusalMessage(error: unknown, fallback: string): string {
  return error instanceof ActionRefusal ? error.message : fallback;
}
