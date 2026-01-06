/**
 * Episode Export Utilities
 * 
 * Converts shots with trim points, audio tracks, and transitions
 * into a Timeline object for FFmpeg rendering.
 */

import type { Shot } from './types';
import type { TransitionConfig, TransitionType } from './transitions';
import { toFFmpegTransition } from './transitions';

// ============================================================================
// Types
// ============================================================================

export interface AudioTrackExport {
    id: string;
    type: 'dialogue' | 'music' | 'sfx';
    fileUrl: string;
    timelineStartSeconds: number;
    durationSeconds: number;
    volume: number; // 0-1
}

export interface ShotExport {
    id: string;
    videoUrl: string;
    /** Start point in source video (seconds) */
    trimInPoint: number;
    /** End point in source video (seconds) */
    trimOutPoint: number;
    /** Effective duration after trim */
    duration: number;
    /** Timeline position (calculated) */
    timelineStart: number;
}

export interface TransitionExport {
    type: TransitionType;
    durationSeconds: number;
    fromShotId: string;
    toShotId: string;
    ffmpegType: string; // FFmpeg xfade transition name
}

export interface EpisodeExport {
    shots: ShotExport[];
    audioTracks: AudioTrackExport[];
    transitions: TransitionExport[];
    totalDuration: number;
}

// ============================================================================
// Conversion Functions
// ============================================================================

/**
 * Prepare shots for export with trim points applied
 * 
 * @param shots - Array of shots with optional trim points
 * @param transitions - Array of transitions between shots
 * @returns Export-ready shot data with timeline positions
 */
export function prepareShotsForExport(
    shots: Shot[],
    transitions: TransitionConfig[] = []
): { shots: ShotExport[]; totalDuration: number } {
    // Sort shots by sequence
    const sortedShots = [...shots].sort((a, b) =>
        (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0)
    );

    let timelinePosition = 0;
    const exportShots: ShotExport[] = [];

    for (let i = 0; i < sortedShots.length; i++) {
        const shot = sortedShots[i]!;

        // Get effective trim points
        const inPoint = shot.trimInPoint ?? 0;
        const outPoint = shot.trimOutPoint ?? shot.sourceDuration ?? shot.duration ?? 5;
        const effectiveDuration = outPoint - inPoint;

        // Check for transition overlap with previous shot
        const transitionToPrev = transitions.find(
            t => t.toShotId === shot.id
        );

        // Adjust timeline position for transitions (they overlap clips)
        if (i > 0 && transitionToPrev && transitionToPrev.durationSeconds > 0) {
            timelinePosition -= transitionToPrev.durationSeconds / 2;
        }

        exportShots.push({
            id: shot.id,
            videoUrl: shot.videoUrl!,
            trimInPoint: inPoint,
            trimOutPoint: outPoint,
            duration: effectiveDuration,
            timelineStart: timelinePosition,
        });

        timelinePosition += effectiveDuration;

        // Adjust for transition to next shot
        const transitionToNext = transitions.find(
            t => t.fromShotId === shot.id
        );
        if (transitionToNext && transitionToNext.durationSeconds > 0) {
            timelinePosition -= transitionToNext.durationSeconds / 2;
        }
    }

    return {
        shots: exportShots,
        totalDuration: timelinePosition,
    };
}

/**
 * Prepare transitions for FFmpeg export
 */
export function prepareTransitionsForExport(
    transitions: TransitionConfig[]
): TransitionExport[] {
    return transitions
        .filter(t => t.transitionType !== 'cut') // Cut = no transition effect
        .map(t => ({
            type: t.transitionType,
            durationSeconds: t.durationSeconds,
            fromShotId: t.fromShotId ?? '',
            toShotId: t.toShotId,
            ffmpegType: toFFmpegTransition(t.transitionType),
        }));
}

/**
 * Prepare audio tracks for export
 * 
 * Filters to completed tracks with valid URLs
 */
