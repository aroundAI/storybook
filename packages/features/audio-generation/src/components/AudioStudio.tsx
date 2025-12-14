'use client';

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Download, Settings, Volume2 } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { cn } from '@kit/ui/utils';

import { AudioPlayer } from './AudioPlayer';
import { DialogueList } from './DialogueList';
import { MusicTrackList } from './MusicTrackList';
import { VoiceAssignmentPanel } from './VoiceAssignment';
import { getAudioTracksAction } from '../server/audio-track-queries';
import { getDialogueLinesAction } from '../server/dialogue-queries';
import type { CharacterAsset } from '../lib/types/dialogue.types';

/**
 * Props for AudioStudio component
 */
export interface AudioStudioProps {
    /** Episode ID to manage audio for */
    episodeId: string;
    /** Project ID (for fetching characters) */
    projectId: string;
    /** Episode title to display */
    episodeTitle?: string;
    /** Characters for the episode (voice assignment) */
    characters?: CharacterAsset[];
    /** Additional CSS classes */
    className?: string;
}

type ActiveTab = 'dialogue' | 'music' | 'settings';

/**
 * AudioStudio - Central workspace for managing episode audio
 *
 * The Audio Studio provides a comprehensive interface for:
 * - Managing dialogue voice generation (Dialogue tab)
 * - Managing background music tracks (Music tab)
 * - Configuring audio settings (Settings tab)
 * - Assigning voices to characters (sidebar)
 * - Playing/previewing audio (footer player)
 *
 * It serves as the hub for all Phase 5 audio features, orchestrating
 * the DialogueList, MusicTrackList, VoiceAssignmentPanel, and AudioPlayer
 * components.
 *
 * @example
 * ```tsx
 * <AudioStudio
 *   episodeId="uuid-here"
 *   projectId="project-uuid"
 *   episodeTitle="Episode 1: The Beginning"
 *   characters={charactersList}
 * />
 * ```
 */
