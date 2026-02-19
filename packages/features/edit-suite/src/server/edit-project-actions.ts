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
    mapDialogueSyncGroupRow,
} from '../lib/types';
import type { EditProject, EditProjectFull } from '../lib/types';

/**
 * Create a new edit project for an episode.
 * Also creates default tracks (video, dialogue, music, sfx, ambient).
 */
export const createEditProjectAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.createProject', episodeId: data.episodeId };

        logger.info(ctx, 'Creating edit project');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        // Check episode exists and user has access (RLS will enforce this)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: episode, error: episodeError } = await (client as any)
            .from('episodes')
            .select('id')
            .eq('id', data.episodeId)
            .is('deleted_at', null)
            .single();

        if (episodeError || !episode) {
            throw new Error('Episode not found');
        }

        // Create edit project
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: project, error } = await (client as any)
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

        if (error) {
            logger.error({ ...ctx, error }, 'Failed to create edit project');
            throw new Error(`Failed to create edit project: ${error.message}`);
        }

        // Create default tracks
        const defaultTracks = [
            { type: 'video', name: 'Video', sort_order: 0, edit_project_id: project.id },
            { type: 'dialogue', name: 'Dialogue (EN)', sort_order: 1, edit_project_id: project.id },
            { type: 'music', name: 'Music', sort_order: 2, edit_project_id: project.id },
            { type: 'sfx', name: 'SFX', sort_order: 3, edit_project_id: project.id },
            { type: 'ambient', name: 'Ambient', sort_order: 4, edit_project_id: project.id },
        ];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: tracksError } = await (client as any)
            .from('edit_tracks')
            .insert(defaultTracks);

        if (tracksError) {
            logger.error({ ...ctx, error: tracksError }, 'Failed to create default tracks');
            // Non-fatal — project was created, tracks can be added later
        }

        logger.info({ ...ctx, projectId: project.id }, 'Edit project created');
        revalidatePath('/home/[account]/studio/[projectId]/episodes/[episodeId]', 'page');

        return { success: true, project: mapEditProjectRow(project) };
    },
    { schema: CreateEditProjectSchema },
);

/**
 * Get an edit project by episode ID with all related data.
 * Returns project + tracks + clips + transitions + keyframes + sync groups.
 */
export const getEditProjectAction = enhanceAction(
    async (data): Promise<{ success: true; data: EditProjectFull | null }> => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.getProject', episodeId: data.episodeId };

        logger.info(ctx, 'Fetching edit project');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        // Fetch project
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: project, error: projectError } = await (client as any)
            .from('edit_projects')
            .select('*')
            .eq('episode_id', data.episodeId)
            .single();

        if (projectError || !project) {
            // No project for this episode yet — return null (triggers auto-assembly)
            return { success: true, data: null };
        }

        // Fetch all related data in parallel
        const [tracksResult, clipsResult, syncGroupsResult] = await Promise.all([
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (client as any)
                .from('edit_tracks')
                .select('*')
                .eq('edit_project_id', project.id)
                .order('sort_order', { ascending: true }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (client as any)
                .from('edit_clips')
                .select('*')
                .in(
                    'track_id',
                    // We need track IDs — get them from a subquery
                    // First fetch tracks, then use their IDs
                    [],
                ),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (client as any)
                .from('dialogue_sync_groups')
                .select('*')
                .eq('edit_project_id', project.id),
        ]);

        const tracks = (tracksResult.data ?? []) as Record<string, unknown>[];
        const trackIds = tracks.map((t) => t.id as string);

        // Now fetch clips for the actual track IDs
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: clips } = await (client as any)
            .from('edit_clips')
            .select('*')
            .in('track_id', trackIds.length > 0 ? trackIds : ['__none__'])
            .order('start_ms', { ascending: true });

        const clipRows = (clips ?? []) as Record<string, unknown>[];
        const clipIds = clipRows.map((c) => c.id as string);

        // Fetch keyframes + transitions for all clips
        const [keyframesResult, transitionsResult] = await Promise.all([
            clipIds.length > 0
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ? (client as any)
                    .from('edit_keyframes')
                    .select('*')
                    .in('clip_id', clipIds)
                    .order('offset_ms', { ascending: true })
                : { data: [] },
            clipIds.length > 0
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ? (client as any)
                    .from('edit_transitions')
                    .select('*')
                    .or(`from_clip_id.in.(${clipIds.join(',')}),to_clip_id.in.(${clipIds.join(',')})`)
                : { data: [] },
        ]);

        logger.info(
            {
                ...ctx,
                trackCount: tracks.length,
                clipCount: clipRows.length,
                keyframeCount: (keyframesResult.data ?? []).length,
            },
            'Edit project fetched',
        );

        return {
            success: true,
            data: {
                project: mapEditProjectRow(project),
                tracks: tracks.map(mapEditTrackRow),
                clips: clipRows.map(mapEditClipRow),
                transitions: ((transitionsResult.data ?? []) as Record<string, unknown>[]).map(
                    mapEditTransitionRow,
                ),
                keyframes: ((keyframesResult.data ?? []) as Record<string, unknown>[]).map(
                    mapEditKeyframeRow,
                ),
                syncGroups: ((syncGroupsResult.data ?? []) as Record<string, unknown>[]).map(
                    mapDialogueSyncGroupRow,
                ),
            },
        };
    },
    { schema: GetEditProjectSchema },
);

/**
 * Update edit project settings (fps, dimensions, language, render status).
 */
export const updateEditProjectAction = enhanceAction(
    async (data) => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.updateProject', projectId: data.editProjectId };

        logger.info(ctx, 'Updating edit project');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const updates: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
        };

        if (data.width !== undefined) updates.width = data.width;
        if (data.height !== undefined) updates.height = data.height;
        if (data.fps !== undefined) updates.fps = data.fps;
        if (data.activeLanguage !== undefined) updates.active_language = data.activeLanguage;
        if (data.renderStatus !== undefined) updates.render_status = data.renderStatus;
        if (data.renderUrl !== undefined) updates.render_url = data.renderUrl;
        if (data.renderError !== undefined) updates.render_error = data.renderError;

        if (data.renderStatus === 'rendering') {
            updates.render_started_at = new Date().toISOString();
        }
        if (data.renderStatus === 'completed' || data.renderStatus === 'failed') {
            updates.render_completed_at = new Date().toISOString();
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: project, error } = await (client as any)
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

        return { success: true, project: mapEditProjectRow(project) as EditProject };
    },
    { schema: UpdateEditProjectSchema },
);
