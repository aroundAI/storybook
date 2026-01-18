'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  ApplyLipSyncSchema,
  DetectFacesSchema,
  GenerateLipSyncSchema,
  GetLipSyncJobSchema,
  PollLipSyncStatusSchema,
} from '../lib/schemas/lip-sync.schema';
import { createAccountLipSyncProvider } from '../providers/lip-sync/factory';
import type {
  FaceCoordinates,
  LipSyncJob,
  LipSyncProviderName,
  LipSyncQuality,
} from '../providers/lip-sync/types';

// Note: These actions use type assertions because the film studio tables
// (lip_sync_jobs, shots, dialogue_lines) are not yet in the generated
// database types. The database schema will be aligned in a future update.
// RLS policies enforce project-level authorization.

/**
 * Film studio database response types for type-safe access to nested data
 */
interface ShotResponse {
  id: string;
  episode_id: string;
  video_url: string | null;
  generation_metadata: Record<string, unknown> | null;
  episodes: {
    id: string;
    project_id: string;
    projects: {
      id: string;
      account_id: string;
    };
  };
}

interface DialogueLineResponse {
  id: string;
  episode_id: string;
  audio_url: string | null;
  status: string;
}

/**
 * Result types for actions
 */
export interface DetectFacesResult {
  faces: FaceCoordinates[];
}

export interface GenerateLipSyncResult {
  jobId: string;
  providerJobId: string;
  status: string;
}

export interface ApplyLipSyncResult {
  success: boolean;
  shotId: string;
  newVideoUrl: string;
}

export interface GetLipSyncJobResult {
  id: string;
  shotId: string;
  dialogueLineId: string;
  provider: LipSyncProviderName;
  status: string;
  inputVideoUrl: string;
  inputAudioUrl: string;
  outputVideoUrl?: string;
  faceCoordinates?: FaceCoordinates;
  quality: LipSyncQuality;
  providerJobId?: string;
  errorMessage?: string;
  processingTimeSeconds?: number;
  progress?: number;
  createdAt: string;
  completedAt?: string;
}

/**
 * Detect faces in a video
 *
 * This action analyzes a video URL and returns detected face coordinates.
 * For MVP, this returns an empty array as face detection would require
 * integration with a computer vision service (AWS Rekognition, etc.)
 */
export const detectFacesAction = enhanceAction(
  async (data: { videoUrl: string }): Promise<DetectFacesResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'lip-sync.detectFaces',
      videoUrl: data.videoUrl,
    };

    logger.info(ctx, 'Face detection requested');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized face detection attempt');
      throw new Error('Authentication required');
    }

    // MVP: Return empty array. In production, this would call a face detection API
    // (e.g., AWS Rekognition, Google Cloud Vision, or self-hosted model)
    logger.info(ctx, 'Face detection completed (MVP - returning empty)');

    return {
      faces: [],
    };
  },
  {
    schema: DetectFacesSchema,
  },
);

/**
 * Generate lip sync for a shot's video with dialogue audio
 *
 * This action:
 * 1. Validates the shot and dialogue line exist with video/audio
 * 2. Creates a lip_sync_jobs record
 * 3. Triggers the lip sync provider
 * 4. Returns the job ID for tracking
 */
