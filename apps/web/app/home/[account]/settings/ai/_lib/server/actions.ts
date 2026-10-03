'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { whyNoRow } from '@kit/shared/rows';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  AiSettingsSchema,
  UpdateAccountAiSettingsSchema,
  aiSettingsProblem,
} from '../schemas/ai-settings.schema';

const OWNERS_ONLY = 'Only team owners can change the AI settings.';

/**
 * Writes the team's AI mode policy (FILM-1910) as the signed-in user, so
 * RLS decides who may: owners write, members read
 * (account_ai_settings_insert/_update). Both modes off, or a default the
 * team does not allow, is refused here as a value, and by the table's
 * CHECK constraints for any other writer.
 */
export const updateAccountAiSettingsAction = returnRefusals(
  enhanceAction(
    async ({ accountSlug, ...settings }) => {
      const problem = aiSettingsProblem(settings);

      if (problem) throw new ActionRefusal(problem);

      const client = getSupabaseServerClient();

      const { data: account, error: accountError } = await client
        .from('accounts')
        .select('id')
        .eq('slug', accountSlug)
        .single();

      if (accountError || !account) {
        throw new Error(whyNoRow(accountError, 'Account not found'));
      }

      const { data, error } = await client
        .from('account_ai_settings')
        .upsert(
          {
            account_id: account.id,
            server_generation_enabled: settings.serverGenerationEnabled,
            external_generation_enabled: settings.externalGenerationEnabled,
            default_mode: settings.defaultMode,
          },
          { onConflict: 'account_id' },
        )
        .select(
          'server_generation_enabled, external_generation_enabled, default_mode',
        )
        .maybeSingle();

      // RLS refuses a member's insert with 42501; a member's update of an
      // existing row matches nothing and returns no row
      if (error?.code === '42501' || (!error && !data)) {
        throw new ActionRefusal(OWNERS_ONLY);
      }

      if (error?.code === '23514') {
        throw new ActionRefusal(
          'These AI settings are not allowed: keep a mode on, and make the default an allowed mode.',
        );
      }

      if (error || !data) {
        throw new Error(
          `Could not save the AI settings (${error?.code}): ${error?.message}`,
        );
      }

      revalidatePath(`/home/${accountSlug}/settings/ai`);

      return AiSettingsSchema.parse({
        serverGenerationEnabled: data.server_generation_enabled,
        externalGenerationEnabled: data.external_generation_enabled,
        defaultMode: data.default_mode,
      });
    },
    { schema: UpdateAccountAiSettingsSchema, auth: true },
  ),
);
