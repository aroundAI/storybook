
import { NextResponse } from 'next/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { buildEpisodeContext } from '@kit/episodes/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const episodeId = searchParams.get('id');

    const client = getSupabaseServerClient();

    // If no ID, list recent episodes to choose from
    if (!episodeId) {
        const { data: episodes } = await client
            .from('episodes')
            .select('id, number, title, project_id')
            .order('created_at', { ascending: false })
            .limit(5);

        return NextResponse.json({
            message: 'Provide ?id=<episode_id> to see context',
            recent_episodes: episodes,
        });
    }

    try {
        console.log(`Building context for episode ${episodeId}...`);
        const startTime = Date.now();

        // Build the context
        const context = await buildEpisodeContext(episodeId);

        const duration = Date.now() - startTime;

        return NextResponse.json({
            success: true,
            duration_ms: duration,
            context,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;

        return NextResponse.json(
            {
                success: false,
                error: message,
                stack: stack,
            },
            { status: 500 },
        );
    }
}