export const generateLipSyncAction = enhanceAction(
  async (data: {
    shotId: string;
    dialogueLineId: string;
    provider?: LipSyncProviderName;
    quality?: LipSyncQuality;
    faceCoordinates?: FaceCoordinates;
  }): Promise<GenerateLipSyncResult> => {
    const logger = await getLogger();
    const provider = data.provider ?? 'synclabs';
    const quality = data.quality ?? 'standard';

    const ctx = {
      name: 'lip-sync.generate',
      shotId: data.shotId,
      dialogueLineId: data.dialogueLineId,
      provider,
      quality,
    };

    logger.info(ctx, 'Starting lip sync generation');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized lip sync attempt');
      throw new Error('Authentication required');
    }

    // 1. Fetch shot with video URL and account context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shot, error: shotError } = await (client as any)
      .from('shots')
      .select(
        `
        id,
        episode_id,
        video_url,
        generation_metadata,
        episodes!inner(
          id,
          project_id,
          projects!inner(
            id,
            account_id
          )
        )
      `,
      )
      .eq('id', data.shotId)
      .single();

    if (shotError || !shot) {
      logger.error({ ...ctx, error: shotError }, 'Shot not found');
      throw new Error('Shot not found');
    }

    const shotData = shot as ShotResponse;

    if (!shotData.video_url) {
      throw new Error('Shot does not have a video. Generate video first.');
    }

    const accountId = shotData.episodes?.projects?.account_id;
    if (!accountId) {
      throw new Error('Could not determine account for shot');
    }

    // 2. Fetch dialogue line with audio URL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dialogueLine, error: dialogueError } = await (client as any)
      .from('dialogue_lines')
      .select('id, episode_id, audio_url, status')
      .eq('id', data.dialogueLineId)
      .single();

    if (dialogueError || !dialogueLine) {
      logger.error({ ...ctx, error: dialogueError }, 'Dialogue line not found');
      throw new Error('Dialogue line not found');
    }

    const dialogueData = dialogueLine as DialogueLineResponse;

    if (!dialogueData.audio_url) {
      throw new Error(
        'Dialogue line does not have audio. Generate voice first.',
      );
    }

    // 3. Create lip_sync_jobs record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: jobError } = await (client as any)
      .from('lip_sync_jobs')
      .insert({
        shot_id: data.shotId,
        dialogue_line_id: data.dialogueLineId,
        provider,
        status: 'queued',
        input_video_url: shotData.video_url,
        input_audio_url: dialogueData.audio_url,
        face_coordinates: data.faceCoordinates ?? null,
        quality,
      })
      .select()
      .single();

    if (jobError || !job) {
      logger.error(
        { ...ctx, error: jobError },
        'Failed to create lip sync job',
      );
      throw new Error('Failed to create lip sync job');
    }

    const jobData = job as LipSyncJob;

    try {
      // 4. Get provider and trigger lip sync
      const lipSyncProvider = await createAccountLipSyncProvider({
        accountId,
        provider,
      });

      const providerJobId = await lipSyncProvider.generateLipSync({
        videoUrl: shotData.video_url,
        audioUrl: dialogueData.audio_url,
        faceCoordinates: data.faceCoordinates,
        quality,
      });

      // 5. Update job with provider job ID and status
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('lip_sync_jobs')
        .update({
          provider_job_id: providerJobId,
          status: 'processing',
        })
        .eq('id', jobData.id);

      logger.info(
        { ...ctx, jobId: jobData.id, providerJobId },
        'Lip sync job started',
      );

      return {
        jobId: jobData.id,
        providerJobId,
        status: 'processing',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Update job as failed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('lip_sync_jobs')
        .update({
          status: 'failed',
          error_message: errorMessage,
        })
        .eq('id', jobData.id);

      logger.error({ ...ctx, error }, 'Lip sync generation failed');
      throw error;
    }
  },
  {
    schema: GenerateLipSyncSchema,
  },
);

/**
 * Apply a completed lip sync job to the shot
 *
 * This action:
 * 1. Validates the job is completed with output URL
 * 2. Updates the shot's video_url with the lip-synced video
 * 3. Preserves original video URL in metadata
 */
