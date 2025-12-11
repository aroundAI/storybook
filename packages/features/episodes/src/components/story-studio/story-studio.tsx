'use client';

import { useMemo, useTransition } from 'react';

import {
  BookOpen,
  Film,
  Lightbulb,
  ListOrdered,
  Loader2,
  Lock,
} from 'lucide-react';

import type { StoryIdea } from '@kit/prompt-engine/schemas';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { cn } from '@kit/ui/utils';

import { useEpisodeQuery } from '../../hooks/use-episode-query';
import { useUrlTabState } from '../../hooks/use-url-tab-state';
import type { Episode, EpisodeWithShots, StudioTab } from '../../lib/types';
import {
  convertToScreenplayAction,
  generateFullStoryAction,
} from '../../server';
import { ScreenplayViewer } from '../screenplay-viewer/screenplay-viewer';
import { ShotListEditor } from '../shot-list-editor/shot-list-editor';
import { StoryIdeation } from '../story-ideation/story-ideation';
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

/**
 * Story tab content - displays the generated story and provides
 * a button to convert it to screenplay
 */
function StoryTabContent({ episode }: { episode: EpisodeWithShots }) {
  const [isPending, startTransition] = useTransition();
  const storyData = episode.storyData;

  // Get refetch from context
  const { refetchEpisode } = useStoryStudioContext();

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

  const handleConvertToScreenplay = () => {
    startTransition(async () => {
      try {
        const result = await convertToScreenplayAction({
          episodeId: episode.id,
        });

        if (result.success) {
          toast.success(
            `Screenplay generated with ${result.data.screenplay.scenes.length} scenes`,
          );
          refetchEpisode();
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to convert to screenplay',
        );
      }
    });
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{storyData.title ?? 'Story'}</CardTitle>
            <CardDescription>Generated story for this episode</CardDescription>
          </div>
          {!episode.screenplayData?.scenes?.length && (
            <Button onClick={handleConvertToScreenplay} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Convert to Screenplay
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <p className="whitespace-pre-wrap">{storyData.fullStory}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// Re-export context hook for use in child components
import { useStoryStudioContext } from './story-studio-context';

export function StoryStudio({ episodeId, projectId: _projectId }: StoryStudioProps) {
  const [activeTab, setActiveTab] = useUrlTabState('ideation');
  const [isGeneratingStory, startStoryTransition] = useTransition();
  const {
    data: episode,
    isLoading,
    error,
    refetch,
  } = useEpisodeQuery(episodeId);

  const tabUnlockState = useMemo(() => getTabUnlockState(episode), [episode]);
  const currentProgress = useMemo(() => calculateProgress(episode), [episode]);
  const isGenerating = episode?.status === 'generating' || isGeneratingStory;

  const handleTabChange = (tab: string) => {
    const studioTab = tab as StudioTab;

    if (tabUnlockState[studioTab]) {
      setActiveTab(studioTab);
    }
  };

  /**
   * Handle when user selects a story idea from StoryIdeation
   * This triggers full story generation and advances to story tab
   */
  const handleIdeaSelected = (idea: StoryIdea) => {
    if (!episode) return;

    startStoryTransition(async () => {
      try {
        const result = await generateFullStoryAction({
          episodeId: episode.id,
          version: episode.version,
          title: idea.title,
          logline: idea.logline,
          targetDuration: 300, // 5 minutes default
          style: idea.visualPotential,
        });

        if (result.success) {
          toast.success('Story generated successfully!');
          await refetch();
          setActiveTab('story');
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to generate story',
        );
      }
    });
  };

  /**
   * Handle screenplay approval - advance to shot-list tab
   */
  const handleScreenplayApproved = () => {
    setActiveTab('shot-list');
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
              <div className="mt-4">
                <StoryIdeation
                  episodeId={episodeId}
                  onComplete={handleIdeaSelected}
                  isGenerating={isGeneratingStory}
                />
              </div>
            ) : (
              <LockedTabContent tabId="ideation" />
            )}
          </TabsContent>

          <TabsContent value="story">
            {tabUnlockState.story ? (
              <StoryTabContent episode={episode} />
            ) : (
              <LockedTabContent tabId="story" />
            )}
          </TabsContent>

          <TabsContent value="screenplay">
            {tabUnlockState.screenplay ? (
              <div className="mt-4">
                <ScreenplayViewer
                  episode={episode}
                  onApprove={handleScreenplayApproved}
                />
              </div>
            ) : (
              <LockedTabContent tabId="screenplay" />
            )}
          </TabsContent>

          <TabsContent value="shot-list">
            {tabUnlockState['shot-list'] ? (
              <div className="mt-4">
                <ShotListEditor episode={episode} />
              </div>
            ) : (
              <LockedTabContent tabId="shot-list" />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </StoryStudioContext.Provider>
  );
}
