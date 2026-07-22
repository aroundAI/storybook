'use server';

import 'server-only';
import { z } from 'zod';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { getLogger } from '@kit/shared/logger';
import { enhanceAction } from '@kit/next/actions';

const getReviewsSchema = z.object({
  accountId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  status: z.enum(['pending', 'in_review', 'completed', 'skipped']).optional(),
});

export const getReviewsAction = enhanceAction(
  async ({ accountId, projectId, status }) => {
    const logger = await getLogger();
    const client = getSupabaseServerClient();
    
    let query = client
      .from('content_reviews')
      .select(`
        *,
        publish:publish_id (title, platform, language),
        episode:episode_id (title)
      `)
      .eq('account_id', accountId)
      .order('review_due_at', { ascending: true });
      
    if (projectId) {
      query = query.eq('project_id', projectId);
    }
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query;
    
    if (error) {
      logger.error({ error, accountId }, 'Failed to fetch content reviews');
      throw new Error('Failed to fetch content reviews');
    }
    
    return data;
  },
  {
    auth: true,
    schema: getReviewsSchema,
  }
);

const getReviewSchema = z.object({
  reviewId: z.string().uuid(),
});

export const getReviewAction = enhanceAction(
  async ({ reviewId }) => {
    const logger = await getLogger();
    const client = getSupabaseServerClient();
    
    const { data, error } = await client
      .from('content_reviews')
      .select(`
        *,
        publish:publish_id (title, platform, language),
        episode:episode_id (title)
      `)
      .eq('id', reviewId)
      .single();
      
    if (error) {
      logger.error({ error, reviewId }, 'Failed to fetch content review');
      throw new Error('Failed to fetch content review');
    }
    
    return data;
  },
  {
    auth: true,
    schema: getReviewSchema,
  }
);

const generateReviewsSchema = z.object({
  accountId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
});

export const generateReviewsAction = enhanceAction(
  async ({ accountId, projectId }) => {
    const logger = await getLogger();
    const client = getSupabaseServerClient();
    
    // In a real implementation, this would look up publishes published <= 30 days ago
    // For now, this is a simplified stub that generates reviews
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    let query = client
      .from('publishes')
      .select('id, episode_id, project_id, account_id, published_at')
      .eq('account_id', accountId)
      .lte('published_at', thirtyDaysAgo.toISOString());
      
    if (projectId) {
      query = query.eq('project_id', projectId);
    }
    
    const { data: eligiblePublishes, error } = await query;
    
    if (error) {
      logger.error({ error }, 'Failed to fetch eligible publishes');
      throw new Error('Failed to fetch eligible publishes');
    }
    
    if (!eligiblePublishes || eligiblePublishes.length === 0) {
      return { count: 0 };
    }
    
    let generatedCount = 0;
    
    for (const publish of eligiblePublishes) {
      // Check if a day_30 review already exists
      const { data: existingReview } = await client
        .from('content_reviews')
        .select('id')
        .eq('publish_id', publish.id)
        .eq('review_type', 'day_30')
        .single();
        
      if (existingReview) {
        continue;
      }
      
      const dueAt = new Date(publish.published_at);
      dueAt.setDate(dueAt.getDate() + 30);
      
      const { error: insertError } = await client
        .from('content_reviews')
        .insert({
          account_id: publish.account_id,
          project_id: publish.project_id,
          episode_id: publish.episode_id,
          publish_id: publish.id,
          review_type: 'day_30',
          review_due_at: dueAt.toISOString(),
          status: 'pending',
          performance_snapshot: {
            views: Math.floor(Math.random() * 10000),
            likes: Math.floor(Math.random() * 500),
            comments: Math.floor(Math.random() * 100),
            watchTimeSeconds: Math.floor(Math.random() * 50000),
            revenueCents: Math.floor(Math.random() * 5000)
          },
          benchmarks: {
            projectAvg: {
              views: 5000,
              likes: 250,
            },
            percentileRank: Math.floor(Math.random() * 100)
          },
          verdict: 'on_track' // Simplified logic
        });
        
      if (insertError) {
        logger.error({ error: insertError, publishId: publish.id }, 'Failed to insert content review');
      } else {
        generatedCount++;
      }
    }
    
    return { count: generatedCount };
  },
  {
    auth: true,
    schema: generateReviewsSchema,
  }
);

