import { ownedPublicKey } from '@kit/storage/public-url';
import {
  PROJECT_ASSETS_BUCKET,
  episodeThumbnailFolder,
} from '@kit/storage/upload-paths';

/**
 * `url` when it is one of this episode's own uploaded thumbnails, else null
 * (KB-104). A publish downloads its thumbnail and sends it to the channel,
 * and the value comes from the request or from a row any project writer can
 * update, so a host-suffix check let another tenant's file, or one on a
 * storage host the caller owns, reach the platform.
 *
 * Environment only, so the publish worker Lambda runs the same check the
 * server does.
 */
export function ownedEpisodeThumbnail(
  url: string | null | undefined,
  episodeId: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!url) return null;

  return ownedPublicKey(
    PROJECT_ASSETS_BUCKET,
    url,
    episodeThumbnailFolder(episodeId),
    env,
  )
    ? url
    : null;
}
