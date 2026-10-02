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

/** A platform's upload row once its upload went out, linking to the post. */
export function publishedUploadStatus(
  row: PlatformUploadStatus,
  result: PublishOutcome,
): PlatformUploadStatus {
  return { ...row, status: 'success', url: result.platformUrl };
}
