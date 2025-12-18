'use client';

import { useMemo, useState, useTransition } from 'react';

import {
  Download,
  Loader2,
  MessageSquare,
  Music,
  Play,
  Volume2,
} from 'lucide-react';

import { autoStitchAction } from '@kit/episodes/server';
import type { EpisodeWithShots, ScreenplayScene } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

import { DialogueTimeline } from './dialogue-timeline';
import { VoiceAssignmentPanel } from './voice-assignment-panel';

interface AudioStudioScreenProps {
  episode: EpisodeWithShots;
  refetchEpisode: () => void;
}

interface DialogueLine {
  character: string;
  text: string;
  parenthetical?: string;
  sceneNumber: number;
  lineIndex: number;
}

export function AudioStudioScreen({
  episode,
  refetchEpisode,
}: AudioStudioScreenProps) {
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<'dialogue' | 'music' | 'sfx'>(
    'dialogue',
  );

  // Extract all dialogue lines from screenplay
  const dialogueLines = useMemo<DialogueLine[]>(() => {
    const lines: DialogueLine[] = [];
    if (!episode.screenplayData?.scenes) return lines;

    episode.screenplayData.scenes.forEach((scene: ScreenplayScene) => {
      scene.dialogue.forEach((line, index) => {
        lines.push({
          character: line.character,
          text: line.text,
          parenthetical: line.parenthetical,
          sceneNumber: scene.number,
          lineIndex: index,
        });
      });
    });

    return lines;
  }, [episode.screenplayData]);

  // Get unique characters from dialogue
  const characters = useMemo(() => {
    const charSet = new Set<string>();
    dialogueLines.forEach((line) => charSet.add(line.character));
    return Array.from(charSet);
  }, [dialogueLines]);

  // Stats
  const stats = useMemo(() => {
    const total = dialogueLines.length;
    const generated = 0; // TODO: Track which lines have audio
    const pending = total - generated;
    return { total, generated, pending };
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
    // TODO: Implement export
  };

  return (
    <div className="flex h-full">
      {/* Left Sidebar - Voice Assignment */}
      <div className="w-72 shrink-0 border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <VoiceAssignmentPanel characters={characters} episodeId={episode.id} />
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              Audio Studio
            </h2>
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span>{stats.total} dialogue lines</span>
              <span>•</span>
              <span>{characters.length} characters</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs">
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                {stats.pending} pending
              </span>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                {stats.generated} generated
              </span>
            </div>

            <Button
              onClick={handleGenerateAll}
              disabled={isPending || stats.pending === 0}
              className="gap-2 bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700"
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

            <Button variant="outline" onClick={handleExport} className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'dialogue' | 'music' | 'sfx')}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="border-b border-gray-200 bg-gray-50 px-6 dark:border-gray-700 dark:bg-gray-900">
            <TabsList className="h-12 bg-transparent">
              <TabsTrigger
                value="dialogue"
                className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow dark:data-[state=active]:bg-gray-800"
              >
                <MessageSquare className="h-4 w-4" />
                Dialogue
              </TabsTrigger>
              <TabsTrigger
                value="music"
                className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow dark:data-[state=active]:bg-gray-800"
              >
                <Music className="h-4 w-4" />
                Music
              </TabsTrigger>
              <TabsTrigger
                value="sfx"
                className="gap-2 data-[state=active]:bg-white data-[state=active]:shadow dark:data-[state=active]:bg-gray-800"
              >
                <Volume2 className="h-4 w-4" />
                SFX
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="dialogue" className="mt-0 flex-1 overflow-hidden">
            <DialogueTimeline
              dialogueLines={dialogueLines}
              characters={characters}
            />
          </TabsContent>

          <TabsContent value="music" className="flex-1 p-6">
            <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
              <div className="text-center">
                <Music className="mx-auto mb-3 h-12 w-12 opacity-30" />
                <p>Music tracks coming soon</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="sfx" className="flex-1 p-6">
            <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
              <div className="text-center">
                <Volume2 className="mx-auto mb-3 h-12 w-12 opacity-30" />
                <p>Sound effects coming soon</p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
