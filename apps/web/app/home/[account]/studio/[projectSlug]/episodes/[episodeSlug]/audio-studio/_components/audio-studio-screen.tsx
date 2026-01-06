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
  Download,
  Loader2,
  Minus,
  Play,
  Plus,
  Volume2,
} from 'lucide-react';

import type { CharacterAsset, DialogueLine } from '@kit/audio-generation/lib';
import {
  getCharactersForEpisodeAction,
  getDialogueLinesAction,
} from '@kit/audio-generation/server';
import { autoStitchAction } from '@kit/episodes/server';
import type { EpisodeWithShots } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';

import { DialogueTimeline } from './dialogue-timeline';
import {
  LanguageTabBar,
  type SupportedLanguage,
} from './language-tab-bar';
import { MusicTimeline } from './music-timeline';

interface AudioStudioScreenProps {
  episode: EpisodeWithShots;
  refetchEpisode: () => void;
}

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
  const [isLoading, setIsLoading] = useState(true);

  // Language selection state
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('en');
  const [availableLanguages, setAvailableLanguages] = useState<SupportedLanguage[]>(['en']);

  // Timeline zoom state (pixels per second)
  const [pixelsPerSecond, setPixelsPerSecond] = useState(2);
  const timelineContainerRef = useRef<HTMLDivElement>(null);

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

  // Fetch dialogue lines and characters on mount
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [dialogueResult, chars] = await Promise.all([
        getDialogueLinesAction({ episodeId: episode.id }),
        getCharactersForEpisodeAction({ episodeId: episode.id }),
      ]);

      const allLines = Array.isArray(dialogueResult?.lines) ? dialogueResult.lines : [];

      // Extract available languages from dialogue lines
      const langs = new Set<SupportedLanguage>(
        allLines.map((l) => (l.language || 'en') as SupportedLanguage)
      );
      const langArray = Array.from(langs).sort((a, b) => {
        const order = ['en', 'hi', 'es', 'pt'];
        return order.indexOf(a) - order.indexOf(b);
      });
      setAvailableLanguages(langArray.length > 0 ? langArray : ['en']);

      // Filter dialogue by selected language
      const filteredLines = allLines.filter(
        (l) => (l.language || 'en') === selectedLanguage
      );
      setDialogueLines(filteredLines);
      setCharacters(Array.isArray(chars) ? chars : []);
    } catch (error) {
      console.error('Failed to fetch audio studio data:', error);
      toast.error('Failed to load dialogue data');
      // Reset to empty arrays on error
      setDialogueLines([]);
      setCharacters([]);
    } finally {
      setIsLoading(false);
    }
  }, [episode.id, selectedLanguage]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

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

  const handleGenerateAll = () => {
    startTransition(async () => {
      try {
        const result = await autoStitchAction({
          episodeId: episode.id,
          mode: 'audio-only',
          gapFillStrategy: 'ignore',
        });

        if (result.success) {
          toast.success('Audio generation started');
          refetchEpisode();
          void fetchData(); // Refresh dialogue data
        } else {
          toast.error(result.error ?? 'Failed to generate audio');
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to generate audio',
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
  const formatSrtTime = (seconds: number): string => {
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
  const [isExporting, setIsExporting] = useState(false);

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

      // SRT Content Builder
      let srtContent = '';
      let srtIndex = 1;

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
          const characterName = characters.find(c => c.id === line.characterAssetId)?.name ?? 'Unknown';
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
      const scriptContent = sortedLines.map(l => {
        const charName = characters.find(c => c.id === l.characterAssetId)?.name ?? 'Unknown';
        return `${charName}: ${l.text}`;
      }).join('\n\n');

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
        <div className="flex items-center gap-3 border-b border-gray-200/50 bg-white/85 px-4 py-2.5 backdrop-blur-xl dark:border-gray-700/50 dark:bg-gray-800/85 overflow-x-auto">
          <div className="flex items-center gap-3 min-w-max">
            {/* Tab Switcher */}
            <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-black/40">
              <button
                onClick={() => setActiveTab('dialogue')}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-all whitespace-nowrap ${activeTab === 'dialogue'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
              >
                Dialogue{' '}
                <span className="ml-1 font-normal text-gray-400">
                  {stats.total}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('music')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${activeTab === 'music'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
              >
                Music
              </button>
              <button
                onClick={() => setActiveTab('sfx')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${activeTab === 'sfx'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
              >
                SFX
              </button>
            </div>

            {/* Language Selector (for Dialogue tab) */}
            {activeTab === 'dialogue' && (
              <>
                <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 shrink-0" />
                <LanguageTabBar
                  episodeId={episode.id}
                  availableLanguages={availableLanguages}
                  selectedLanguage={selectedLanguage}
                  onLanguageChange={setSelectedLanguage}
                  onLanguageAdded={fetchData}
                />
              </>
            )}

            <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 shrink-0" />

            {/* Status badges - compact */}
            <div className="flex items-center gap-1.5">
              <span className="rounded-md border border-green-100 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400 whitespace-nowrap">
                {stats.completed}
              </span>
              <span className="rounded-md border border-orange-100 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-400 whitespace-nowrap">
                {stats.pending}
              </span>
            </div>

            <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 shrink-0" />

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
          <div className="flex-1 min-w-4" />

          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={handleGenerateAll}
              disabled={isPending || stats.pending === 0}
              size="sm"
              className="gap-2 bg-gray-900 text-white shadow-sm hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Generate All Pending
                </>
              )}
            </Button>

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

        {/* Timeline Content */}
        <div ref={timelineContainerRef} className="flex-1 overflow-hidden">
          {activeTab === 'dialogue' && (
            <DialogueTimeline
              dialogueLines={dialogueLines}
              characters={characters}
              isLoading={isLoading}
              onRefresh={fetchData}
              pixelsPerSecond={pixelsPerSecond}
            />
          )}

          {activeTab === 'music' && (
            <MusicTimeline
              episodeId={episode.id}
              totalDuration={totalDuration}
              scenes={scenes}
              onRefresh={fetchData}
              pixelsPerSecond={pixelsPerSecond}
            />
          )}

          {activeTab === 'sfx' && (
            <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
              <div className="text-center">
                <Volume2 className="mx-auto mb-3 h-12 w-12 opacity-30" />
                <p>Sound effects coming soon</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
