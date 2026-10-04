/**
 * An episode's video URLs, and which of them a save may store (KB-123).
 *
 * A publish downloads the episode's video, or hands its URL to the
 * platform, so the stored URL decides which file reaches the channel. Every
 * upload the app makes lands in the episode's own videos folder
 * (`publishVideoPath`), so a new or changed value must be there. A value the
 * episode already holds is kept: older episodes may name videos elsewhere,
 * and which of those may still publish is decided at publish time, from the
 * owner's count, not by refusing a save.
 *
 * Environment only, like KB-104's `ownedPublicKey`, so the Lambda workers can
 * import it.
 */
import { ownedPublicKey } from './public-url';
import {
  PROJECT_ASSETS_BUCKET,
  episodeRenderFolder,
  episodeVideoFolder,
} from './upload-paths';

type Env = Record<string, string | undefined>;

/**
 * The video columns of an episode row as stored. The JSON columns are
 * untyped, and public sharing writes objects into `localized_videos`, so a
 * value that is not a string is not a video URL.
 */
export interface EpisodeVideoFields {
  final_video_url?: string | null;
  localized_videos?: unknown;
  shorts_groups?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValues(value: unknown): string[] {
  return isRecord(value)
    ? Object.values(value).filter(
        (item): item is string => typeof item === 'string' && item !== '',
      )
    : [];
}

/** Every video URL an episode holds, in all three places a publish reads */
export function episodeVideoUrls(episode: EpisodeVideoFields): string[] {
  const groups = Array.isArray(episode.shorts_groups)
    ? episode.shorts_groups
    : [];

  return [
    ...(episode.final_video_url ? [episode.final_video_url] : []),
    ...stringValues(episode.localized_videos),
    ...groups.flatMap((group) =>
      isRecord(group) ? stringValues(group.videos) : [],
    ),
  ];
}

/**
 * `url` when it is an upload in this episode's own videos folder, or, given
 * the episode's project, a StorybookStudio render of this episode (FILM-2003:
 * `projects/{project}/episodes/{episode}/renders/`); else null
 */
export function ownedEpisodeVideoUpload(
  url: string,
  episodeId: string,
  env: Env = process.env,
  projectId?: string,
): string | null {
  const folders = [
    episodeVideoFolder(episodeId),
    ...(projectId ? [episodeRenderFolder(projectId, episodeId)] : []),
  ];

  return folders.some((folder) =>
    ownedPublicKey(PROJECT_ASSETS_BUCKET, url, folder, env),
  )
    ? url
    : null;
}

export const EPISODE_VIDEO_SAVE_REFUSAL =
  "That video isn't one of this episode's uploads. Upload it from the episode's publish screen.";

/**
 * Why a save may not store `next`, or null when it may. Each value must be
 * this episode's own upload, or one the episode already holds (`stored`).
 */
export function episodeVideoSaveRefusal({
  episodeId,
  projectId,
  stored,
  next,
  env = process.env,
}: {
  episodeId: string;
  /** The episode's project, read from its row: admits its Studio renders */
  projectId?: string;
  stored: EpisodeVideoFields;
  next: string[];
  env?: Env;
}): string | null {
  const held = new Set(episodeVideoUrls(stored));

  const refused = next.some(
    (url) =>
      url !== '' &&
      !held.has(url) &&
      !ownedEpisodeVideoUpload(url, episodeId, env, projectId),
  );

  return refused ? EPISODE_VIDEO_SAVE_REFUSAL : null;
}
