/**
 * The one item with more comments than every other, or null.
 *
 * The Comments card said "“X” generated the most discussion" of whatever
 * came first in the list, with zero comments (KB-16). A sentence like that
 * is true only when someone commented and one item has strictly the most:
 * a tie has no "most", and nothing has been discussed at zero.
 */
export function mostDiscussed<T extends { comments: number }>(
  items: readonly T[] | undefined,
): T | null {
  if (!items || items.length === 0) return null;

  let top: T | null = null;
  let tied = false;

  for (const item of items) {
    if (top === null || item.comments > top.comments) {
      top = item;
      tied = false;
    } else if (item.comments === top.comments) {
      tied = true;
    }
  }

  return top !== null && top.comments > 0 && !tied ? top : null;
}
