/**
 * The due-for-review list's cache key. It includes the user's local date:
 * "due" is a calendar question, so each day is a different answer, and a
 * key without the date kept serving yesterday's list to a tab left open past
 * midnight. Its first two parts are the prefix the page invalidates.
 */
export function dueQueryKey(accountId: string, asOf: string) {
  return ['experiments-due', accountId, asOf] as const;
}
