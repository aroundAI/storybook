/**
 * Audio Asset Library Actions
 * 
 * Server actions for managing reusable music/SFX assets with deduplication.
 * Assets are stored in the audio_assets table with prompt hashing for reuse.
 */

'use server';

import crypto from 'crypto';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

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
export function normalizePrompt(prompt: string): string {
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
export function hashPrompt(normalizedPrompt: string): string {
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
            'Looking up audio asset by prompt hash'
        );

        // Query by hash
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rows, error } = await (client as any)
            .from('audio_assets')
            .select('*')
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
            'Found existing audio asset for reuse'
        );

        return mapRowToAudioAsset(rows[0]);
    },
    { schema: FindAudioAssetSchema }
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
            'Creating audio asset'
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
    { schema: CreateAudioAssetSchema }
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
        if (data.durationSeconds) updateData.duration_seconds = data.durationSeconds;
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
    { schema: UpdateAudioAssetSchema }
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
            .select('*', { count: 'exact' })
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
    { schema: GetAudioAssetsSchema }
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
    { schema: IncrementUsageSchema }
);

/**
 * Find or create an audio asset
 * Returns existing asset if found, creates new one if not
 */
export async function findOrCreateAudioAsset(params: {
    projectId: string;
    audioType: 'music' | 'sfx';
    prompt: string;
    name?: string;
    provider?: string;
    metadata?: Record<string, unknown>;
}): Promise<{ asset: AudioAsset; isNew: boolean }> {
    // Try to find existing
    const existing = await findAudioAssetByPromptAction({
        projectId: params.projectId,
        prompt: params.prompt,
        audioType: params.audioType,
    });

    if (existing) {
        // Increment usage count
        await incrementAudioAssetUsageAction({ assetId: existing.id });
        return { asset: existing, isNew: false };
    }

    // Create new
    const newAsset = await createAudioAssetAction({
        projectId: params.projectId,
        audioType: params.audioType,
        prompt: params.prompt,
        name: params.name,
        provider: params.provider ?? 'elevenlabs',
        metadata: params.metadata,
    });

    return { asset: newAsset, isNew: true };
}
