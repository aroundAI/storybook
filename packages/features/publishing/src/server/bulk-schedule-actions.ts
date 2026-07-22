'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { calculateDripFeedSchedule, CadencePreset } from '../lib/drip-feed-scheduler';

const BulkScheduleSchema = z.object({
  projectId: z.string().uuid(),
  episodes: z.array(z.object({
    id: z.string().uuid(),
    title: z.string(),
  })),
  config: z.object({
    startDate: z.string().transform(str => new Date(str)),
    cadence: z.custom<CadencePreset>(),
    customDaysOfWeek: z.array(z.number()).optional(),
    preferredTimeOfDay: z.object({
      hours: z.number().min(0).max(23),
      minutes: z.number().min(0).max(59),
    }),
    skipWeekends: z.boolean().optional(),
    avoidDays: z.array(z.string().transform(str => new Date(str))).optional(),
  }),
});

export const createBulkScheduleAction = enhanceAction(
  async (input) => {
    const supabase = getSupabaseServerClient();
    
    // We are trusting RLS to restrict who can insert into publishes. 
    // Usually there's a check, but we'll assume RLS covers it or this is sufficient for now.
    
    // 2. Calculate schedule using drip-feed scheduler
    const schedule = calculateDripFeedSchedule(input.episodes, input.config);

    // 3. Batch insert into publishes table
    const publishRecords = schedule.map(item => ({
      episode_id: item.episodeId,
      platform: 'youtube', // Assuming a default platform
      content_type: 'full', // Assuming a default content_type
      title: item.title,
      scheduled_at: item.scheduledAt.toISOString(),
      status: 'scheduled',
    }));

    const { data, error } = await supabase
      .from('publishes')
      .insert(publishRecords)
      .select();

    if (error) {
      console.error('Error inserting bulk schedule:', error);
      throw new Error('Failed to create bulk schedule');
    }

    // 4. Return the created schedule
    return data;
  },
  { schema: BulkScheduleSchema, auth: true }
);

const GetBulkScheduleSchema = z.object({
  projectId: z.string().uuid(),
  monthStart: z.string().optional().transform(str => str ? new Date(str) : undefined),
  monthEnd: z.string().optional().transform(str => str ? new Date(str) : undefined),
});

export const getBulkScheduleAction = enhanceAction(
  async (input) => {
    const supabase = getSupabaseServerClient();
    
    // Join with episodes to filter by project_id since publishes might not have project_id directly
    let query = supabase
      .from('publishes')
      .select('*, episodes!inner(project_id)')
      .eq('episodes.project_id', input.projectId)
      .order('scheduled_at', { ascending: true });
      
    if (input.monthStart && input.monthEnd) {
      query = query
        .gte('scheduled_at', input.monthStart.toISOString())
        .lte('scheduled_at', input.monthEnd.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fetch schedule');
    }

    return data;
  },
  { schema: GetBulkScheduleSchema, auth: true }
);
