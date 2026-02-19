'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
    CreateEditProjectSchema,
    GetEditProjectSchema,
    UpdateEditProjectSchema,
} from '../lib/schemas';
import {
    mapEditClipRow,
    mapEditKeyframeRow,
    mapEditProjectRow,
    mapEditTrackRow,
    mapEditTransitionRow,
    mapSyncGroupRow,
} from '../lib/types';
import type { EditProjectWithRelations } from '../lib/types';
import { getEditSuiteClient } from './db-client';

/**
 * Create a new edit project for an episode with default tracks.
 * Default tracks: Video A, Video B, Audio, SFX, Music
 */
export const createEditProjectAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.createProject', episodeId: data.episodeId };

        logger.info(ctx, 'Creating edit project');

        const authClient = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(authClient);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const client = getEditSuiteClient();

        // Create project
        const { data: project, error } = await client
            .from('edit_projects')
            .insert({
                episode_id: data.episodeId,
                width: data.width,
                height: data.height,
                fps: data.fps,
                active_language: data.activeLanguage,
            })
            .select()
            .single();

        if (error || !project) {
            logger.error({ ...ctx, error }, 'Failed to create edit project');
            throw new Error(`Failed to create edit project: ${error?.message}`);
        }

        // Create default tracks
        const defaultTracks = [
            { edit_project_id: project.id, type: 'video', name: 'Video A', sort_order: 0, volume: 1.0 },
            { edit_project_id: project.id, type: 'video', name: 'Video B', sort_order: 1, volume: 1.0 },
            { edit_project_id: project.id, type: 'dialogue', name: 'Dialogue', sort_order: 2, volume: 1.0 },
            { edit_project_id: project.id, type: 'sfx', name: 'SFX', sort_order: 3, volume: 0.8 },
            { edit_project_id: project.id, type: 'music', name: 'Music', sort_order: 4, volume: 0.5 },
        ];

        const { error: trackError } = await client
            .from('edit_tracks')
            .insert(defaultTracks);

        if (trackError) {
            logger.error({ ...ctx, error: trackError }, 'Failed to create default tracks');
            throw new Error(`Failed to create default tracks: ${trackError.message}`);
        }

        logger.info({ ...ctx, projectId: project.id }, 'Edit project created with defaults');
        revalidatePath('/home/[account]/studio/[projectId]/episodes/[episodeId]', 'page');

        return { success: true, project: mapEditProjectRow(project) };
    },
    { schema: CreateEditProjectSchema },
);

/**
 * Fetch an edit project with all related data:
 * tracks, clips, keyframes, transitions, sync groups.
 */
export const getEditProjectAction = enhanceAction(
    async (data): Promise<{ success: true; project: EditProjectWithRelations }> => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.getProject', editProjectId: data.editProjectId };

        logger.info(ctx, 'Fetching edit project');

        const authClient = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(authClient);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const client = getEditSuiteClient();

        // Fetch project
        const { data: project, error: projectError } = await client
            .from('edit_projects')
            .select('*')
            .eq('id', data.editProjectId)
            .single();

        if (projectError || !project) {
            throw new Error('Edit project not found');
        }

        // Fetch tracks
        const { data: tracks, error: tracksError } = await client
            .from('edit_tracks')
            .select('*')
            .eq('edit_project_id', data.editProjectId)
            .order('sort_order');

        if (tracksError) {
            throw new Error(`Failed to fetch tracks: ${tracksError.message}`);
        }

        // Fetch clips for all tracks (join via track IDs)
        const trackIds = (tracks ?? []).map((t: { id: string }) => t.id);
        let clips: Array<Record<string, unknown>> = [];
        let transitions: Array<Record<string, unknown>> = [];

        if (trackIds.length > 0) {
            const { data: clipData, error: clipsError } = await client
                .from('edit_clips')
                .select('*')
                .in('track_id', trackIds)
                .order('start_ms');

            if (clipsError) {
                throw new Error(`Failed to fetch clips: ${clipsError.message}`);
            }

            clips = clipData ?? [];

            // Fetch transitions (join via clip IDs)
            const clipIds = clips.map((c) => c.id as string);

            if (clipIds.length > 0) {
                const { data: transitionData, error: transitionsError } = await client
                    .from('edit_transitions')
                    .select('*')
                    .in('from_clip_id', clipIds);

                if (transitionsError) {
                    throw new Error(`Failed to fetch transitions: ${transitionsError.message}`);
                }

                transitions = transitionData ?? [];
            }
        }

        // Fetch keyframes for all clips
        const clipIds = clips.map((c) => c.id as string);
        let keyframes: Array<Record<string, unknown>> = [];

        if (clipIds.length > 0) {
            const { data: keyframeData, error: keyframesError } = await client
                .from('edit_keyframes')
                .select('*')
                .in('clip_id', clipIds)
                .order('offset_ms');

            if (keyframesError) {
                throw new Error(`Failed to fetch keyframes: ${keyframesError.message}`);
            }

            keyframes = keyframeData ?? [];
        }

        // Fetch sync groups
        const { data: syncGroups, error: syncGroupsError } = await client
            .from('dialogue_sync_groups')
            .select('*')
            .eq('edit_project_id', data.editProjectId);

        if (syncGroupsError) {
            throw new Error(`Failed to fetch sync groups: ${syncGroupsError.message}`);
        }

        logger.info(
            {
                ...ctx,
                tracks: tracks?.length ?? 0,
                clips: clips.length,
                keyframes: keyframes.length,
                transitions: transitions.length,
                syncGroups: syncGroups?.length ?? 0,
            },
            'Edit project fetched',
        );

        return {
            success: true,
            project: {
                ...mapEditProjectRow(project),
                tracks: (tracks ?? []).map(mapEditTrackRow),
                clips: clips.map(mapEditClipRow),
                keyframes: keyframes.map(mapEditKeyframeRow),
                transitions: transitions.map(mapEditTransitionRow),
                syncGroups: (syncGroups ?? []).map(mapSyncGroupRow),
            },
        };
    },
    { schema: GetEditProjectSchema },
);

/**
 * Update edit project settings (FPS, dimensions, language).
 */
export const updateEditProjectAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.updateProject', editProjectId: data.editProjectId };

        logger.info(ctx, 'Updating edit project');

        const authClient = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(authClient);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const client = getEditSuiteClient();

        const updates: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
        };

        if (data.width !== undefined) updates.width = data.width;
        if (data.height !== undefined) updates.height = data.height;
        if (data.fps !== undefined) updates.fps = data.fps;
        if (data.activeLanguage !== undefined) updates.active_language = data.activeLanguage;

        const { data: project, error } = await client
            .from('edit_projects')
            .update(updates)
            .eq('id', data.editProjectId)
            .select()
            .single();

        if (error) {
            logger.error({ ...ctx, error }, 'Failed to update edit project');
            throw new Error(`Failed to update edit project: ${error.message}`);
        }

        if (!project) {
            throw new Error('Edit project not found');
        }

        logger.info(ctx, 'Edit project updated');
        revalidatePath('/home/[account]/studio/[projectId]/episodes/[episodeId]', 'page');

        return { success: true, project: mapEditProjectRow(project) };
    },
    { schema: UpdateEditProjectSchema },
);
