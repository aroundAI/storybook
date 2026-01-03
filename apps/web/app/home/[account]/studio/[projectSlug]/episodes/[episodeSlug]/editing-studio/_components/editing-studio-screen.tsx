'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import {
  ChevronDown,
  ChevronUp,
  Download,
  Globe,
  Pause,
  Play,
  RotateCcw,
  Share2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';

import type { CharacterAsset, DialogueLine, SupportedLanguage } from '@kit/audio-generation/lib';
import { SUPPORTED_LANGUAGES } from '@kit/audio-generation/lib';
import {
  getAudioTracksAction,
  getCharactersForEpisodeAction,
  getDialogueLinesAction,
} from '@kit/audio-generation/server';
import type { EpisodeWithShots, Shot } from '@kit/episodes/types';
import { reorderShotsAction } from '@kit/episodes/server';
import { Button } from '@kit/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

import { TimelinePanel } from './timeline/timeline-panel';
import { VideoPreview, type VideoPreviewHandle } from './video-preview';
import { FinalizeDialog } from './finalize-dialog';
import { StatusBar } from './status-bar';
import { AudioMixer } from './audio-mixer';

interface EditingStudioScreenProps {
  episode: EpisodeWithShots;
  projectId: string;
  accountSlug: string;
  refetchEpisode: () => void;
}

interface MusicTrackData {
  id: string;
  name: string | null;
  fileUrl: string | null;
  durationSeconds: number | null;
  timelineStartSeconds: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  metadata: {
    sceneNumber?: number;
  } | null;
}

