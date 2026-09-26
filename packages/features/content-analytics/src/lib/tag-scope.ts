/**
 * Why these tags cannot go on these videos, or null when they can (KB-98).
 *
 * A tag belongs to one account and a video to its project's account; a link
 * is allowed only within one account. `publish_tags_create` enforces the
 * same rule in the database. This names the problem before the action
 * clears a video's existing tags, which a refused insert would otherwise
 * leave behind.
 *
 * Both maps hold only the rows the caller can read, so a video or tag the
 * caller cannot see is treated as absent.
 */
export function tagScopeRefusal({
  publishIds,
  tagIds,
  publishAccounts,
  tagAccounts,
}: {
  publishIds: string[];
  tagIds: string[];
  /** Publish id → the account of its project. */
  publishAccounts: ReadonlyMap<string, string>;
  /** Tag id → the tag's account. */
  tagAccounts: ReadonlyMap<string, string>;
}): string | null {
  if (publishIds.some((id) => !publishAccounts.has(id))) {
    return 'Some of these videos were not found.';
  }

  const accounts = new Set(publishIds.map((id) => publishAccounts.get(id)));

  if (accounts.size > 1) {
    return "These videos belong to different accounts. Tag each account's videos separately.";
  }

  const [account] = accounts;

  if (tagIds.some((id) => tagAccounts.get(id) !== account)) {
    return 'Some of these tags belong to another account.';
  }

  return null;
}
