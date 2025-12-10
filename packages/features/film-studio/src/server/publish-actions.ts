'use server';

import 'server-only';

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
 * Safely extracts a nested property from Supabase join data
 */
function safeGetNestedProperty<T>(
  obj: unknown,
  path: string[],
  defaultValue: T,
): T {
  let current: unknown = obj;
  for (const key of path) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return defaultValue;
    }
  }
  return current as T;
}

/**
 * Get upcoming scheduled publishes for an account
 */
export const getScheduledPublishesAction = enhanceAction(
  async (data) => {
    try {
      const client = getSupabaseServerClient();

      // Fetch more than the limit since we filter by account after
      const { data: publishes, error } = await client
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
        .limit(data.limit * 3); // Fetch more since we filter by account

      if (error) {
        throw new Error(
          `Failed to fetch scheduled publishes: ${error.message}`,
        );
      }

      if (!publishes) {
        return [];
      }

      // Filter by account_id and transform
      const result: ScheduledPublish[] = [];

      for (const publish of publishes) {
        // Stop if we have enough results
        if (result.length >= data.limit) {
          break;
        }

        const accountId = safeGetNestedProperty<string>(
          publish.episodes,
          ['projects', 'account_id'],
          '',
        );

        // Skip if not matching account
        if (accountId !== data.accountId) {
          continue;
        }

        const episodeTitle = safeGetNestedProperty<string>(
          publish.episodes,
          ['title'],
          'Unknown episode',
        );

        result.push({
          id: publish.id,
          platform: publish.platform as Platform,
          title: publish.title || 'Untitled',
          episodeTitle,
          scheduledAt: publish.scheduled_at!,
        });
      }

      return result;
    } catch (error) {
      console.error('Error fetching scheduled publishes:', error);
      throw error;
    }
  },
  {
    schema: GetScheduledPublishesSchema,
  },
);
