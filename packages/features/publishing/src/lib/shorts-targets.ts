/**
 * Which channels a Shorts group goes to.
 *
 * A short is cut differently for YouTube, Instagram and Facebook, so each
 * group names the platforms its videos are for (`platforms`). A group that
 * names none goes to every Shorts platform, as every group did before
 * (owner, 2026-10-10). Language still comes from the channel.
 *
 * Environment-free and without `server-only`: the Publish screen, the
 * publish actions and the scheduled Lambda all import it.
 */
import { takesVideo } from './constants';

export interface ShortsGroupTargeting {
  id: string;
  platforms?: readonly string[] | null;
  videos: Record<string, string>;
}

export interface ShortsChannel {
  id: string;
  platform: string;
  language?: string | null;
}

export function groupTakesPlatform(
  group: { platforms?: readonly string[] | null },
  platform: string,
) {
  const platforms = group.platforms ?? [];

  return platforms.length === 0 || platforms.includes(platform);
}

/** The channels that take one group's video in one language */
export function shortsChannelsFor<C extends ShortsChannel>(
  group: { platforms?: readonly string[] | null } | undefined,
  language: string,
  channels: readonly C[],
) {
  return channels.filter(
    (channel) =>
      (channel.language || 'en') === language &&
      takesVideo('short', channel.platform) &&
      (!group || groupTakesPlatform(group, channel.platform)),
  );
}

/** One upload per group video and channel that takes it */
export function shortsTargets<
  G extends ShortsGroupTargeting,
  C extends ShortsChannel,
>(groups: readonly G[], channels: readonly C[]) {
  return groups.flatMap((group) =>
    Object.entries(group.videos)
      .filter(([, url]) => url)
      .flatMap(([language]) =>
        shortsChannelsFor(group, language, channels).map((channel) => ({
          group,
          language,
          channel,
        })),
      ),
  );
}
