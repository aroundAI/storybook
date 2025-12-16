'use client';

import { useCallback, useMemo } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { BookOpen, Film, Lock, Music, Scissors, Share2 } from 'lucide-react';

import { AudioStudio } from '@kit/audio-generation';
import { StoryStudio } from '@kit/episodes/components';
import type { EpisodeWithShots } from '@kit/episodes/types';
import { PublishHub } from '@kit/publishing/components';
import { Card, CardContent } from '@kit/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Tabs, TabsContent } from '@kit/ui/tabs';
import { VisualStudio } from '@kit/video-generation/components';

type WorkspaceTab = 'story' | 'visuals' | 'audio' | 'edit' | 'publish';

interface WorkspaceTabsProps {
  episode: EpisodeWithShots;
  projectId: string;
  accountSlug: string;
  accountId: string;
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
    {
      id: 'publish',
      label: 'Publish Hub',
      icon: Share2,
      description: 'Multi-platform publishing',
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
    publish: ['ready', 'published'].includes(episode.status), // Unlocked when ready or published
  };
}

function isValidWorkspaceTab(tab: string | null): tab is WorkspaceTab {
  return (
    tab !== null &&
    ['story', 'visuals', 'audio', 'edit', 'publish'].includes(tab)
  );
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
    publish: {
      title: 'Publish Hub Locked',
      description:
        'Complete video editing to unlock multi-platform publishing',
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
  accountSlug,
  accountId,
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
    <div className="space-y-6">
      {/* Studio Switcher Header */}
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          {/* Left side reserved for page title or context if needed */}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm font-medium">Studio:</span>
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select Studio" />
            </SelectTrigger>
            <SelectContent>
              {WORKSPACE_TABS.map((tab) => {
                const isUnlocked = tabUnlockState[tab.id];
                const TabIcon = tab.icon;

                return (
                  <SelectItem
                    key={tab.id}
                    value={tab.id}
                    disabled={!isUnlocked}
                  >
                    <div className="flex items-center gap-2">
                      <TabIcon className="h-4 w-4" />
                      <span>{tab.label}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content Area */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        {/* Hidden TabsList to maintain accessibility if needed, or we rely on Select */}
        {/* We generally don't need TabsList if we control value programmatically, 
            but for a11y with Radix Tabs, it usually expects a list. 
            However, since we use Select as the switcher, we can omit TabsList 
            or keep it hidden/sr-only if strictly required by Radix (it's not strictly required for controlled mode).
         */}

        <TabsContent value="story" className="mt-0 focus-visible:outline-none">
          {tabUnlockState.story ? (
            <StoryStudio episodeId={episode.id} />
          ) : (
            <LockedTabContent tabId="story" />
          )}
        </TabsContent>

        <TabsContent value="visuals" className="mt-0 focus-visible:outline-none">
          {tabUnlockState.visuals ? (
            <VisualStudio episodeId={episode.id} projectId={projectId} />
          ) : (
            <LockedTabContent tabId="visuals" />
          )}
        </TabsContent>

        <TabsContent value="audio" className="mt-0 focus-visible:outline-none">
          {tabUnlockState.audio ? (
            <AudioStudio
              episodeId={episode.id}
              projectId={projectId}
              episodeTitle={episode.title}
            />
          ) : (
            <LockedTabContent tabId="audio" />
          )}
        </TabsContent>

        <TabsContent value="edit" className="mt-0 focus-visible:outline-none">
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

        <TabsContent value="publish" className="mt-0 focus-visible:outline-none">
          {tabUnlockState.publish ? (
            <PublishHub
              episodeId={episode.id}
              projectId={projectId}
              accountSlug={accountSlug}
              accountId={accountId}
              videoUrl={episode.finalVideoUrl ?? ''}
              thumbnailUrl={episode.thumbnailUrl ?? undefined}
              defaultTitle={episode.title}
              defaultDescription={episode.description ?? ''}
              duration={episode.durationSeconds ?? 0}
            />
          ) : (
            <LockedTabContent tabId="publish" />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
