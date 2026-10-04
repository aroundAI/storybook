'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

export interface EpisodeRender {
  id: string;
  preset: string;
  language: string;
  aspect: string;
  file_url: string;
  file_size_bytes: number;
  duration_seconds: number;
  thumbnail_url: string | null;
  qa: { pass?: boolean; issues?: unknown[] };
  created_at: string;
}

/**
 * The episode's ready StorybookStudio renders (FILM-2003), newest first, as
 * the caller sees them under RLS (project members).
 */
export const listEpisodeRendersAction = enhanceAction(
  async ({ episodeId }) => {
    const client = getSupabaseServerClient();

    const rows = await fetchAllRows(
      (from, to) =>
        client
          .from('episode_renders')
          .select(
            'id, preset, language, aspect, file_url, file_size_bytes, duration_seconds, thumbnail_url, qa, created_at',
          )
          .eq('episode_id', episodeId)
          .eq('status', 'ready')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      'episode_renders',
    );

    // a ready render has its file, size and duration (episode_renders_ready_has_file)
    const renders = rows.flatMap((row): EpisodeRender[] =>
      row.file_url && row.file_size_bytes && row.duration_seconds
        ? [
            {
              ...row,
              file_url: row.file_url,
              file_size_bytes: Number(row.file_size_bytes),
              duration_seconds: Number(row.duration_seconds),
              qa: (row.qa ?? {}) as EpisodeRender['qa'],
            },
          ]
        : [],
    );

    return { renders };
  },
  { schema: z.object({ episodeId: z.string().uuid() }) },
);
