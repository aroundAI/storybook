import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { getLogger } from '@kit/shared/logger';
import { createYouTubeProvider } from '../providers/youtube/youtube-provider';

/**
 * Auto-playlist rule configuration stored in project metadata.
 * Rules define how episodes should be automatically added to playlists
 * after publishing.
 */
export interface PlaylistRule {
  id: string;
  playlistId: string;      // YouTube playlist ID (or 'auto-create' to create on first use)
  playlistTitle?: string;  // Title for auto-created playlists
  platforms: string[];     // Which platforms this rule applies to (e.g., ['youtube'])
  contentTypes: string[];  // Which content types (e.g., ['full', 'short'])
  orderBy: 'episode_number' | 'publish_date' | 'manual';
  seasonScope?: 'all' | 'current';  // 'current' = only current season's playlist
  isActive: boolean;
}

/**
 * Retrieves auto-playlist rules for a project.
 * Rules are stored in project metadata JSONB field.
 */
export async function getPlaylistRules(projectId: string): Promise<PlaylistRule[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('projects')
    .select('metadata')
    .eq('id', projectId)
    .single();

  if (error || !data) {
    getLogger().error({ error, projectId }, 'Failed to fetch project metadata for playlist rules');
    return [];
  }

  const metadata = data.metadata as Record<string, any>;
  return (metadata?.playlistRules as PlaylistRule[]) || [];
}

/**
 * Saves auto-playlist rules for a project.
 */
export async function savePlaylistRules(projectId: string, rules: PlaylistRule[]): Promise<void> {
  const supabase = getSupabaseServerClient();
  
  // First, get the existing metadata
  const { data: projectData, error: fetchError } = await supabase
    .from('projects')
    .select('metadata')
    .eq('id', projectId)
    .single();

  if (fetchError) {
    getLogger().error({ error: fetchError, projectId }, 'Failed to fetch existing metadata');
    throw fetchError;
  }

  const currentMetadata = (projectData?.metadata as Record<string, any>) || {};
  const newMetadata = {
    ...currentMetadata,
    playlistRules: rules,
  };

  const { error: updateError } = await supabase
    .from('projects')
    .update({ metadata: newMetadata })
    .eq('id', projectId);

  if (updateError) {
    getLogger().error({ error: updateError, projectId }, 'Failed to save playlist rules');
    throw updateError;
  }
}

/**
 * Applies auto-playlist rules after a video is published.
 * Called from the post-publish hook.
 */
export async function applyPlaylistRules(params: {
  publishId: string;
  episodeId: string;
  projectId: string;
  platform: string;
  contentType: string;
  platformContentId: string;
  accessToken: string;
}): Promise<void> {
  const logger = getLogger();
  const supabase = getSupabaseServerClient();

  try {
    // 1. Gets rules for the project
    const rules = await getPlaylistRules(params.projectId);
    if (!rules.length) return;

    // 2. Filters rules that match this publish (platform, content type)
    const matchingRules = rules.filter(
      (rule) =>
        rule.isActive &&
        rule.platforms.includes(params.platform) &&
        rule.contentTypes.includes(params.contentType)
    );

    if (!matchingRules.length) return;

    // We need episode details to determine position and for auto-create playlist titles
    const { data: episode, error: epError } = await supabase
      .from('episodes')
      .select('number, seasons(name)')
      .eq('id', params.episodeId)
      .single();

    if (epError) {
      logger.error({ error: epError, episodeId: params.episodeId }, 'Failed to fetch episode details');
      return;
    }

    const provider = createYouTubeProvider(params.accessToken);
    const updatedRules: PlaylistRule[] = [];
    let rulesChanged = false;

    // 3. For each matching rule
    for (const rule of matchingRules) {
      let playlistId = rule.playlistId;

      // a. If playlistId is 'auto-create', check if playlist exists (by title), create if not
      if (playlistId === 'auto-create') {
        const seasonName = Array.isArray(episode.seasons) 
          ? episode.seasons[0]?.name 
          : episode.seasons?.name;
          
        let playlistTitle = rule.playlistTitle || \`Project \${params.projectId} Playlist\`;
        
        // If rule wants current season scope, append season name
        if (rule.seasonScope === 'current' && seasonName) {
           playlistTitle = \`\${playlistTitle} - \${seasonName}\`;
        }

        try {
          const playlists = await provider.getPlaylists();
          const existingPlaylist = playlists.find((p) => p.title === playlistTitle);

          if (existingPlaylist) {
            playlistId = existingPlaylist.id;
          } else {
            const newPlaylist = await provider.createPlaylist(
              playlistTitle,
              'Auto-generated playlist', // Default description
              'public'
            );
            playlistId = newPlaylist.id;
          }
          
          // Update rule so we don't recreate it next time
          rule.playlistId = playlistId;
          rulesChanged = true;
        } catch (error) {
          logger.error({ error, ruleId: rule.id }, 'Failed to auto-create playlist');
          continue; // Skip to next rule
        }
      }

      // b. Calculate position based on orderBy (episode_number → position = episode.number - 1)
      let position: number | undefined;
      if (rule.orderBy === 'episode_number' && typeof episode.number === 'number') {
        position = Math.max(0, episode.number - 1);
      }

      // c. Call YouTubeProvider.addToPlaylist with position
      try {
        await provider.addToPlaylist(params.platformContentId, playlistId, position);
      } catch (error) {
        logger.error(
          { error, videoId: params.platformContentId, playlistId, position },
          'Failed to add video to playlist'
        );
      }
    }

    // Update project rules if any 'auto-create' playlists were resolved
    if (rulesChanged) {
      const allRules = rules.map(r => {
        const matched = matchingRules.find(mr => mr.id === r.id);
        return matched ? matched : r;
      });
      await savePlaylistRules(params.projectId, allRules);
    }

    // 4. Store the playlist assignment in publish metadata
    const { data: publishData } = await supabase
      .from('publishes')
      .select('metadata')
      .eq('id', params.publishId)
      .single();

    if (publishData) {
      const publishMeta = (publishData.metadata as Record<string, any>) || {};
      const newPublishMeta = {
        ...publishMeta,
        playlists: matchingRules.map(r => r.playlistId),
      };

      await supabase
        .from('publishes')
        .update({ metadata: newPublishMeta })
        .eq('id', params.publishId);
    }
  } catch (error) {
    logger.error({ error, publishId: params.publishId }, 'Error applying playlist rules');
  }
}
