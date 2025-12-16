'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { v4 as uuidv4 } from 'uuid';

import { createLLMClient, createTranscriptionService } from '@kit/llm';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  exportToSrt,
  exportToVtt,
  getLanguageName,
} from '../lib/caption-utils';
import {
  DeleteCaptionSchema,
  ExportCaptionsSchema,
  GenerateCaptionsSchema,
  GetAvailableLanguagesSchema,
  GetCaptionsSchema,
  TranslateCaptionsSchema,
  UpdateCaptionSegmentSchema,
  UpdateCaptionStyleSchema,
} from '../lib/schemas/caption.schema';
import type {
  CaptionSegment,
  DeleteCaptionInput,
  ExportCaptionsInput,
  GenerateCaptionsInput,
  GetAvailableLanguagesInput,
  GetCaptionsInput,
  TranslateCaptionsInput,
  UpdateCaptionSegmentInput,
  UpdateCaptionStyleInput,
} from '../lib/schemas/caption.schema';

// Type for database segment
interface DbCaptionSegment {
  id: string;
  caption_id: string;
  start_time: number;
  end_time: number;
  text: string;
  words: unknown;
  speaker_id: string | null;
  sequence_number: number;
  is_edited: boolean;
}

// Type for database caption with segments
interface DbCaption {
  id: string;
  episode_id: string;
  language: string;
  style_preset: string;
  custom_styles: unknown;
  status: string;
  source_caption_id: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  caption_segments?: DbCaptionSegment[];
}

// Type assertion helper for tables pending migration
// TODO: Remove after applying 31-captions.sql migration and regenerating types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const captionTable = (client: ReturnType<typeof getSupabaseServerClient>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.from('captions' as any) as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const captionSegmentTable = (client: ReturnType<typeof getSupabaseServerClient>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.from('caption_segments' as any) as any;

/**
 * Generate captions from dialogue audio using Whisper transcription
 */
