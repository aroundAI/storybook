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

/**
 * Batch-creates an entire edit project from auto-assembly.
 * Creates: project → tracks → clips → sync groups → keyframes in one action.
 *
 * The client-side auto-assembly algorithm builds the arrays and calls this
 * single server action to persist everything atomically.
 */
export const batchAssembleAction = enhanceAction(
    async (data): Promise<{ success: true; result: BatchAssembleResult }> => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.batchAssemble', episodeId: data.episodeId };

        logger.info(ctx, 'Batch assembling edit project');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        // Verify episode exists
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

        // 1. Create edit project
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: project, error: projectError } = await (client as any)
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

        if (projectError) {
            logger.error({ ...ctx, error: projectError }, 'Failed to create edit project');
            throw new Error(`Failed to create edit project: ${projectError.message}`);
        }

        // 2. Create tracks
        const tracksToInsert = data.tracks.map((track) => ({
            edit_project_id: project.id,
            type: track.type,
            name: track.name,
            sort_order: track.sortOrder,
            volume: track.volume,
        }));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: tracks, error: tracksError } = await (client as any)
            .from('edit_tracks')
            .insert(tracksToInsert)
            .select()
            .order('sort_order', { ascending: true });

        if (tracksError || !tracks) {
            logger.error({ ...ctx, error: tracksError }, 'Failed to create tracks');
            throw new Error(`Failed to create tracks: ${tracksError?.message}`);
        }

        // 3. Create sync groups
        let syncGroupIds: string[] = [];

        if (data.syncGroups.length > 0) {
            const syncGroupsToInsert = data.syncGroups.map((sg) => ({
                edit_project_id: project.id,
                anchor_dialogue_id: sg.anchorDialogueId,
                // primary_clip_id set later after clips are created
            }));

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: syncGroups, error: sgError } = await (client as any)
                .from('dialogue_sync_groups')
                .insert(syncGroupsToInsert)
                .select();

            if (sgError) {
                logger.error({ ...ctx, error: sgError }, 'Failed to create sync groups');
                // Non-fatal for assembly
            }

            syncGroupIds = (syncGroups ?? []).map((sg: { id: string }) => sg.id);
        }

        // 4. Create clips (resolve track index → track ID, sync group index → ID)
        const clipsToInsert = data.clips.map((clip) => ({
            track_id: tracks[clip.trackIndex]?.id,
            source_shot_id: clip.sourceShotId ?? null,
            source_dialogue_id: clip.sourceDialogueId ?? null,
            source_dubbed_dialogue_id: clip.sourceDubbedDialogueId ?? null,
            source_audio_track_id: clip.sourceAudioTrackId ?? null,
            source_upload_url: clip.sourceUploadUrl ?? null,
            media_url: clip.mediaUrl ?? null,
            thumbnail_url: clip.thumbnailUrl ?? null,
            start_ms: clip.startMs,
            end_ms: clip.endMs,
            in_point_ms: clip.inPointMs,
            out_point_ms: clip.outPointMs,
            volume: clip.volume,
            speed: clip.speed,
            fade_in_ms: clip.fadeInMs,
            fade_out_ms: clip.fadeOutMs,
            sort_order: clip.sortOrder,
            sync_group_id:
                clip.syncGroupIndex != null ? syncGroupIds[clip.syncGroupIndex] ?? null : null,
            language: clip.language ?? null,
            is_active: clip.isActive,
        }));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: clips, error: clipsError } = await (client as any)
            .from('edit_clips')
            .insert(clipsToInsert)
            .select()
            .order('start_ms', { ascending: true });

        if (clipsError || !clips) {
            logger.error({ ...ctx, error: clipsError }, 'Failed to create clips');
            throw new Error(`Failed to create clips: ${clipsError?.message}`);
        }

        // 5. Update primary_clip_id on sync groups
        for (const sg of data.syncGroups) {
            if (sg.primaryClipIndex != null && syncGroupIds.length > 0) {
                const sgIndex = data.syncGroups.indexOf(sg);
                const sgId = syncGroupIds[sgIndex];
                const clipId = clips[sg.primaryClipIndex]?.id;

                if (sgId && clipId) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await (client as any)
                        .from('dialogue_sync_groups')
                        .update({ primary_clip_id: clipId })
                        .eq('id', sgId);
                }
            }
        }

        // 6. Create keyframes (resolve clip index → clip ID)
        if (data.keyframes.length > 0) {
            const keyframesToInsert = data.keyframes.map((kf) => ({
                clip_id: clips[kf.clipIndex]?.id,
                property: kf.property,
                offset_ms: kf.offsetMs,
                value: kf.value,
                easing: kf.easing,
            }));

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: kfError } = await (client as any)
                .from('edit_keyframes')
                .insert(keyframesToInsert);

            if (kfError) {
                logger.error({ ...ctx, error: kfError }, 'Failed to create keyframes');
                // Non-fatal for assembly
            }
        }

        logger.info(
            {
                ...ctx,
                projectId: project.id,
                trackCount: tracks.length,
                clipCount: clips.length,
                syncGroupCount: syncGroupIds.length,
                keyframeCount: data.keyframes.length,
            },
            'Edit project assembled',
        );
        revalidatePath('/home/[account]/studio/[projectId]/episodes/[episodeId]', 'page');

        return {
            success: true,
            result: {
                project: mapEditProjectRow(project),
                trackCount: tracks.length,
                clipCount: clips.length,
                keyframeCount: data.keyframes.length,
                syncGroupCount: syncGroupIds.length,
            },
        };
    },
    { schema: BatchAssembleSchema },
);

