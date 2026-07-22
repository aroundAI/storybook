'use server';
import 'server-only';

import { z } from 'zod';
import { enhanceAction } from '@kit/next/actions';
import { getPlaylistRules, savePlaylistRules } from '../lib/auto-playlist-rules';
import { createYouTubeProvider } from '../providers/youtube/youtube-provider';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const PlaylistRuleSchema = z.object({
  id: z.string(),
  playlistId: z.string(),
  playlistTitle: z.string().optional(),
  platforms: z.array(z.string()),
  contentTypes: z.array(z.string()),
  orderBy: z.enum(['episode_number', 'publish_date', 'manual']),
  seasonScope: z.enum(['all', 'current']).optional(),
  isActive: z.boolean(),
});

const SavePlaylistRulesSchema = z.object({
  projectId: z.string().uuid(),
  rules: z.array(PlaylistRuleSchema),
});

export const getPlaylistRulesAction = enhanceAction(
  async (input, user) => {
    return await getPlaylistRules(input.projectId);
  },
  { schema: z.object({ projectId: z.string().uuid() }), auth: true }
);

export const savePlaylistRulesAction = enhanceAction(
  async (input, user) => {
    await savePlaylistRules(input.projectId, input.rules);
    return { success: true };
  },
  { schema: SavePlaylistRulesSchema, auth: true }
);

export const getAvailablePlaylistsAction = enhanceAction(
  async (input, user) => {
    const supabase = getSupabaseServerClient();
    
    // Get the platform connection access token
    const { data: connection, error } = await supabase
      .from('platform_connections')
      .select('access_token')
      .eq('id', input.platformConnectionId)
      .eq('account_id', input.accountId)
      .single();

    if (error || !connection) {
      throw new Error('Failed to fetch platform connection or missing access token');
    }

    const provider = createYouTubeProvider(connection.access_token);
    const playlists = await provider.getPlaylists();
    return playlists.map((p) => ({ id: p.id, title: p.title }));
  },
  { 
    schema: z.object({ 
      accountId: z.string().uuid(), 
      platformConnectionId: z.string().uuid() 
    }), 
    auth: true 
  }
);
