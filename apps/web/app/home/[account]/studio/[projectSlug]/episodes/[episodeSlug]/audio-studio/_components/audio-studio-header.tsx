'use client';

import {
  Download,
  Loader2,
  Minus,
  Play,
  Plus,
  Square,
  Trash2,
  Wand2,
} from 'lucide-react';

import { Button } from '@kit/ui/button';

import type { LanguageTabBarProps } from './language-tab-bar';
import { LanguageTabBar } from './language-tab-bar';
import type { MusicTimelineStats } from './music-timeline';
import type { SfxTimelineStats } from './sfx-timeline';

type ActiveTab = 'dialogue' | 'music' | 'sfx';

interface DialogueStats {
  total: number;
  completed: number;
  pending: number;
  generating: number;
  failed: number;
}

interface AudioStudioHeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  dialogueStats: DialogueStats;
  musicStats: MusicTimelineStats;
  sfxStats: SfxTimelineStats;

  // Language (only shown for dialogue tab)
  languageTabBarProps: Omit<LanguageTabBarProps, 'episodeId'>;
  episodeId: string;

  // Zoom controls
  pixelsPerSecond: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToWindow: () => void;

  // Dialogue actions
  isPending: boolean;
  isGenerating: boolean;
  onClearAllVoices: () => void;
  onCancelBatch: () => void;
  onGenerateAll: () => void;

  // Music/SFX actions
  hasNoCues: boolean;
  isGeneratingCues: boolean;
  onGenerateAudioCues: () => void;
  onGenerateAllMusic: () => void;
  onGenerateAllSfx: () => void;
  musicPendingCount: number;
  sfxPendingCount: number;

  // Export
  onExport: () => void;
}

export function AudioStudioHeader({
  activeTab,
  setActiveTab,
  dialogueStats,
  musicStats,
  sfxStats,
  languageTabBarProps,
  episodeId,
  pixelsPerSecond,
  onZoomIn,
  onZoomOut,
  onFitToWindow,
  isPending,
  isGenerating,
  onClearAllVoices,
  onCancelBatch,
  onGenerateAll,
  hasNoCues,
  isGeneratingCues,
  onGenerateAudioCues,
  onGenerateAllMusic,
  onGenerateAllSfx,
  musicPendingCount,
  sfxPendingCount,
  onExport,
}: AudioStudioHeaderProps) {
  const stats =
    activeTab === 'dialogue'
      ? dialogueStats
      : activeTab === 'music'
        ? musicStats
        : sfxStats;

  return (
    <div className="flex items-center gap-3 overflow-x-auto border-b border-gray-200/50 bg-white/85 px-4 py-2.5 backdrop-blur-xl dark:border-white/5 dark:bg-[#111111]/95">
      <div className="flex min-w-max items-center gap-3">
        {/* Tab Switcher */}
        <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-black/40">
          <button
            data-test="audio-tab-dialogue"
            onClick={() => setActiveTab('dialogue')}
            className={`rounded-md px-3 py-1 text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === 'dialogue'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-[#3B82F6] dark:text-white dark:shadow-[0_0_10px_rgba(59,130,246,0.25)]'
                : 'text-gray-500 hover:text-gray-800 dark:text-[#A3A3A3] dark:hover:text-white'
            }`}
          >
            Dialogue{' '}
            <span className="ml-1 font-normal text-gray-400">
              {dialogueStats.total}
            </span>
          </button>
          <button
            data-test="audio-tab-music"
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
            data-test="audio-tab-sfx"
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
            <LanguageTabBar episodeId={episodeId} {...languageTabBarProps} />
          </>
        )}

        <div className="h-5 w-px shrink-0 bg-gray-200 dark:bg-gray-700" />

        {/* Status badges - context-aware per tab */}
        <div className="flex items-center gap-1.5">
          <span className="rounded-md border border-green-100 bg-green-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
            {stats.completed}
          </span>
          <span className="rounded-md border border-orange-100 bg-orange-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-400">
            {stats.pending}
          </span>
        </div>

        <div className="h-5 w-px shrink-0 bg-gray-200 dark:bg-gray-700" />

        {/* Zoom Controls - compact */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onZoomOut}
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
            onClick={onZoomIn}
            className="h-6 w-6 p-0"
            title="Zoom in"
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onFitToWindow}
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
            onClick={onClearAllVoices}
            disabled={
              isPending || isGenerating || dialogueStats.completed === 0
            }
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
              onClick={onCancelBatch}
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
              onClick={onGenerateAll}
              disabled={
                isPending ||
                dialogueStats.pending +
                  dialogueStats.generating +
                  dialogueStats.failed ===
                  0
              }
              size="sm"
              data-test="generate-all-dialogue"
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
                onClick={onGenerateAudioCues}
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
              onClick={onGenerateAllMusic}
              disabled={musicPendingCount === 0}
              size="sm"
              className="gap-2 bg-gray-900 text-white shadow-sm hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
            >
              <Play className="h-4 w-4" />
              Generate All Pending ({musicPendingCount})
            </Button>
          </>
        )}

        {activeTab === 'sfx' && (
          <>
            {hasNoCues && (
              <Button
                onClick={onGenerateAudioCues}
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
              onClick={onGenerateAllSfx}
              disabled={sfxPendingCount === 0}
              size="sm"
              className="gap-2 bg-gray-900 text-white shadow-sm hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
            >
              <Play className="h-4 w-4" />
              Generate All Pending ({sfxPendingCount})
            </Button>
          </>
        )}

        <Button
          variant="default"
          size="sm"
          onClick={onExport}
          className="gap-2 bg-blue-600 text-white shadow-sm hover:bg-blue-700"
        >
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>
    </div>
  );
}

export type { ActiveTab };
