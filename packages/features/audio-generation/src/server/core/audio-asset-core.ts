/**
 * Audio Asset Core
 *
 * Core audio asset functions without server action wrapper.
 * Used by LLM Worker Lambda for async processing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import crypto from 'crypto';

import { getLogger } from '@kit/shared/logger';

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

function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .sort()
    .join(' ');
}

function hashPrompt(normalizedPrompt: string): string {
  return crypto.createHash('sha256').update(normalizedPrompt).digest('hex');
}

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
// Core Functions
// =============================================================================

/**
 * Find an existing audio asset by prompt (core version)
 * Returns null if not found
 */
export async function findAudioAssetByPromptCore(params: {
  supabase: SupabaseClient;
  projectId: string;
  prompt: string;
  audioType: 'music' | 'sfx';
}): Promise<AudioAsset | null> {
  const logger = await getLogger();
  const ctx = {
    name: 'audioAsset.findByPromptCore',
    projectId: params.projectId,
  };

  const normalized = normalizePrompt(params.prompt);
  const hash = hashPrompt(normalized);

  logger.debug(
    { ...ctx, promptHash: hash.substring(0, 16), audioType: params.audioType },
    'Looking up audio asset by prompt hash (core)',
  );

  const { data: rows, error } = await params.supabase
    .from('audio_assets')
    .select(
      `id, asset_id, project_id, audio_type, prompt_hash, prompt,
       name, file_url, file_path, duration_seconds, file_size_bytes,
       provider, provider_job_id, status, metadata,
       usage_count, last_used_at, created_at, updated_at`,
    )
    .eq('project_id', params.projectId)
    .eq('prompt_hash', hash)
    .eq('audio_type', params.audioType)
    .eq('status', 'completed')
    .is('deleted_at', null)
    .limit(1);

  if (error) {
    logger.error({ ...ctx, error }, 'Failed to query audio assets (core)');
    throw new Error('Failed to find audio asset');
  }

  if (!rows || rows.length === 0) {
    logger.debug(ctx, 'No existing audio asset found');
    return null;
  }

  const firstRow = rows[0]!;

  logger.info(
    { ...ctx, assetId: firstRow.id },
    'Found existing audio asset for reuse (core)',
  );

  return mapRowToAudioAsset(firstRow as AudioAssetRow);
}

/**
 * Create a new audio asset (core version)
 */
export async function createAudioAssetCore(params: {
  supabase: SupabaseClient;
  projectId: string;
  audioType: 'music' | 'sfx';
  prompt: string;
  name?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}): Promise<AudioAsset> {
  const logger = await getLogger();
  const ctx = { name: 'audioAsset.createCore', projectId: params.projectId };

  const normalized = normalizePrompt(params.prompt);
  const hash = hashPrompt(normalized);

  logger.info(
    { ...ctx, audioType: params.audioType, promptHash: hash.substring(0, 16) },
    'Creating audio asset (core)',
  );

  const { data: row, error } = await params.supabase
    .from('audio_assets')
    .insert({
      project_id: params.projectId,
      audio_type: params.audioType,
      prompt: params.prompt,
      prompt_hash: hash,
      name: params.name,
      provider: params.provider ?? 'elevenlabs',
      status: 'pending',
      metadata: params.metadata ?? {},
    })
    .select()
    .single();

  if (error || !row) {
    logger.error({ ...ctx, error }, 'Failed to create audio asset (core)');
    throw new Error('Failed to create audio asset');
  }

  logger.info({ ...ctx, assetId: row.id }, 'Audio asset created (core)');

  return mapRowToAudioAsset(row as AudioAssetRow);
}

/**
 * Update an audio asset (core version)
 */
export async function updateAudioAssetCore(params: {
  supabase: SupabaseClient;
  assetId: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  fileUrl?: string;
  filePath?: string;
  durationSeconds?: number;
  fileSizeBytes?: number;
  providerJobId?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}): Promise<AudioAsset> {
  const logger = await getLogger();
  const ctx = { name: 'audioAsset.updateCore', assetId: params.assetId };

  logger.info({ ...ctx, status: params.status }, 'Updating audio asset (core)');

  const updateData: Record<string, unknown> = {};
  if (params.status) updateData.status = params.status;
  if (params.fileUrl) updateData.file_url = params.fileUrl;
  if (params.filePath) updateData.file_path = params.filePath;
  if (params.durationSeconds)
    updateData.duration_seconds = params.durationSeconds;
  if (params.fileSizeBytes) updateData.file_size_bytes = params.fileSizeBytes;
  if (params.providerJobId) updateData.provider_job_id = params.providerJobId;
  if (params.name) updateData.name = params.name;
  if (params.metadata) updateData.metadata = params.metadata;

  const { data: row, error } = await params.supabase
    .from('audio_assets')
    .update(updateData)
    .eq('id', params.assetId)
    .is('deleted_at', null)
    .select()
    .single();

  if (error || !row) {
    logger.error({ ...ctx, error }, 'Failed to update audio asset (core)');
    throw new Error('Failed to update audio asset');
  }

  logger.info({ ...ctx }, 'Audio asset updated (core)');

  return mapRowToAudioAsset(row as AudioAssetRow);
}

/**
 * Find or create an audio asset (core version)
 * Returns existing asset if found, creates new one if not
 */
export async function findOrCreateAudioAssetCore(params: {
  supabase: SupabaseClient;
  projectId: string;
  audioType: 'music' | 'sfx';
  prompt: string;
  name?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ asset: AudioAsset; isNew: boolean }> {
  // Try to find existing
  const existing = await findAudioAssetByPromptCore({
    supabase: params.supabase,
    projectId: params.projectId,
    prompt: params.prompt,
    audioType: params.audioType,
  });

  if (existing) {
    // Increment usage count
    await params.supabase
      .from('audio_assets')
      .update({
        usage_count: existing.usageCount + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    return { asset: existing, isNew: false };
  }

  // Create new
  const newAsset = await createAudioAssetCore({
    supabase: params.supabase,
    projectId: params.projectId,
    audioType: params.audioType,
    prompt: params.prompt,
    name: params.name,
    provider: params.provider ?? 'elevenlabs',
    metadata: params.metadata,
  });

  return { asset: newAsset, isNew: true };
}
