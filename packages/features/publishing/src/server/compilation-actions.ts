'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { calculateChaptersFromSegments } from '../lib/chapter-generator';
import { CompilationTypeEnum } from '../lib/compilation-types';

const logger = getLogger();

export const createCompilationAction = enhanceAction(
  async ({ projectId, accountId, title, description, compilationType, seasonId }) => {
    logger.info({ projectId, compilationType }, 'Creating compilation');
    const client = getSupabaseServerClient();
    
    const { data, error } = await client
      .from('compilations')
      .insert({
        project_id: projectId,
        account_id: accountId,
        title,
        description,
        compilation_type: compilationType,
        season_id: seasonId,
        status: 'draft',
        chapters: [],
        metadata: {},
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create compilation: ${error.message}`);
    }

    return data;
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
      accountId: z.string().uuid(),
      title: z.string().min(1),
      description: z.string().nullable().optional(),
      compilationType: CompilationTypeEnum,
      seasonId: z.string().uuid().nullable().optional(),
    }),
  }
);

export const getCompilationsAction = enhanceAction(
  async ({ projectId, status }) => {
    const client = getSupabaseServerClient();
    
    let query = client.from('compilations').select('*').eq('project_id', projectId);
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to get compilations: ${error.message}`);
    }

    return data;
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
      status: z.enum(['draft', 'assembling', 'rendering', 'rendered', 'published', 'archived']).optional(),
    }),
  }
);

export const getCompilationAction = enhanceAction(
  async ({ compilationId }) => {
    const client = getSupabaseServerClient();
    
    const { data: compilation, error: compilationError } = await client
      .from('compilations')
      .select('*')
      .eq('id', compilationId)
      .single();

    if (compilationError || !compilation) {
      throw new Error(`Failed to get compilation: ${compilationError?.message}`);
    }

    const { data: segments, error: segmentsError } = await client
      .from('compilation_segments')
      .select('*')
      .eq('compilation_id', compilationId)
      .order('sequence_number', { ascending: true });

    if (segmentsError) {
      throw new Error(`Failed to get compilation segments: ${segmentsError.message}`);
    }

    return {
      compilation,
      segments: segments || [],
    };
  },
  {
    schema: z.object({
      compilationId: z.string().uuid(),
    }),
  }
);