export const generateCaptionsAction = enhanceAction(
  async (data: GenerateCaptionsInput) => {
    const logger = await getLogger();
    const ctx = {
      name: 'captions.generate',
      episodeId: data.episodeId,
      language: data.language,
    };

    logger.info(ctx, 'Starting caption generation');

    const client = getSupabaseServerClient();
    
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized caption generation attempt');
      throw new Error('Authentication required');
    }

    // Fetch episode with dialogue lines that have audio
    const { data: episode, error: episodeError } = await client
      .from('episodes')
      .select(
        `
        id,
        project_id,
        projects(account_id)
      `,
      )
      .eq('id', data.episodeId)
      .single();

    if (episodeError || !episode) {
      logger.error({ ...ctx, error: episodeError }, 'Episode not found');
      throw new Error('Episode not found');
    }

    const accountId = (episode.projects as { account_id: string } | null)
      ?.account_id;
    if (!accountId) {
      throw new Error('Could not determine account for episode');
    }

    // Check for existing captions in this language
    const { data: existingCaption } = await captionTable(client)
      .select('id')
      .eq('episode_id', data.episodeId)
      .eq('language', data.language)
      .single();

    if (existingCaption) {
      throw new Error(
        `Captions already exist for language: ${getLanguageName(data.language)}. Delete existing captions first.`,
      );
    }

    // Fetch dialogue lines with audio
    const { data: dialogueLines, error: dialogueError } = await client
      .from('dialogue_lines')
      .select('id, text, audio_url, character_asset_id, sequence_number')
      .eq('episode_id', data.episodeId)
      .eq('status', 'completed')
      .not('audio_url', 'is', null)
      .order('sequence_number');

    if (dialogueError) {
      logger.error(
        { ...ctx, error: dialogueError },
        'Failed to fetch dialogue',
      );
      throw new Error('Failed to fetch dialogue lines');
    }

    if (!dialogueLines || dialogueLines.length === 0) {
      throw new Error(
        'No dialogue audio found. Generate dialogue audio first.',
      );
    }

    // Create generation job for tracking
    const idempotencyKey = `caption-${data.episodeId}-${data.language}-${uuidv4()}`;
    const { data: job, error: jobError } = await client
      .from('generation_jobs')
      .insert({
        account_id: accountId,
        project_id: episode.project_id,
        job_type: 'transcription',
        reference_type: 'episode',
        reference_id: data.episodeId,
        provider: 'openai',
        status: 'processing',
        idempotency_key: idempotencyKey,
        input_data: {
          language: data.language,
          stylePreset: data.stylePreset,
          dialogueCount: dialogueLines.length,
        },
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (jobError) {
      logger.error(
        { ...ctx, error: jobError },
        'Failed to create generation job',
      );
      throw new Error('Failed to create generation job');
    }

    try {
      // Create caption record
      const { data: caption, error: captionError } = await captionTable(client)
        .insert({
          episode_id: data.episodeId,
          language: data.language,
          style_preset: data.stylePreset,
          status: 'transcribing',
        })
        .select()
        .single();

      if (captionError || !caption) {
        throw new Error('Failed to create caption record');
      }

      // Get API key
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OpenAI API key not configured');
      }

      // Transcribe each dialogue line with audio
      const transcriptionService = createTranscriptionService({
        apiKey,
        language: data.language,
      });

      const segments: Array<{
        caption_id: string;
        start_time: number;
        end_time: number;
        text: string;
        words: string | null;
        speaker_id: string | null;
        sequence_number: number;
      }> = [];

      let currentTime = 0;

      for (const line of dialogueLines) {
        if (!line.audio_url) continue;

        try {
          const result = await transcriptionService.transcribeFromUrl(
            line.audio_url,
          );

          for (const seg of result.segments) {
            segments.push({
              caption_id: caption.id,
              start_time: currentTime + seg.start,
              end_time: currentTime + seg.end,
              text: seg.text.trim(),
              words: seg.words ? JSON.stringify(seg.words) : null,
              speaker_id: line.character_asset_id,
              sequence_number: segments.length + 1,
            });
          }

          currentTime += result.duration;
        } catch (error) {
          logger.warn(
            { ...ctx, dialogueId: line.id, error },
            'Failed to transcribe dialogue line',
          );
          // Continue with other lines
        }
      }

      // Insert all segments
      if (segments.length > 0) {
        const { error: segmentError } = await captionSegmentTable(client)
          .insert(segments);

        if (segmentError) {
          logger.error(
            { ...ctx, error: segmentError },
            'Failed to insert caption segments',
          );
          throw new Error('Failed to insert caption segments');
        }
      }

      // Update caption status
      await captionTable(client)
        .update({ status: 'completed' })
        .eq('id', caption.id);

      // Update job as completed
      await client
        .from('generation_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          output_data: {
            captionId: caption.id,
            segmentCount: segments.length,
          },
        })
        .eq('id', job.id);

      logger.info(
        { ...ctx, captionId: caption.id, segmentCount: segments.length },
        'Caption generation completed',
      );

      revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

      return {
        success: true,
        captionId: caption.id,
        segmentCount: segments.length,
      };
    } catch (error) {
      // Update job as failed
      await client
        .from('generation_jobs')
        .update({
          status: 'failed',
          error_message:
            error instanceof Error ? error.message : 'Unknown error',
          error_code: 'TRANSCRIPTION_FAILED',
        })
        .eq('id', job.id);

      logger.error({ ...ctx, error }, 'Caption generation failed');
      throw error;
    }
  },
  {
    schema: GenerateCaptionsSchema,
  },
);

/**
 * Translate captions to another language using LLM
 */
