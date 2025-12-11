'use client';

import { useCallback, useMemo } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { BookOpen, Film, Lock, Music, Scissors } from 'lucide-react';

import { StoryStudio } from '@kit/episodes/components';
import type { EpisodeWithShots } from '@kit/episodes/types';
import { Card, CardContent } from '@kit/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { cn } from '@kit/ui/utils';

type WorkspaceTab = 'story' | 'visuals' | 'audio' | 'edit';

interface WorkspaceTabsProps {
  episode: EpisodeWithShots;
  projectId: string;
  defaultTab?: WorkspaceTab;
}

const WORKSPACE_TABS: Array<{
  id: WorkspaceTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    id: 'story',
    label: 'Story Studio',
    icon: BookOpen,
    description: 'Create and refine your story',
  },
  {
    id: 'visuals',
    label: 'Visual Studio',
    icon: Film,
    description: 'Generate video content',
  },
  {
    id: 'audio',
    label: 'Audio Studio',
    icon: Music,
    description: 'Voice and music generation',
  },
  {
    id: 'edit',
    label: 'Edit Suite',
    icon: Scissors,
    description: 'Timeline editing',
  },
];

function getTabUnlockState(
  episode: EpisodeWithShots,
): Record<WorkspaceTab, boolean> {
  return {
    story: true, // Always accessible
    visuals: episode.status !== 'draft', // Unlocked when status !== 'draft'
    audio: episode.shotList !== null, // Unlocked when shotList exists
    edit: ['editing', 'ready', 'published'].includes(episode.status), // Unlocked for editing/ready/published
  };
}

function isValidWorkspaceTab(tab: string | null): tab is WorkspaceTab {
  return tab !== null && ['story', 'visuals', 'audio', 'edit'].includes(tab);
}

function ComingSoonPlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: number;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16">
        <div className="bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
          <Film className="text-muted-foreground h-8 w-8" />
        </div>
        <h3 className="mb-2 text-lg font-semibold">{title}</h3>
        <p className="text-muted-foreground mb-2 max-w-sm text-center text-sm">
          {description}
        </p>
        <p className="text-muted-foreground text-xs">
          Phase {phase} - Coming Soon
        </p>
      </CardContent>
    </Card>
  );
}

function LockedTabContent({ tabId }: { tabId: WorkspaceTab }) {
  const tabInfo: Record<WorkspaceTab, { title: string; description: string }> =
    {
      story: {
        title: 'Story Studio',
        description: 'Start creating your story',
      },
      visuals: {
        title: 'Visual Studio Locked',
        description: 'Complete the story creation to unlock video generation',
      },
      audio: {
        title: 'Audio Studio Locked',
        description: 'Generate a shot list to unlock audio generation',
      },
      edit: {
        title: 'Edit Suite Locked',
        description: 'Generate visuals and audio to unlock the timeline editor',
      },
    };

  const { title, description } = tabInfo[tabId];

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16">
        <Lock className="text-muted-foreground mb-4 h-12 w-12" />
        <h3 className="mb-2 text-lg font-semibold">{title}</h3>
        <p className="text-muted-foreground max-w-sm text-center text-sm">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

export function WorkspaceTabs({
  episode,
  projectId,
  defaultTab = 'story',
}: WorkspaceTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabUnlockState = useMemo(() => getTabUnlockState(episode), [episode]);

  const activeTab = useMemo(() => {
    const urlTab = searchParams.get('tab');
    return isValidWorkspaceTab(urlTab) ? urlTab : defaultTab;
  }, [searchParams, defaultTab]);

  const setActiveTab = useCallback(
    (newTab: string) => {
      const tab = newTab as WorkspaceTab;
      if (!tabUnlockState[tab]) return;

      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tab);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, tabUnlockState],
  );

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
      <TabsList className="grid w-full grid-cols-4">
        {WORKSPACE_TABS.map((tab) => {
          const isUnlocked = tabUnlockState[tab.id];
          const TabIcon = tab.icon;

          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              disabled={!isUnlocked}
              className={cn(!isUnlocked && 'cursor-not-allowed opacity-50')}
            >
              <TabIcon className="mr-2 h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="story">
        {tabUnlockState.story ? (
          <StoryStudio episodeId={episode.id} />
        ) : (
          <LockedTabContent tabId="story" />
        )}
      </TabsContent>

      <TabsContent value="visuals">
        {tabUnlockState.visuals ? (
          <ComingSoonPlaceholder
            title="Visual Studio"
            description="Generate video content for each shot in your screenplay using AI video generation."
            phase={4}
          />
        ) : (
          <LockedTabContent tabId="visuals" />
        )}
      </TabsContent>

      <TabsContent value="audio">
        {tabUnlockState.audio ? (
          <ComingSoonPlaceholder
            title="Audio Studio"
            description="Generate voice acting, sound effects, and background music for your episode."
            phase={5}
          />
        ) : (
          <LockedTabContent tabId="audio" />
        )}
      </TabsContent>

      <TabsContent value="edit">
        {tabUnlockState.edit ? (
          <ComingSoonPlaceholder
            title="Edit Suite"
            description="Combine your video and audio clips in the timeline editor to create the final episode."
            phase={6}
          />
        ) : (
          <LockedTabContent tabId="edit" />
        )}
      </TabsContent>
    </Tabs>
  );
}