export const updateCompilationAction = enhanceAction(
  async ({ compilationId, title, description, compilationType, status, metadata }) => {
    const client = getSupabaseServerClient();
    
    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (compilationType !== undefined) updateData.compilation_type = compilationType;
    if (status !== undefined) updateData.status = status;
    if (metadata !== undefined) updateData.metadata = metadata;

    const { data, error } = await client
      .from('compilations')
      .update(updateData)
      .eq('id', compilationId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update compilation: ${error.message}`);
    }

    return data;
  },
  {
    schema: z.object({
      compilationId: z.string().uuid(),
      title: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      compilationType: CompilationTypeEnum.optional(),
      status: z.enum(['draft', 'assembling', 'rendering', 'rendered', 'published', 'archived']).optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
  }
);

export const deleteCompilationAction = enhanceAction(
  async ({ compilationId }) => {
    const client = getSupabaseServerClient();
    
    const { error } = await client.from('compilations').delete().eq('id', compilationId);

    if (error) {
      throw new Error(`Failed to delete compilation: ${error.message}`);
    }

    return { success: true };
  },
  {
    schema: z.object({
      compilationId: z.string().uuid(),
    }),
  }
);

export const addSegmentAction = enhanceAction(
  async ({
    compilationId,
    sourceEpisodeId,
    sourceShotId,
    sequenceNumber,
    startSeconds,
    endSeconds,
    transitionType,
    isChapterStart,
    chapterTitle,
  }) => {
    const client = getSupabaseServerClient();
    
    let mediaUrl = null;
    let thumbnailUrl = null;
    let durationSeconds = endSeconds ? endSeconds - startSeconds : null;

    if (sourceShotId) {
      const { data: shot } = await client.from('shots').select('render_url, duration, thumbnail_url').eq('id', sourceShotId).single();
      if (shot) {
        mediaUrl = shot.render_url;
        thumbnailUrl = shot.thumbnail_url;
        if (durationSeconds === null && shot.duration) {
          durationSeconds = shot.duration;
        }
      }
    } else if (sourceEpisodeId) {
      const { data: episode } = await client.from('episodes').select('localized_videos').eq('id', sourceEpisodeId).single();
      if (episode && episode.localized_videos && Array.isArray(episode.localized_videos) && episode.localized_videos.length > 0) {
        mediaUrl = (episode.localized_videos[0] as Record<string, string>).url || null;
      }
    }

    const { data, error } = await client
      .from('compilation_segments')
      .insert({
        compilation_id: compilationId,
        source_episode_id: sourceEpisodeId,
        source_shot_id: sourceShotId,
        sequence_number: sequenceNumber,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
        duration_seconds: durationSeconds,
        media_url: mediaUrl,
        thumbnail_url: thumbnailUrl,
        transition_type: transitionType,
        transition_duration_ms: transitionType === 'cut' ? 0 : 1000,
        is_chapter_start: isChapterStart,
        chapter_title: chapterTitle,
        metadata: {},
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add segment: ${error.message}`);
    }

    return data;
  },
  {
    schema: z.object({
      compilationId: z.string().uuid(),
      sourceEpisodeId: z.string().uuid(),
      sourceShotId: z.string().uuid().nullable().optional(),
      sequenceNumber: z.number().int().min(0),
      startSeconds: z.number().min(0),
      endSeconds: z.number().nullable().optional(),
      transitionType: z.enum(['cut', 'crossfade', 'fade_black', 'fade_white', 'dissolve']).default('cut'),
      isChapterStart: z.boolean().default(false),
      chapterTitle: z.string().nullable().optional(),
    }),
  }
);

export const reorderSegmentsAction = enhanceAction(
  async ({ compilationId, segmentIds }) => {
    const client = getSupabaseServerClient();
    
    const promises = segmentIds.map((id, index) => 
      client.from('compilation_segments').update({ sequence_number: index }).eq('id', id).eq('compilation_id', compilationId)
    );
    
    await Promise.all(promises);
    return { success: true };
  },
  {
    schema: z.object({
      compilationId: z.string().uuid(),
      segmentIds: z.array(z.string().uuid()),
    }),
  }
);

export const removeSegmentAction = enhanceAction(
  async ({ segmentId, compilationId }) => {
    const client = getSupabaseServerClient();
    
    const { error } = await client.from('compilation_segments').delete().eq('id', segmentId);

    if (error) {
      throw new Error(`Failed to remove segment: ${error.message}`);
    }

    const { data: remainingSegments } = await client
      .from('compilation_segments')
      .select('id')
      .eq('compilation_id', compilationId)
      .order('sequence_number', { ascending: true });

    if (remainingSegments && remainingSegments.length > 0) {
      const promises = remainingSegments.map((seg, index) => 
        client.from('compilation_segments').update({ sequence_number: index }).eq('id', seg.id)
      );
      await Promise.all(promises);
    }

    return { success: true };
  },
  {
    schema: z.object({
      segmentId: z.string().uuid(),
      compilationId: z.string().uuid(),
    }),
  }
);

