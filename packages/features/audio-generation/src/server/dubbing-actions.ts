'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { createLLMClient } from '@kit/llm';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getStorageAdapter } from '@kit/storage';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { DEFAULT_VOICE_SETTINGS } from '../lib/constants';
import {
  MULTILINGUAL_VOICE_MODEL,
  getLanguageName,
} from '../lib/dubbing-languages';
import {
  estimateTranslationCost,
  estimateVoiceGenerationCost,
} from '../lib/dubbing-utils';
import type {
  CreateDubbedVersionResult,
  CreateDubbedVersionSchemaType,
  DubbedDialogueLineResponse,
  DubbedVersionResponse,
  GenerateDubbedAudioResult,
  GenerateDubbedAudioSchemaType,
  TranslateDialogueResult,
  TranslateDialogueSchemaType,
  UpdateDubbedLineResult,
  UpdateDubbedLineSchemaType,
} from '../lib/schemas/dubbing.schema';
import {
  CreateDubbedVersionSchema,
  GenerateDubbedAudioSchema,
  TranslateDialogueSchema,
  UpdateDubbedLineSchema,
} from '../lib/schemas/dubbing.schema';
import { ElevenLabsProvider } from '../providers/elevenlabs';
import {
  getCharacterVoiceProfile,
  getDubbedLinesWithOriginal,
  getDubbedVersionWithContext,
} from './dubbing-queries';
import { checkAccountBudget, incrementAccountUsage } from './voice-queries';
import { getAccountElevenLabsApiKey } from './project-audio-settings';

// Note: These actions use type assertions because the film studio tables
// (dubbed_versions, dubbed_dialogue_lines, etc.) are not yet in the generated
// database types. The database schema will be aligned in a future update.
// RLS policies enforce project-level authorization.

/**
 * Create a new dubbed version for an episode
 *
 * This action:
 * 1. Validates episode access
 * 2. Creates dubbed_versions record
 * 3. Creates placeholder dubbed_dialogue_lines for all original dialogue
 */
export const createDubbedVersionAction = enhanceAction(
  async (
    data: CreateDubbedVersionSchemaType,
  ): Promise<CreateDubbedVersionResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'dubbing.createVersion',
      episodeId: data.episodeId,
      language: data.language,
    };

    logger.info(ctx, 'Creating dubbed version');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // 1. Verify episode exists and get project context (RLS handles access)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select('id, project_id, projects!inner(account_id)')
      .eq('id', data.episodeId)
      .single();

    if (episodeError || !episode) {
      throw new Error('Episode not found');
    }

    // 2. Check if dubbed version already exists for this language
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (client as any)
      .from('dubbed_versions')
      .select('id')
      .eq('episode_id', data.episodeId)
      .eq('language', data.language)
      .single();

    if (existing) {
      throw new Error(
        `Dubbed version for ${getLanguageName(data.language)} already exists`,
      );
    }

    // 3. Create dubbed version
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: version, error: versionError } = await (client as any)
      .from('dubbed_versions')
      .insert({
        episode_id: data.episodeId,
        language: data.language,
        status: 'draft',
        translation_status: 'pending',
        voice_status: 'pending',
        sync_status: 'pending',
        metadata: {},
      })
      .select()
      .single();

    if (versionError || !version) {
      logger.error(
        { ...ctx, error: versionError },
        'Failed to create dubbed version',
      );
      throw new Error('Failed to create dubbed version');
    }

    const versionData = version as DubbedVersionResponse;

    // 4. Get all original dialogue lines for the episode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dialogueLines, error: linesError } = await (client as any)
      .from('dialogue_lines')
      .select('id, text, sequence_number')
      .eq('episode_id', data.episodeId)
      .order('sequence_number', { ascending: true });

    if (linesError) {
      logger.error({ ...ctx, error: linesError }, 'Failed to fetch dialogue');
      throw new Error('Failed to fetch dialogue lines');
    }

    const lines = (dialogueLines ?? []) as Array<{
      id: string;
      text: string;
      sequence_number: number;
    }>;

    // 5. Create placeholder dubbed lines
    if (lines.length > 0) {
      const dubbedLines = lines.map((line) => ({
        dubbed_version_id: versionData.id,
        original_dialogue_id: line.id,
        translated_text: line.text, // Placeholder - will be translated
        status: 'pending',
        timing_adjustment: 1.0,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insertError } = await (client as any)
        .from('dubbed_dialogue_lines')
        .insert(dubbedLines);

      if (insertError) {
        logger.error(
          { ...ctx, error: insertError },
          'Failed to create dubbed lines',
        );
        // Cleanup: delete the version
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('dubbed_versions')
          .delete()
          .eq('id', versionData.id);
        throw new Error('Failed to create dubbed dialogue lines');
      }
    }

    logger.info(
      { ...ctx, versionId: versionData.id, lineCount: lines.length },
      'Dubbed version created',
    );

    revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

    return {
      versionId: versionData.id,
      language: data.language,
      totalLines: lines.length,
      status: 'draft',
    };
  },
  {
    schema: CreateDubbedVersionSchema,
  },
);