export function prepareAudioTracksForExport(
    dialogueLines: Array<{
        id: string;
        audioUrl: string | null;
        timelineStartSeconds: number | null;
        generationMetadata?: { durationSeconds?: number } | null;
        estimatedDurationSeconds?: number | null;
    }>,
    musicTracks: Array<{
        id: string;
        fileUrl: string | null;
        timelineStartSeconds: number;
        durationSeconds: number | null;
        status: string;
    }>,
    sfxTracks: Array<{
        id: string;
        fileUrl: string | null;
        timelineStartSeconds: number;
        durationSeconds: number | null;
        status: string;
    }>,
    volumes: { dialogue: number; music: number; sfx: number } = { dialogue: 1, music: 0.4, sfx: 0.7 }
): AudioTrackExport[] {
    const tracks: AudioTrackExport[] = [];

    // Add dialogue tracks
    for (const line of dialogueLines) {
        if (!line.audioUrl) continue;
        tracks.push({
            id: line.id,
            type: 'dialogue',
            fileUrl: line.audioUrl,
            timelineStartSeconds: line.timelineStartSeconds ?? 0,
            durationSeconds: line.generationMetadata?.durationSeconds
                ?? line.estimatedDurationSeconds
                ?? 2,
            volume: volumes.dialogue,
        });
    }

    // Add music tracks
    for (const track of musicTracks) {
        if (!track.fileUrl || track.status !== 'completed') continue;
        tracks.push({
            id: track.id,
            type: 'music',
            fileUrl: track.fileUrl,
            timelineStartSeconds: track.timelineStartSeconds,
            durationSeconds: track.durationSeconds ?? 60,
            volume: volumes.music,
        });
    }

    // Add SFX tracks
    for (const track of sfxTracks) {
        if (!track.fileUrl || track.status !== 'completed') continue;
        tracks.push({
            id: track.id,
            type: 'sfx',
            fileUrl: track.fileUrl,
            timelineStartSeconds: track.timelineStartSeconds,
            durationSeconds: track.durationSeconds ?? 2,
            volume: volumes.sfx,
        });
    }

    return tracks;
}

/**
 * Build complete episode export data
 */
export function buildEpisodeExport(
    shots: Shot[],
    transitions: TransitionConfig[],
    dialogueLines: Parameters<typeof prepareAudioTracksForExport>[0],
    musicTracks: Parameters<typeof prepareAudioTracksForExport>[1],
    sfxTracks: Parameters<typeof prepareAudioTracksForExport>[2],
    volumes?: { dialogue: number; music: number; sfx: number }
): EpisodeExport {
    const { shots: exportShots, totalDuration } = prepareShotsForExport(shots, transitions);
    const exportTransitions = prepareTransitionsForExport(transitions);
    const audioTracks = prepareAudioTracksForExport(dialogueLines, musicTracks, sfxTracks, volumes);

    return {
        shots: exportShots,
        audioTracks,
        transitions: exportTransitions,
        totalDuration,
    };
}

/**
 * Generate FFmpeg input options for a shot with trim points
 * 
 * @returns Array of FFmpeg options like ['-ss', '2.5', '-to', '7.5']
 */
export function getFFmpegTrimOptions(shot: ShotExport): string[] {
    const options: string[] = [];

    if (shot.trimInPoint > 0) {
        options.push('-ss', shot.trimInPoint.toFixed(3));
    }

    if (shot.trimOutPoint > 0 && shot.trimOutPoint !== shot.duration) {
        options.push('-to', shot.trimOutPoint.toFixed(3));
    }

    return options;
}

/**
 * Generate amix filter for combining audio tracks
 * 
 * @example
 * // Returns: "[1:a][2:a][3:a]amix=inputs=3:duration=longest[aout]"
 */
export function generateAmixFilter(
    audioTrackCount: number,
    startInputIndex: number = 1
): string {
    if (audioTrackCount === 0) return '';
    if (audioTrackCount === 1) return `[${startInputIndex}:a]acopy[aout]`;

    const inputs = Array.from(
        { length: audioTrackCount },
        (_, i) => `[${startInputIndex + i}:a]`
    ).join('');

    return `${inputs}amix=inputs=${audioTrackCount}:duration=longest[aout]`;
}