const completeReviewSchema = z.object({
  reviewId: z.string().uuid(),
  verdict: z.enum(['outperforming', 'on_track', 'underperforming', 'needs_attention']),
  notes: z.string().optional(),
  actionItems: z.array(z.object({
    title: z.string(),
    completed: z.boolean()
  })).default([]),
});

export const completeReviewAction = enhanceAction(
  async ({ reviewId, verdict, notes, actionItems }) => {
    const logger = await getLogger();
    const client = getSupabaseServerClient();
    
    const { data: user } = await client.auth.getUser();
    
    const { error } = await client
      .from('content_reviews')
      .update({
        status: 'completed',
        verdict,
        notes: notes || null,
        action_items: actionItems,
        reviewed_by: user?.user?.id,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', reviewId);
      
    if (error) {
      logger.error({ error, reviewId }, 'Failed to complete content review');
      throw new Error('Failed to complete content review');
    }
    
    return { success: true };
  },
  {
    auth: true,
    schema: completeReviewSchema,
  }
);

const skipReviewSchema = z.object({
  reviewId: z.string().uuid(),
  reason: z.string().optional(),
});

export const skipReviewAction = enhanceAction(
  async ({ reviewId, reason }) => {
    const logger = await getLogger();
    const client = getSupabaseServerClient();
    
    const { data: user } = await client.auth.getUser();
    
    const { error } = await client
      .from('content_reviews')
      .update({
        status: 'skipped',
        notes: reason || null,
        reviewed_by: user?.user?.id,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', reviewId);
      
    if (error) {
      logger.error({ error, reviewId }, 'Failed to skip content review');
      throw new Error('Failed to skip content review');
    }
    
    return { success: true };
  },
  {
    auth: true,
    schema: skipReviewSchema,
  }
);

const getReviewSummarySchema = z.object({
  accountId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
});

export const getReviewSummaryAction = enhanceAction(
  async ({ accountId, projectId }) => {
    const logger = await getLogger();
    const client = getSupabaseServerClient();
    
    let query = client
      .from('content_reviews')
      .select('status', { count: 'exact' })
      .eq('account_id', accountId);
      
    if (projectId) {
      query = query.eq('project_id', projectId);
    }
    
    const { data, error } = await query;
    
    if (error) {
      logger.error({ error, accountId }, 'Failed to fetch review summary');
      throw new Error('Failed to fetch review summary');
    }
    
    const summary = {
      pending: 0,
      inReview: 0,
      completed: 0,
      skipped: 0
    };
    
    if (data) {
      data.forEach(item => {
        if (item.status === 'pending') summary.pending++;
        else if (item.status === 'in_review') summary.inReview++;
        else if (item.status === 'completed') summary.completed++;
        else if (item.status === 'skipped') summary.skipped++;
      });
    }
    
    return summary;
  },
  {
    auth: true,
    schema: getReviewSummarySchema,
  }
);

const updateActionItemSchema = z.object({
  reviewId: z.string().uuid(),
  actionItemIndex: z.number().int().min(0),
  completed: z.boolean(),
});

export const updateActionItemAction = enhanceAction(
  async ({ reviewId, actionItemIndex, completed }) => {
    const logger = await getLogger();
    const client = getSupabaseServerClient();
    
    const { data: review, error: fetchError } = await client
      .from('content_reviews')
      .select('action_items')
      .eq('id', reviewId)
      .single();
      
    if (fetchError || !review) {
      logger.error({ error: fetchError, reviewId }, 'Failed to fetch review for action item update');
      throw new Error('Failed to fetch review');
    }
    
    const actionItems = Array.isArray(review.action_items) ? [...review.action_items] : [];
    
    if (actionItemIndex >= actionItems.length) {
      throw new Error('Action item index out of bounds');
    }
    
    // Assuming action items is an array of objects
    if (typeof actionItems[actionItemIndex] === 'object' && actionItems[actionItemIndex] !== null) {
      (actionItems[actionItemIndex] as any).completed = completed;
    }
    
    const { error: updateError } = await client
      .from('content_reviews')
      .update({ action_items: actionItems })
      .eq('id', reviewId);
      
    if (updateError) {
      logger.error({ error: updateError, reviewId }, 'Failed to update action item');
      throw new Error('Failed to update action item');
    }
    
    return { success: true };
  },
  {
    auth: true,
    schema: updateActionItemSchema,
  }
);
