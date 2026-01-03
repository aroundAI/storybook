'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Pause, Play, Volume2, VolumeX } from 'lucide-react';

import type { CharacterAsset, DialogueLine } from '@kit/audio-generation/lib';
import { cn } from '@kit/ui/utils';

interface AudioTrack {
    id: string;
    type: 'dialogue' | 'music' | 'sfx';
    fileUrl: string;
    startTime: number; // Timeline position in seconds
    duration: number;
    name?: string;
    volume: number; // 0-1
}

interface AudioMixerProps {
    dialogueLines: DialogueLine[];
    characters: CharacterAsset[];
    musicTracks: Array<{
        id: string;
        fileUrl: string | null;
        timelineStartSeconds: number;
        durationSeconds: number | null;
        name: string | null;
    }>;
    sfxTracks?: Array<{
        id: string;
        fileUrl: string | null;
        timelineStartSeconds: number;
        durationSeconds: number | null;
        name: string | null;
    }>;
    currentTime: number;
    isPlaying: boolean;
    isMuted: boolean;
    onVolumeChange?: (trackType: 'dialogue' | 'music' | 'sfx', volume: number) => void;
}

// Default volumes
const DEFAULT_VOLUMES = {
    dialogue: 1.0,
    music: 0.4,
    sfx: 0.7,
};

/**
 * AudioMixer - Syncs and plays multiple audio tracks with video timeline
 * 
 * Features:
 * - Plays dialogue at correct timeline positions
 * - Plays music and SFX at their timeline positions
 * - Volume control per track type
 * - Syncs with video playback state
 */