interface SfxTrackData {
  id: string;
  name: string | null;
  fileUrl: string | null;
  durationSeconds: number | null;
  timelineStartSeconds: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

const ZOOM_LEVELS = [10, 20, 40, 60, 80, 100, 120, 160, 200];

export function EditingStudioScreen({
  episode,
  projectId: _projectId,
  accountSlug,
  refetchEpisode,
}: EditingStudioScreenProps) {
  const router = useRouter();
  const videoPreviewRef = useRef<VideoPreviewHandle>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentShotIndex, setCurrentShotIndex] = useState(0);
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);

  // Timeline state
  const [pixelsPerSecond, setPixelsPerSecond] = useState(40);

  // Audio data state
  const [dialogueLines, setDialogueLines] = useState<DialogueLine[]>([]);
  const [characters, setCharacters] = useState<CharacterAsset[]>([]);
  const [musicTracks, setMusicTracks] = useState<MusicTrackData[]>([]);
  const [sfxTracks, setSfxTracks] = useState<SfxTrackData[]>([]);
  const [isAudioLoading, setIsAudioLoading] = useState(true);

  // Language selection state
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('en');
  const [availableLanguages, setAvailableLanguages] = useState<SupportedLanguage[]>(['en']);

  // Fetch audio data on mount and language change
  useEffect(() => {
    async function fetchAudioData() {
      setIsAudioLoading(true);
      try {
        const [dialogueResult, chars, musicResult, sfxResult] = await Promise.all([
          getDialogueLinesAction({ episodeId: episode.id }),
          getCharactersForEpisodeAction({ episodeId: episode.id }),
          getAudioTracksAction({ episodeId: episode.id, type: 'music' }),
          getAudioTracksAction({ episodeId: episode.id, type: 'sfx' }),
        ]);

        const allLines = Array.isArray(dialogueResult?.lines) ? dialogueResult.lines : [];

        // Extract available languages
        const langs = new Set<SupportedLanguage>(
          allLines.map((l) => (l.language || 'en') as SupportedLanguage)
        );
        const langArray = Array.from(langs).sort((a, b) => {
          const order = ['en', 'hi', 'es', 'pt'];
          return order.indexOf(a) - order.indexOf(b);
        });
        setAvailableLanguages(langArray.length > 0 ? langArray : ['en']);

        // Filter by selected language
        const filteredLines = allLines.filter(
          (l) => (l.language || 'en') === selectedLanguage
        );
        setDialogueLines(filteredLines);
        setCharacters(Array.isArray(chars) ? chars : []);
        setMusicTracks(
          musicResult.tracks.map((t) => ({
            id: t.id,
            name: t.name,
            fileUrl: t.fileUrl,
            durationSeconds: t.durationSeconds,
            timelineStartSeconds: t.timelineStartSeconds,
            status: t.status,
            metadata: t.metadata as MusicTrackData['metadata'],
          })),
        );
        setSfxTracks(
          sfxResult.tracks.map((t) => ({
            id: t.id,
            name: t.name,
            fileUrl: t.fileUrl,
            durationSeconds: t.durationSeconds,
            timelineStartSeconds: t.timelineStartSeconds,
            status: t.status,
          })),
        );
      } catch (error) {
        console.error('Failed to fetch audio data:', error);
      } finally {
        setIsAudioLoading(false);
      }
    }
    void fetchAudioData();
  }, [episode.id, selectedLanguage]);

  // Get completed shots with videos, sorted by sequence
  const completedShots = useMemo(() => {
    return (
      episode.shots
        ?.filter((shot) => shot.status === 'completed' && shot.videoUrl)
        .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0)) ?? []
    );
  }, [episode.shots]);

  // Calculate timeline with start/end times
  const timelineData = useMemo(() => {
    let cumulativeTime = 0;
    const shots = completedShots.map((shot) => {
      const startTime = cumulativeTime;
      const endTime = startTime + (shot.duration || 5);
      cumulativeTime = endTime;
      return { ...shot, startTime, endTime };
    });
    return { shots, totalDuration: cumulativeTime };
  }, [completedShots]);

  const currentShot = completedShots[currentShotIndex] ?? null;

  // Find shot index by time
  const findShotIndexByTime = useCallback(
    (time: number): number => {
      for (let i = 0; i < timelineData.shots.length; i++) {
        const shot = timelineData.shots[i];
        if (shot && time >= shot.startTime && time < shot.endTime) {
          return i;
        }
      }
      return timelineData.shots.length - 1;
    },
    [timelineData.shots],
  );

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      videoPreviewRef.current?.pause();
    } else {
      videoPreviewRef.current?.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleVideoEnded = useCallback(() => {
    if (currentShotIndex < completedShots.length - 1) {
      setCurrentShotIndex(currentShotIndex + 1);
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
      setCurrentShotIndex(0);
    }
  }, [currentShotIndex, completedShots.length]);

  const handleTimeUpdate = useCallback(
    (videoTime: number) => {
      const shotData = timelineData.shots[currentShotIndex];
      if (shotData) {
        setCurrentTime(shotData.startTime + videoTime);
      }
    },
    [currentShotIndex, timelineData.shots],
  );

  const handleShotClick = useCallback(
    (index: number) => {
      setCurrentShotIndex(index);
      const shotData = timelineData.shots[index];
      setCurrentTime(shotData?.startTime ?? 0);
      setIsPlaying(false);
      videoPreviewRef.current?.seek(0);
    },
    [timelineData.shots],
  );

  const handleTimelineClick = useCallback(
    (time: number) => {
      const index = findShotIndexByTime(time);
      const shotData = timelineData.shots[index];
      if (shotData) {
        setCurrentShotIndex(index);
        setCurrentTime(time);
        const offsetInShot = time - shotData.startTime;
        videoPreviewRef.current?.seek(offsetInShot);
        setIsPlaying(false);
      }
    },
    [findShotIndexByTime, timelineData.shots],
  );

  const handlePrevShot = useCallback(() => {
    if (currentShotIndex > 0) {
      handleShotClick(currentShotIndex - 1);
    }
  }, [currentShotIndex, handleShotClick]);

  const handleNextShot = useCallback(() => {
    if (currentShotIndex < completedShots.length - 1) {
      handleShotClick(currentShotIndex + 1);
    }
  }, [currentShotIndex, completedShots.length, handleShotClick]);

  const handleRestart = useCallback(() => {
    setCurrentShotIndex(0);
    setCurrentTime(0);
    setIsPlaying(false);
    videoPreviewRef.current?.seek(0);
  }, []);

  const handleMuteToggle = useCallback(() => {
    setIsMuted(!isMuted);
  }, [isMuted]);

  const handleZoomIn = useCallback(() => {
    const idx = ZOOM_LEVELS.findIndex((z) => z >= pixelsPerSecond);
    if (idx < ZOOM_LEVELS.length - 1) {
      setPixelsPerSecond(ZOOM_LEVELS[idx + 1]!);
    }
  }, [pixelsPerSecond]);

  const handleZoomOut = useCallback(() => {
    const idx = ZOOM_LEVELS.findIndex((z) => z >= pixelsPerSecond);
    if (idx > 0) {
      setPixelsPerSecond(ZOOM_LEVELS[idx - 1]!);
    }
  }, [pixelsPerSecond]);

  const handleExportComplete = useCallback(() => {
    // Refetch episode to get updated finalVideoUrl
    refetchEpisode();
  }, [refetchEpisode]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-900">
      {/* Header - Collapsible */}
      <div className={`flex shrink-0 items-center justify-between border-b border-gray-200 bg-white/85 px-6 backdrop-blur-xl dark:border-gray-700 dark:bg-gray-800/85 transition-all ${isHeaderCollapsed ? 'py-1' : 'py-3'}`}>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsHeaderCollapsed(!isHeaderCollapsed)}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            {isHeaderCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Editing Studio
          </h2>
          <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
            <span>{completedShots.length} shots</span>
            <span>•</span>
            <span>{formatTime(timelineData.totalDuration)}</span>
          </div>
        </div>

        {!isHeaderCollapsed && (
          <div className="flex items-center gap-3">
            {/* Tertiary: Language Selector (ghost style) */}
            {availableLanguages.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2 text-gray-600 dark:text-gray-400">
                    <Globe className="h-4 w-4" />
                    {SUPPORTED_LANGUAGES[selectedLanguage] ?? 'English'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {availableLanguages.map((lang) => (
                    <DropdownMenuItem
                      key={lang}
                      onClick={() => setSelectedLanguage(lang)}
                      className={selectedLanguage === lang ? 'bg-gray-100 dark:bg-gray-800' : ''}
                    >
                      {SUPPORTED_LANGUAGES[lang] ?? lang}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Secondary: Export Video (outlined) */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFinalizeDialog(true)}
              disabled={completedShots.length === 0}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export Video
            </Button>

            {/* Primary: Publish (filled green, unmistakable CTA) */}
            <Button
              size="sm"
              onClick={() => {
                const episodeSlug = episode.slug ?? episode.id;
                router.push(
                  `/home/${accountSlug}/studio/${episode.projectId}/episodes/${episodeSlug}/publish`,
                );
              }}
              disabled={!episode.finalVideoUrl}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-400"
            >
              <Share2 className="h-4 w-4" />
              Publish
            </Button>
          </div>
        )}
      </div>

      {/* Main Content: Video Preview */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-hidden p-4">
          <VideoPreview
            ref={videoPreviewRef}
            shot={currentShot}
            isPlaying={isPlaying}
            isMuted={isMuted}
            onPlayPause={handlePlayPause}
            onEnded={handleVideoEnded}
            onTimeUpdate={handleTimeUpdate}
            className="h-full w-full"
          />
        </div>

        {/* Playback Controls */}
        <div className="flex shrink-0 items-center justify-center gap-4 border-t border-gray-200 bg-gray-50 px-6 py-3 dark:border-gray-700 dark:bg-gray-800">
          {/* Time Display */}
          <span className="w-16 font-mono text-sm text-gray-500 dark:text-gray-400">
            {formatTime(currentTime)}
          </span>

          {/* Control Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleRestart}
              className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={handlePrevShot}
              disabled={currentShotIndex === 0}
              className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              onClick={handlePlayPause}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white transition-transform hover:scale-105 dark:bg-white dark:text-gray-900"
            >
              {isPlaying ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="ml-0.5 h-5 w-5" />
              )}
            </button>
            <button
              onClick={handleNextShot}
              disabled={currentShotIndex === completedShots.length - 1}
              className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            >
              <SkipForward className="h-4 w-4" />
            </button>
            <button
              onClick={handleMuteToggle}
              className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Duration Display */}
          <span className="w-16 text-right font-mono text-sm text-gray-500 dark:text-gray-400">
            {formatTime(timelineData.totalDuration)}
          </span>
        </div>

        {/* Audio Mixer - syncs dialogue/music/sfx with video */}
        <AudioMixer
          dialogueLines={dialogueLines}
          characters={characters}
          musicTracks={musicTracks}
          sfxTracks={sfxTracks}
          currentTime={currentTime}
          isPlaying={isPlaying}
          isMuted={isMuted}
        />
      </div>

      {/* Timeline Panel */}
      <div className="h-[220px] shrink-0 border-t border-gray-200 dark:border-gray-700">
        <TimelinePanel
          shots={completedShots}
          currentShotIndex={currentShotIndex}
          currentTime={currentTime}
          totalDuration={timelineData.totalDuration}
          pixelsPerSecond={pixelsPerSecond}
          onShotClick={handleShotClick}
          onShotsReorder={async (newOrder: Shot[]) => {
            const shotIds = newOrder.map(s => s.id);
            await reorderShotsAction({ shotIds, episodeId: episode.id });
            refetchEpisode();
          }}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onTimelineClick={handleTimelineClick}
          dialogueLines={dialogueLines}
          characters={characters}
          musicTracks={musicTracks}
          sfxTracks={sfxTracks}
          isAudioLoading={isAudioLoading}
        />
      </div>

      {/* Status Bar */}
      <StatusBar
        saveState="saved"
        lastSavedSecondsAgo={2}
      />

      {/* Finalize Dialog */}
      <FinalizeDialog
        open={showFinalizeDialog}
        onOpenChange={setShowFinalizeDialog}
        episode={episode}
        completedShots={completedShots}
        dialogueLines={dialogueLines}
        characters={characters}
        musicTracks={musicTracks}
        accountSlug={accountSlug}
        selectedLanguage={selectedLanguage}
        onComplete={handleExportComplete}
      />
    </div>
  );
}

