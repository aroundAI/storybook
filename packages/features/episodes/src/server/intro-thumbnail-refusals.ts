import { ActionRefusal } from '@kit/next/action-result';

/**
 * What a user reads when saving or deleting a project intro or an episode
 * thumbnail is refused.
 *
 * - `foreignFile` (KB-90): the file is not an upload in this project's (or
 *   episode's) own folder. The publish and render steps fetch what is saved,
 *   so nothing else may be.
 * - `*NotDeleted` (KB-61): the delete removed no row — it was already gone,
 *   or the table's policy does not let this user delete it.
 */
export const INTRO_THUMBNAIL_REFUSALS = {
  foreignFile:
    "That file isn't one of this project's uploads. Upload it again from this page.",
  introNotDeleted:
    "The intro wasn't deleted: it's already gone, or you can't delete it. Reload the page.",
  thumbnailNotDeleted:
    "The thumbnail wasn't removed: it's already gone, or you can't remove it. Reload the page.",
  failed: 'Something went wrong. Try again; if it keeps failing, reload the page.',
} as const;

/**
 * The message an action returns for a caught error: a refusal as written,
 * anything else as a generic sentence — a database error is for the log,
 * not the page.
 */
export function failureMessage(error: unknown): string {
  return error instanceof ActionRefusal
    ? error.message
    : INTRO_THUMBNAIL_REFUSALS.failed;
}
