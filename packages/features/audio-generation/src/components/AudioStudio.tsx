'use client';

import * as React from 'react';
import { useCallback, useEffect, useState, useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Download, Settings, Volume2 } from 'lucide-react';

import { listCharactersAction } from '@kit/assets/character/server';
import { Button } from '@kit/ui/button';
import { Label } from '@kit/ui/label';
import { Slider } from '@kit/ui/slider';
import { Switch } from '@kit/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { AudioPlayer } from './AudioPlayer';
import { DialogueList } from './DialogueList';
import { MusicTrackList } from './MusicTrackList';
import { VoiceAssignmentPanel } from './VoiceAssignment';
import type { VoiceAssignmentCharacter } from './VoiceAssignment';
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
 * Default voice settings configuration
 */
interface VoiceSettings {
    stability: number;
    similarityBoost: number;
    speed: number;
    useSpeakerBoost: boolean;
}

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
    stability: 0.5,
    similarityBoost: 0.75,
    speed: 1.0,
    useSpeakerBoost: true,
};

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
 * Keyboard shortcuts:
 * - Space: Play/Pause
 * - Alt+1/2/3: Switch tabs
 * - Cmd+G (Ctrl+G): Batch generate all pending dialogue
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

    // Voice settings state
    const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(
        DEFAULT_VOICE_SETTINGS,
    );

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

    // Fetch characters for voice assignment
    const { data: charactersData } = useQuery({
        queryKey: ['characters', projectId],
        queryFn: () => listCharactersAction({ projectId, limit: 100, offset: 0 }),
        staleTime: 60000, // Cache for 1 minute
    });

    // Transform characters for VoiceAssignmentPanel
    const voiceAssignmentCharacters: VoiceAssignmentCharacter[] = useMemo(() => {
        if (!charactersData?.data?.characters) return [];
        return charactersData.data.characters.map((char) => ({
            id: char.id,
            name: char.name,
            thumbnailUrl: char.thumbnailUrl,
            voiceAssetId: char.voiceAssetId,
        }));
    }, [charactersData]);

    // Audio player controls
    const handleDialoguePlay = useCallback(
        (audioUrl: string, lineId: string) => {
            setSelectedAudioUrl(audioUrl);
            setPlayingLineId(lineId);
            setPlayingTrackId(null);
            setIsPlaying(true);
        },
        [],
    );

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

    // Handle batch generate shortcut
    const handleBatchGenerate = useCallback(() => {
        const pendingCount =
            (dialogueData?.summary?.pending ?? 0) +
            (dialogueData?.summary?.failed ?? 0);
        if (pendingCount === 0) {
            toast.info('No pending dialogue lines to generate');
            return;
        }

        // Switch to dialogue tab and notify user
        setActiveTab('dialogue');
        toast.info(
            `Click "Generate All" to process ${pendingCount} pending lines`,
            {
                description: 'Switched to Dialogue tab',
            },
        );
    }, [dialogueData?.summary?.pending, dialogueData?.summary?.failed]);

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

            // Cmd+G (Ctrl+G): Batch generate
            if ((e.metaKey || e.ctrlKey) && e.code === 'KeyG') {
                e.preventDefault();
                handleBatchGenerate();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedAudioUrl, handleBatchGenerate]);

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
                        characters={voiceAssignmentCharacters}
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
                        <TabsContent value="dialogue" className="flex-1 overflow-auto p-6">
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
                            <div className="max-w-2xl space-y-8">
                                <div>
                                    <h3 className="text-lg font-semibold">Audio Settings</h3>
                                    <p className="text-muted-foreground text-sm">
                                        Configure default voice settings and audio preferences for
                                        this episode.
                                    </p>
                                </div>

                                {/* Voice Defaults Section */}
                                <div className="space-y-6 rounded-lg border p-6">
                                    <h4 className="font-medium">Default Voice Settings</h4>
                                    <p className="text-muted-foreground text-sm">
                                        These settings apply to all new voice generations.
                                    </p>

                                    {/* Stability */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="stability">Stability</Label>
                                            <span className="text-muted-foreground text-sm">
                                                {Math.round(voiceSettings.stability * 100)}%
                                            </span>
                                        </div>
                                        <Slider
                                            id="stability"
                                            min={0}
                                            max={100}
                                            step={1}
                                            value={[voiceSettings.stability * 100]}
                                            onValueChange={([v]) =>
                                                setVoiceSettings((s) => ({
                                                    ...s,
                                                    stability: (v ?? 50) / 100,
                                                }))
                                            }
                                        />
                                        <p className="text-muted-foreground text-xs">
                                            Higher values make the voice more consistent but less
                                            expressive.
                                        </p>
                                    </div>

                                    {/* Similarity Boost */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="similarity">Similarity Boost</Label>
                                            <span className="text-muted-foreground text-sm">
                                                {Math.round(voiceSettings.similarityBoost * 100)}%
                                            </span>
                                        </div>
                                        <Slider
                                            id="similarity"
                                            min={0}
                                            max={100}
                                            step={1}
                                            value={[voiceSettings.similarityBoost * 100]}
                                            onValueChange={([v]) =>
                                                setVoiceSettings((s) => ({
                                                    ...s,
                                                    similarityBoost: (v ?? 75) / 100,
                                                }))
                                            }
                                        />
                                        <p className="text-muted-foreground text-xs">
                                            Higher values make the output more similar to the original
                                            voice.
                                        </p>
                                    </div>

                                    {/* Speed */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="speed">Speed</Label>
                                            <span className="text-muted-foreground text-sm">
                                                {voiceSettings.speed.toFixed(2)}x
                                            </span>
                                        </div>
                                        <Slider
                                            id="speed"
                                            min={50}
                                            max={200}
                                            step={5}
                                            value={[voiceSettings.speed * 100]}
                                            onValueChange={([v]) =>
                                                setVoiceSettings((s) => ({
                                                    ...s,
                                                    speed: (v ?? 100) / 100,
                                                }))
                                            }
                                        />
                                        <p className="text-muted-foreground text-xs">
                                            Adjust the playback speed of generated audio.
                                        </p>
                                    </div>

                                    {/* Speaker Boost */}
                                    <div className="flex items-center justify-between rounded-lg border p-4">
                                        <div>
                                            <Label htmlFor="speaker-boost" className="font-medium">
                                                Speaker Boost
                                            </Label>
                                            <p className="text-muted-foreground text-sm">
                                                Enhance voice clarity and presence
                                            </p>
                                        </div>
                                        <Switch
                                            id="speaker-boost"
                                            checked={voiceSettings.useSpeakerBoost}
                                            onCheckedChange={(checked) =>
                                                setVoiceSettings((s) => ({
                                                    ...s,
                                                    useSpeakerBoost: checked,
                                                }))
                                            }
                                        />
                                    </div>
                                </div>

                                {/* Keyboard Shortcuts Reference */}
                                <div className="space-y-4 rounded-lg border p-6">
                                    <h4 className="font-medium">Keyboard Shortcuts</h4>
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">Play/Pause</span>
                                            <kbd className="rounded bg-gray-100 px-2 py-1 font-mono text-xs">
                                                Space
                                            </kbd>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">
                                                Batch Generate
                                            </span>
                                            <kbd className="rounded bg-gray-100 px-2 py-1 font-mono text-xs">
                                                ⌘G
                                            </kbd>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">
                                                Dialogue Tab
                                            </span>
                                            <kbd className="rounded bg-gray-100 px-2 py-1 font-mono text-xs">
                                                Alt+1
                                            </kbd>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">Music Tab</span>
                                            <kbd className="rounded bg-gray-100 px-2 py-1 font-mono text-xs">
                                                Alt+2
                                            </kbd>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">
                                                Settings Tab
                                            </span>
                                            <kbd className="rounded bg-gray-100 px-2 py-1 font-mono text-xs">
                                                Alt+3
                                            </kbd>
                                        </div>
                                    </div>
                                </div>

                                {/* Save Button */}
                                <div className="flex justify-end">
                                    <Button
                                        onClick={() => {
                                            toast.success('Settings saved');
                                        }}
                                    >
                                        Save Settings
                                    </Button>
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
