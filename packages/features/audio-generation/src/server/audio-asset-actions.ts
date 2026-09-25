'use server';

/**
 * Audio Asset Library Actions
 *
 * Server actions for managing reusable music/SFX assets with deduplication.
 * Assets are stored in the audio_assets table with prompt hashing for reuse.
 */
import crypto from 'crypto';
import { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { authorizeProjectTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { STORAGE_BUCKETS } from '@kit/storage/buckets';
import {
  AUDIO_LIBRARY_UPLOAD_TYPES,
  type AudioLibraryUploadType,
  isAudioLibraryPath,
} from '@kit/storage/upload-paths';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { findOrCreateAudioAsset } from './audio-asset-library';
import { getProjectElevenLabsApiKey } from './project-audio-settings';

// =============================================================================
// Types
// =============================================================================

export interface AudioAsset {
  id: string;
  assetId: string | null;
  projectId: string;
  audioType: 'music' | 'sfx';
  promptHash: string;
  prompt: string;
  name: string | null;
  fileUrl: string | null;
  filePath: string | null;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  provider: string;
  providerJobId: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  metadata: Record<string, unknown>;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AudioAssetRow {
  id: string;
  asset_id: string | null;
  project_id: string;
  audio_type: string;
  prompt_hash: string;
  prompt: string;
  name: string | null;
  file_url: string | null;
  file_path: string | null;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  provider: string;
  provider_job_id: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Normalize a prompt for consistent hashing
 * - Lowercase
 * - Trim whitespace
 * - Remove extra spaces
 * - Sort words alphabetically (for fuzzy matching)
 */
function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .sort()
    .join(' ');
}

/**
 * Generate SHA-256 hash of normalized prompt
 */
function hashPrompt(normalizedPrompt: string): string {
  return crypto.createHash('sha256').update(normalizedPrompt).digest('hex');
}

/**
 * Map database row to AudioAsset type
 */
function mapRowToAudioAsset(row: AudioAssetRow): AudioAsset {
  return {
    id: row.id,
    assetId: row.asset_id,
    projectId: row.project_id,
    audioType: row.audio_type as 'music' | 'sfx',
    promptHash: row.prompt_hash,
    prompt: row.prompt,
    name: row.name,
    fileUrl: row.file_url,
    filePath: row.file_path,
    durationSeconds: row.duration_seconds,
    fileSizeBytes: row.file_size_bytes,
    provider: row.provider,
    providerJobId: row.provider_job_id,
    status: row.status as 'pending' | 'processing' | 'completed' | 'failed',
    metadata: row.metadata ?? {},
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// Schemas
// =============================================================================

const FindAudioAssetSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1).max(500),
  audioType: z.enum(['music', 'sfx']),
});

const CreateAudioAssetSchema = z.object({
  projectId: z.string().uuid(),
  audioType: z.enum(['music', 'sfx']),
  prompt: z.string().min(1).max(500),
  name: z.string().max(100).optional(),
  provider: z.string().default('elevenlabs'),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateAudioAssetSchema = z.object({
  assetId: z.string().uuid(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  fileUrl: z.string().url().optional(),
  filePath: z.string().optional(),
  durationSeconds: z.number().positive().optional(),
  fileSizeBytes: z.number().int().positive().optional(),
  providerJobId: z.string().optional(),
  name: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const GetAudioAssetsSchema = z.object({
  projectId: z.string().uuid(),
  audioType: z.enum(['music', 'sfx']).optional(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

const IncrementUsageSchema = z.object({
  assetId: z.string().uuid(),
});

// =============================================================================
// Actions
// =============================================================================

/**
 * Find an existing audio asset by prompt (for deduplication)
 * Returns null if not found
 */
export const findAudioAssetByPromptAction = enhanceAction(
  async (data): Promise<AudioAsset | null> => {
    const logger = await getLogger();
    const ctx = { name: 'audioAsset.findByPrompt', projectId: data.projectId };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Generate hash from normalized prompt
    const normalized = normalizePrompt(data.prompt);
    const hash = hashPrompt(normalized);

    logger.debug(
      { ...ctx, promptHash: hash.substring(0, 16), audioType: data.audioType },
      'Looking up audio asset by prompt hash',
    );

    // Query by hash
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (client as any)
      .from('audio_assets')
      .select(
        `
                id, asset_id, project_id, audio_type, prompt_hash, prompt,
                name, file_url, file_path, duration_seconds, file_size_bytes,
                provider, provider_job_id, status, metadata,
                usage_count, last_used_at, created_at, updated_at
            `,
      )
      .eq('project_id', data.projectId)
      .eq('prompt_hash', hash)
      .eq('audio_type', data.audioType)
      .eq('status', 'completed')
      .is('deleted_at', null)
      .limit(1);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to query audio assets');
      throw new Error('Failed to find audio asset');
    }

    if (!rows || rows.length === 0) {
      logger.debug(ctx, 'No existing audio asset found');
      return null;
    }

    logger.info(
      { ...ctx, assetId: rows[0].id },
      'Found existing audio asset for reuse',
    );

    return mapRowToAudioAsset(rows[0]);
  },
  { schema: FindAudioAssetSchema },
);

/**
 * Create a new audio asset (for generation tracking)
 */
export const createAudioAssetAction = enhanceAction(
  async (data): Promise<AudioAsset> => {
    const logger = await getLogger();
    const ctx = { name: 'audioAsset.create', projectId: data.projectId };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Generate hash
    const normalized = normalizePrompt(data.prompt);
    const hash = hashPrompt(normalized);

    logger.info(
      { ...ctx, audioType: data.audioType, promptHash: hash.substring(0, 16) },
      'Creating audio asset',
    );

    // Insert
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row, error } = await (client as any)
      .from('audio_assets')
      .insert({
        project_id: data.projectId,
        audio_type: data.audioType,
        prompt: data.prompt,
        prompt_hash: hash,
        name: data.name,
        provider: data.provider,
        status: 'pending',
        metadata: data.metadata ?? {},
      })
      .select()
      .single();

    if (error || !row) {
      logger.error({ ...ctx, error }, 'Failed to create audio asset');
      throw new Error('Failed to create audio asset');
    }

    logger.info({ ...ctx, assetId: row.id }, 'Audio asset created');

    return mapRowToAudioAsset(row);
  },
  { schema: CreateAudioAssetSchema },
);

/**
 * Update an audio asset (e.g., after generation completes)
 */
export const updateAudioAssetAction = enhanceAction(
  async (data): Promise<AudioAsset> => {
    const logger = await getLogger();
    const ctx = { name: 'audioAsset.update', assetId: data.assetId };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    logger.info({ ...ctx, status: data.status }, 'Updating audio asset');

    const updateData: Record<string, unknown> = {};
    if (data.status) updateData.status = data.status;
    if (data.fileUrl) updateData.file_url = data.fileUrl;
    if (data.filePath) updateData.file_path = data.filePath;
    if (data.durationSeconds)
      updateData.duration_seconds = data.durationSeconds;
    if (data.fileSizeBytes) updateData.file_size_bytes = data.fileSizeBytes;
    if (data.providerJobId) updateData.provider_job_id = data.providerJobId;
    if (data.name) updateData.name = data.name;
    if (data.metadata) updateData.metadata = data.metadata;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row, error } = await (client as any)
      .from('audio_assets')
      .update(updateData)
      .eq('id', data.assetId)
      .is('deleted_at', null)
      .select()
      .single();

    if (error || !row) {
      logger.error({ ...ctx, error }, 'Failed to update audio asset');
      throw new Error('Failed to update audio asset');
    }

    logger.info({ ...ctx }, 'Audio asset updated');

    return mapRowToAudioAsset(row);
  },
  { schema: UpdateAudioAssetSchema },
);

/**
 * Get audio assets for a project
 */
export const getAudioAssetsAction = enhanceAction(
  async (data): Promise<{ assets: AudioAsset[]; total: number }> => {
    const logger = await getLogger();
    const ctx = { name: 'audioAsset.list', projectId: data.projectId };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Build query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (client as any)
      .from('audio_assets')
      .select(
        `
                id, asset_id, project_id, audio_type, prompt_hash, prompt,
                name, file_url, file_path, duration_seconds, file_size_bytes,
                provider, provider_job_id, status, metadata,
                usage_count, last_used_at, created_at, updated_at
            `,
        { count: 'exact' },
      )
      .eq('project_id', data.projectId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.audioType) {
      query = query.eq('audio_type', data.audioType);
    }

    if (data.status) {
      query = query.eq('status', data.status);
    }

    const { data: rows, error, count } = await query;

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to get audio assets');
      throw new Error('Failed to get audio assets');
    }

    return {
      assets: (rows ?? []).map(mapRowToAudioAsset),
      total: count ?? 0,
    };
  },
  { schema: GetAudioAssetsSchema },
);

/**
 * Increment usage count for an audio asset (when reused)
 */
export const incrementAudioAssetUsageAction = enhanceAction(
  async (data): Promise<void> => {
    const logger = await getLogger();
    const ctx = { name: 'audioAsset.incrementUsage', assetId: data.assetId };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Increment usage_count and update last_used_at
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client as any).rpc('increment_audio_asset_usage', {
      asset_id: data.assetId,
    });

    // If RPC doesn't exist, do manual update
    if (error?.code === 'PGRST202') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('audio_assets')
        .update({
          usage_count: 1, // Will be incremented in SQL
          last_used_at: new Date().toISOString(),
        })
        .eq('id', data.assetId);
    } else if (error) {
      logger.warn({ ...ctx, error }, 'Failed to increment usage count');
    }
  },
  { schema: IncrementUsageSchema },
);

// =============================================================================
// Generation Actions
// =============================================================================

const GenerateMusicSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1).max(500),
  name: z.string().max(100).optional(),
  duration: z.number().min(5).max(300).default(30),
  genre: z.string().optional(),
  mood: z.string().optional(),
});

const GenerateSfxSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1).max(500),
  name: z.string().max(100).optional(),
  duration: z.number().min(1).max(22).default(5),
});

