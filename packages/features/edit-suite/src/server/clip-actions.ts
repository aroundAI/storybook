'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
    CreateClipSchema,
    CreateTransitionSchema,
    DeleteClipSchema,
    DeleteTransitionSchema,
    SplitClipSchema,
    UpdateClipSchema,
    UpdateTransitionSchema,
} from '../lib/schemas';
import {
    mapEditClipRow,
    mapEditTransitionRow,
} from '../lib/types';
import type { EditClip, SplitClipResult } from '../lib/types';
import { getEditSuiteClient } from './db-client';

// ──────────────────────────────────────────
// Clip CRUD
// ──────────────────────────────────────────

/**
 * Create a new clip on a track (e.g., from media bin drag-drop).
 */
export const createClipAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.createClip', trackId: data.trackId };

        logger.info(ctx, 'Creating clip');

        const authClient = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(authClient);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const client = getEditSuiteClient();

        const { data: clip, error } = await client
            .from('edit_clips')
            .insert({
                track_id: data.trackId,
                source_shot_id: data.sourceShotId ?? null,
                source_dialogue_id: data.sourceDialogueId ?? null,
                source_dubbed_dialogue_id: data.sourceDubbedDialogueId ?? null,
                source_audio_track_id: data.sourceAudioTrackId ?? null,
                source_upload_url: data.sourceUploadUrl ?? null,
                media_url: data.mediaUrl ?? null,
                thumbnail_url: data.thumbnailUrl ?? null,
                start_ms: data.startMs,
                end_ms: data.endMs,
                in_point_ms: data.inPointMs,
                out_point_ms: data.outPointMs,
                volume: data.volume,
                speed: data.speed,
                fade_in_ms: data.fadeInMs,
                fade_out_ms: data.fadeOutMs,
                sort_order: data.sortOrder,
                sync_group_id: data.syncGroupId ?? null,
                language: data.language ?? null,
                is_active: data.isActive,
            })
            .select()
            .single();

        if (error) {
            logger.error({ ...ctx, error }, 'Failed to create clip');
            throw new Error(`Failed to create clip: ${error.message}`);
        }

        logger.info({ ...ctx, clipId: clip.id }, 'Clip created');
        revalidatePath('/home/[account]/studio/[projectId]/episodes/[episodeId]', 'page');

        return { success: true, clip: mapEditClipRow(clip) };
    },
    { schema: CreateClipSchema },
);

/**
 * Update clip properties (position, volume, speed, trim, etc.).
 */
export const updateClipAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.updateClip', clipId: data.clipId };

        logger.info(ctx, 'Updating clip');

        const authClient = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(authClient);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const client = getEditSuiteClient();

        const updates: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
        };

        if (data.startMs !== undefined) updates.start_ms = data.startMs;
        if (data.endMs !== undefined) updates.end_ms = data.endMs;
        if (data.inPointMs !== undefined) updates.in_point_ms = data.inPointMs;
        if (data.outPointMs !== undefined) updates.out_point_ms = data.outPointMs;
        if (data.volume !== undefined) updates.volume = data.volume;
        if (data.speed !== undefined) updates.speed = data.speed;
        if (data.fadeInMs !== undefined) updates.fade_in_ms = data.fadeInMs;
        if (data.fadeOutMs !== undefined) updates.fade_out_ms = data.fadeOutMs;
        if (data.sortOrder !== undefined) updates.sort_order = data.sortOrder;
        if (data.isActive !== undefined) updates.is_active = data.isActive;

        const { data: clip, error } = await client
            .from('edit_clips')
            .update(updates)
            .eq('id', data.clipId)
            .select()
            .single();

        if (error) {
            logger.error({ ...ctx, error }, 'Failed to update clip');
            throw new Error(`Failed to update clip: ${error.message}`);
        }

        if (!clip) {
            throw new Error('Clip not found');
        }

        logger.info(ctx, 'Clip updated');

        return { success: true, clip: mapEditClipRow(clip) as EditClip };
    },
    { schema: UpdateClipSchema },
);

/**
 * Delete a clip (cascades keyframes via ON DELETE CASCADE).
 */
export const deleteClipAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.deleteClip', clipId: data.clipId };

        logger.info(ctx, 'Deleting clip');

        const authClient = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(authClient);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const client = getEditSuiteClient();

        // Hard delete — keyframes cascade via FK
        const { error } = await client
            .from('edit_clips')
            .delete()
            .eq('id', data.clipId);

        if (error) {
            logger.error({ ...ctx, error }, 'Failed to delete clip');
            throw new Error(`Failed to delete clip: ${error.message}`);
        }

        logger.info(ctx, 'Clip deleted');
        revalidatePath('/home/[account]/studio/[projectId]/episodes/[episodeId]', 'page');

        return { success: true, clipId: data.clipId };
    },
    { schema: DeleteClipSchema },
);

