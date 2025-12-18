'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  BookOpen,
  Film,
  Lightbulb,
  ListOrdered,
  Lock,
  Music,
} from 'lucide-react';

import { cn } from '@kit/ui/utils';

import { useEpisodeContext } from './episode-context-provider';

interface TabConfig {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  studioMode: 'story' | 'audio';
}

const TABS: TabConfig[] = [
  {
    id: 'ideation',
    label: 'Ideation',
    icon: Lightbulb,
    path: 'ideation',
    studioMode: 'story',
  },
  {
    id: 'story',
    label: 'Story',
    icon: BookOpen,
    path: 'story',
    studioMode: 'story',
  },
  {
    id: 'screenplay',
    label: 'Screenplay',
    icon: Film,
    path: 'screenplay',
    studioMode: 'story',
  },
  {
    id: 'shot-list',
    label: 'Shot List',
    icon: ListOrdered,
    path: 'visual-studio',
    studioMode: 'story',
  },
];

const AUDIO_TAB: TabConfig = {
  id: 'audio',
  label: 'Audio Studio',
  icon: Music,
  path: 'audio-studio',
  studioMode: 'audio',
};

function getTabUnlockState(episode: {
  storyData: unknown;
  screenplayData: unknown;
  shotList: unknown;
  status: string;
}): Record<string, boolean> {
  const hasStoryData = episode.storyData !== null;
  const hasScreenplayData = episode.screenplayData !== null;
  const hasShotList = episode.shotList !== null;

  return {
    ideation: true, // Always accessible
    story: true, // Always accessible (can view even without data)
    screenplay: hasStoryData, // Unlocked when story exists
    'shot-list': hasScreenplayData, // Unlocked when screenplay exists
    audio: hasShotList, // Unlocked when shot list exists
  };
}

export function EpisodeWorkspaceTabs() {
  const pathname = usePathname();
  const { episode, accountSlug, projectId } = useEpisodeContext();

  const tabUnlockState = getTabUnlockState(episode);

  // Determine which studio mode we're in
  const isAudioStudio = pathname.includes('/audio-studio');

  // Get base path for episode
  const basePath = `/home/${accountSlug}/studio/${projectId}/episodes/${episode.id}`;

  // Determine active tab from pathname (using endsWith for exact path matching)
  const getActiveTab = () => {
    if (pathname.endsWith('/ideation')) return 'ideation';
    if (pathname.endsWith('/story')) return 'story';
    if (pathname.endsWith('/screenplay')) return 'screenplay';
    if (pathname.endsWith('/visual-studio')) return 'shot-list';
    if (pathname.endsWith('/audio-studio')) return 'audio';
    return 'ideation';
  };

  const activeTab = getActiveTab();

  // Show Story Studio tabs or Audio Studio
  const tabsToShow = isAudioStudio ? [AUDIO_TAB] : TABS;

  return (
    <div className="sticky top-[140px] z-10 px-8 py-4">
      <div className="flex items-center rounded-2xl bg-gray-100/80 p-1.5 dark:bg-gray-800/50">
        {tabsToShow.map((tab) => {
          const isActive = activeTab === tab.id;
          const isUnlocked = tabUnlockState[tab.id];
          const TabIcon = tab.icon;

          if (!isUnlocked) {
            return (
              <div
                key={tab.id}
                className="flex flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-gray-400 dark:text-gray-500"
                title={`Complete previous steps to unlock ${tab.label}`}
              >
                <Lock className="h-4 w-4" />
                <span>{tab.label}</span>
              </div>
            );
          }

          return (
            <Link
              key={tab.id}
              href={`${basePath}/${tab.path}`}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all',
                isActive
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-400'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-gray-200',
              )}
            >
              <TabIcon className="h-4 w-4" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