/**
 * Translate all dialogue lines for a dubbed version using LLM
 *
 * This action:
 * 1. Gets dubbed version with dialogue lines
 * 2. Uses LLM to translate each line with context
 * 3. Updates dubbed_dialogue_lines with translations
 * 4. Tracks costs in metadata
 */
export const translateDialogueAction = enhanceAction(
  async (
    data: TranslateDialogueSchemaType,
  ): Promise<TranslateDialogueResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'dubbing.translate',
      versionId: data.versionId,
    };

    logger.info(ctx, 'Starting dialogue translation');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // 1. Get dubbed version with context
    const version = await getDubbedVersionWithContext(client, data.versionId);
    if (!version) {
      throw new Error('Dubbed version not found');
    }

    const accountId = version.episodes?.projects?.account_id;
    const projectId = version.episodes?.project_id;

    if (!accountId || !projectId) {
      throw new Error('Could not determine account context');
    }

    // 2. Get all dubbed lines with original text
    const dubbedLines = await getDubbedLinesWithOriginal(
      client,
      data.versionId,
    );
    const pendingLines = dubbedLines.filter((l) => l.status === 'pending');

    if (pendingLines.length === 0) {
      return {
        versionId: data.versionId,
        translatedCount: 0,
        failedCount: 0,
        estimatedCost: 0,
        status: 'completed',
      };
    }

    // 3. Estimate cost and check budget
    const totalChars = pendingLines.reduce(
      (sum, line) => sum + (line.dialogue_lines?.text?.length ?? 0),
      0,
    );
    const estimatedCost = estimateTranslationCost(totalChars);

    const hasBudget = await checkAccountBudget(
      client,
      accountId,
      estimatedCost,
    );
    if (!hasBudget) {
      throw new Error('Monthly budget exceeded');
    }

    // 4. Update version status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('dubbed_versions')
      .update({ status: 'translating', translation_status: 'processing' })
      .eq('id', data.versionId);

    // 5. Create LLM client and translate
    const llm = createLLMClient();
    const targetLanguage = getLanguageName(version.language);

    let translatedCount = 0;
    let failedCount = 0;
    let actualCost = 0;

    // Process translations with concurrency
    const concurrency = data.concurrency ?? 3;

    for (let i = 0; i < pendingLines.length; i += concurrency) {
      const batch = pendingLines.slice(i, i + concurrency);

      const results = await Promise.allSettled(
        batch.map(async (line) => {
          const originalText = line.dialogue_lines?.text ?? '';
          const characterName =
            line.dialogue_lines?.assets?.name ?? 'Unknown Character';

          const response = await llm.createChatCompletion({
            messages: [
              {
                role: 'system',
                content: `You are a professional dialogue translator for film/video dubbing.
Translate the dialogue to ${targetLanguage}.
Maintain the character's voice, tone, and emotional intent.
Keep the translation natural and roughly similar in length to the original for lip-sync purposes.
Return ONLY the translated text, no explanations or notes.`,
              },
              {
                role: 'user',
                content: JSON.stringify({
                  character: characterName,
                  originalText,
                  targetLanguage,
                }),
              },
            ],
            temperature: 0.3,
            maxTokens: Math.max(100, Math.ceil(originalText.length * 2)),
          });

          const translatedText = response.message.content.trim();
          actualCost += response.cost?.total ?? 0;

          // Update the dubbed line
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (client as any)
            .from('dubbed_dialogue_lines')
            .update({
              translated_text: translatedText,
              status: 'translated',
            })
            .eq('id', line.id);

          return translatedText;
        }),
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          translatedCount++;
        } else {
          failedCount++;
          logger.error(
            { ...ctx, error: result.reason },
            'Translation failed for line',
          );
        }
      });
    }

    // 6. Update version status
    const finalStatus =
      failedCount === pendingLines.length ? 'failed' : 'completed';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('dubbed_versions')
      .update({
        translation_status: finalStatus,
        status: finalStatus === 'failed' ? 'failed' : 'draft',
        metadata: {
          ...version.metadata,
          translation_cost_cents: Math.ceil(actualCost * 100),
          translated_at: new Date().toISOString(),
        },
      })
      .eq('id', data.versionId);

    // 7. Track usage
    await incrementAccountUsage(client, accountId, Math.ceil(actualCost * 100));

    logger.info(
      { ...ctx, translatedCount, failedCount, actualCost },
      'Translation completed',
    );

    revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

    return {
      versionId: data.versionId,
      translatedCount,
      failedCount,
      estimatedCost: Math.ceil(actualCost * 100),
      status: finalStatus === 'failed' ? 'failed' : 'completed',
    };
  },
  {
    schema: TranslateDialogueSchema,
  },
);

