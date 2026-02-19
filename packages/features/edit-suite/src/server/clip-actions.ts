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

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: clip, error } = await (client as any)
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

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: clip, error } = await (client as any)
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

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        // Hard delete — keyframes cascade via FK
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (client as any)
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
 * Split a clip at a given timeline position.
 * Creates two clips from one, preserving keyframes split across both.
 */
export const splitClipAction = enhanceAction(
    async (data): Promise<{ success: true; result: SplitClipResult }> => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.splitClip', clipId: data.clipId, splitAtMs: data.splitAtMs };

        logger.info(ctx, 'Splitting clip');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        // Fetch the clip to split
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: originalClip, error: fetchError } = await (client as any)
            .from('edit_clips')
            .select('*')
            .eq('id', data.clipId)
            .single();

        if (fetchError || !originalClip) {
            throw new Error('Clip not found');
        }

        // Validate split point is within clip bounds
        if (data.splitAtMs <= originalClip.start_ms || data.splitAtMs >= originalClip.end_ms) {
            throw new Error('Split point must be within clip boundaries');
        }

        // Calculate source offset at split point
        const clipDuration = originalClip.end_ms - originalClip.start_ms;
        const sourceDuration = originalClip.out_point_ms - originalClip.in_point_ms;
        const splitRatio = (data.splitAtMs - originalClip.start_ms) / clipDuration;
        const sourceOffsetAtSplit = originalClip.in_point_ms + Math.round(sourceDuration * splitRatio);

        // Update first clip (trim end)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: firstClip, error: updateError } = await (client as any)
            .from('edit_clips')
            .update({
                end_ms: data.splitAtMs,
                out_point_ms: sourceOffsetAtSplit,
                updated_at: new Date().toISOString(),
            })
            .eq('id', data.clipId)
            .select()
            .single();

        if (updateError) {
            throw new Error(`Failed to update first clip: ${updateError.message}`);
        }

        // Create second clip (from split point to original end)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: secondClip, error: createError } = await (client as any)
            .from('edit_clips')
            .insert({
                track_id: originalClip.track_id,
                source_shot_id: originalClip.source_shot_id,
                source_dialogue_id: originalClip.source_dialogue_id,
                source_dubbed_dialogue_id: originalClip.source_dubbed_dialogue_id,
                source_audio_track_id: originalClip.source_audio_track_id,
                source_upload_url: originalClip.source_upload_url,
                media_url: originalClip.media_url,
                thumbnail_url: originalClip.thumbnail_url,
                start_ms: data.splitAtMs,
                end_ms: originalClip.end_ms,
                in_point_ms: sourceOffsetAtSplit,
                out_point_ms: originalClip.out_point_ms,
                volume: originalClip.volume,
                speed: originalClip.speed,
                fade_in_ms: 0,
                fade_out_ms: originalClip.fade_out_ms,
                sort_order: originalClip.sort_order + 1,
                sync_group_id: originalClip.sync_group_id,
                language: originalClip.language,
                is_active: originalClip.is_active,
            })
            .select()
            .single();

        if (createError) {
            throw new Error(`Failed to create second clip: ${createError.message}`);
        }

        // Split keyframes: fetch all for original clip, distribute
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: keyframes } = await (client as any)
            .from('edit_keyframes')
            .select('*')
            .eq('clip_id', data.clipId);

        if (keyframes && keyframes.length > 0) {
            const splitOffsetMs = data.splitAtMs - originalClip.start_ms;

            // Keyframes for second clip: those after split point, with adjusted offset
            const secondClipKeyframes = keyframes
                .filter((kf: Record<string, unknown>) => (kf.offset_ms as number) >= splitOffsetMs)
                .map((kf: Record<string, unknown>) => ({
                    clip_id: secondClip.id,
                    property: kf.property,
                    offset_ms: (kf.offset_ms as number) - splitOffsetMs,
                    value: kf.value,
                    easing: kf.easing,
                    bezier_cp1_x: kf.bezier_cp1_x,
                    bezier_cp1_y: kf.bezier_cp1_y,
                    bezier_cp2_x: kf.bezier_cp2_x,
                    bezier_cp2_y: kf.bezier_cp2_y,
                }));

            if (secondClipKeyframes.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (client as any)
                    .from('edit_keyframes')
                    .insert(secondClipKeyframes);
            }

            // Remove keyframes beyond split from first clip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (client as any)
                .from('edit_keyframes')
                .delete()
                .eq('clip_id', data.clipId)
                .gt('offset_ms', splitOffsetMs);
        }

        // Remove the outgoing fade from the first clip since it's now split
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
            .from('edit_clips')
            .update({ fade_out_ms: 0 })
            .eq('id', data.clipId);

        logger.info(
            { ...ctx, firstClipId: firstClip.id, secondClipId: secondClip.id },
            'Clip split',
        );
        revalidatePath('/home/[account]/studio/[projectId]/episodes/[episodeId]', 'page');

        return {
            success: true,
            result: {
                firstClip: mapEditClipRow(firstClip),
                secondClip: mapEditClipRow(secondClip),
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

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: transition, error } = await (client as any)
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

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const updates: Record<string, unknown> = {};

        if (data.type !== undefined) updates.type = data.type;
        if (data.durationMs !== undefined) updates.duration_ms = data.durationMs;
        if (data.params !== undefined) updates.params = data.params;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: transition, error } = await (client as any)
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

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (client as any)
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
