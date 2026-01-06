'use server';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { requireUser } from '@kit/supabase/require-user';
import { z } from 'zod';

function formatSrtTime(seconds: number): string {
    const date = new Date(0);
    date.setUTCMilliseconds(seconds * 1000);
    const iso = date.toISOString();
    // ISO format: 1970-01-01T00:00:00.000Z
    // SRT format: 00:00:00,000
    return iso.slice(11, 23).replace('.', ',');
}

export const getEpisodeCaptionsAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const client = getSupabaseServerClient();
        const { error } = await requireUser(client);

        if (error) {
            throw new Error('Authentication required');
        }

        // Fetch dialogue lines
        const { data: dialogueLines, error: fetchError } = await client
            .from('dialogue_lines')
            .select('*')
            .eq('episode_id', data.episodeId)
            .eq('status', 'completed')
            .not('timeline_start_seconds', 'is', null) // Only lines placed on timeline
            .order('timeline_start_seconds', { ascending: true });

        if (fetchError) {
            logger.error({ error: fetchError }, 'Failed to fetch dialogue for captions');
            throw new Error('Failed to fetch dialogue');
        }

        if (!dialogueLines || dialogueLines.length === 0) {
            return { srt: '' };
        }

        let srtContent = '';
        let counter = 1;

        for (const line of dialogueLines) {
            const start = line.timeline_start_seconds!;
            // Use metadata duration or estimated duration
            const duration = (line.generation_metadata as { durationSeconds?: number })?.durationSeconds
                ?? line.estimated_duration_seconds
                ?? 3;
            const end = start + duration;

            srtContent += `${counter}\n`;
            srtContent += `${formatSrtTime(start)} --> ${formatSrtTime(end)}\n`;
            // Clean text (remove speaker names if encoded like "Name: text")
            // Assuming text is just the spoken content.
            // If text contains newline, SRT handles it.
            srtContent += `${line.text.trim()}\n\n`;

            counter++;
        }

        return { srt: srtContent };
    },
    {
        schema: z.object({
            episodeId: z.string().uuid(),
            format: z.enum(['srt', 'vtt']).default('srt'),
        }),
    }
);
