'use server';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
    CreateKeyframeSchema,
    DeleteKeyframeSchema,
    UpdateKeyframeSchema,
} from '../lib/schemas';
import { mapEditKeyframeRow } from '../lib/types';
import type { EditKeyframe } from '../lib/types';

/**
 * Create a keyframe for a clip property.
 */
export const createKeyframeAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.createKeyframe', clipId: data.clipId, property: data.property };

        logger.info(ctx, 'Creating keyframe');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: keyframe, error } = await (client as any)
            .from('edit_keyframes')
            .insert({
                clip_id: data.clipId,
                property: data.property,
                offset_ms: data.offsetMs,
                value: data.value,
                easing: data.easing,
                bezier_cp1_x: data.bezierCp1X ?? null,
                bezier_cp1_y: data.bezierCp1Y ?? null,
                bezier_cp2_x: data.bezierCp2X ?? null,
                bezier_cp2_y: data.bezierCp2Y ?? null,
            })
            .select()
            .single();

        if (error) {
            logger.error({ ...ctx, error }, 'Failed to create keyframe');
            throw new Error(`Failed to create keyframe: ${error.message}`);
        }

        logger.info({ ...ctx, keyframeId: keyframe.id }, 'Keyframe created');

        return { success: true, keyframe: mapEditKeyframeRow(keyframe) };
    },
    { schema: CreateKeyframeSchema },
);

/**
 * Update a keyframe's value, offset, easing, or bezier control points.
 */
export const updateKeyframeAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.updateKeyframe', keyframeId: data.keyframeId };

        logger.info(ctx, 'Updating keyframe');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const updates: Record<string, unknown> = {};

        if (data.offsetMs !== undefined) updates.offset_ms = data.offsetMs;
        if (data.value !== undefined) updates.value = data.value;
        if (data.easing !== undefined) updates.easing = data.easing;
        if (data.bezierCp1X !== undefined) updates.bezier_cp1_x = data.bezierCp1X;
        if (data.bezierCp1Y !== undefined) updates.bezier_cp1_y = data.bezierCp1Y;
        if (data.bezierCp2X !== undefined) updates.bezier_cp2_x = data.bezierCp2X;
        if (data.bezierCp2Y !== undefined) updates.bezier_cp2_y = data.bezierCp2Y;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: keyframe, error } = await (client as any)
            .from('edit_keyframes')
            .update(updates)
            .eq('id', data.keyframeId)
            .select()
            .single();

        if (error) {
            logger.error({ ...ctx, error }, 'Failed to update keyframe');
            throw new Error(`Failed to update keyframe: ${error.message}`);
        }

        if (!keyframe) {
            throw new Error('Keyframe not found');
        }

        logger.info(ctx, 'Keyframe updated');

        return { success: true, keyframe: mapEditKeyframeRow(keyframe) as EditKeyframe };
    },
    { schema: UpdateKeyframeSchema },
);

/**
 * Delete a keyframe.
 */
export const deleteKeyframeAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.deleteKeyframe', keyframeId: data.keyframeId };

        logger.info(ctx, 'Deleting keyframe');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (client as any)
            .from('edit_keyframes')
            .delete()
            .eq('id', data.keyframeId);

        if (error) {
            logger.error({ ...ctx, error }, 'Failed to delete keyframe');
            throw new Error(`Failed to delete keyframe: ${error.message}`);
        }

        logger.info(ctx, 'Keyframe deleted');

        return { success: true, keyframeId: data.keyframeId };
    },
    { schema: DeleteKeyframeSchema },
);
