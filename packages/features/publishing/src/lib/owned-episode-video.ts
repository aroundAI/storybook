import { keyUnderPrefix, publicUrlPrefix } from '@kit/storage/public-url';
import { PROJECT_ASSETS_BUCKET } from '@kit/storage/upload-paths';

/**
 * Which video a publish may send (KB-123).
 *
 * A publish downloads the episode's video or hands its URL to the platform,
 * and the URL comes from a row any project writer can update, so without a
 * check another project's video, another tenant's, or a file on a host the
 * caller owns could reach the channel.
 *
 * The rule, decided by the owner on 2026-09-25: the app's own storage, and a
 * file of the episode's own project — the episode's folders, a sibling
 * episode's, or the project's. Anyone who can publish the episode can already
 * reach those. Production's count that day found one video URL, in its own
 * episode's folder, so the rule refuses nothing that publishes today.
 *
 * Environment only, apart from `projectOfEpisode`, so the publish worker runs
 * the same check the server does.
 */

type Env = Record<string, string | undefined>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EpisodeVideoScope {
  episodeId: string;
  projectId: string;
}

/** The project an episode belongs to, or null when it cannot be read */
export type ProjectOfEpisode = (episodeId: string) => Promise<string | null>;

/**
 * What an app storage URL names: an episode's folder or a project's. Null
 * for another host, another bucket, a traversal, or any other key.
 */
export function episodeVideoTarget(
  url: string,
  env: Env = process.env,
): { episodeId: string } | { projectId: string } | null {
  const prefix = publicUrlPrefix(PROJECT_ASSETS_BUCKET, env);
  const key = prefix ? keyUnderPrefix(prefix, url) : null;
  if (!key) return null;

  const [root, id, ...rest] = key.split('/');
  if (!id || !UUID.test(id) || rest.length === 0) return null;

  if (root === 'episodes') return { episodeId: id };
  if (root === 'projects') return { projectId: id };
  return null;
}

/** `url` when a publish of this episode may send it, else null */
export async function ownedEpisodeVideo(
  url: string | null | undefined,
  scope: EpisodeVideoScope,
  projectOfEpisode: ProjectOfEpisode,
  env: Env = process.env,
): Promise<string | null> {
  if (!url) return null;

  const target = episodeVideoTarget(url, env);
  if (!target) return null;

  if ('projectId' in target) {
    return target.projectId === scope.projectId ? url : null;
  }

  if (target.episodeId === scope.episodeId) return url;

  return (await projectOfEpisode(target.episodeId)) === scope.projectId
    ? url
    : null;
}

export const EPISODE_VIDEO_PUBLISH_REFUSAL =
  "That video isn't one of this project's files. Upload it again from the episode's publish screen.";
