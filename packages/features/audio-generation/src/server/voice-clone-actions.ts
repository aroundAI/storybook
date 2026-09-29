'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import {
  requireAffectedRows,
  requireRow,
  returnRefusals,
} from '@kit/next/refusals';
import { authorizeProjectTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { whyNoRow } from '@kit/shared/rows';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  CheckCloneStatusSchemaType,
  CloneStatusType,
  DeleteVoiceCloneSchemaType,
  StartVoiceCloneSchemaType,
} from '../lib/schemas';
import {
  CheckCloneStatusSchema,
  DeleteVoiceCloneSchema,
  StartVoiceCloneSchema,
} from '../lib/schemas';
import { ElevenLabsProvider } from '../providers/elevenlabs';
import { getAccountElevenLabsApiKey } from './project-audio-settings';

/**
 * Start voice cloning process
 *
 * This action:
 * 1. Stores the consent record for legal compliance
 * 2. Downloads audio samples from storage URLs
 * 3. Calls ElevenLabs API to create a cloned voice
 * 4. Updates the voice profile with the cloned voice ID
 */
const startVoiceClone = enhanceAction(
  async (data: StartVoiceCloneSchemaType) => {
    const logger = await getLogger();
    const ctx = { name: 'voice-clone.start', assetId: data.assetId };

    logger.info(ctx, 'Starting voice clone');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized voice clone attempt');
      throw new Error('Authentication required');
    }

    // Get asset to determine account_id
    const asset = requireRow(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('assets')
        .select('id, project_id, projects(account_id)')
        .eq('id', data.assetId)
        .single(),
      'Asset not found',
    );

    // Cloning spends the account's ElevenLabs key: the caller must be able
    // to write the asset's project, not only read it (KB-112, the KB-46 rule)
    const target = await authorizeProjectTarget(client, asset.project_id);

    if (!target) {
      logger.warn(ctx, 'Voice clone refused: no write access to the project');
      throw new ActionRefusal('Asset not found');
    }

    const { accountId } = target;

    // Store consent record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: consentError } = await (client as any)
      .from('voice_consent')
      .upsert({
        voice_profile_id: data.assetId,
        consenter_name: data.consent.consenterName,
        consenter_email: data.consent.consenterEmail || null,
        consent_type: data.consent.consentType,
        consent_text: data.consent.consentText,
        consent_signature: data.consent.consentSignature || null,
      });

    if (consentError) {
      logger.error({ ...ctx, error: consentError }, 'Failed to store consent');
      throw new Error('Failed to store consent record');
    }

    // Update voice profile status to pending. A clone RLS refuses changes no
    // row: it stops here, before the paid ElevenLabs call (KB-105).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pending, error: pendingError } = await (client as any)
      .from('voice_profiles')
      .update({
        clone_samples: data.samples,
        clone_status: 'pending',
        clone_metadata: { training_started_at: new Date().toISOString() },
      })
      .eq('asset_id', data.assetId)
      .select('id');

    if (pendingError) {
      throw new Error(
        `Failed to start the voice clone: ${pendingError.message}`,
      );
    }

    requireAffectedRows(pending, "You can't clone this voice.");

    try {
      // Get API key and create provider
      const apiKey = await getAccountElevenLabsApiKey(accountId);
      const provider = new ElevenLabsProvider({
        apiKey,
        timeout: 120000, // 2 minute timeout for large uploads
        maxRetries: 3,
      });

      // Download audio files and convert to buffers
      const audioBuffers: Buffer[] = [];
      for (const sampleUrl of data.samples) {
        const response = await fetch(sampleUrl);
        if (!response.ok) {
          throw new Error(`Failed to download sample: ${sampleUrl}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        audioBuffers.push(Buffer.from(arrayBuffer));
      }

      logger.info(
        { ...ctx, sampleCount: audioBuffers.length },
        'Downloaded audio samples',
      );

      // Clone voice via ElevenLabs
      const result = await provider.cloneVoice({
        name: data.voiceName,
        description: data.description,
        audioFiles: audioBuffers,
      });

      // Update voice profile with success
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('voice_profiles')
        .update({
          provider: 'elevenlabs',
          provider_voice_id: result.voiceId,
          clone_status: result.status,
          clone_metadata: {
            training_started_at: new Date().toISOString(),
            training_completed_at: new Date().toISOString(),
            voice_name: result.name,
          },
        })
        .eq('asset_id', data.assetId);

      logger.info(
        { ...ctx, voiceId: result.voiceId, status: result.status },
        'Voice clone completed',
      );

      revalidatePath('/home/[account]/studio/[projectId]/assets', 'page');

      return {
        success: true,
        voiceId: result.voiceId,
        status: result.status as CloneStatusType,
      };
    } catch (error) {
      // Update voice profile with failure
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('voice_profiles')
        .update({
          clone_status: 'failed',
          clone_metadata: {
            training_started_at: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        })
        .eq('asset_id', data.assetId);

      logger.error({ ...ctx, error }, 'Voice clone failed');
      throw error;
    }
  },
  {
    schema: StartVoiceCloneSchema,
  },
);

export const startVoiceCloneAction = returnRefusals(startVoiceClone);

/**
 * Delete a cloned voice
 *
 * This action:
 * 1. Deletes the voice from ElevenLabs
 * 2. Clears clone data from voice_profiles
 * 3. Deletes the consent record
 */
const deleteVoiceClone = enhanceAction(
  async (data: DeleteVoiceCloneSchemaType) => {
    const logger = await getLogger();
    const ctx = { name: 'voice-clone.delete', assetId: data.assetId };

    logger.info(ctx, 'Deleting voice clone');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized voice clone deletion attempt');
      throw new Error('Authentication required');
    }

    // Get voice profile with provider_voice_id
    const profile = requireRow(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('voice_profiles')
        .select('provider_voice_id, assets(project_id, projects(account_id))')
        .eq('asset_id', data.assetId)
        .single(),
      'Voice profile not found',
    );

    // Deleting spends the account's ElevenLabs key and removes the voice for
    // every project: the caller must be able to write this one (KB-112)
    const projectId = profile.assets?.project_id;
    const target = projectId
      ? await authorizeProjectTarget(client, projectId)
      : null;

    if (!target) {
      logger.warn(ctx, 'Voice clone deletion refused: no write access');
      throw new ActionRefusal('Voice profile not found');
    }

    const { accountId } = target;

    // Delete from ElevenLabs if we have a provider_voice_id
    if (profile.provider_voice_id && accountId) {
      try {
        const apiKey = await getAccountElevenLabsApiKey(accountId);
        const provider = new ElevenLabsProvider({
          apiKey,
          timeout: 30000,
          maxRetries: 2,
        });
        await provider.deleteClonedVoice(profile.provider_voice_id);
        logger.info(
          { ...ctx, providerVoiceId: profile.provider_voice_id },
          'Deleted voice from ElevenLabs',
        );
      } catch (error) {
        // Log but don't fail - the voice might already be deleted
        logger.warn(
          { ...ctx, error },
          'Failed to delete from ElevenLabs (may already be deleted)',
        );
      }
    }

    // Clear clone data from voice_profiles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cleared, error: clearError } = await (client as any)
      .from('voice_profiles')
      .update({
        provider_voice_id: null,
        clone_samples: null,
        clone_status: null,
        clone_metadata: {},
      })
      .eq('asset_id', data.assetId)
      .select('asset_id');

    if (clearError) {
      throw new Error(`Failed to clear the voice clone: ${clearError.message}`);
    }

    requireAffectedRows(cleared, "The voice clone wasn't removed.");

    // Delete consent record (cascade should handle this, but be explicit)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('voice_consent')
      .delete()
      .eq('voice_profile_id', data.assetId);

    logger.info(ctx, 'Voice clone deleted successfully');
    revalidatePath('/home/[account]/studio/[projectId]/assets', 'page');

    return { success: true };
  },
  {
    schema: DeleteVoiceCloneSchema,
  },
);

export const deleteVoiceCloneAction = returnRefusals(deleteVoiceClone);

/**
 * Check the status of a voice clone
 */
export const checkCloneStatusAction = enhanceAction(
  async (data: CheckCloneStatusSchemaType) => {
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile, error } = await (client as any)
      .from('voice_profiles')
      .select('clone_status, clone_metadata, provider_voice_id')
      .eq('asset_id', data.assetId)
      .single();

    if (error || !profile) {
      throw new Error(whyNoRow(error, 'Voice profile not found'));
    }

    return {
      status: profile.clone_status as CloneStatusType | null,
      metadata: profile.clone_metadata as Record<string, unknown>,
      voiceId: profile.provider_voice_id as string | null,
    };
  },
  {
    schema: CheckCloneStatusSchema,
  },
);
