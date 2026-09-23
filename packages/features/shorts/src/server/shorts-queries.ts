import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

// =============================================================================
// Types
// =============================================================================

export interface ShortCandidate {
  id: string;
  episodeId: string;
  sequenceNumber: number;
  durationSeconds: number;
  videoUrl: string | null;
  shortsCandidate: boolean;
  viralScore: number | null;
  hookType: string | null;
  standaloneSummary: string | null;
  veoPrompt: string | null;
}

export interface Short {
  id: string;
  episodeId: string;
  sourceShot: {
    id: string;
    sequenceNumber: number;
  } | null;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  title: string | null;
  caption: string | null;
  hashtags: string[] | null;
  viralScore: number | null;
  hookType: string | null;
  standaloneSummary: string | null;
  videoUrl9x16: string | null;
  videoUrlOriginal: string | null;
  thumbnailUrl: string | null;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  processingError: string | null;
  createdAt: string;
  publications: ShortPublication[];
}

export interface ShortPublication {
  id: string;
  shortId: string;
  platform: string;
  language: string;
  status: string;
  platformUrl: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  views: number;
  likes: number;
}

// =============================================================================
// Queries
// =============================================================================

/**
 * Get all shorts candidates (shots with shorts_candidate=true) for an episode
 */
export async function getShortsCandidates(
  episodeId: string,
): Promise<ShortCandidate[]> {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('shots')
    .select(
      `
      id,
      episode_id,
      sequence_number,
      duration_seconds,
      video_url,
      shorts_candidate,
      shorts_metadata,
      veo_prompt
    `,
    )
    .eq('episode_id', episodeId)
    .eq('shorts_candidate', true)
    .order('sequence_number', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch shorts candidates: ${error.message}`);
  }

  return (data ?? []).map(
    (shot: {
      id: string;
      episode_id: string;
      sequence_number: number;
      duration_seconds: number;
      video_url: string | null;
      shorts_candidate: boolean;
      shorts_metadata: {
        viralScore?: number;
        hookType?: string;
        standaloneSummary?: string;
      } | null;
      veo_prompt: string | null;
    }) => ({
      id: shot.id,
      episodeId: shot.episode_id,
      sequenceNumber: shot.sequence_number,
      durationSeconds: shot.duration_seconds,
      videoUrl: shot.video_url,
      shortsCandidate: shot.shorts_candidate,
      viralScore: shot.shorts_metadata?.viralScore ?? null,
      hookType: shot.shorts_metadata?.hookType ?? null,
      standaloneSummary: shot.shorts_metadata?.standaloneSummary ?? null,
      veoPrompt: shot.veo_prompt,
    }),
  );
}

/**
 * Get all generated shorts for an episode
 */
export async function getShortsForEpisode(episodeId: string): Promise<Short[]> {
  const client = getSupabaseServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('shorts')
    .select(
      `
      id,
      episode_id,
      source_shot_id,
      start_seconds,
      end_seconds,
      duration_seconds,
      title,
      caption,
      hashtags,
      viral_score,
      hook_type,
      standalone_summary,
      video_url_9x16,
      video_url_original,
      thumbnail_url,
      status,
      processing_error,
      created_at,
      short_publications (
        id,
        short_id,
        platform,
        language,
        status,
        platform_url,
        scheduled_at,
        published_at,
        views,
        likes
      )
    `,
    )
    .eq('episode_id', episodeId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch shorts: ${error.message}`);
  }

  return (data ?? []).map(
    (short: {
      id: string;
      episode_id: string;
      source_shot_id: string | null;
      start_seconds: number;
      end_seconds: number;
      duration_seconds: number;
      title: string | null;
      caption: string | null;
      hashtags: string[] | null;
      viral_score: number | null;
      hook_type: string | null;
      standalone_summary: string | null;
      video_url_9x16: string | null;
      video_url_original: string | null;
      thumbnail_url: string | null;
      status: 'pending' | 'processing' | 'ready' | 'failed';
      processing_error: string | null;
      created_at: string;
      short_publications: ShortPublication[];
    }) => ({
      id: short.id,
      episodeId: short.episode_id,
      sourceShot: short.source_shot_id
        ? { id: short.source_shot_id, sequenceNumber: 0 }
        : null,
      startSeconds: short.start_seconds,
      endSeconds: short.end_seconds,
      durationSeconds: short.duration_seconds,
      title: short.title,
      caption: short.caption,
      hashtags: short.hashtags,
      viralScore: short.viral_score,
      hookType: short.hook_type,
      standaloneSummary: short.standalone_summary,
      videoUrl9x16: short.video_url_9x16,
      videoUrlOriginal: short.video_url_original,
      thumbnailUrl: short.thumbnail_url,
      status: short.status,
      processingError: short.processing_error,
      createdAt: short.created_at,
      publications: short.short_publications ?? [],
    }),
  );
}