export const translateCaptionsAction = enhanceAction(
  async (data: TranslateCaptionsInput) => {
    const logger = await getLogger();
    const ctx = {
      name: 'captions.translate',
      sourceCaptionId: data.sourceCaptionId,
      targetLanguage: data.targetLanguage,
    };

    logger.info(ctx, 'Starting caption translation');

    const client = getSupabaseServerClient();
    
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized caption translation attempt');
      throw new Error('Authentication required');
    }

    // Fetch source caption with segments
    const { data: sourceCaption, error: sourceCaptionError } = await captionTable(client)
      .select(
        `
        *,
        caption_segments(*),
        episodes!inner(id, project_id, projects(account_id))
      `,
      )
      .eq('id', data.sourceCaptionId)
      .single();

    if (sourceCaptionError || !sourceCaption) {
      logger.error(
        { ...ctx, error: sourceCaptionError },
        'Source caption not found',
      );
      throw new Error('Source caption not found');
    }

    const typedSourceCaption = sourceCaption as unknown as DbCaption & {
      episodes: {
        id: string;
        project_id: string;
        projects: { account_id: string } | null;
      };
    };

    const accountId = typedSourceCaption.episodes?.projects?.account_id;
    if (!accountId) {
      throw new Error('Could not determine account for episode');
    }

    // Check for existing caption in target language
    const { data: existingCaption } = await captionTable(client)
      .select('id')
      .eq('episode_id', typedSourceCaption.episode_id)
      .eq('language', data.targetLanguage)
      .single();

    if (existingCaption) {
      throw new Error(
        `Captions already exist for ${getLanguageName(data.targetLanguage)}. Delete existing captions first.`,
      );
    }

    // Create generation job
    const idempotencyKey = `translate-${data.sourceCaptionId}-${data.targetLanguage}-${uuidv4()}`;
    const { data: job, error: jobError } = await client
      .from('generation_jobs')
      .insert({
        account_id: accountId,
        project_id: typedSourceCaption.episodes.project_id,
        job_type: 'translation',
        reference_type: 'caption',
        reference_id: data.sourceCaptionId,
        provider: 'openai',
        status: 'processing',
        idempotency_key: idempotencyKey,
        input_data: {
          sourceLanguage: typedSourceCaption.language,
          targetLanguage: data.targetLanguage,
          segmentCount: typedSourceCaption.caption_segments?.length ?? 0,
        },
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (jobError) {
      logger.error(
        { ...ctx, error: jobError },
        'Failed to create generation job',
      );
      throw new Error('Failed to create generation job');
    }

    try {
      // Create new caption record
      const { data: newCaption, error: captionError } = await captionTable(client)
        .insert({
          episode_id: typedSourceCaption.episode_id,
          language: data.targetLanguage,
          style_preset: data.stylePreset ?? typedSourceCaption.style_preset,
          source_caption_id: data.sourceCaptionId,
          status: 'translating',
        })
        .select()
        .single();

      if (captionError || !newCaption) {
        throw new Error('Failed to create caption record');
      }

      // Get LLM client for translation
      const llm = createLLMClient();

      const sourceSegments = typedSourceCaption.caption_segments ?? [];
      const translatedSegments: Array<{
        caption_id: string;
        start_time: number;
        end_time: number;
        text: string;
        words: null;
        speaker_id: string | null;
        sequence_number: number;
      }> = [];

      // Batch segments for efficient translation
      const batchSize = 10;
      for (let i = 0; i < sourceSegments.length; i += batchSize) {
        const batch = sourceSegments.slice(i, i + batchSize);
        const textsToTranslate = batch.map((seg) => seg.text).join('\n---\n');

        const response = await llm.createChatCompletion({
          messages: [
            {
              role: 'system',
              content: `You are a professional translator. Translate the following caption segments from ${getLanguageName(typedSourceCaption.language)} to ${getLanguageName(data.targetLanguage)}.
Keep each segment on a separate line, separated by "---".
Preserve the meaning and tone while making it natural in the target language.
Do not add any explanations or notes - only output the translations.`,
            },
            {
              role: 'user',
              content: textsToTranslate,
            },
          ],
          temperature: 0.3,
          maxTokens: 2000,
        });

        const translatedTexts = response.message.content
          .split('---')
          .map((t) => t.trim())
          .filter(Boolean);

        // Map translated texts back to segments
        for (let j = 0; j < batch.length; j++) {
          const sourceSegment = batch[j];
          if (!sourceSegment) continue;

          const translatedText = translatedTexts[j] ?? sourceSegment.text;

          translatedSegments.push({
            caption_id: newCaption.id,
            start_time: sourceSegment.start_time,
            end_time: sourceSegment.end_time,
            text: translatedText,
            words: null, // Word-level timing not available for translations
            speaker_id: sourceSegment.speaker_id,
            sequence_number: translatedSegments.length + 1,
          });
        }
      }

      // Insert translated segments
      if (translatedSegments.length > 0) {
        const { error: segmentError } = await captionSegmentTable(client)
          .insert(translatedSegments);

        if (segmentError) {
          throw new Error('Failed to insert translated segments');
        }
      }

      // Update caption status
      await captionTable(client)
        .update({ status: 'completed' })
        .eq('id', newCaption.id);

      // Update job as completed
      await client
        .from('generation_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          output_data: {
            captionId: newCaption.id,
            segmentCount: translatedSegments.length,
          },
        })
        .eq('id', job.id);

      logger.info(
        {
          ...ctx,
          captionId: newCaption.id,
          segmentCount: translatedSegments.length,
        },
        'Caption translation completed',
      );

      revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

      return {
        success: true,
        captionId: newCaption.id,
        segmentCount: translatedSegments.length,
      };
    } catch (error) {
      // Update job as failed
      await client
        .from('generation_jobs')
        .update({
          status: 'failed',
          error_message:
            error instanceof Error ? error.message : 'Unknown error',
          error_code: 'TRANSLATION_FAILED',
        })
        .eq('id', job.id);

      logger.error({ ...ctx, error }, 'Caption translation failed');
      throw error;
    }
  },
  {
    schema: TranslateCaptionsSchema,
  },
);