export const applyLipSyncAction = enhanceAction(
  async (data: { jobId: string }): Promise<ApplyLipSyncResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'lip-sync.apply',
      jobId: data.jobId,
    };

    logger.info(ctx, 'Applying lip sync to shot');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized apply lip sync attempt');
      throw new Error('Authentication required');
    }

    // 1. Fetch completed lip sync job
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: jobError } = await (client as any)
      .from('lip_sync_jobs')
      .select(`
        id, shot_id, dialogue_line_id, provider, status,
        input_video_url, input_audio_url, output_video_url,
        face_coordinates, quality, provider_job_id,
        error_message, processing_time_seconds,
        created_at, completed_at
      `)
      .eq('id', data.jobId)
      .single();

    if (jobError || !job) {
      logger.error({ ...ctx, error: jobError }, 'Lip sync job not found');
      throw new Error('Lip sync job not found');
    }

    const jobData = job as LipSyncJob;

    if (jobData.status !== 'completed') {
      throw new Error(
        `Lip sync job is not completed. Current status: ${jobData.status}`,
      );
    }

    if (!jobData.output_video_url) {
      throw new Error('Lip sync job has no output video');
    }

    // 2. Update shot with lip-synced video, preserving original
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shot, error: shotFetchError } = await (client as any)
      .from('shots')
      .select('generation_metadata')
      .eq('id', jobData.shot_id)
      .single();

    if (shotFetchError) {
      throw new Error('Failed to fetch shot metadata');
    }

    const existingMetadata =
      (shot?.generation_metadata as Record<string, unknown>) ?? {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (client as any)
      .from('shots')
      .update({
        video_url: jobData.output_video_url,
        generation_metadata: {
          ...existingMetadata,
          lip_sync_applied: true,
          original_video_url: jobData.input_video_url,
          lip_sync_job_id: jobData.id,
          lip_sync_applied_at: new Date().toISOString(),
        },
      })
      .eq('id', jobData.shot_id);

    if (updateError) {
      logger.error({ ...ctx, error: updateError }, 'Failed to apply lip sync');
      throw new Error('Failed to apply lip sync to shot');
    }

    logger.info(
      {
        ...ctx,
        shotId: jobData.shot_id,
        newVideoUrl: jobData.output_video_url,
      },
      'Lip sync applied to shot',
    );

    revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

    return {
      success: true,
      shotId: jobData.shot_id,
      newVideoUrl: jobData.output_video_url,
    };
  },
  {
    schema: ApplyLipSyncSchema,
  },
);

/**
 * Get lip sync job details
 *
 * Fetches job by ID or most recent job for a shot.
 * If job is processing, polls the provider for current status.
 */
