'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';

import {
  AlertCircle,
  CheckCircle,
  Download,
  Loader2,
  Minus,
  Play,
  Plus,
  Square,
  Trash2,
  Wand2,
  XCircle,
} from 'lucide-react';

import type {
  CharacterAsset,
  DialogueLine,
  ProjectAudioSettings,
} from '@kit/audio-generation/lib';
import type { AudioTrack } from '@kit/audio-generation/lib';
import {
  batchGenerateDialogueAction,
  cancelBatchAction,
  clearAllVoicesAction,
  generateAudioCuesAction,
  getActiveBatchForEpisodeAction,
  getAudioStudioBulkDataAction,
  getBatchStatusAction,
  getDialogueLinesAction,
} from '@kit/audio-generation/server';
import type { AudioStudioBulkData } from '@kit/audio-generation/server';
import type { EpisodeWithShots } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { useLlmJob } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';

import { DialogueTimeline } from './dialogue-timeline';
import { LanguageTabBar, type SupportedLanguage } from './language-tab-bar';
import {
  MusicTimeline,
  type MusicTimelineHandle,
  type MusicTimelineStats,
} from './music-timeline';
import {
  SfxTimeline,
  type SfxTimelineHandle,
  type SfxTimelineStats,
} from './sfx-timeline';

interface AudioStudioScreenProps {
  episode: EpisodeWithShots;
  refetchEpisode: () => void;
}

const PREFERRED_LANGUAGE_ORDER = ['en', 'hi', 'es', 'pt'];

