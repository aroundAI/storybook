'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  BookOpen,
  Check,
  Film,
  Lightbulb,
  ListOrdered,
  Music,
  Scissors,
  Share2,
} from 'lucide-react';

import {
  type StageKey,
  type StageView,
  deriveStageViews,
} from '@kit/episodes/lib/stage-state';
import type { EpisodeWithShots } from '@kit/episodes/types';
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
    id: 'publish',
    label: 'Publish',
    icon: Share2,
    path: 'publish',
    studioMode: 'post',
  },
  {
    id: 'edit',
    label: 'Edit record',
    icon: Scissors,
    path: 'edit',
    studioMode: 'post',
  },
];

/**
 * The studio stage each tab shows a state for. Audio has none here: the
 * workspace does not load the audio cue count, and a guessed "not started"
 * would be wrong. The Edit record tab is not a stage.
 */
const TAB_STAGE: Partial<Record<string, StageKey>> = {
  ideation: 'ideation',
  story: 'story',
  screenplay: 'screenplay',
  'shot-list': 'shots',
  publish: 'publish',
};

/**
 * Each tab's stage state (FILM-2202). No tab is locked: a stage is reachable
 * whatever came before it, and an empty one says what it needs.
 */
function stageStates(episode: EpisodeWithShots): Map<StageKey, StageView> {
  const views = deriveStageViews({
    status: episode.status,
    storyData: episode.storyData,
    screenplayData: episode.screenplayData,
    shotList: episode.shotList,
    shotCount: episode.shots?.length ?? 0,
    audioCueCount: 0, // not loaded here; the audio tab shows no state
    finalVideoUrl: episode.finalVideoUrl,
    localizedVideoCount: Object.keys(episode.localizedVideos ?? {}).length,
    skippedStages: episode.skippedStages,
  });

  return new Map(views.map((view) => [view.key, view]));
}

const STATE_LABEL: Record<StageView['state'], string> = {
  done: 'Done',
  empty: 'Not started',
  skipped: 'Skipped',
};

export function EpisodeWorkspaceTabs() {
  const pathname = usePathname() ?? '';
  const { episode, accountSlug, projectSlug } = useEpisodeContext();

  const states = stageStates(episode);

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
    if (pathname.endsWith('/publish')) return 'publish';
    if (pathname.endsWith('/edit')) return 'edit';
    return 'ideation';
  };

  const activeTab = getActiveTab();

  const renderTab = (tab: TabConfig) => {
    const isActive = activeTab === tab.id;
    const stage = TAB_STAGE[tab.id];
    const view = stage ? states.get(stage) : undefined;
    const TabIcon = tab.icon;

    return (
      <Link
        key={tab.id}
        href={`${basePath}/${tab.path}`}
        data-test={`episode-tab-${tab.id}`}
        data-stage-state={view?.state}
        title={view ? `${tab.label}: ${STATE_LABEL[view.state]}` : tab.label}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none',
          isActive
            ? 'bg-white text-blue-600 shadow-sm dark:bg-[#3B82F6] dark:text-white dark:shadow-[0_0_12px_rgba(59,130,246,0.30)]'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-700 dark:text-[#A3A3A3] dark:hover:bg-[#1A1A1A] dark:hover:text-white',
        )}
      >
        <TabIcon className="h-3.5 w-3.5" />
        <span
          className={cn(view?.state === 'skipped' && 'line-through opacity-60')}
        >
          {tab.label}
        </span>
        {view?.state === 'done' ? (
          <Check
            aria-label="Done"
            className="h-3 w-3 text-emerald-600 dark:text-emerald-400"
          />
        ) : null}
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
