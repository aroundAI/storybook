'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { GetScheduledPublishesSchema } from '../lib/schemas/dashboard.schema';

export type Platform =
  | 'youtube'
  | 'tiktok'
  | 'instagram'
  | 'facebook'
  | 'twitter'
  | 'linkedin';

export interface ScheduledPublish {
  id: string;
  platform: Platform;
  title: string;
  episodeTitle: string;
  scheduledAt: string;
}

/**
 * Get upcoming scheduled publishes for an account
 */
export const getScheduledPublishesAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    const { data: publishes } = await client
      .from('publishes')
      .select(
        `
        id,
        platform,
        title,
        scheduled_at,
        episodes!inner(
          title,
          projects!inner(account_id)
        )
      `,
      )
      .eq('status', 'scheduled')
      .not('scheduled_at', 'is', null)
      .gt('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(data.limit);

    if (!publishes) {
      return [];
    }

    // Filter by account_id (since we can't directly filter in the query)
    const accountPublishes = publishes.filter((pub) => {
      const episode = pub.episodes as unknown as {
        title: string;
        projects: { account_id: string };
      };
      return episode?.projects?.account_id === data.accountId;
    });

    return accountPublishes.map((publish) => {
      const episode = publish.episodes as unknown as {
        title: string;
        projects: { account_id: string };
      };

      return {
        id: publish.id,
        platform: publish.platform as Platform,
        title: publish.title || 'Untitled',
        episodeTitle: episode?.title || 'Unknown episode',
        scheduledAt: publish.scheduled_at!,
      };
    });
  },
  {
    schema: GetScheduledPublishesSchema,
  },
);
