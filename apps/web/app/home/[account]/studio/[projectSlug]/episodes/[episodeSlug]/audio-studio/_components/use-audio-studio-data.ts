'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  CharacterAsset,
  DialogueLine,
  ProjectAudioSettings,
} from '@kit/audio-generation/lib';
import type { AudioTrack } from '@kit/audio-generation/lib';
import {
  generateAudioCuesAction,
  getAudioStudioBulkDataAction,
  getDialogueLinesAction,
} from '@kit/audio-generation/server';
import type { AudioStudioBulkData } from '@kit/audio-generation/server';
import type { EpisodeWithShots } from '@kit/episodes/types';
import { useLlmJob } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';

import type { SupportedLanguage } from './language-tab-bar';
import type { MusicTimelineStats } from './music-timeline';
import type { SfxTimelineStats } from './sfx-timeline';

const PREFERRED_LANGUAGE_ORDER = ['en', 'hi', 'es', 'pt'];

export interface AudioStudioData {
  // Core data
  dialogueLines: DialogueLine[];
  characters: CharacterAsset[];
  audioSettings: ProjectAudioSettings | null;
  isLoading: boolean;

  // Language
  selectedLanguage: SupportedLanguage;
  setSelectedLanguage: (lang: SupportedLanguage) => void;
  availableLanguages: SupportedLanguage[];

  // Pre-loaded audio tracks and cues for music/sfx timelines
  initialAudioTracks: AudioTrack[] | null;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  initialAudioCues: Array<Record<string, any>> | null;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Audio cue generation
  isGeneratingCues: boolean;
  handleGenerateAudioCues: () => void;

  // Stats
  dialogueStats: {
    total: number;
    completed: number;
    pending: number;
    generating: number;
    failed: number;
  };
  musicStats: MusicTimelineStats;
  setMusicStats: (stats: MusicTimelineStats) => void;
  sfxStats: SfxTimelineStats;
  setSfxStats: (stats: SfxTimelineStats) => void;

  // Scenes & duration
  scenes: Array<{
    number: number;
    heading: string;
    estimatedDuration: number;
  }>;
  totalDuration: number;

  // Refresh
  refreshAll: () => Promise<void>;
  fetchDialogueForLanguage: (
    lang: SupportedLanguage,
    skipCache?: boolean,
  ) => Promise<void>;
}

export function useAudioStudioData(
  episode: EpisodeWithShots,
  refetchEpisode: () => void,
  isPending: boolean,
  startTransition: (callback: () => void) => void,
): AudioStudioData {
  // State for real dialogue data
  const [dialogueLines, setDialogueLines] = useState<DialogueLine[]>([]);
  const [characters, setCharacters] = useState<CharacterAsset[]>([]);
  const [audioSettings, setAudioSettings] =
    useState<ProjectAudioSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Language selection state
  const [selectedLanguage, setSelectedLanguage] =
    useState<SupportedLanguage>('en');
  const [availableLanguages, setAvailableLanguages] = useState<
    SupportedLanguage[]
  >(['en']);

  // Client-side dialogue cache: avoids re-fetching when switching back to a language
  const dialogueCache = useRef<Map<string, DialogueLine[]>>(new Map());

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

  // Stats from real data
  const dialogueStats = useMemo(() => {
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

  // Audio cue generation handler
  const handleGenerateAudioCues = useCallback(() => {
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
  }, [episode.id, startTransition]);

  return {
    dialogueLines,
    characters,
    audioSettings,
    isLoading,
    selectedLanguage,
    setSelectedLanguage,
    availableLanguages,
    initialAudioTracks,
    initialAudioCues,
    isGeneratingCues,
    handleGenerateAudioCues,
    dialogueStats,
    musicStats,
    setMusicStats,
    sfxStats,
    setSfxStats,
    scenes,
    totalDuration,
    refreshAll,
    fetchDialogueForLanguage,
  };
}