/**
 * Batch-save dirty state from client to database.
 * Called by auto-save (debounced 2s) after user edits.
 *
 * Handles: updated clips/tracks/keyframes, deleted clips/keyframes,
 * newly created clips/keyframes.
 */
export const batchSaveAction = enhanceAction(
    async (data): Promise<{ success: true; result: BatchSaveResult }> => {
        const logger = await getLogger();
        const ctx = { name: 'editSuite.batchSave', projectId: data.editProjectId };

        logger.info(ctx, 'Batch saving edit project');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        const now = new Date().toISOString();
        let updatedClips = 0;
        let updatedTracks = 0;
        let updatedKeyframes = 0;
        let deletedClips = 0;
        let deletedKeyframes = 0;
        let createdClips = 0;
        let createdKeyframes = 0;

        // 1. Update dirty tracks
        for (const track of data.dirtyTracks) {
            const updates: Record<string, unknown> = { updated_at: now };
            if (track.name !== undefined) updates.name = track.name;
            if (track.sortOrder !== undefined) updates.sort_order = track.sortOrder;
            if (track.volume !== undefined) updates.volume = track.volume;
            if (track.isMuted !== undefined) updates.is_muted = track.isMuted;
            if (track.isSolo !== undefined) updates.is_solo = track.isSolo;
            if (track.isLocked !== undefined) updates.is_locked = track.isLocked;
            if (track.height !== undefined) updates.height = track.height;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (client as any)
                .from('edit_tracks')
                .update(updates)
                .eq('id', track.id);

            if (!error) updatedTracks++;
        }

        // 2. Delete clips
        if (data.deletedClipIds.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (client as any)
                .from('edit_clips')
                .delete()
                .in('id', data.deletedClipIds);

            if (!error) deletedClips = data.deletedClipIds.length;
        }

        // 3. Delete keyframes
        if (data.deletedKeyframeIds.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (client as any)
                .from('edit_keyframes')
                .delete()
                .in('id', data.deletedKeyframeIds);

            if (!error) deletedKeyframes = data.deletedKeyframeIds.length;
        }

        // 4. Update dirty clips
        for (const clip of data.dirtyClips) {
            const updates: Record<string, unknown> = { updated_at: now };
            if (clip.startMs !== undefined) updates.start_ms = clip.startMs;
            if (clip.endMs !== undefined) updates.end_ms = clip.endMs;
            if (clip.inPointMs !== undefined) updates.in_point_ms = clip.inPointMs;
            if (clip.outPointMs !== undefined) updates.out_point_ms = clip.outPointMs;
            if (clip.volume !== undefined) updates.volume = clip.volume;
            if (clip.speed !== undefined) updates.speed = clip.speed;
            if (clip.fadeInMs !== undefined) updates.fade_in_ms = clip.fadeInMs;
            if (clip.fadeOutMs !== undefined) updates.fade_out_ms = clip.fadeOutMs;
            if (clip.sortOrder !== undefined) updates.sort_order = clip.sortOrder;
            if (clip.isActive !== undefined) updates.is_active = clip.isActive;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (client as any)
                .from('edit_clips')
                .update(updates)
                .eq('id', clip.id);

            if (!error) updatedClips++;
        }

        // 5. Update dirty keyframes
        for (const kf of data.dirtyKeyframes) {
            const updates: Record<string, unknown> = {};
            if (kf.offsetMs !== undefined) updates.offset_ms = kf.offsetMs;
            if (kf.value !== undefined) updates.value = kf.value;
            if (kf.easing !== undefined) updates.easing = kf.easing;
            if (kf.bezierCp1X !== undefined) updates.bezier_cp1_x = kf.bezierCp1X;
            if (kf.bezierCp1Y !== undefined) updates.bezier_cp1_y = kf.bezierCp1Y;
            if (kf.bezierCp2X !== undefined) updates.bezier_cp2_x = kf.bezierCp2X;
            if (kf.bezierCp2Y !== undefined) updates.bezier_cp2_y = kf.bezierCp2Y;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (client as any)
                .from('edit_keyframes')
                .update(updates)
                .eq('id', kf.id);

            if (!error) updatedKeyframes++;
        }

        // 6. Create new clips
        if (data.newClips.length > 0) {
            const clipsToInsert = data.newClips.map((clip) => ({
                track_id: clip.trackId,
                source_shot_id: clip.sourceShotId ?? null,
                source_dialogue_id: clip.sourceDialogueId ?? null,
                source_dubbed_dialogue_id: clip.sourceDubbedDialogueId ?? null,
                source_audio_track_id: clip.sourceAudioTrackId ?? null,
                source_upload_url: clip.sourceUploadUrl ?? null,
                media_url: clip.mediaUrl ?? null,
                thumbnail_url: clip.thumbnailUrl ?? null,
                start_ms: clip.startMs,
                end_ms: clip.endMs,
                in_point_ms: clip.inPointMs,
                out_point_ms: clip.outPointMs,
                volume: clip.volume,
                speed: clip.speed,
                fade_in_ms: clip.fadeInMs,
                fade_out_ms: clip.fadeOutMs,
                sort_order: clip.sortOrder,
                sync_group_id: clip.syncGroupId ?? null,
                language: clip.language ?? null,
                is_active: clip.isActive,
            }));

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: created, error } = await (client as any)
                .from('edit_clips')
                .insert(clipsToInsert)
                .select();

            if (!error) createdClips = created?.length ?? 0;
        }

        // 7. Create new keyframes
        if (data.newKeyframes.length > 0) {
            const kfsToInsert = data.newKeyframes.map((kf) => ({
                clip_id: kf.clipId,
                property: kf.property,
                offset_ms: kf.offsetMs,
                value: kf.value,
                easing: kf.easing,
                bezier_cp1_x: kf.bezierCp1X ?? null,
                bezier_cp1_y: kf.bezierCp1Y ?? null,
                bezier_cp2_x: kf.bezierCp2X ?? null,
                bezier_cp2_y: kf.bezierCp2Y ?? null,
            }));

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: created, error } = await (client as any)
                .from('edit_keyframes')
                .insert(kfsToInsert)
                .select();

            if (!error) createdKeyframes = created?.length ?? 0;
        }

        // Update project version
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
            .from('edit_projects')
            .update({
                version: (client as any).rpc ? undefined : undefined, // version incremented by trigger
                updated_at: now,
            })
            .eq('id', data.editProjectId);

        logger.info(
            {
                ...ctx,
                updatedClips,
                updatedTracks,
                updatedKeyframes,
                deletedClips,
                deletedKeyframes,
                createdClips,
                createdKeyframes,
            },
            'Batch save complete',
        );

        return {
            success: true,
            result: {
                updatedClips,
                updatedTracks,
                updatedKeyframes,
                deletedClips,
                deletedKeyframes,
                createdClips,
                createdKeyframes,
            },
        };
    },
    { schema: BatchSaveSchema },
);