export function AudioStudio({
    episodeId,
    projectId,
    episodeTitle = 'Untitled Episode',
    characters = [],
    className,
}: AudioStudioProps) {
    // Tab state
    const [activeTab, setActiveTab] = useState<ActiveTab>('dialogue');

    // Audio player state
    const [selectedAudioUrl, setSelectedAudioUrl] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playingLineId, setPlayingLineId] = useState<string | null>(null);
    const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);

    // Fetch dialogue lines
    const {
        data: dialogueData,
        isLoading: dialogueLoading,
        error: dialogueError,
    } = useQuery({
        queryKey: ['dialogue-lines', episodeId],
        queryFn: () => getDialogueLinesAction({ episodeId }),
        refetchInterval: 5000, // Poll every 5 seconds for status updates
    });

    // Fetch music tracks
    const {
        data: musicData,
        isLoading: musicLoading,
        error: musicError,
    } = useQuery({
        queryKey: ['music-tracks', episodeId],
        queryFn: () => getAudioTracksAction({ episodeId, type: 'music' }),
        refetchInterval: 10000, // Poll every 10 seconds for music generation
    });

    // Audio player controls
    const handleDialoguePlay = useCallback((audioUrl: string, lineId: string) => {
        setSelectedAudioUrl(audioUrl);
        setPlayingLineId(lineId);
        setPlayingTrackId(null);
        setIsPlaying(true);
    }, []);

    const handleMusicPlay = useCallback((audioUrl: string, trackId: string) => {
        setSelectedAudioUrl(audioUrl);
        setPlayingTrackId(trackId);
        setPlayingLineId(null);
        setIsPlaying(true);
    }, []);

    const handlePause = useCallback(() => {
        setIsPlaying(false);
    }, []);

    const handlePlayerPlay = useCallback(() => {
        setIsPlaying(true);
    }, []);

    const handlePlayerPause = useCallback(() => {
        setIsPlaying(false);
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input
            const target = e.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            ) {
                return;
            }

            // Space: Play/Pause
            if (e.code === 'Space' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                if (selectedAudioUrl) {
                    setIsPlaying((prev) => !prev);
                }
            }

            // Alt+1: Dialogue tab
            if (e.altKey && e.code === 'Digit1') {
                e.preventDefault();
                setActiveTab('dialogue');
            }

            // Alt+2: Music tab
            if (e.altKey && e.code === 'Digit2') {
                e.preventDefault();
                setActiveTab('music');
            }

            // Alt+3: Settings tab
            if (e.altKey && e.code === 'Digit3') {
                e.preventDefault();
                setActiveTab('settings');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedAudioUrl]);

    // Calculate pending counts for tab badges
    const dialoguePending = dialogueData?.summary?.pending ?? 0;
    const dialogueGenerating = dialogueData?.summary?.generating ?? 0;
    const musicProcessing = musicData?.summary?.processing ?? 0;

    return (
        <div className={cn('flex h-full flex-col', className)}>
            {/* Header */}
            <header className="border-b bg-white px-6 py-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">Audio Studio</h1>
                        <p className="text-muted-foreground text-sm">{episodeTitle}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm">
                            <Settings className="mr-2 h-4 w-4" />
                            Settings
                        </Button>
                        <Button size="sm">
                            <Download className="mr-2 h-4 w-4" />
                            Export Audio
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar - Character Voice Assignment */}
                <aside className="w-72 shrink-0 overflow-y-auto border-r bg-gray-50 p-4">
                    <div className="mb-4 flex items-center gap-2">
                        <Volume2 className="h-5 w-5" />
                        <h2 className="font-semibold">Voice Assignment</h2>
                    </div>
                    <VoiceAssignmentPanel
                        characters={characters.map((c) => ({
                            id: c.id,
                            name: c.name,
                            thumbnailUrl: c.thumbnailUrl,
                            voiceAssetId: null, // Will be populated from voice profiles
                        }))}
                        projectId={projectId}
                        episodeId={episodeId}
                    />
                </aside>

                {/* Main Area */}
                <main className="flex flex-1 flex-col overflow-hidden">
                    {/* Tabs */}
                    <Tabs
                        value={activeTab}
                        onValueChange={(v) => setActiveTab(v as ActiveTab)}
                        className="flex flex-1 flex-col"
                    >
                        <div className="border-b px-6">
                            <TabsList className="h-12">
                                <TabsTrigger value="dialogue" className="relative">
                                    Dialogue
                                    {(dialoguePending > 0 || dialogueGenerating > 0) && (
                                        <span className="ml-2 rounded-full bg-blue-500 px-2 py-0.5 text-xs text-white">
                                            {dialoguePending + dialogueGenerating}
                                        </span>
                                    )}
                                </TabsTrigger>
                                <TabsTrigger value="music" className="relative">
                                    Music
                                    {musicProcessing > 0 && (
                                        <span className="ml-2 h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                                    )}
                                </TabsTrigger>
                                <TabsTrigger value="settings">Settings</TabsTrigger>
                            </TabsList>
                        </div>

                        {/* Dialogue Tab */}
                        <TabsContent
                            value="dialogue"
                            className="flex-1 overflow-auto p-6"
                        >
                            {dialogueError ? (
                                <div className="py-12 text-center text-red-500">
                                    Failed to load dialogue lines. Please try again.
                                </div>
                            ) : dialogueLoading ? (
                                <div className="py-12 text-center">
                                    <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
                                    <p className="text-muted-foreground">
                                        Loading dialogue lines...
                                    </p>
                                </div>
                            ) : (
                                <DialogueList
                                    episodeId={episodeId}
                                    dialogueLines={dialogueData?.lines ?? []}
                                    characters={characters}
                                    onPlay={handleDialoguePlay}
                                    onPause={handlePause}
                                    playingLineId={playingLineId}
                                />
                            )}
                        </TabsContent>

                        {/* Music Tab */}
                        <TabsContent value="music" className="flex-1 overflow-auto p-6">
                            {musicError ? (
                                <div className="py-12 text-center text-red-500">
                                    Failed to load music tracks. Please try again.
                                </div>
                            ) : musicLoading ? (
                                <div className="py-12 text-center">
                                    <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
                                    <p className="text-muted-foreground">
                                        Loading music tracks...
                                    </p>
                                </div>
                            ) : (
                                <MusicTrackList
                                    episodeId={episodeId}
                                    tracks={musicData?.tracks ?? []}
                                    onPlay={handleMusicPlay}
                                    onPause={handlePause}
                                    playingTrackId={playingTrackId}
                                />
                            )}
                        </TabsContent>

                        {/* Settings Tab */}
                        <TabsContent value="settings" className="flex-1 overflow-auto p-6">
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-lg font-semibold">Audio Settings</h3>
                                    <p className="text-muted-foreground text-sm">
                                        Configure default voice settings and audio preferences for
                                        this episode.
                                    </p>
                                </div>

                                <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center">
                                    <Settings className="mx-auto mb-2 h-8 w-8 opacity-50" />
                                    <p>Settings panel coming soon</p>
                                    <p className="mt-1 text-sm">
                                        Configure voice defaults, audio quality, and export options.
                                    </p>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>

                    {/* Audio Player Footer */}
                    {selectedAudioUrl && (
                        <footer className="shrink-0 border-t bg-white p-4">
                            <AudioPlayer
                                audioUrl={selectedAudioUrl}
                                isPlaying={isPlaying}
                                onPlay={handlePlayerPlay}
                                onPause={handlePlayerPause}
                                showWaveform
                            />
                        </footer>
                    )}
                </main>
            </div>
        </div>
    );
}