export function AudioStudioScreen({
  episode,
  refetchEpisode,
}: AudioStudioScreenProps) {
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<'dialogue' | 'music' | 'sfx'>(
    'dialogue',
  );

  // State for real dialogue data
  const [dialogueLines, setDialogueLines] = useState<DialogueLine[]>([]);
  const [characters, setCharacters] = useState<CharacterAsset[]>([]);
  const [audioSettings, setAudioSettings] =
    useState<ProjectAudioSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Batch generation state
  const [batchJobId, setBatchJobId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<{
    status: string;
    total: number;
    completed: number;
    failed: number;
    percentage: number;
  } | null>(null);
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Language selection state
  const [selectedLanguage, setSelectedLanguage] =
    useState<SupportedLanguage>('en');
  const [availableLanguages, setAvailableLanguages] = useState<
    SupportedLanguage[]
  >(['en']);

  // Client-side dialogue cache: avoids re-fetching when switching back to a language
  const dialogueCache = useRef<Map<string, DialogueLine[]>>(new Map());

  // Timeline zoom state (pixels per second)
  const [pixelsPerSecond, setPixelsPerSecond] = useState(2);
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  // Music & SFX stats (reported from child timelines)
  const [musicStats, setMusicStats] = useState<MusicTimelineStats>({
    total: 0,
    completed: 0,
    pending: 0,
    processing: 0,
    failed: 0,
  });
  const [sfxStats, setSfxStats] = useState<SfxTimelineStats>({
    total: 0,
    completed: 0,
    pending: 0,
    processing: 0,
    failed: 0,
  });
  const musicTimelineRef = useRef<MusicTimelineHandle>(null);
  const sfxTimelineRef = useRef<SfxTimelineHandle>(null);

  // Pre-loaded audio tracks and cues from bulk action (passed to music/sfx timelines)
  const [initialAudioTracks, setInitialAudioTracks] = useState<
    AudioTrack[] | null
  >(null);
   
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [initialAudioCues, setInitialAudioCues] = useState<Array<
    Record<string, any>
  > | null>(null);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Audio cue generation state
  const [isGeneratingCues, setIsGeneratingCues] = useState(false);

  // WebSocket for shot-generation results (when shot list is generated while on this tab)
  const {
    status: shotGenStatus,
    result: shotGenResult,
    error: shotGenError,
  } = useLlmJob<{ success: boolean }>('shot-generation');

  // WebSocket for translate-dialogue results (when dialogue is translated while on this tab)
  const {
    status: translateStatus,
    result: translateResult,
    error: translateError,
  } = useLlmJob<{ success: boolean }>('translate-dialogue');

  // WebSocket for audio-cue-generation results
  const {
    status: audioCueGenStatus,
    result: audioCueGenResult,
    error: audioCueGenError,
  } = useLlmJob<{ success: boolean; cuesCreated: number }>(
    'audio-cue-generation',
  );

  // Bulk-load ALL audio studio data on mount (replaces 5+ separate server actions)
  const fetchInitialData = useCallback(async () => {
    setIsLoading(true);
    try {
      const bulkData: AudioStudioBulkData = await getAudioStudioBulkDataAction({
        episodeId: episode.id,
        projectId: episode.projectId,
        language: selectedLanguage,
      });

      // Dialogue lines
      const allLines = bulkData.dialogue.lines;
      dialogueCache.current.set(selectedLanguage, allLines);
      setDialogueLines(allLines);

      // Characters
      setCharacters(bulkData.characters);

      // Audio settings
      setAudioSettings(bulkData.audioSettings);

      // Languages
      if (bulkData.languages.length > 0) {
        const langArray = [...bulkData.languages].sort((a, b) => {
          return (
            PREFERRED_LANGUAGE_ORDER.indexOf(a) -
            PREFERRED_LANGUAGE_ORDER.indexOf(b)
          );
        });
        setAvailableLanguages(langArray);
      }

      // Pre-load audio tracks and cues for music/sfx timelines
      setInitialAudioTracks(bulkData.audioTracks.tracks);
      setInitialAudioCues(bulkData.audioCues);

      // Compute music stats from bulk data (so tab counts show immediately)
      {
        // Music tracks (user-created)
        const musicTracks = bulkData.audioTracks.tracks.filter(
          (t) => t.type === 'music',
        );
        // Music cues (auto-generated, not yet placed)
        const musicCueRows = (
          bulkData.audioCues as Array<{
            cue_type: string;
            status: string | null;
          }>
        )
          .filter((c) => c.cue_type === 'music')
          .filter((c) => c.status !== 'placed' && c.status !== 'matched');

        const mTotal = musicTracks.length + musicCueRows.length;
        const mCompleted = musicTracks.filter(
          (t) => t.status === 'completed',
        ).length;
        const mPending =
          musicTracks.filter((t) => t.status === 'pending').length +
          musicCueRows.filter((c) => c.status === 'pending').length;
        const mProcessing =
          musicTracks.filter((t) => t.status === 'processing').length +
          musicCueRows.filter((c) => c.status === 'generating').length;
        const mFailed =
          musicTracks.filter((t) => t.status === 'failed').length +
          musicCueRows.filter((c) => c.status === 'failed').length;
        setMusicStats({
          total: mTotal,
          completed: mCompleted,
          pending: mPending,
          processing: mProcessing,
          failed: mFailed,
        });
      }

      // Compute SFX stats from bulk data
      {
        const sfxCueRows = (
          bulkData.audioCues as Array<{
            cue_type: string;
            status: string | null;
          }>
        ).filter((c) => c.cue_type === 'sfx' || c.cue_type === 'ambient');

        const sTotal = sfxCueRows.length;
        const sCompleted = sfxCueRows.filter(
          (c) => c.status === 'placed' || c.status === 'matched',
        ).length;
        const sPending = sfxCueRows.filter(
          (c) => c.status === 'pending',
        ).length;
        const sProcessing = sfxCueRows.filter(
          (c) => c.status === 'generating',
        ).length;
        const sFailed = sfxCueRows.filter((c) => c.status === 'failed').length;
        setSfxStats({
          total: sTotal,
          completed: sCompleted,
          pending: sPending,
          processing: sProcessing,
          failed: sFailed,
        });
      }

      // Stale reset notification (fire-and-forget on server, just inform user)
      if (bulkData.staleResetCount > 0) {
        toast.info(
          `Recovered ${bulkData.staleResetCount} stuck dialogue line(s) from a previous failed batch.`,
        );
      }
    } catch (error) {
      console.error('Failed to fetch audio studio data:', error);
      toast.error('Failed to load audio studio data');
      setCharacters([]);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.id, episode.projectId]);

  // Fetch dialogue lines for a specific language (with cache)
  const fetchDialogueForLanguage = useCallback(
    async (lang: SupportedLanguage, skipCache = false) => {
      // Check cache first
      if (!skipCache) {
        const cached = dialogueCache.current.get(lang);
        if (cached) {
          setDialogueLines(cached);
          return;
        }
      }

      setIsLoading(true);
      try {
        const dialogueResult = await getDialogueLinesAction({
          episodeId: episode.id,
          language: lang,
        });

        const allLines = Array.isArray(dialogueResult?.lines)
          ? dialogueResult.lines
          : [];

        dialogueCache.current.set(lang, allLines);
        setDialogueLines(allLines);
      } catch (error) {
        console.error('Failed to fetch dialogue lines:', error);
        toast.error('Failed to load dialogue data');
        setDialogueLines([]);
      } finally {
        setIsLoading(false);
      }
    },
    [episode.id],
  );

  // Combined refresh: clears cache and reloads everything
  const refreshAll = useCallback(async () => {
    dialogueCache.current.clear();
    setInitialAudioTracks(null);
    setInitialAudioCues(null);
    await fetchInitialData();
  }, [fetchInitialData]);

  // Handle shot-generation result (refresh to show updated episode)
  useEffect(() => {
    if (shotGenStatus === 'success' && shotGenResult) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = shotGenResult as any;
      if (resultData?.success) {
        toast.success('Shot list generated successfully');
        refetchEpisode();
        void refreshAll();
      }
    } else if (shotGenStatus === 'error') {
      toast.error(shotGenError || 'Failed to generate shot list');
    }
  }, [shotGenStatus, shotGenResult, shotGenError, refetchEpisode, refreshAll]);

  // Handle translate-dialogue result (refresh to show translated dialogue)
  useEffect(() => {
    if (translateStatus === 'success' && translateResult) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = translateResult as any;
      if (resultData?.success) {
        toast.success('Dialogue translated successfully');
        refetchEpisode();
        void refreshAll();
      }
    } else if (translateStatus === 'error') {
      toast.error(translateError || 'Failed to translate dialogue');
    }
  }, [
    translateStatus,
    translateResult,
    translateError,
    refetchEpisode,
    refreshAll,
  ]);

  // Handle audio-cue-generation result (refresh to show generated cues)
  useEffect(() => {
    if (audioCueGenStatus === 'success' && audioCueGenResult) {
      if (audioCueGenResult.success) {
        toast.success(
          `Audio cues generated: ${audioCueGenResult.cuesCreated ?? 0} cue(s) created`,
        );
        setIsGeneratingCues(false);
        refetchEpisode();
        void refreshAll();
      }
    } else if (audioCueGenStatus === 'error') {
      setIsGeneratingCues(false);
      toast.error(audioCueGenError || 'Failed to generate audio cues');
    }
  }, [
    audioCueGenStatus,
    audioCueGenResult,
    audioCueGenError,
    refetchEpisode,
    refreshAll,
  ]);

  // Initial load: fetch everything in one bulk action
  useEffect(() => {
    void fetchInitialData();
  }, [fetchInitialData]);

  // Language switch: fetch dialogue for the new language (uses individual action)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    void fetchDialogueForLanguage(selectedLanguage);
  }, [fetchDialogueForLanguage, selectedLanguage]);

  // Zoom presets
  const ZOOM_LEVELS = [2, 5, 10, 20, 40, 60, 80, 120, 160, 200];

  const zoomIn = () => {
    const idx = ZOOM_LEVELS.findIndex((z) => z >= pixelsPerSecond);
    if (idx < ZOOM_LEVELS.length - 1) {
      setPixelsPerSecond(ZOOM_LEVELS[idx + 1]!);
    }
  };

  const zoomOut = () => {
    const idx = ZOOM_LEVELS.findIndex((z) => z >= pixelsPerSecond);
    if (idx > 0) {
      setPixelsPerSecond(ZOOM_LEVELS[idx - 1]!);
    }
  };

  const fitToWindow = () => {
    const containerWidth = timelineContainerRef.current?.clientWidth ?? 800;
    // Leave some padding (280px for sidebar, 60px for margins)
    const availableWidth = containerWidth - 60;
    const newPPS = Math.floor(availableWidth / totalDuration);
    setPixelsPerSecond(Math.max(20, Math.min(200, newPPS)));
  };

  // Stats from real data
  const stats = useMemo(() => {
    const total = dialogueLines.length;
    const completed = dialogueLines.filter(
      (l) => l.status === 'completed',
    ).length;
    const pending = dialogueLines.filter((l) => l.status === 'pending').length;
    const generating = dialogueLines.filter(
      (l) => l.status === 'generating',
    ).length;
    const failed = dialogueLines.filter((l) => l.status === 'failed').length;
    return { total, completed, pending, generating, failed };
  }, [dialogueLines]);

  // Extract scenes from screenplay data for music timeline
  const scenes = useMemo(() => {
    const screenplayData = episode.screenplayData as {
      scenes?: Array<{
        number: number;
        heading: string;
        estimatedDuration: number;
      }>;
    } | null;

    return (
      screenplayData?.scenes?.map((scene) => ({
        number: scene.number,
        heading: scene.heading ?? `Scene ${scene.number}`,
        estimatedDuration: scene.estimatedDuration ?? 30,
      })) ?? []
    );
  }, [episode.screenplayData]);

  // Calculate total duration from scenes or use target duration
  const totalDuration = useMemo(() => {
    if (scenes.length > 0) {
      return scenes.reduce((acc, scene) => acc + scene.estimatedDuration, 0);
    }
    return episode.durationSeconds ?? 90;
  }, [scenes, episode.durationSeconds]);

  // Poll batch job status
  const pollBatchStatus = useCallback(
    async (jobId: string) => {
      try {
        const status = await getBatchStatusAction({ batchJobId: jobId });
        setBatchStatus({
          status: status.status,
          total: status.progress.total,
          completed: status.progress.completed,
          failed: status.progress.failed,
          percentage: status.progress.percentage,
        });

        // Refresh only dialogue lines (not all static data) for performance
        void fetchDialogueForLanguage(selectedLanguage, true);

        // Stop polling when done
        if (
          status.status === 'completed' ||
          status.status === 'completed_with_errors' ||
          status.status === 'failed' ||
          status.status === 'cancelled'
        ) {
          if (batchPollRef.current) {
            clearInterval(batchPollRef.current);
            batchPollRef.current = null;
          }

          if (status.status === 'completed') {
            toast.success(
              `All ${status.progress.completed} voice(s) generated successfully!`,
            );
          } else if (status.status === 'completed_with_errors') {
            toast.warning(
              `${status.progress.completed} voice(s) generated, ${status.progress.failed} failed.`,
            );
          } else if (status.status === 'failed') {
            toast.error(
              `Generation failed for all ${status.progress.total} line(s).`,
            );
          } else {
            toast.info('Generation cancelled');
          }

          refetchEpisode();
        }
      } catch {
        // If polling fails, stop polling
        if (batchPollRef.current) {
          clearInterval(batchPollRef.current);
          batchPollRef.current = null;
        }
      }
    },
    [fetchDialogueForLanguage, selectedLanguage, refetchEpisode],
  );

  // Resume polling if an active batch job exists (e.g. after page refresh)
  useEffect(() => {
    const checkActiveBatch = async () => {
      try {
        const activeBatch = await getActiveBatchForEpisodeAction({
          episodeId: episode.id,
        });

        if (activeBatch) {
          setBatchJobId(activeBatch.batchJobId);
          setBatchStatus({
            status: activeBatch.status,
            total: activeBatch.progress.total,
            completed: activeBatch.progress.completed,
            failed: activeBatch.progress.failed,
            percentage: activeBatch.progress.percentage,
          });

          if (batchPollRef.current) {
            clearInterval(batchPollRef.current);
          }
          batchPollRef.current = setInterval(() => {
            void pollBatchStatus(activeBatch.batchJobId);
          }, 3000);
        }
      } catch {
        // Non-critical — just means we won't auto-resume polling
      }
    };

    void checkActiveBatch();

    // Cleanup polling on unmount
    return () => {
      if (batchPollRef.current) {
        clearInterval(batchPollRef.current);
      }
    };
  }, [episode.id, pollBatchStatus]);

  const handleGenerateAll = () => {
    startTransition(async () => {
      try {
        const result = await batchGenerateDialogueAction({
          episodeId: episode.id,
        });

        setBatchJobId(result.batchJobId);
        setBatchStatus({
          status: 'queued',
          total: result.totalLines,
          completed: 0,
          failed: 0,
          percentage: 0,
        });

        toast.success(
          `Generating voices for ${result.totalLines} dialogue line(s)...`,
        );

        // Start polling every 3 seconds
        if (batchPollRef.current) {
          clearInterval(batchPollRef.current);
        }
        batchPollRef.current = setInterval(() => {
          void pollBatchStatus(result.batchJobId);
        }, 3000);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to start generation',
        );
      }
    });
  };

  const handleCancelBatch = () => {
    if (!batchJobId) return;

    startTransition(async () => {
      try {
        await cancelBatchAction({ batchJobId });
        toast.info('Generation cancelled');

        if (batchPollRef.current) {
          clearInterval(batchPollRef.current);
          batchPollRef.current = null;
        }

        setBatchStatus((prev) =>
          prev ? { ...prev, status: 'cancelled' } : null,
        );
        void refreshAll();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to cancel generation',
        );
      }
    });
  };

  const isGenerating =
    batchStatus?.status === 'queued' || batchStatus?.status === 'processing';

  const hasNoCues = musicStats.total === 0 && sfxStats.total === 0;

  const handleGenerateAudioCues = () => {
    setIsGeneratingCues(true);
    startTransition(async () => {
      try {
        const result = await generateAudioCuesAction({
          episodeId: episode.id,
        });

        if (result.queued) {
          toast.info(
            'Generating audio cues in background... This may take a minute.',
          );
        } else {
          setIsGeneratingCues(false);
          toast.error(result.error ?? 'Failed to generate audio cues');
        }
      } catch (error) {
        setIsGeneratingCues(false);
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to generate audio cues',
        );
      }
    });
  };

  const handleClearAllVoices = () => {
    if (
      !window.confirm(
        `Clear all ${stats.completed} generated voice(s)? This will reset them back to pending so you can regenerate.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const result = await clearAllVoicesAction({
          episodeId: episode.id,
        });

        if (result.success) {
          toast.success(`Cleared ${result.clearedCount} voice(s)`);
          void refreshAll();
        } else {
          toast.error(result.error ?? 'Failed to clear voices');
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to clear voices',
        );
      }
    });
  };

  /**
   * Helper to fetch audio as blob
   */
  const fetchAudioAsBlob = async (url: string): Promise<Blob | null> => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  };

  /**
   * Format seconds to SRT timestamp (HH:MM:SS,ms)
   */
  const _formatSrtTime = (seconds: number): string => {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const iso = date.toISOString();
    // ISO format is YYYY-MM-DDTHH:MM:SS.mmmZ
    // We want HH:MM:SS,mmm
    return iso.substring(11, 23).replace('.', ',');
  };

  /**
   * Export all audio assets and SRTs
   */
  const [_isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (dialogueLines.length === 0) {
      toast.warning('No dialogue to export');
      return;
    }

    setIsExporting(true);
    toast.info('Preparing Audio export...');

    try {
      // Dynamic import of JSZip
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Folders
      const dialogueFolder = zip.folder('Dialogue');
      const srtFolder = zip.folder('Subtitles');

      if (!dialogueFolder || !srtFolder) return;

      // Track fetched audio to avoid duplicates
      const fetchedAudio = new Map<string, Blob>();

      // Sort lines by execution order
      const sortedLines = [...dialogueLines].sort((a, b) => {
        // Sort by scene number first, then sequence number
        // Note: dialogueLines might not have scene number directly if not joined.
        return (a.sequenceNumber || 0) - (b.sequenceNumber || 0);
      });

      for (const line of sortedLines) {
        if (!line.audioUrl) continue;

        // 1. Add Audio File
        let blob = fetchedAudio.get(line.audioUrl);
        if (!blob) {
          blob = (await fetchAudioAsBlob(line.audioUrl)) ?? undefined;
          if (blob) {
            fetchedAudio.set(line.audioUrl, blob);
          }
        }

        if (blob) {
          // Filename: Scene-X_Seq-Y_Character.mp3
          // If scene info is missing, just use Seq-Y
          const characterName =
            characters.find((c) => c.id === line.characterAssetId)?.name ??
            'Unknown';
          const filename = `${line.sequenceNumber.toString().padStart(3, '0')}_${characterName.replace(/[^a-z0-9]/gi, '_')}.mp3`;
          dialogueFolder.file(filename, blob);
        }

        // 2. Append to SRT
        // Assuming we have timing info relative to the start of the episode
        // If 'startTime' exists on the line, use it. Otherwise, we can strictly only generate
        // per-clip SRTs or assume a sequential flow if we had durations.
        // For now, if we don't have global timeline positions, we can't generate a valid global SRT.
        // BUT, looking at `DialogueLine` type, we might not have `startTime`.
        // Let's create individual SRTs per line if global timing isn't available,
        // OR just dump the transcription text.

        // Let's assume for this export we primarily want the files.
        // If we want a global SRT, we'd need the Timeline logic to calculate offsets.
        // Since `dialogueLines` is just a list, we'll skip global SRT for now
        // and just export a JSON manifest of the lines.
      }

      // Export Metadata / Script
      const scriptContent = sortedLines
        .map((l) => {
          const charName =
            characters.find((c) => c.id === l.characterAssetId)?.name ??
            'Unknown';
          return `${charName}: ${l.text}`;
        })
        .join('\n\n');

      zip.file('script_transcript.txt', scriptContent);
      zip.file('dialogue_manifest.json', JSON.stringify(sortedLines, null, 2));

      // Generate and download ZIP
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audio-export-${episode.title.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Exported ${sortedLines.length} dialogue lines`);
    } catch (error) {
      console.error('Audio export failed:', error);
      toast.error('Failed to export audio data');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center gap-3 overflow-x-auto border-b border-gray-200/50 bg-white/85 px-4 py-2.5 backdrop-blur-xl dark:border-white/5 dark:bg-[#111111]/95">
          <div className="flex min-w-max items-center gap-3">
            {/* Tab Switcher */}
            <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-black/40">
              <button
                onClick={() => setActiveTab('dialogue')}
                className={`rounded-md px-3 py-1 text-xs font-semibold whitespace-nowrap transition-all ${
                  activeTab === 'dialogue'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-[#3B82F6] dark:text-white dark:shadow-[0_0_10px_rgba(59,130,246,0.25)]'
                    : 'text-gray-500 hover:text-gray-800 dark:text-[#A3A3A3] dark:hover:text-white'
                }`}
              >
                Dialogue{' '}
                <span className="ml-1 font-normal text-gray-400">
                  {stats.total}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('music')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  activeTab === 'music'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-[#3B82F6] dark:text-white dark:shadow-[0_0_10px_rgba(59,130,246,0.25)]'
                    : 'text-gray-500 hover:text-gray-800 dark:text-[#A3A3A3] dark:hover:text-white'
                }`}
              >
                Music{' '}
                <span className="ml-1 font-normal text-gray-400">
                  {musicStats.total}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('sfx')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  activeTab === 'sfx'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-[#3B82F6] dark:text-white dark:shadow-[0_0_10px_rgba(59,130,246,0.25)]'
                    : 'text-gray-500 hover:text-gray-800 dark:text-[#A3A3A3] dark:hover:text-white'
                }`}
              >
                SFX{' '}
                <span className="ml-1 font-normal text-gray-400">
                  {sfxStats.total}
                </span>
              </button>
            </div>

            {/* Language Selector (for Dialogue tab) */}
            {activeTab === 'dialogue' && (
              <>
                <div className="h-5 w-px shrink-0 bg-gray-200 dark:bg-gray-700" />
                <LanguageTabBar
                  episodeId={episode.id}
                  availableLanguages={availableLanguages}
                  selectedLanguage={selectedLanguage}
                  onLanguageChange={setSelectedLanguage}
                  onLanguageAdded={refreshAll}
                />
              </>
            )}

            <div className="h-5 w-px shrink-0 bg-gray-200 dark:bg-gray-700" />

            {/* Status badges - context-aware per tab */}
            <div className="flex items-center gap-1.5">
              <span className="rounded-md border border-green-100 bg-green-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
                {activeTab === 'dialogue'
                  ? stats.completed
                  : activeTab === 'music'
                    ? musicStats.completed
                    : sfxStats.completed}
              </span>
              <span className="rounded-md border border-orange-100 bg-orange-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-400">
                {activeTab === 'dialogue'
                  ? stats.pending
                  : activeTab === 'music'
                    ? musicStats.pending
                    : sfxStats.pending}
              </span>
            </div>

            <div className="h-5 w-px shrink-0 bg-gray-200 dark:bg-gray-700" />

            {/* Zoom Controls - compact */}
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={zoomOut}
                className="h-6 w-6 p-0"
                title="Zoom out"
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-10 text-center text-[10px] text-gray-500 dark:text-gray-400">
                {pixelsPerSecond}px/s
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={zoomIn}
                className="h-6 w-6 p-0"
                title="Zoom in"
              >
                <Plus className="h-3 w-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={fitToWindow}
                className="ml-0.5 h-6 px-1.5 text-[10px]"
              >
                Fit
              </Button>
            </div>
          </div>

          {/* Spacer to push action buttons right */}
          <div className="min-w-4 flex-1" />

          <div className="flex shrink-0 items-center gap-2">
            {activeTab === 'dialogue' && (
              <Button
                variant="outline"
                onClick={handleClearAllVoices}
                disabled={isPending || isGenerating || stats.completed === 0}
                size="sm"
                className="gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 dark:hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
                Clear All Voices
              </Button>
            )}

            {activeTab === 'dialogue' &&
              (isGenerating ? (
                <Button
                  onClick={handleCancelBatch}
                  disabled={isPending}
                  size="sm"
                  variant="outline"
                  className="gap-2 border-orange-200 text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-950"
                >
                  <Square className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              ) : (
                <Button
                  onClick={handleGenerateAll}
                  disabled={
                    isPending ||
                    stats.pending + stats.generating + stats.failed === 0
                  }
                  size="sm"
                  className="gap-2 bg-gray-900 text-white shadow-sm hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
                >
                  <Play className="h-4 w-4" />
                  Generate All Pending
                </Button>
              ))}

            {activeTab === 'music' && (
              <>
                {hasNoCues && (
                  <Button
                    onClick={handleGenerateAudioCues}
                    disabled={isPending || isGeneratingCues}
                    size="sm"
                    className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-sm hover:from-violet-700 hover:to-purple-700"
                  >
                    {isGeneratingCues ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating Cues…
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-4 w-4" />
                        Generate Audio Cues
                      </>
                    )}
                  </Button>
                )}
                <Button
                  onClick={() => musicTimelineRef.current?.generateAll()}
                  disabled={musicStats.pending === 0}
                  size="sm"
                  className="gap-2 bg-gray-900 text-white shadow-sm hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
                >
                  <Play className="h-4 w-4" />
                  Generate All Pending ({musicStats.pending})
                </Button>
              </>
            )}

            {activeTab === 'sfx' && (
              <>
                {hasNoCues && (
                  <Button
                    onClick={handleGenerateAudioCues}
                    disabled={isPending || isGeneratingCues}
                    size="sm"
                    className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-sm hover:from-violet-700 hover:to-purple-700"
                  >
                    {isGeneratingCues ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating Cues…
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-4 w-4" />
                        Generate Audio Cues
                      </>
                    )}
                  </Button>
                )}
                <Button
                  onClick={() => sfxTimelineRef.current?.generateAll()}
                  disabled={sfxStats.pending === 0}
                  size="sm"
                  className="gap-2 bg-gray-900 text-white shadow-sm hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
                >
                  <Play className="h-4 w-4" />
                  Generate All Pending ({sfxStats.pending})
                </Button>
              </>
            )}

            <Button
              variant="default"
              size="sm"
              onClick={handleExport}
              className="gap-2 bg-blue-600 text-white shadow-sm hover:bg-blue-700"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        {/* Batch Generation Progress Bar */}
        {batchStatus && (
          <div className="border-b border-gray-200/50 bg-gradient-to-r from-blue-50/80 to-indigo-50/80 px-4 py-2.5 backdrop-blur-xl dark:border-white/5 dark:from-blue-950/30 dark:to-indigo-950/30">
            <div className="flex items-center gap-3">
              {/* Status icon */}
              {isGenerating ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
              ) : batchStatus.status === 'completed' ? (
                <CheckCircle className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
              ) : batchStatus.status === 'completed_with_errors' ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
              ) : batchStatus.status === 'failed' ? (
                <XCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              ) : batchStatus.status === 'cancelled' ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
              ) : null}

              {/* Progress text */}
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {isGenerating
                  ? `Generating voices... ${batchStatus.completed}/${batchStatus.total}`
                  : batchStatus.status === 'completed'
                    ? `✓ All ${batchStatus.completed} voice(s) generated`
                    : batchStatus.status === 'completed_with_errors'
                      ? `⚠ ${batchStatus.completed} generated, ${batchStatus.failed} failed`
                      : batchStatus.status === 'failed'
                        ? `✗ Failed: ${batchStatus.completed} completed, ${batchStatus.failed} failed`
                        : batchStatus.status === 'cancelled'
                          ? `Cancelled: ${batchStatus.completed} completed`
                          : `${batchStatus.status}`}
                {batchStatus.failed > 0 && isGenerating && (
                  <span className="ml-1 text-red-600 dark:text-red-400">
                    ({batchStatus.failed} failed)
                  </span>
                )}
              </span>

              {/* Progress bar */}
              <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div className="flex h-full">
                  <div
                    className="h-full rounded-l-full bg-green-500 transition-all duration-500 dark:bg-green-400"
                    style={{
                      width: `${batchStatus.total > 0 ? (batchStatus.completed / batchStatus.total) * 100 : 0}%`,
                    }}
                  />
                  {batchStatus.failed > 0 && (
                    <div
                      className="h-full bg-red-500 transition-all duration-500 dark:bg-red-400"
                      style={{
                        width: `${(batchStatus.failed / batchStatus.total) * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Percentage */}
              <span className="text-xs font-semibold text-gray-600 tabular-nums dark:text-gray-400">
                {batchStatus.percentage}%
              </span>

              {/* Dismiss button (when not generating) */}
              {!isGenerating && (
                <button
                  onClick={() => {
                    setBatchStatus(null);
                    setBatchJobId(null);
                  }}
                  className="ml-1 rounded-md p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  title="Dismiss"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Timeline Content */}
        <div ref={timelineContainerRef} className="flex-1 overflow-hidden">
          {activeTab === 'dialogue' && (
            <DialogueTimeline
              dialogueLines={dialogueLines}
              characters={characters}
              isLoading={isLoading}
              onRefresh={refreshAll}
              pixelsPerSecond={pixelsPerSecond}
              audioSettings={audioSettings}
            />
          )}

          {activeTab === 'music' && (
            <MusicTimeline
              ref={musicTimelineRef}
              episodeId={episode.id}
              totalDuration={totalDuration}
              scenes={scenes}
              onRefresh={refreshAll}
              pixelsPerSecond={pixelsPerSecond}
              audioSettings={audioSettings}
              onStatsChange={setMusicStats}
              initialTracks={initialAudioTracks}
              initialCues={initialAudioCues}
            />
          )}

          {activeTab === 'sfx' && (
            <SfxTimeline
              ref={sfxTimelineRef}
              episodeId={episode.id}
              totalDuration={totalDuration}
              pixelsPerSecond={pixelsPerSecond}
              onRefresh={refreshAll}
              audioSettings={audioSettings}
              onStatsChange={setSfxStats}
              initialCues={initialAudioCues}
            />
          )}
        </div>
      </div>
    </div>
  );
}
