import type { publishToAllAction } from '@kit/publishing/server';

import type { PlatformUploadStatus } from './publish-types';

/**
 * One platform's answer from `publishToAllAction`, typed from the action
 * itself rather than restated by hand: a restated shape read `url` while the
 * action returns `platformUrl`, and the link was never shown (KB-160).
 */
export type PublishOutcome = Extract<
  Awaited<ReturnType<typeof publishToAllAction>>,
  { ok: true }
>['data'][number];

/**
 * A platform's upload row once the action answered: queued for the publish
 * worker (KB-206), or, for an answer that names the post, linking to it.
 */
export function publishedUploadStatus(
  row: PlatformUploadStatus,
  result: PublishOutcome,
): PlatformUploadStatus {
  if (result.status === 'queued') return { ...row, status: 'queued' };

  return { ...row, status: 'success', url: result.platformUrl };
}
