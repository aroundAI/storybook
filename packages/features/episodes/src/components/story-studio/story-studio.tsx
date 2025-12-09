'use client';

import { useMemo } from 'react';

import {
  BookOpen,
  Film,
  Lightbulb,
  ListOrdered,
  Loader2,
  Lock,
} from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { cn } from '@kit/ui/utils';

import { useEpisodeQuery } from '../../hooks/use-episode-query';
import { useUrlTabState } from '../../hooks/use-url-tab-state';
import type { Episode, EpisodeWithShots, StudioTab } from '../../lib/types';
import { PipelineProgress } from './pipeline-progress';
import { StoryStudioContext } from './story-studio-context';

interface StoryStudioProps {
  episodeId: string;
  projectId: string;
}

const STUDIO_TABS: Array<{
  id: StudioTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'ideation', label: 'Ideation', icon: Lightbulb },
  { id: 'story', label: 'Story', icon: BookOpen },
  { id: 'screenplay', label: 'Screenplay', icon: Film },
  { id: 'shot-list', label: 'Shot List', icon: ListOrdered },
];

function getTabUnlockState(
  episode: Episode | undefined,
): Record<StudioTab, boolean> {
  if (!episode) {
    return {
      ideation: true,
      story: false,
      screenplay: false,
      'shot-list': false,
    };
  }

  const storyUnlocked = episode.status !== 'draft';
  const screenplayUnlocked = [
    'storyboard',
    'generating',
    'editing',
    'ready',
    'published',
  ].includes(episode.status);
  const shotListUnlocked = episode.shotList !== null;

  return {
    ideation: true,
    story: storyUnlocked,
    screenplay: screenplayUnlocked,
    'shot-list': shotListUnlocked,
  };
}

function calculateProgress(episode: Episode | undefined): number {
  if (!episode) return 1;

  let progress = 1;

  if (episode.storyData?.fullStory) progress = 2;
  if (episode.screenplayData?.scenes?.length) progress = 3;
  if (episode.shotList?.shots?.length) progress = 4;

  return progress;
}

function LockedTabContent({ tabId }: { tabId: StudioTab }) {
  const tabLabels: Record<StudioTab, { title: string; description: string }> = {
    ideation: {
      title: 'Ideation',
      description: 'Start by entering your story premise',
    },
    story: {
      title: 'Story Locked',
      description:
        'Complete the ideation step and select a story idea to unlock',
    },
    screenplay: {
      title: 'Screenplay Locked',
      description: 'Complete the story generation and approval to unlock',
    },
    'shot-list': {
      title: 'Shot List Locked',
      description: 'Complete the screenplay conversion to unlock',
    },
  };

  const { title, description } = tabLabels[tabId];

  return (
    <Card className="mt-4">
      <CardContent className="flex flex-col items-center justify-center py-12">
        <Lock className="text-muted-foreground mb-4 h-12 w-12" />
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-muted-foreground mt-2 text-center text-sm">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

function StoryTabPlaceholder({ episode }: { episode: EpisodeWithShots }) {
  const storyData = episode.storyData;

  if (!storyData?.fullStory) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Story Generation</CardTitle>
          <CardDescription>
            Select an idea from the Ideation tab to generate a full story
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{storyData.title ?? 'Story'}</CardTitle>
        <CardDescription>Generated story for this episode</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <p className="whitespace-pre-wrap">{storyData.fullStory}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ScreenplayPlaceholder({ episode }: { episode: EpisodeWithShots }) {
  const screenplayData = episode.screenplayData;

  if (!screenplayData?.scenes?.length) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Screenplay</CardTitle>
          <CardDescription>
            Approve the story to generate a screenplay
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Screenplay</CardTitle>
        <CardDescription>{screenplayData.scenes.length} scenes</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          Screenplay viewer coming soon (FILM-310)
        </p>
      </CardContent>
    </Card>
  );
}

function ShotListPlaceholder({ episode }: { episode: EpisodeWithShots }) {
  const shotList = episode.shotList;

  if (!shotList?.shots?.length) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Shot List</CardTitle>
          <CardDescription>
            Approve the screenplay to generate a shot list
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Shot List</CardTitle>
        <CardDescription>{shotList.shots.length} shots</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          Shot list editor coming soon (FILM-311)
        </p>
      </CardContent>
    </Card>
  );
}

function IdeationPlaceholder({ episodeId }: { episodeId: string }) {
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Story Ideation</CardTitle>
        <CardDescription>
          Enter your premise and generate story ideas
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          Story ideation form coming soon (FILM-309)
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          Episode ID: {episodeId}
        </p>
      </CardContent>
    </Card>
  );
}

export function StoryStudio({ episodeId }: StoryStudioProps) {
  const [activeTab, setActiveTab] = useUrlTabState('ideation');
  const {
    data: episode,
    isLoading,
    error,
    refetch,
  } = useEpisodeQuery(episodeId);

  const tabUnlockState = useMemo(() => getTabUnlockState(episode), [episode]);
  const currentProgress = useMemo(() => calculateProgress(episode), [episode]);
  const isGenerating = episode?.status === 'generating';

  const handleTabChange = (tab: string) => {
    const studioTab = tab as StudioTab;

    if (tabUnlockState[studioTab]) {
      setActiveTab(studioTab);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !episode) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-destructive">Failed to load episode</p>
          <p className="text-muted-foreground mt-2 text-sm">
            {error?.message ?? 'Episode not found'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <StoryStudioContext.Provider
      value={{
        episode,
        tabUnlockState,
        activeTab,
        isGenerating,
        refetchEpisode: refetch,
      }}
    >
      <div className="space-y-6">
        <PipelineProgress
          currentStep={currentProgress}
          totalSteps={4}
          currentTab={activeTab}
          isGenerating={isGenerating}
        />

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="grid w-full grid-cols-4">
            {STUDIO_TABS.map((tab) => {
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

          <TabsContent value="ideation">
            {tabUnlockState.ideation ? (
              <IdeationPlaceholder episodeId={episodeId} />
            ) : (
              <LockedTabContent tabId="ideation" />
            )}
          </TabsContent>

          <TabsContent value="story">
            {tabUnlockState.story ? (
              <StoryTabPlaceholder episode={episode} />
            ) : (
              <LockedTabContent tabId="story" />
            )}
          </TabsContent>

          <TabsContent value="screenplay">
            {tabUnlockState.screenplay ? (
              <ScreenplayPlaceholder episode={episode} />
            ) : (
              <LockedTabContent tabId="screenplay" />
            )}
          </TabsContent>

          <TabsContent value="shot-list">
            {tabUnlockState['shot-list'] ? (
              <ShotListPlaceholder episode={episode} />
            ) : (
              <LockedTabContent tabId="shot-list" />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </StoryStudioContext.Provider>
  );
}