/**
 * Get captions for an episode
 */
export const getCaptionsAction = enhanceAction(
  async (data: GetCaptionsInput) => {
    const client = getSupabaseServerClient();
    
    const { error: authError } = await requireUser(client);

    if (authError) {
      throw new Error('Authentication required');
    }

    let query = captionTable(client)
      .select(
        `
        *,
        caption_segments(*)
      `,
      )
      .eq('episode_id', data.episodeId)
      .order('created_at', { ascending: false });

    if (data.language) {
      query = query.eq('language', data.language);
    }

    const { data: captions, error } = await query;

    if (error) {
      throw new Error('Failed to fetch captions');
    }

    // Transform to frontend format
    return (captions as unknown as DbCaption[]).map((caption) => ({
      id: caption.id,
      episodeId: caption.episode_id,
      language: caption.language,
      stylePreset: caption.style_preset,
      customStyles: caption.custom_styles,
      status: caption.status,
      sourceCaptionId: caption.source_caption_id,
      createdAt: caption.created_at,
      updatedAt: caption.updated_at,
      segments: (caption.caption_segments ?? []).map((seg) => ({
        id: seg.id,
        captionId: seg.caption_id,
        startTime: seg.start_time,
        endTime: seg.end_time,
        text: seg.text,
        words: seg.words,
        speakerId: seg.speaker_id,
        sequenceNumber: seg.sequence_number,
        isEdited: seg.is_edited,
      })),
    }));
  },
  {
    schema: GetCaptionsSchema,
  },
);

/**
 * Update a caption segment
 */
export const updateCaptionSegmentAction = enhanceAction(
  async (data: UpdateCaptionSegmentInput) => {
    const logger = await getLogger();
    const ctx = { name: 'captions.updateSegment', segmentId: data.segmentId };

    const client = getSupabaseServerClient();
    
    const { error: authError } = await requireUser(client);

    if (authError) {
      throw new Error('Authentication required');
    }

    const updateData: Record<string, unknown> = {
      text: data.text,
      is_edited: true,
      updated_at: new Date().toISOString(),
    };

    if (data.startTime !== undefined) {
      updateData.start_time = data.startTime;
    }
    if (data.endTime !== undefined) {
      updateData.end_time = data.endTime;
    }
    if (data.speakerId !== undefined) {
      updateData.speaker_id = data.speakerId;
    }

    const { error } = await captionSegmentTable(client)
      .update(updateData)
      .eq('id', data.segmentId);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to update segment');
      throw new Error('Failed to update caption segment');
    }

    logger.info(ctx, 'Caption segment updated');
    return { success: true };
  },
  {
    schema: UpdateCaptionSegmentSchema,
  },
);

