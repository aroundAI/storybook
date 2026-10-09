import 'server-only';

import {
  type FollowUpSnapshot,
  buildFollowUpSnapshot,
} from '@kit/generation/follow-up';
import type { Database } from '@kit/supabase/database';
import type { getSupabaseServerClient } from '@kit/supabase/server-client';

type Client = ReturnType<typeof getSupabaseServerClient<Database>>;

/**
 * FILM-2206: the `metadata.follow_up` a new episode carries when it follows
 * up another of its project, for the web dialog and MCP create_episode.
 * The snapshot is frozen now, through the FILM-1912 reader on the caller's
 * client, so every brief written for the episode reads the same evidence.
 */
export async function followUpMetadata(
  client: Client,
  input: { projectId: string; episodeId: string },
): Promise<
  | {
      ok: true;
      snapshot: FollowUpSnapshot;
      metadata: { follow_up: Record<string, unknown> };
    }
  | { ok: false; refusal: string }
> {
  const { createPerformanceReader } = await import(
    '@kit/content-analytics/server/performance-reader'
  );

  const snapshot = await buildFollowUpSnapshot(
    client,
    createPerformanceReader(client),
    input,
  );

  if (!snapshot) {
    return {
      ok: false,
      refusal:
        'The episode it follows up must be a live episode of this project.',
    };
  }

  return {
    ok: true,
    snapshot,
    metadata: { follow_up: { episode_id: snapshot.episodeId, snapshot } },
  };
}