/**
 * Split a clip at a given timeline position atomically.
 * Uses a PostgreSQL function to ensure the split (update original,
 * create second clip, redistribute keyframes) happens in one transaction.
 */
export const splitClipAction = enhanceAction(
    async (data): Promise<{ success: true; result: SplitClipResult }> => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.splitClip', clipId: data.clipId, splitAtMs: data.splitAtMs };

        logger.info(ctx, 'Splitting clip');

        const authClient = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(authClient);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const client = getEditSuiteClient();

        // Call the atomic RPC function
        const { data: result, error: rpcError } = await client.rpc(
            'split_edit_clip',
            {
                p_clip_id: data.clipId,
                p_split_at_ms: data.splitAtMs,
            },
        );

        if (rpcError) {
            logger.error({ ...ctx, error: rpcError }, 'Failed to split clip');
            throw new Error(`Failed to split clip: ${rpcError.message}`);
        }

        const rpcResult = result as { firstClipId: string; secondClipId: string };

        // Fetch both clips for the response
        const [firstClipResult, secondClipResult] = await Promise.all([
            client.from('edit_clips').select('*').eq('id', rpcResult.firstClipId).single(),
            client.from('edit_clips').select('*').eq('id', rpcResult.secondClipId).single(),
        ]);

        if (firstClipResult.error || !firstClipResult.data) {
            throw new Error('Failed to fetch first clip after split');
        }
        if (secondClipResult.error || !secondClipResult.data) {
            throw new Error('Failed to fetch second clip after split');
        }

        logger.info(
            { ...ctx, firstClipId: rpcResult.firstClipId, secondClipId: rpcResult.secondClipId },
            'Clip split (atomic)',
        );
        revalidatePath('/home/[account]/studio/[projectId]/episodes/[episodeId]', 'page');

        return {
            success: true,
            result: {
                firstClip: mapEditClipRow(firstClipResult.data),
                secondClip: mapEditClipRow(secondClipResult.data),
            },
        };
    },
    { schema: SplitClipSchema },
);

// ──────────────────────────────────────────
// Transition CRUD
// ──────────────────────────────────────────

/**
 * Create a transition between two adjacent clips.
 */
export const createTransitionAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.createTransition' };

        logger.info(ctx, 'Creating transition');

        const authClient = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(authClient);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const client = getEditSuiteClient();

        const { data: transition, error } = await client
            .from('edit_transitions')
            .insert({
                from_clip_id: data.fromClipId,
                to_clip_id: data.toClipId,
                type: data.type,
                duration_ms: data.durationMs,
                params: data.params,
            })
            .select()
            .single();

        if (error) {
            logger.error({ ...ctx, error }, 'Failed to create transition');
            throw new Error(`Failed to create transition: ${error.message}`);
        }

        logger.info({ ...ctx, transitionId: transition.id }, 'Transition created');

        return { success: true, transition: mapEditTransitionRow(transition) };
    },
    { schema: CreateTransitionSchema },
);

/**
 * Update a transition's type, duration, or params.
 */
export const updateTransitionAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.updateTransition', transitionId: data.transitionId };

        logger.info(ctx, 'Updating transition');

        const authClient = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(authClient);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const client = getEditSuiteClient();

        const updates: Record<string, unknown> = {};

        if (data.type !== undefined) updates.type = data.type;
        if (data.durationMs !== undefined) updates.duration_ms = data.durationMs;
        if (data.params !== undefined) updates.params = data.params;

        const { data: transition, error } = await client
            .from('edit_transitions')
            .update(updates)
            .eq('id', data.transitionId)
            .select()
            .single();

        if (error) {
            logger.error({ ...ctx, error }, 'Failed to update transition');
            throw new Error(`Failed to update transition: ${error.message}`);
        }

        logger.info(ctx, 'Transition updated');

        return { success: true, transition: mapEditTransitionRow(transition) };
    },
    { schema: UpdateTransitionSchema },
);

/**
 * Delete a transition.
 */
export const deleteTransitionAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.deleteTransition', transitionId: data.transitionId };

        logger.info(ctx, 'Deleting transition');

        const authClient = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(authClient);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const client = getEditSuiteClient();

        const { error } = await client
            .from('edit_transitions')
            .delete()
            .eq('id', data.transitionId);

        if (error) {
            logger.error({ ...ctx, error }, 'Failed to delete transition');
            throw new Error(`Failed to delete transition: ${error.message}`);
        }

        logger.info(ctx, 'Transition deleted');

        return { success: true, transitionId: data.transitionId };
    },
    { schema: DeleteTransitionSchema },
);