export function AudioMixer({
    dialogueLines,
    musicTracks,
    sfxTracks = [],
    currentTime,
    isPlaying,
    isMuted,
    onVolumeChange,
}: AudioMixerProps) {
    // Track volumes
    const [dialogueVolume, setDialogueVolume] = useState(DEFAULT_VOLUMES.dialogue);
    const [musicVolume, setMusicVolume] = useState(DEFAULT_VOLUMES.music);
    const [sfxVolume, setSfxVolume] = useState(DEFAULT_VOLUMES.sfx);

    // Active audio elements
    const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
    const lastTimeRef = useRef<number>(0);

    // Convert dialogue lines to audio tracks
    const dialogueTracks: AudioTrack[] = dialogueLines
        .filter(line => line.audioUrl)
        .map(line => ({
            id: line.id,
            type: 'dialogue' as const,
            fileUrl: line.audioUrl!,
            startTime: line.timelineStartSeconds ?? 0,
            duration: line.generationMetadata?.durationSeconds ?? line.estimatedDurationSeconds ?? 2,
            name: line.text?.substring(0, 30),
            volume: dialogueVolume,
        }));

    // Convert music tracks
    const allMusicTracks: AudioTrack[] = musicTracks
        .filter(t => t.fileUrl)
        .map(t => ({
            id: t.id,
            type: 'music' as const,
            fileUrl: t.fileUrl!,
            startTime: t.timelineStartSeconds,
            duration: t.durationSeconds ?? 60,
            name: t.name ?? 'Music Track',
            volume: musicVolume,
        }));

    // Convert SFX tracks
    const allSfxTracks: AudioTrack[] = sfxTracks
        .filter(t => t.fileUrl)
        .map(t => ({
            id: t.id,
            type: 'sfx' as const,
            fileUrl: t.fileUrl!,
            startTime: t.timelineStartSeconds,
            duration: t.durationSeconds ?? 2,
            name: t.name ?? 'SFX',
            volume: sfxVolume,
        }));

    // All tracks combined
    const allTracks = [...dialogueTracks, ...allMusicTracks, ...allSfxTracks];

    // Get or create audio element for a track
    const getAudioElement = useCallback((track: AudioTrack): HTMLAudioElement => {
        let audio = audioElementsRef.current.get(track.id);
        if (!audio) {
            audio = new Audio(track.fileUrl);
            audio.preload = 'auto';
            audioElementsRef.current.set(track.id, audio);
        }
        return audio;
    }, []);

    // Cleanup audio elements on unmount
    useEffect(() => {
        return () => {
            audioElementsRef.current.forEach(audio => {
                audio.pause();
                audio.src = '';
            });
            audioElementsRef.current.clear();
        };
    }, []);

    // Sync audio playback with timeline
    useEffect(() => {
        const timeDelta = Math.abs(currentTime - lastTimeRef.current);
        const isSeek = timeDelta > 0.5; // Detect seek (jump > 0.5s)
        lastTimeRef.current = currentTime;

        allTracks.forEach(track => {
            const audio = getAudioElement(track);
            const trackEnd = track.startTime + track.duration;
            const isInRange = currentTime >= track.startTime && currentTime < trackEnd;

            // Update volume
            const effectiveVolume = isMuted ? 0 : track.volume;
            audio.volume = effectiveVolume;

            if (isInRange && isPlaying) {
                // Calculate where we should be in this track
                const trackPosition = currentTime - track.startTime;

                // If seek detected or audio is too far off, sync position
                if (isSeek || Math.abs(audio.currentTime - trackPosition) > 0.3) {
                    audio.currentTime = trackPosition;
                }

                // Start playing if not already
                if (audio.paused) {
                    audio.play().catch(() => {
                        // Ignore autoplay errors
                    });
                }
            } else {
                // Stop if outside range or not playing
                if (!audio.paused) {
                    audio.pause();
                }
            }
        });
    }, [currentTime, isPlaying, isMuted, allTracks, getAudioElement]);

    // Update volumes when they change
    useEffect(() => {
        allTracks.forEach(track => {
            const audio = audioElementsRef.current.get(track.id);
            if (audio) {
                const volume = isMuted ? 0 : (
                    track.type === 'dialogue' ? dialogueVolume :
                        track.type === 'music' ? musicVolume :
                            sfxVolume
                );
                audio.volume = volume;
            }
        });
    }, [dialogueVolume, musicVolume, sfxVolume, isMuted, allTracks]);

    const handleVolumeChange = useCallback((type: 'dialogue' | 'music' | 'sfx', value: number) => {
        if (type === 'dialogue') setDialogueVolume(value);
        if (type === 'music') setMusicVolume(value);
        if (type === 'sfx') setSfxVolume(value);
        onVolumeChange?.(type, value);
    }, [onVolumeChange]);

    return (
        <div className="flex flex-col gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Audio Mixer
            </h4>

            {/* Dialogue Volume */}
            <div className="flex items-center gap-3">
                <div className="w-16 text-xs font-medium text-gray-700 dark:text-gray-300">
                    Dialogue
                </div>
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={dialogueVolume}
                    onChange={(e) => handleVolumeChange('dialogue', parseFloat(e.target.value))}
                    className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full appearance-none cursor-pointer"
                />
                <span className="w-8 text-xs text-gray-500 text-right">
                    {Math.round(dialogueVolume * 100)}%
                </span>
            </div>

            {/* Music Volume */}
            <div className="flex items-center gap-3">
                <div className="w-16 text-xs font-medium text-gray-700 dark:text-gray-300">
                    Music
                </div>
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={musicVolume}
                    onChange={(e) => handleVolumeChange('music', parseFloat(e.target.value))}
                    className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full appearance-none cursor-pointer"
                />
                <span className="w-8 text-xs text-gray-500 text-right">
                    {Math.round(musicVolume * 100)}%
                </span>
            </div>

            {/* SFX Volume */}
            <div className="flex items-center gap-3">
                <div className="w-16 text-xs font-medium text-gray-700 dark:text-gray-300">
                    SFX
                </div>
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={sfxVolume}
                    onChange={(e) => handleVolumeChange('sfx', parseFloat(e.target.value))}
                    className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full appearance-none cursor-pointer"
                />
                <span className="w-8 text-xs text-gray-500 text-right">
                    {Math.round(sfxVolume * 100)}%
                </span>
            </div>

            {/* Track counts */}
            <div className="flex gap-4 pt-2 border-t border-gray-200 dark:border-gray-600 text-[10px] text-gray-400">
                <span>{dialogueTracks.length} dialogue</span>
                <span>{allMusicTracks.length} music</span>
                <span>{allSfxTracks.length} sfx</span>
            </div>
        </div>
    );
}
