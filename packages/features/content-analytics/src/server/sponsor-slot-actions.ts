'use server';

import 'server-only';
import { z } from 'zod';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';

const logger = getLogger();

export const createSponsorSlotAction = enhanceAction(
  async (params) => {
    const client = getSupabaseServerClient();
    const { data, error } = await client
      .from('sponsor_slots')
      .insert({
        account_id: params.accountId,
        episode_id: params.episodeId,
        project_id: params.projectId,
        brand_name: params.brandName,
        brand_logo_url: params.brandLogoUrl,
        campaign_name: params.campaignName,
        slot_type: params.slotType,
        start_seconds: params.startSeconds,
        end_seconds: params.endSeconds,
        duration_seconds: params.durationSeconds,
        rate_cents: params.rateCents,
        rate_type: params.rateType,
        currency: params.currency,
        is_paid: params.isPaid || false,
        paid_at: params.paidAt,
        invoice_url: params.invoiceUrl,
        talking_points: params.talkingPoints,
        script_text: params.scriptText,
        cta_url: params.ctaUrl,
        promo_code: params.promoCode,
        status: params.status,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create sponsor slot: ${error.message}`);
    }

    return data;
  },
  {
    auth: true,
    schema: z.object({
      accountId: z.string().uuid(),
      episodeId: z.string().uuid(),
      projectId: z.string().uuid(),
      brandName: z.string().min(1),
      brandLogoUrl: z.string().nullable().optional(),
      campaignName: z.string().nullable().optional(),
      slotType: z.enum(['pre_roll', 'mid_roll', 'post_roll', 'dedicated', 'product_placement', 'overlay']).default('mid_roll'),
      startSeconds: z.number().nullable().optional(),
      endSeconds: z.number().nullable().optional(),
      durationSeconds: z.number().nullable().optional(),
      rateCents: z.number().nullable().optional(),
      rateType: z.enum(['flat', 'cpm', 'cpc', 'revenue_share', 'barter']).default('flat'),
      currency: z.string().default('USD'),
      isPaid: z.boolean().default(false),
      paidAt: z.string().nullable().optional(),
      invoiceUrl: z.string().nullable().optional(),
      talkingPoints: z.string().nullable().optional(),
      scriptText: z.string().nullable().optional(),
      ctaUrl: z.string().nullable().optional(),
      promoCode: z.string().nullable().optional(),
      status: z.enum(['draft', 'confirmed', 'recorded', 'published', 'completed', 'cancelled']).default('draft'),
    }),
  }
);

export const getSponsorSlotsAction = enhanceAction(
  async (params) => {
    const client = getSupabaseServerClient();
    
    let query = client
      .from('sponsor_slots')
      .select(`
        *,
        episode:episodes(title)
      `);

    if (params.episodeId) {
      query = query.eq('episode_id', params.episodeId);
    }
    if (params.projectId) {
      query = query.eq('project_id', params.projectId);
    }
    if (params.status) {
      query = query.eq('status', params.status);
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch sponsor slots: ${error.message}`);
    }

    return data.map((item: any) => ({
      ...item,
      episodeTitle: item.episode?.title || 'Unknown Episode'
    }));
  },
  {
    auth: true,
    schema: z.object({
      episodeId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      status: z.string().optional(),
    }),
  }
);

export const updateSponsorSlotAction = enhanceAction(
  async (params) => {
    const client = getSupabaseServerClient();
    
    const { slotId, ...updates } = params;
    
    const { data, error } = await client
      .from('sponsor_slots')
      .update(updates)
      .eq('id', slotId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update sponsor slot: ${error.message}`);
    }

    return data;
  },
  {
    auth: true,
    schema: z.object({
      slotId: z.string().uuid(),
    }).catchall(z.any()),
  }
);

export const deleteSponsorSlotAction = enhanceAction(
  async (params) => {
    const client = getSupabaseServerClient();
    
    const { error } = await client
      .from('sponsor_slots')
      .delete()
      .eq('id', params.slotId);

    if (error) {
      throw new Error(`Failed to delete sponsor slot: ${error.message}`);
    }

    return { success: true };
  },
  {
    auth: true,
    schema: z.object({
      slotId: z.string().uuid(),
    }),
  }
);

export const markSlotPaidAction = enhanceAction(
  async (params) => {
    const client = getSupabaseServerClient();
    
    const { data, error } = await client
      .from('sponsor_slots')
      .update({
        is_paid: true,
        paid_at: new Date().toISOString(),
        invoice_url: params.invoiceUrl || null,
      })
      .eq('id', params.slotId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to mark slot as paid: ${error.message}`);
    }

    return data;
  },
  {
    auth: true,
    schema: z.object({
      slotId: z.string().uuid(),
      invoiceUrl: z.string().optional(),
    }),
  }
);

export const getSponsorRevenueAction = enhanceAction(
  async (params) => {
    const client = getSupabaseServerClient();
    
    let query = client
      .from('sponsor_slots')
      .select('rate_cents, is_paid, brand_name')
      .eq('account_id', params.accountId)
      .not('status', 'in', '("cancelled", "draft")');

    if (params.projectId) {
      query = query.eq('project_id', params.projectId);
    }
    
    if (params.startDate) {
      query = query.gte('created_at', params.startDate);
    }
    
    if (params.endDate) {
      query = query.lte('created_at', params.endDate);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch sponsor revenue: ${error.message}`);
    }

    let totalRevenueCents = 0;
    let paidCents = 0;
    let unpaidAmount = 0;
    const brandBreakdown: Record<string, number> = {};

    data.forEach(slot => {
      const rate = slot.rate_cents || 0;
      totalRevenueCents += rate;
      
      if (slot.is_paid) {
        paidCents += rate;
      } else {
        unpaidAmount += rate;
      }
      
      if (slot.brand_name) {
        brandBreakdown[slot.brand_name] = (brandBreakdown[slot.brand_name] || 0) + rate;
      }
    });

    return {
      totalRevenueCents,
      paidCents,
      unpaidAmount,
      slotCount: data.length,
      brandBreakdown,
    };
  },
  {
    auth: true,
    schema: z.object({
      accountId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }),
  }
);
