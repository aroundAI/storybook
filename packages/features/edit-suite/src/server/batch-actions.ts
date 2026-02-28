'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
    BatchAssembleSchema,
    BatchSaveSchema,
} from '../lib/schemas';
import { mapEditProjectRow } from '../lib/types';
import type { BatchAssembleResult, BatchSaveResult } from '../lib/types';
import { getEditSuiteClient } from './db-client';

/**
 * Batch-creates an entire edit project from auto-assembly.
 * Creates: project → tracks → clips → sync groups → keyframes atomically
 * via a PostgreSQL function (single transaction).
 *
 * The client-side auto-assembly algorithm builds the arrays and calls this
 * single server action to persist everything atomically.
 */
export const batchAssembleAction = enhanceAction(
    async (data): Promise<{ success: true; result: BatchAssembleResult }> => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.batchAssemble', episodeId: data.episodeId };

        logger.info(ctx, 'Batch assembling edit project');

        const authClient = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(authClient);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const client = getEditSuiteClient();

        // Verify user has access to this episode (IDOR protection)
        // Join episode → project → account to verify ownership
        const { data: episode, error: episodeError } = await client
            .from('episodes')
            .select('id, projects!inner(id, account_id)')
            .eq('id', data.episodeId)
            .is('deleted_at', null)
            .single();

        if (episodeError || !episode) {
            throw new Error('Episode not found or access denied');
        }

        // Verify the user is a member of the account that owns this project
        const accountId = (episode as { projects: { account_id: string } }).projects.account_id;
        const { data: membership, error: memberError } = await client
            .from('accounts_memberships')
            .select('account_id')
            .eq('account_id', accountId)
            .eq('user_id', user.id)
            .single();

        if (memberError || !membership) {
            throw new Error('Access denied: not a member of the project account');
        }

        // Call the atomic RPC function
        const { data: result, error: rpcError } = await client.rpc(
            'batch_assemble_edit_project',
            {
                p_episode_id: data.episodeId,
                p_user_id: user.id,
                p_width: data.width,
                p_height: data.height,
                p_fps: data.fps,
                p_active_language: data.activeLanguage,
                p_tracks: JSON.stringify(data.tracks),
                p_clips: JSON.stringify(data.clips),
                p_keyframes: JSON.stringify(data.keyframes),
                p_sync_groups: JSON.stringify(data.syncGroups),
            },
        );

        if (rpcError) {
            logger.error({ ...ctx, error: rpcError }, 'Failed to batch assemble edit project');
            throw new Error(`Failed to batch assemble: ${rpcError.message}`);
        }

        const rpcResult = result as {
            projectId: string;
            trackCount: number;
            clipCount: number;
            keyframeCount: number;
            syncGroupCount: number;
        };

        // Fetch the created project for the response
        const { data: project, error: fetchError } = await client
            .from('edit_projects')
            .select('*')
            .eq('id', rpcResult.projectId)
            .single();

        if (fetchError || !project) {
            throw new Error('Failed to fetch created project');
        }

        logger.info(
            {
                ...ctx,
                projectId: rpcResult.projectId,
                trackCount: rpcResult.trackCount,
                clipCount: rpcResult.clipCount,
                syncGroupCount: rpcResult.syncGroupCount,
                keyframeCount: rpcResult.keyframeCount,
            },
            'Edit project assembled (atomic)',
        );
        revalidatePath('/home/[account]/studio/[projectId]/episodes/[episodeId]', 'page');

        return {
            success: true,
            result: {
                project: mapEditProjectRow(project),
                trackCount: rpcResult.trackCount ?? 0,
                clipCount: rpcResult.clipCount ?? 0,
                keyframeCount: rpcResult.keyframeCount ?? 0,
                syncGroupCount: rpcResult.syncGroupCount ?? 0,
            },
        };
    },
    { schema: BatchAssembleSchema },
);

/**
 * Batch-save dirty state from client to database atomically.
 * Called by auto-save (debounced 2s) after user edits.
 *
 * Uses a PostgreSQL function to ensure all updates, deletes, and creates
 * happen in a single transaction. Also bumps the project version.
 */
export const batchSaveAction = enhanceAction(
    async (data): Promise<{ success: true; result: BatchSaveResult }> => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.batchSave', projectId: data.editProjectId };

        logger.info(ctx, 'Batch saving edit project');

        const authClient = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(authClient);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const client = getEditSuiteClient();

        // Call the atomic RPC function
        const { data: result, error: rpcError } = await client.rpc(
            'batch_save_edit_project',
            {
                p_edit_project_id: data.editProjectId,
                p_dirty_tracks: JSON.stringify(data.dirtyTracks),
                p_dirty_clips: JSON.stringify(data.dirtyClips),
                p_dirty_keyframes: JSON.stringify(data.dirtyKeyframes),
                p_deleted_clip_ids: JSON.stringify(data.deletedClipIds),
                p_deleted_keyframe_ids: JSON.stringify(data.deletedKeyframeIds),
                p_new_clips: JSON.stringify(data.newClips),
                p_new_keyframes: JSON.stringify(data.newKeyframes),
            },
        );

        if (rpcError) {
            logger.error({ ...ctx, error: rpcError }, 'Failed to batch save edit project');
            throw new Error(`Failed to batch save: ${rpcError.message}`);
        }

        const rpcResult = result as BatchSaveResult;

        logger.info(
            { ...ctx, ...rpcResult },
            'Batch save complete (atomic)',
        );

        return {
            success: true,
            result: rpcResult,
        };
    },
    { schema: BatchSaveSchema },
);