export const updateSegmentAction = enhanceAction(
  async ({ segmentId, startSeconds, endSeconds, transitionType, isChapterStart, chapterTitle }) => {
    const client = getSupabaseServerClient();
    
    const updateData: Record<string, unknown> = {};
    if (startSeconds !== undefined) updateData.start_seconds = startSeconds;
    if (endSeconds !== undefined) {
      updateData.end_seconds = endSeconds;
      if (startSeconds !== undefined && endSeconds !== null) {
        updateData.duration_seconds = endSeconds - startSeconds;
      }
    }
    if (transitionType !== undefined) {
      updateData.transition_type = transitionType;
      updateData.transition_duration_ms = transitionType === 'cut' ? 0 : 1000;
    }
    if (isChapterStart !== undefined) updateData.is_chapter_start = isChapterStart;
    if (chapterTitle !== undefined) updateData.chapter_title = chapterTitle;

    const { data, error } = await client
      .from('compilation_segments')
      .update(updateData)
      .eq('id', segmentId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update segment: ${error.message}`);
    }

    return data;
  },
  {
    schema: z.object({
      segmentId: z.string().uuid(),
      startSeconds: z.number().min(0).optional(),
      endSeconds: z.number().nullable().optional(),
      transitionType: z.enum(['cut', 'crossfade', 'fade_black', 'fade_white', 'dissolve']).optional(),
      isChapterStart: z.boolean().optional(),
      chapterTitle: z.string().nullable().optional(),
    }),
  }
);

export const assembleCompilationAction = enhanceAction(
  async ({ compilationId, accountId, projectId }) => {
    logger.info({ compilationId }, 'Assembling compilation');
    const client = getSupabaseServerClient();
    
    const { data: compilation, error: compilationError } = await client
      .from('compilations')
      .select('*')
      .eq('id', compilationId)
      .single();
      
    if (compilationError || !compilation) throw new Error('Compilation not found');
    
    const { data: segments, error: segmentsError } = await client
      .from('compilation_segments')
      .select('*')
      .eq('compilation_id', compilationId)
      .order('sequence_number', { ascending: true });
      
    if (segmentsError) throw new Error('Failed to load segments');
    if (!segments || segments.length === 0) throw new Error('No segments to assemble');

    const { data: editProject, error: epError } = await client
      .from('edit_projects')
      .insert({
        project_id: projectId,
        account_id: accountId,
        compilation_id: compilationId,
        title: compilation.title || 'Compilation Edit',
        status: 'draft',
      })
      .select()
      .single();
      
    if (epError) throw new Error(`Failed to create edit project: ${epError.message}`);
    const editProjectId = editProject.id;

    const { data: track, error: trackError } = await client
      .from('edit_tracks')
      .insert({
        edit_project_id: editProjectId,
        type: 'video',
        index: 0,
        name: 'Main Video',
      })
      .select()
      .single();
      
    if (trackError) throw new Error(`Failed to create edit track: ${trackError.message}`);
    const trackId = track.id;

    let currentStartMs = 0;
    const clipsToInsert = [];
    const transitionsToInsert = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const durationMs = (segment.duration_seconds || (segment.end_seconds ? segment.end_seconds - segment.start_seconds : 10)) * 1000;
      const endMs = currentStartMs + durationMs;
      
      clipsToInsert.push({
        track_id: trackId,
        source_shot_id: segment.source_shot_id,
        media_url: segment.media_url,
        start_ms: currentStartMs,
        end_ms: endMs,
        in_point_ms: segment.start_seconds * 1000,
        out_point_ms: segment.end_seconds ? segment.end_seconds * 1000 : null,
      });
      
      if (i < segments.length - 1 && segment.transition_type !== 'cut') {
        transitionsToInsert.push({
          track_id: trackId,
          type: segment.transition_type,
          duration_ms: segment.transition_duration_ms || 1000,
          start_ms: endMs - (segment.transition_duration_ms || 1000) / 2,
        });
      }
      
      currentStartMs = endMs;
    }
    
    if (clipsToInsert.length > 0) {
      const { error: clipsError } = await client.from('edit_clips').insert(clipsToInsert);
      if (clipsError) throw new Error(`Failed to insert clips: ${clipsError.message}`);
    }
    
    if (transitionsToInsert.length > 0) {
      const { error: transitionsError } = await client.from('edit_transitions').insert(transitionsToInsert);
      if (transitionsError) throw new Error(`Failed to insert transitions: ${transitionsError.message}`);
    }

    const chapters = calculateChaptersFromSegments(
      segments.map((s) => ({
        id: s.id,
        compilationId: s.compilation_id,
        sourceEpisodeId: s.source_episode_id,
        sourceShotId: s.source_shot_id,
        title: s.title,
        sequenceNumber: s.sequence_number,
        startSeconds: s.start_seconds,
        endSeconds: s.end_seconds,
        durationSeconds: s.duration_seconds,
        mediaUrl: s.media_url,
        thumbnailUrl: s.thumbnail_url,
        transitionType: s.transition_type as 'cut' | 'crossfade' | 'fade_black' | 'fade_white' | 'dissolve',
        transitionDurationMs: s.transition_duration_ms,
        isChapterStart: s.is_chapter_start,
        chapterTitle: s.chapter_title,
        metadata: s.metadata as Record<string, unknown>,
      }))
    );

    const { error: updateError } = await client
      .from('compilations')
      .update({
        status: 'assembling',
        edit_project_id: editProjectId,
        chapters: JSON.parse(JSON.stringify(chapters)),
      })
      .eq('id', compilationId);
      
    if (updateError) throw new Error(`Failed to update compilation status: ${updateError.message}`);

    return { editProjectId };
  },
  {
    schema: z.object({
      compilationId: z.string().uuid(),
      accountId: z.string().uuid(),
      projectId: z.string().uuid(),
    }),
  }
);

export const generateChaptersAction = enhanceAction(
  async ({ compilationId }) => {
    const client = getSupabaseServerClient();
    
    const { data: segments, error: segmentsError } = await client
      .from('compilation_segments')
      .select('*')
      .eq('compilation_id', compilationId)
      .order('sequence_number', { ascending: true });

    if (segmentsError || !segments) {
      throw new Error(`Failed to load segments: ${segmentsError?.message}`);
    }

    const chapters = calculateChaptersFromSegments(
      segments.map((s) => ({
        id: s.id,
        compilationId: s.compilation_id,
        sourceEpisodeId: s.source_episode_id,
        sourceShotId: s.source_shot_id,
        title: s.title,
        sequenceNumber: s.sequence_number,
        startSeconds: s.start_seconds,
        endSeconds: s.end_seconds,
        durationSeconds: s.duration_seconds,
        mediaUrl: s.media_url,
        thumbnailUrl: s.thumbnail_url,
        transitionType: s.transition_type as 'cut' | 'crossfade' | 'fade_black' | 'fade_white' | 'dissolve',
        transitionDurationMs: s.transition_duration_ms,
        isChapterStart: s.is_chapter_start,
        chapterTitle: s.chapter_title,
        metadata: s.metadata as Record<string, unknown>,
      }))
    );

    const { error: updateError } = await client
      .from('compilations')
      .update({
        chapters: JSON.parse(JSON.stringify(chapters)),
      })
      .eq('id', compilationId);

    if (updateError) {
      throw new Error(`Failed to save chapters: ${updateError.message}`);
    }

    return chapters;
  },
  {
    schema: z.object({
      compilationId: z.string().uuid(),
    }),
  }
);

export const getEpisodeShotsForCompilationAction = enhanceAction(
  async ({ projectId, seasonId, episodeId }) => {
    const client = getSupabaseServerClient();
    
    let episodesQuery = client.from('episodes').select('id, title, sequence_number').eq('project_id', projectId);
    
    if (seasonId) episodesQuery = episodesQuery.eq('season_id', seasonId);
    if (episodeId) episodesQuery = episodesQuery.eq('id', episodeId);
    
    const { data: episodes, error: episodesError } = await episodesQuery.order('sequence_number', { ascending: true });

    if (episodesError) {
      throw new Error(`Failed to fetch episodes: ${episodesError.message}`);
    }

    if (!episodes || episodes.length === 0) return [];

    const episodeIds = episodes.map((e) => e.id);
    
    const { data: shots, error: shotsError } = await client
      .from('shots')
      .select('id, episode_id, render_url, duration, thumbnail_url, sequence_number, prompt')
      .in('episode_id', episodeIds)
      .order('sequence_number', { ascending: true });

    if (shotsError) {
      throw new Error(`Failed to fetch shots: ${shotsError.message}`);
    }

    return episodes.map((ep) => ({
      ...ep,
      shots: (shots || []).filter((s) => s.episode_id === ep.id),
    }));
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
      seasonId: z.string().uuid().nullable().optional(),
      episodeId: z.string().uuid().nullable().optional(),
    }),
  }
);
