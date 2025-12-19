'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';

import {
  Download,
  Loader2,
  Music,
  Play,
  Settings,
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
import { VoiceAssignmentPanel } from './voice-assignment-panel';

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

  // Fetch dialogue lines and characters on mount
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [dialogueResult, chars] = await Promise.all([
        getDialogueLinesAction({ episodeId: episode.id }),
        getCharactersForEpisodeAction({ episodeId: episode.id }),
      ]);
      // Defensive: ensure we always set arrays
      setDialogueLines(
        Array.isArray(dialogueResult?.lines) ? dialogueResult.lines : [],
      );
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
  }, [episode.id]);

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

  const handleExport = () => {
    toast.info('Export functionality coming soon');
  };

  return (
    <div className="flex h-full">
      {/* Left Sidebar - Voice Assignment */}
      <div className="w-[280px] shrink-0 border-r border-gray-200 bg-white dark:border-gray-700/50 dark:bg-gray-900/50">
        <VoiceAssignmentPanel
          characters={characters}
          episodeId={episode.id}
          isLoading={isLoading}
        />
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-gray-200/50 bg-white/85 px-6 py-3 backdrop-blur-xl dark:border-gray-700/50 dark:bg-gray-800/85">
          <div className="flex items-center gap-4">
            {/* Tab Switcher */}
            <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-black/40">
              <button
                onClick={() => setActiveTab('dialogue')}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
                  activeTab === 'dialogue'
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
                className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all ${
                  activeTab === 'music'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                Music
              </button>
              <button
                onClick={() => setActiveTab('sfx')}
                className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all ${
                  activeTab === 'sfx'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                SFX
              </button>
            </div>

            <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" />

            {/* Status badges */}
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-green-100 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
                {stats.completed} completed
              </span>
              <span className="rounded-md border border-orange-100 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-400">
                {stats.pending} pending
              </span>
              {stats.generating > 0 && (
                <span className="rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">
                  {stats.generating} generating
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300"
            >
              <Settings className="h-4 w-4" />
              Settings
            </Button>

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
        <div className="flex-1 overflow-hidden">
          {activeTab === 'dialogue' && (
            <DialogueTimeline
              dialogueLines={dialogueLines}
              characters={characters}
              isLoading={isLoading}
              onRefresh={fetchData}
            />
          )}

          {activeTab === 'music' && (
            <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
              <div className="text-center">
                <Music className="mx-auto mb-3 h-12 w-12 opacity-30" />
                <p>Music tracks coming soon</p>
              </div>
            </div>
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
