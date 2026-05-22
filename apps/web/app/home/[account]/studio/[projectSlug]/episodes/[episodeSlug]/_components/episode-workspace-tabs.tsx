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
  Scissors,
  Share2,
} from 'lucide-react';

import { cn } from '@kit/ui/utils';

import { useEpisodeContext } from './episode-context-provider';

interface TabConfig {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  studioMode: 'story' | 'post';
}

const STORY_TABS: TabConfig[] = [
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
  {
    id: 'audio',
    label: 'Audio',
    icon: Music,
    path: 'audio-studio',
    studioMode: 'story',
  },
];

const POST_TABS: TabConfig[] = [
  {
    id: 'edit-suite',
    label: 'Edit Suite',
    icon: Scissors,
    path: 'edit-suite',
    studioMode: 'post',
  },
  {
    id: 'publish',
    label: 'Publish',
    icon: Share2,
    path: 'publish',
    studioMode: 'post',
  },
];

function getTabUnlockState(
  episode: {
    storyData: unknown;
    screenplayData: unknown;
    shotList: unknown;
    status: string;
    finalVideoUrl: string | null;
  },
  _hasCompletedShots: boolean,
): Record<string, boolean> {
  const hasStoryData = episode.storyData !== null;
  const hasScreenplayData = episode.screenplayData !== null;
  const hasShotList = episode.shotList !== null;

  return {
    ideation: true, // Always accessible
    story: true, // Always accessible (can view even without data)
    screenplay: hasStoryData, // Unlocked when story exists
    'shot-list': hasScreenplayData, // Unlocked when screenplay exists
    audio: hasShotList, // Unlocked when shot list exists
    'edit-suite': hasShotList, // Unlocked when shot list exists
    publish: hasShotList, // Unlocked when shot list exists (user can upload video directly)
  };
}

export function EpisodeWorkspaceTabs() {
  const pathname = usePathname() ?? '';
  const { episode, accountSlug, projectSlug } = useEpisodeContext();

  // Check if any shots have completed videos
  const hasCompletedShots = episode.shots?.some(
    (shot) => shot.status === 'completed' && shot.videoUrl,
  );

  const tabUnlockState = getTabUnlockState(episode, hasCompletedShots ?? false);

  // Get base path for episode using slugs
  const episodeSlug = episode.slug ?? episode.id;
  const basePath = `/home/${accountSlug}/studio/${projectSlug}/episodes/${episodeSlug}`;

  // Determine active tab from pathname (using endsWith for exact path matching)
  const getActiveTab = () => {
    if (pathname.endsWith('/ideation')) return 'ideation';
    if (pathname.endsWith('/story')) return 'story';
    if (pathname.endsWith('/screenplay')) return 'screenplay';
    if (pathname.endsWith('/visual-studio')) return 'shot-list';
    if (pathname.endsWith('/audio-studio')) return 'audio';
    if (pathname.endsWith('/edit-suite')) return 'edit-suite';
    if (pathname.endsWith('/publish')) return 'publish';
    return 'ideation';
  };

  const activeTab = getActiveTab();

  const renderTab = (tab: TabConfig) => {
    const isActive = activeTab === tab.id;
    const isUnlocked = tabUnlockState[tab.id];
    const TabIcon = tab.icon;

    if (!isUnlocked) {
      return (
        <div
          key={tab.id}
          className="flex flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500"
          title={`Complete previous steps to unlock ${tab.label}`}
        >
          <Lock className="h-3.5 w-3.5" />
          <span>{tab.label}</span>
        </div>
      );
    }

    return (
      <Link
        key={tab.id}
        href={`${basePath}/${tab.path}`}
        className={cn(
          'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200',
          isActive
            ? 'bg-white text-blue-600 shadow-sm dark:bg-[#3B82F6] dark:text-white dark:shadow-[0_0_12px_rgba(59,130,246,0.30)]'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-[#A3A3A3] dark:hover:bg-[#1A1A1A] dark:hover:text-white',
        )}
      >
        <TabIcon className="h-3.5 w-3.5" />
        <span>{tab.label}</span>
      </Link>
    );
  };

  return (
    <div className="sticky top-[88px] z-10 px-6 py-2">
      <div className="flex items-center gap-4">
        {/* Story Studio Tabs */}
        <div className="flex flex-1 items-center rounded-xl bg-gray-100/80 p-1 dark:border dark:border-white/5 dark:bg-[#111111]">
          {STORY_TABS.map(renderTab)}
        </div>

        {/* Separator */}
        <div className="h-8 w-px bg-gray-300 dark:bg-white/10" />

        {/* Post-Production Tabs */}
        <div className="flex items-center rounded-xl bg-gray-100/80 p-1 dark:border dark:border-white/5 dark:bg-[#111111]">
          {POST_TABS.map(renderTab)}
        </div>
      </div>
    </div>
  );
}