/**
 * Generate music using ElevenLabs Music API
 * Creates asset record, generates audio, uploads to storage, updates record
 */
const generateMusicAsset = enhanceAction(
  async (data): Promise<AudioAsset> => {
    const logger = await getLogger();
    const ctx = { name: 'audioAsset.generateMusic', projectId: data.projectId };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    logger.info({ ...ctx, prompt: data.prompt }, 'Starting music generation');

    // Spending the project's key needs write access: a teammate who can only
    // read the project can read the key row too (KB-46)
    if (!(await authorizeProjectTarget(client, data.projectId))) {
      logger.warn(
        { ...ctx, userId: user.id, reason: 'not_writable' },
        'Music generation refused',
      );
      throw new ActionRefusal('Project not found');
    }

    // Check for existing asset with same prompt (deduplication)
    const { asset, isNew } = await findOrCreateAudioAsset({
      projectId: data.projectId,
      audioType: 'music',
      prompt: data.prompt,
      name: data.name,
      metadata: {
        genre: data.genre,
        mood: data.mood,
        duration: data.duration,
      },
    });

    // If existing completed asset, return it
    if (!isNew && asset.status === 'completed' && asset.fileUrl) {
      logger.info(
        { ...ctx, assetId: asset.id },
        'Reusing existing music asset',
      );
      return asset;
    }

    // Update status to processing
    await updateAudioAssetAction({
      assetId: asset.id,
      status: 'processing',
    });

    try {
      // Import provider dynamically to avoid circular deps
      const { ElevenLabsMusicProvider } = await import(
        '../providers/elevenlabs-music'
      );

      const apiKey = await getProjectElevenLabsApiKey(data.projectId);

      const provider = new ElevenLabsMusicProvider({ apiKey });

      // ElevenLabs returns audioBuffer directly in the response (extended type)
      const result = (await provider.generateMusic({
        prompt: data.prompt,
        duration: data.duration,
        genre: data.genre,
        mood: data.mood,
      })) as {
        audioBuffer?: Buffer;
        status: string;
        jobId: string;
        duration?: number;
      };

      if (result.status !== 'completed' || !result.audioBuffer) {
        throw new Error('Music generation failed');
      }

      // Upload to storage
      const fileName = `music/${asset.id}.mp3`;
      const { getStorageAdapter } = await import('@kit/storage');
      // audio-assets is server-write-only on Supabase (KB-55); on R2 the
      // client is ignored.
      const storage = getStorageAdapter(getSupabaseServerAdminClient());

      const uploadResult = await storage.upload(
        STORAGE_BUCKETS.audioAssets,
        fileName,
        result.audioBuffer,
        { contentType: 'audio/mpeg' },
      );

      // Update asset with completed status
      await updateAudioAssetAction({
        assetId: asset.id,
        status: 'completed',
        fileUrl: uploadResult.url,
        filePath: fileName,
        durationSeconds: result.duration,
        fileSizeBytes: result.audioBuffer.length,
        providerJobId: result.jobId,
      });

      logger.info({ ...ctx, assetId: asset.id }, 'Music generation completed');

      // Return updated asset
      return {
        ...asset,
        status: 'completed',
        fileUrl: uploadResult.url,
        filePath: fileName,
        durationSeconds: result.duration ?? null,
        fileSizeBytes: result.audioBuffer.length,
        providerJobId: result.jobId,
      };
    } catch (error) {
      logger.error(
        { ...ctx, error, assetId: asset.id },
        'Music generation failed',
      );

      await updateAudioAssetAction({
        assetId: asset.id,
        status: 'failed',
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error;
    }
  },
  { schema: GenerateMusicSchema },
);

export const generateMusicAssetAction = returnRefusals(generateMusicAsset);

/**
 * Generate SFX using ElevenLabs Sound Effects API
 */
const generateSfxAsset = enhanceAction(
  async (data): Promise<AudioAsset> => {
    const logger = await getLogger();
    const ctx = { name: 'audioAsset.generateSfx', projectId: data.projectId };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    logger.info({ ...ctx, prompt: data.prompt }, 'Starting SFX generation');

    // Spending the project's key needs write access: a teammate who can only
    // read the project can read the key row too (KB-46)
    if (!(await authorizeProjectTarget(client, data.projectId))) {
      logger.warn(
        { ...ctx, userId: user.id, reason: 'not_writable' },
        'SFX generation refused',
      );
      throw new ActionRefusal('Project not found');
    }

    // Check for existing asset with same prompt
    const { asset, isNew } = await findOrCreateAudioAsset({
      projectId: data.projectId,
      audioType: 'sfx',
      prompt: data.prompt,
      name: data.name,
      metadata: { duration: data.duration },
    });

    // If existing completed asset, return it
    if (!isNew && asset.status === 'completed' && asset.fileUrl) {
      logger.info({ ...ctx, assetId: asset.id }, 'Reusing existing SFX asset');
      return asset;
    }

    // Update status to processing
    await updateAudioAssetAction({
      assetId: asset.id,
      status: 'processing',
    });

    try {
      const { ElevenLabsSfxProvider } = await import(
        '../providers/elevenlabs-sfx'
      );

      const apiKey = await getProjectElevenLabsApiKey(data.projectId);

      const provider = new ElevenLabsSfxProvider({ apiKey });

      // ElevenLabs returns audioBuffer directly in the response (extended type)
      const result = (await provider.generateSfx({
        text: data.prompt,
        durationSeconds: data.duration,
      })) as {
        audioBuffer?: Buffer;
        status: string;
        jobId: string;
        duration?: number;
      };

      if (result.status !== 'completed' || !result.audioBuffer) {
        throw new Error('SFX generation failed');
      }

      // Upload to storage
      const fileName = `sfx/${asset.id}.mp3`;
      const { getStorageAdapter } = await import('@kit/storage');
      // audio-assets is server-write-only on Supabase (KB-55); on R2 the
      // client is ignored.
      const storage = getStorageAdapter(getSupabaseServerAdminClient());

      const uploadResult = await storage.upload(
        STORAGE_BUCKETS.audioAssets,
        fileName,
        result.audioBuffer,
        { contentType: 'audio/mpeg' },
      );

      // Update asset with completed status
      await updateAudioAssetAction({
        assetId: asset.id,
        status: 'completed',
        fileUrl: uploadResult.url,
        filePath: fileName,
        durationSeconds: result.duration,
        fileSizeBytes: result.audioBuffer.length,
        providerJobId: result.jobId,
      });

      logger.info({ ...ctx, assetId: asset.id }, 'SFX generation completed');

      return {
        ...asset,
        status: 'completed',
        fileUrl: uploadResult.url,
        filePath: fileName,
        durationSeconds: result.duration ?? null,
        fileSizeBytes: result.audioBuffer.length,
        providerJobId: result.jobId,
      };
    } catch (error) {
      logger.error(
        { ...ctx, error, assetId: asset.id },
        'SFX generation failed',
      );

      await updateAudioAssetAction({
        assetId: asset.id,
        status: 'failed',
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error;
    }
  },
  { schema: GenerateSfxSchema },
);

export const generateSfxAssetAction = returnRefusals(generateSfxAsset);

// =============================================================================
// Uploaded files (KB-73)
// =============================================================================

const CreateUploadedAudioAssetSchema = z.object({
  projectId: z.string().uuid(),
  audioType: z.enum(['music', 'sfx']),
  name: z.string().trim().min(1).max(100),
  /** The key the browser PUT the file to, through the presign route */
  path: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  fileSizeBytes: z.number().int().positive(),
});

const ASSET_COLUMNS = `
  id, asset_id, project_id, audio_type, prompt_hash, prompt,
  name, file_url, file_path, duration_seconds, file_size_bytes,
  provider, provider_job_id, status, metadata,
  usage_count, last_used_at, created_at, updated_at
`;

/**
 * Record a file the browser has already stored, as a library asset.
 *
 * The file never passes through here: the dialog PUTs it to storage through
 * the presign route, which signs only for project writers (KB-28) and binds
 * the type and length (KB-38). Sending it as base64 in this body capped
 * uploads at Next's 1 MB action limit, and the old action wrote it with the
 * admin client before checking the project (KB-57, audio leg).
 *
 * So this takes a key, not a URL, and records it only if the caller writes
 * the project, the key is in that project's own audio folder, and the object
 * is there. The URL is built here from the key.
 */
const createUploadedAudioAsset = enhanceAction(
  async (data): Promise<AudioAsset> => {
    const logger = await getLogger();
    const ctx = {
      name: 'audioAsset.createUploaded',
      projectId: data.projectId,
      path: data.path,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const refuse = (reason: string, message: string): never => {
      logger.warn({ ...ctx, userId: user.id, reason }, 'Upload not recorded');
      throw new ActionRefusal(message);
    };

    if (
      !AUDIO_LIBRARY_UPLOAD_TYPES.includes(
        data.contentType as AudioLibraryUploadType,
      )
    ) {
      refuse('type', "This file type isn't supported.");
    }

    if (!(await authorizeProjectTarget(client, data.projectId))) {
      refuse('not_writable', 'Project not found');
    }

    if (!isAudioLibraryPath(data.projectId, data.path)) {
      refuse('foreign_path', 'Upload not found');
    }

    const bucket = STORAGE_BUCKETS.projectAssets;
    const { getStorageAdapter } = await import('@kit/storage');
    const storage = getStorageAdapter(getSupabaseServerAdminClient());

    if (!(await storage.exists(bucket, data.path))) {
      refuse('missing_object', 'Upload not found');
    }

    // The same upload saved twice (a retried request) is one asset
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (client as any)
      .from('audio_assets')
      .select(ASSET_COLUMNS)
      .eq('project_id', data.projectId)
      .eq('file_path', data.path)
      .is('deleted_at', null)
      .limit(1);

    if (existing?.[0]) {
      return mapRowToAudioAsset(existing[0]);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row, error } = await (client as any)
      .from('audio_assets')
      .insert({
        project_id: data.projectId,
        audio_type: data.audioType,
        prompt_hash: hashPrompt(normalizePrompt(data.name)),
        prompt: data.name, // For uploads, name is the "prompt"
        name: data.name,
        file_url: storage.getPublicUrl(bucket, data.path),
        file_path: data.path,
        file_size_bytes: data.fileSizeBytes,
        provider: 'upload',
        source: 'uploaded',
        status: 'completed',
        metadata: { source: 'uploaded', contentType: data.contentType },
      })
      .select()
      .single();

    if (error || !row) {
      logger.error({ ...ctx, error }, 'Failed to create uploaded audio asset');

      // Nothing will point at the file; it is in this project's own folder,
      // checked above, so removing it touches nothing else
      await storage.delete(bucket, data.path).catch((deleteError: unknown) => {
        logger.error(
          { ...ctx, error: deleteError },
          'Failed to delete an unrecorded upload',
        );
      });

      throw new ActionRefusal("Couldn't save this upload.");
    }

    logger.info({ ...ctx, assetId: row.id }, 'Uploaded audio asset created');

    return mapRowToAudioAsset(row);
  },
  { schema: CreateUploadedAudioAssetSchema },
);

export const createUploadedAudioAssetAction = returnRefusals(
  createUploadedAudioAsset,
);
