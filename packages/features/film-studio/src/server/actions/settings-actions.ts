'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  DEFAULT_GENERATION_SETTINGS,
  type GenerationSettings,
  GenerationSettingsSchema,
} from '../../schema/generation-settings.schema';

/**
 * Get generation settings for an account
 * Returns stored settings merged with defaults
 */
export async function getGenerationSettings(
  accountId: string,
): Promise<GenerationSettings> {
  const client = getSupabaseServerClient();

  const { data: account } = await client
    .from('accounts')
    .select('public_data')
    .eq('id', accountId)
    .single();

  const publicData = account?.public_data as Record<string, unknown> | null;
  const savedSettings = publicData?.generationSettings as
    | Partial<GenerationSettings>
    | undefined;

  return {
    ...DEFAULT_GENERATION_SETTINGS,
    ...savedSettings,
  };
}

/**
 * Schema for update action with accountId
 */
const UpdateGenerationSettingsSchema = GenerationSettingsSchema.extend({
  accountId: z.string().uuid(),
});

/**
 * Update generation settings for an account
 */
export const updateGenerationSettingsAction = enhanceAction(
  async (data: z.infer<typeof UpdateGenerationSettingsSchema>) => {
    const logger = await getLogger();
    const client = getSupabaseServerClient();

    const ctx = {
      name: 'generation-settings.update',
      accountId: data.accountId,
    };

    logger.info(ctx, 'Updating generation settings');

    // Get current account data
    const { data: account, error: fetchError } = await client
      .from('accounts')
      .select('public_data')
      .eq('id', data.accountId)
      .single();

    if (fetchError) {
      logger.error({ ...ctx, error: fetchError }, 'Failed to fetch account');
      throw new Error('Failed to fetch account data');
    }

    const currentPublicData =
      (account?.public_data as Record<string, unknown>) || {};

    // Extract settings from data (excluding accountId)
    const { accountId: _, ...settings } = data;

    // Merge settings into public_data
    const updatedPublicData = {
      ...currentPublicData,
      generationSettings: settings,
      // Also update monthlyVideoBudgetCents for backwards compatibility with cost-tracking
      monthlyVideoBudgetCents: settings.monthlyBudgetCents,
    };

    // Update account
    const { error: updateError } = await client
      .from('accounts')
      .update({ public_data: updatedPublicData })
      .eq('id', data.accountId);

    if (updateError) {
      logger.error({ ...ctx, error: updateError }, 'Failed to update settings');
      throw new Error('Failed to save settings');
    }

    logger.info(ctx, 'Generation settings updated successfully');

    // Revalidate the settings page
    revalidatePath('/home/[account]/settings/generation', 'page');

    return { success: true };
  },
  {
    schema: UpdateGenerationSettingsSchema,
  },
);