export const getLipSyncJobAction = enhanceAction(
  async (data: {
    jobId?: string;
    shotId?: string;
  }): Promise<GetLipSyncJobResult | null> => {
    const logger = await getLogger();
    const ctx = {
      name: 'lip-sync.getJob',
      jobId: data.jobId,
      shotId: data.shotId,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Build query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (client as any).from('lip_sync_jobs').select(`
      id, shot_id, dialogue_line_id, provider, status,
      input_video_url, input_audio_url, output_video_url,
      face_coordinates, quality, provider_job_id,
      error_message, processing_time_seconds,
      created_at, completed_at
    `);

    if (data.jobId) {
      query = query.eq('id', data.jobId);
    } else if (data.shotId) {
      query = query
        .eq('shot_id', data.shotId)
        .order('created_at', { ascending: false })
        .limit(1);
    } else {
      throw new Error('Either jobId or shotId must be provided');
    }

    const { data: job, error: jobError } = await query.single();

    if (jobError || !job) {
      // No job found is not an error - return null
      if (jobError?.code === 'PGRST116') {
        return null;
      }
      logger.error({ ...ctx, error: jobError }, 'Failed to fetch lip sync job');
      throw new Error('Failed to fetch lip sync job');
    }

    const jobData = job as LipSyncJob;

    // Build result
    const result: GetLipSyncJobResult = {
      id: jobData.id,
      shotId: jobData.shot_id,
      dialogueLineId: jobData.dialogue_line_id,
      provider: jobData.provider,
      status: jobData.status,
      inputVideoUrl: jobData.input_video_url,
      inputAudioUrl: jobData.input_audio_url,
      outputVideoUrl: jobData.output_video_url ?? undefined,
      faceCoordinates: jobData.face_coordinates ?? undefined,
      quality: jobData.quality,
      providerJobId: jobData.provider_job_id ?? undefined,
      errorMessage: jobData.error_message ?? undefined,
      processingTimeSeconds: jobData.processing_time_seconds ?? undefined,
      createdAt: jobData.created_at,
      completedAt: jobData.completed_at ?? undefined,
    };

    return result;
  },
  {
    schema: GetLipSyncJobSchema,
  },
);

/**
 * Poll lip sync job status from provider
 *
 * Updates the job in database with current provider status.
 * Used for real-time progress tracking.
 */
export const pollLipSyncStatusAction = enhanceAction(
  async (data: { jobId: string }): Promise<GetLipSyncJobResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'lip-sync.pollStatus',
      jobId: data.jobId,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // 1. Fetch job
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: jobError } = await (client as any)
      .from('lip_sync_jobs')
      .select(
        `
        id, shot_id, dialogue_line_id, provider, status, provider_job_id,
        input_video_url, input_audio_url, output_video_url,
        face_coordinates, quality, error_message, processing_time_seconds,
        created_at, completed_at,
        shots!inner(
          episodes!inner(
            projects!inner(account_id)
          )
        )
      `,
      )
      .eq('id', data.jobId)
      .single();

    if (jobError || !job) {
      logger.error({ ...ctx, error: jobError }, 'Lip sync job not found');
      throw new Error('Lip sync job not found');
    }

    const jobData = job as LipSyncJob & {
      shots: { episodes: { projects: { account_id: string } } };
    };

    // 2. If job is still processing and has provider job ID, poll provider
    if (
      (jobData.status === 'processing' || jobData.status === 'pending') &&
      jobData.provider_job_id
    ) {
      try {
        const accountId = jobData.shots.episodes.projects.account_id;
        const lipSyncProvider = await createAccountLipSyncProvider({
          accountId,
          provider: jobData.provider,
        });

        const providerStatus = await lipSyncProvider.getStatus(
          jobData.provider_job_id,
        );

        // Update job with provider status
        const updates: Record<string, unknown> = {
          status: providerStatus.status,
        };

        if (providerStatus.outputUrl) {
          updates.output_video_url = providerStatus.outputUrl;
        }

        if (providerStatus.error) {
          updates.error_message = providerStatus.error;
        }

        if (providerStatus.status === 'completed') {
          updates.completed_at = new Date().toISOString();
          // Calculate processing time
          const startTime = new Date(jobData.created_at).getTime();
          const endTime = Date.now();
          updates.processing_time_seconds = Math.round(
            (endTime - startTime) / 1000,
          );
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('lip_sync_jobs')
          .update(updates)
          .eq('id', data.jobId);

        // Return updated result
        return {
          id: jobData.id,
          shotId: jobData.shot_id,
          dialogueLineId: jobData.dialogue_line_id,
          provider: jobData.provider,
          status: providerStatus.status,
          inputVideoUrl: jobData.input_video_url,
          inputAudioUrl: jobData.input_audio_url,
          outputVideoUrl: providerStatus.outputUrl,
          faceCoordinates: jobData.face_coordinates ?? undefined,
          quality: jobData.quality,
          providerJobId: jobData.provider_job_id ?? undefined,
          errorMessage: providerStatus.error,
          progress: providerStatus.progress,
          createdAt: jobData.created_at,
          completedAt:
            providerStatus.status === 'completed'
              ? new Date().toISOString()
              : undefined,
        };
      } catch (error) {
        logger.error({ ...ctx, error }, 'Failed to poll provider status');
        // Return current job state if polling fails
      }
    }

    // Return current job state
    return {
      id: jobData.id,
      shotId: jobData.shot_id,
      dialogueLineId: jobData.dialogue_line_id,
      provider: jobData.provider,
      status: jobData.status,
      inputVideoUrl: jobData.input_video_url,
      inputAudioUrl: jobData.input_audio_url,
      outputVideoUrl: jobData.output_video_url ?? undefined,
      faceCoordinates: jobData.face_coordinates ?? undefined,
      quality: jobData.quality,
      providerJobId: jobData.provider_job_id ?? undefined,
      errorMessage: jobData.error_message ?? undefined,
      processingTimeSeconds: jobData.processing_time_seconds ?? undefined,
      createdAt: jobData.created_at,
      completedAt: jobData.completed_at ?? undefined,
    };
  },
  {
    schema: PollLipSyncStatusSchema,
  },
);