/**
 * Generate dubbed audio for all translated dialogue lines
 *
 * This action:
 * 1. Gets all translated dubbed lines
 * 2. Uses ElevenLabs multilingual model to generate audio
 * 3. Uploads audio to storage
 * 4. Updates dubbed_dialogue_lines with audio URLs
 */
export const generateDubbedAudioAction = enhanceAction(
  async (
    data: GenerateDubbedAudioSchemaType,
  ): Promise<GenerateDubbedAudioResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'dubbing.generateAudio',
      versionId: data.versionId,
    };

    logger.info(ctx, 'Starting dubbed audio generation');

    const client = getSupabaseServerClient();
    // Admin client is required for storage uploads because the 'audio' bucket
    // has restrictive RLS policies. Authorization is validated via RLS-protected
    // database queries (getDubbedVersionWithContext) which verify project membership.
    const adminClient = getSupabaseServerAdminClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // 1. Get dubbed version with context
    const version = await getDubbedVersionWithContext(client, data.versionId);
    if (!version) {
      throw new Error('Dubbed version not found');
    }

    const accountId = version.episodes?.projects?.account_id;
    const projectId = version.episodes?.project_id;
    const episodeId = version.episode_id;

    if (!accountId || !projectId) {
      throw new Error('Could not determine account context');
    }

    // 2. Get translated lines ready for voice generation
    const dubbedLines = await getDubbedLinesWithOriginal(
      client,
      data.versionId,
    );
    const linesToGenerate = dubbedLines.filter(
      (l) =>
        l.status === 'translated' || (l.status === 'failed' && !l.audio_url),
    );

    if (linesToGenerate.length === 0) {
      return {
        versionId: data.versionId,
        generatedCount: 0,
        failedCount: 0,
        estimatedCost: 0,
        status: 'completed',
      };
    }

    // 3. Estimate cost and check budget
    const totalChars = linesToGenerate.reduce(
      (sum, line) => sum + line.translated_text.length,
      0,
    );
    const estimatedCost = estimateVoiceGenerationCost(totalChars);

    const hasBudget = await checkAccountBudget(
      client,
      accountId,
      estimatedCost,
    );
    if (!hasBudget) {
      throw new Error('Monthly budget exceeded');
    }

    // 4. Get API key from stored keys
    const apiKey = await getAccountElevenLabsApiKey(accountId);

    // 5. Update version status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('dubbed_versions')
      .update({ status: 'voicing', voice_status: 'processing' })
      .eq('id', data.versionId);

    // 6. Create provider
    const provider = new ElevenLabsProvider({
      apiKey,
      timeout: 60000,
      maxRetries: 3,
    });

    let generatedCount = 0;
    let failedCount = 0;
    let actualCost = 0;

    const concurrency = data.concurrency ?? 3;
    const defaultSettings = {
      ...DEFAULT_VOICE_SETTINGS,
      ...data.voiceSettings,
    };

    // 7. Process audio generation
    for (let i = 0; i < linesToGenerate.length; i += concurrency) {
      const batch = linesToGenerate.slice(i, i + concurrency);

      const results = await Promise.allSettled(
        batch.map(async (line) => {
          // Get voice profile for character
          const characterAssetId =
            line.dialogue_lines?.character_asset_id ?? null;
          const voiceProfile = await getCharacterVoiceProfile(
            client,
            characterAssetId,
          );

          if (!voiceProfile) {
            throw new Error(
              `No voice profile for character: ${line.dialogue_lines?.assets?.name ?? 'Unknown'}`,
            );
          }

          // Update status to generating
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (client as any)
            .from('dubbed_dialogue_lines')
            .update({ status: 'generating' })
            .eq('id', line.id);

          // Generate audio with multilingual model
          const result = await provider.generateVoice({
            text: line.translated_text,
            voiceId: voiceProfile.voiceId,
            modelId: MULTILINGUAL_VOICE_MODEL,
            settings: { ...defaultSettings, ...voiceProfile.settings },
            outputFormat: 'mp3',
          });

          if (!result.audioBuffer) {
            throw new Error('No audio generated');
          }

          // Upload to storage (local or Supabase based on STORAGE_PROVIDER)
          const audioPath = `dubbed/${episodeId}/${version.language}/${line.id}.mp3`;
          const storage = getStorageAdapter(adminClient);

          const { url: audioUrl } = await storage.upload(
            'audio',
            audioPath,
            result.audioBuffer,
            {
              contentType: 'audio/mpeg',
              upsert: true,
            },
          );

          // Update dubbed line
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (client as any)
            .from('dubbed_dialogue_lines')
            .update({
              audio_url: audioUrl,
              duration_seconds: result.duration,
              status: 'voiced',
              generation_metadata: {
                provider: 'elevenlabs',
                model: MULTILINGUAL_VOICE_MODEL,
                voiceId: voiceProfile.voiceId,
                costCents: result.cost,
                generatedAt: new Date().toISOString(),
              },
            })
            .eq('id', line.id);

          return result.cost ?? 0;
        }),
      );

      for (let idx = 0; idx < results.length; idx++) {
        const result = results[idx];
        if (result && result.status === 'fulfilled') {
          generatedCount++;
          actualCost += result.value;
        } else if (result && result.status === 'rejected') {
          failedCount++;
          const line = batch[idx];
          logger.error(
            { ...ctx, lineId: line?.id, error: result.reason },
            'Audio generation failed',
          );

          // Mark line as failed - await to ensure status is properly tracked
          if (line) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: updateError } = await (client as any)
              .from('dubbed_dialogue_lines')
              .update({ status: 'failed' })
              .eq('id', line.id);

            if (updateError) {
              logger.error(
                { ...ctx, lineId: line.id, error: updateError },
                'Failed to update line status to failed',
              );
            }
          }
        }
      }
    }

    // 8. Update version status
    const finalStatus =
      failedCount === linesToGenerate.length ? 'failed' : 'completed';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('dubbed_versions')
      .update({
        voice_status: finalStatus,
        status: finalStatus === 'failed' ? 'failed' : 'ready',
        metadata: {
          ...version.metadata,
          voice_cost_cents: actualCost,
          voiced_at: new Date().toISOString(),
        },
      })
      .eq('id', data.versionId);

    // 9. Track usage
    await incrementAccountUsage(client, accountId, actualCost);

    logger.info(
      { ...ctx, generatedCount, failedCount, actualCost },
      'Audio generation completed',
    );

    revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

    return {
      versionId: data.versionId,
      generatedCount,
      failedCount,
      estimatedCost: actualCost,
      status: finalStatus === 'failed' ? 'failed' : 'completed',
    };
  },
  {
    schema: GenerateDubbedAudioSchema,
  },
);

/**
 * Update a single dubbed line's translation (for manual editing)
 */
export const updateDubbedLineAction = enhanceAction(
  async (data: UpdateDubbedLineSchemaType): Promise<UpdateDubbedLineResult> => {
    const logger = await getLogger();
    const ctx = { name: 'dubbing.updateLine', lineId: data.lineId };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Update the line (RLS will verify access)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedLine, error } = await (client as any)
      .from('dubbed_dialogue_lines')
      .update({
        translated_text: data.translatedText,
        timing_adjustment: data.timingAdjustment ?? 1.0,
        status: 'translated', // Reset to translated so it can be regenerated
        audio_url: null, // Clear audio since text changed
      })
      .eq('id', data.lineId)
      .select()
      .single();

    if (error || !updatedLine) {
      logger.error({ ...ctx, error }, 'Failed to update dubbed line');
      throw new Error('Failed to update dubbed line');
    }

    const lineData = updatedLine as DubbedDialogueLineResponse;

    logger.info(ctx, 'Dubbed line updated');

    revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

    return {
      lineId: data.lineId,
      translatedText: data.translatedText,
      status: lineData.status,
    };
  },
  {
    schema: UpdateDubbedLineSchema,
  },
);