/**
 * Update caption style
 */
export const updateCaptionStyleAction = enhanceAction(
  async (data: UpdateCaptionStyleInput) => {
    const client = getSupabaseServerClient();
    
    const { error: authError } = await requireUser(client);

    if (authError) {
      throw new Error('Authentication required');
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.stylePreset) {
      updateData.style_preset = data.stylePreset;
    }
    if (data.customStyles) {
      updateData.custom_styles = data.customStyles;
    }

    const { error } = await captionTable(client)
      .update(updateData)
      .eq('id', data.captionId);

    if (error) {
      throw new Error('Failed to update caption style');
    }

    return { success: true };
  },
  {
    schema: UpdateCaptionStyleSchema,
  },
);

/**
 * Export captions to SRT or VTT format
 */
export const exportCaptionsAction = enhanceAction(
  async (data: ExportCaptionsInput) => {
    const client = getSupabaseServerClient();
    
    const { error: authError } = await requireUser(client);

    if (authError) {
      throw new Error('Authentication required');
    }

    const { data: caption, error } = await captionTable(client)
      .select(
        `
        *,
        caption_segments(*)
      `,
      )
      .eq('id', data.captionId)
      .single();

    if (error || !caption) {
      throw new Error('Caption not found');
    }

    const typedCaption = caption as unknown as DbCaption;
    const segments: CaptionSegment[] = (typedCaption.caption_segments ?? [])
      .map((seg) => ({
        sequenceNumber: seg.sequence_number,
        startTime: seg.start_time,
        endTime: seg.end_time,
        text: seg.text,
        words: seg.words as CaptionSegment['words'],
        speakerId: seg.speaker_id,
      }))
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    const content =
      data.format === 'srt' ? exportToSrt(segments) : exportToVtt(segments);

    return {
      success: true,
      content,
      format: data.format,
      filename: `captions-${typedCaption.language}.${data.format}`,
      language: typedCaption.language,
    };
  },
  {
    schema: ExportCaptionsSchema,
  },
);

/**
 * Delete a caption and its segments
 */
export const deleteCaptionAction = enhanceAction(
  async (data: DeleteCaptionInput) => {
    const logger = await getLogger();
    const ctx = { name: 'captions.delete', captionId: data.captionId };

    const client = getSupabaseServerClient();
    
    const { error: authError } = await requireUser(client);

    if (authError) {
      throw new Error('Authentication required');
    }

    // Cascade delete will handle segments
    const { error } = await captionTable(client)
      .delete()
      .eq('id', data.captionId);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete caption');
      throw new Error('Failed to delete caption');
    }

    logger.info(ctx, 'Caption deleted');
    revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

    return { success: true };
  },
  {
    schema: DeleteCaptionSchema,
  },
);

/**
 * Get available languages for an episode (existing captions)
 */
export const getAvailableLanguagesAction = enhanceAction(
  async (data: GetAvailableLanguagesInput) => {
    const client = getSupabaseServerClient();
    
    const { error: authError } = await requireUser(client);

    if (authError) {
      throw new Error('Authentication required');
    }

    const { data: captions, error } = await captionTable(client)
      .select('language, status')
      .eq('episode_id', data.episodeId)
      .eq('status', 'completed');

    if (error) {
      throw new Error('Failed to fetch available languages');
    }

    return (captions ?? []).map((c) => ({
      code: c.language,
      name: getLanguageName(c.language),
    }));
  },
  {
    schema: GetAvailableLanguagesSchema,
  },
);
