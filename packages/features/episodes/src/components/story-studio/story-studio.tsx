'use client';

import { useMemo, useState, useTransition } from 'react';

import {
  BookOpen,
  Film,
  Lightbulb,
  ListOrdered,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
} from 'lucide-react';

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
import type { ContentStyle } from '../../lib/duration-scaling';
import type { Episode, EpisodeWithShots, StudioTab } from '../../lib/types';
import { convertToScreenplayAction } from '../../server/screenplay-actions';
import { generateFullStoryAction } from '../../server/story-actions';
import { ScreenplayViewer } from '../screenplay-viewer/screenplay-viewer';
import { ShotListEditor } from '../shot-list-editor/shot-list-editor';
import {
  type StoryIdeaWithSettings,
  StoryIdeation,
} from '../story-ideation/story-ideation';
import {
  StoryStudioContext,
  useStoryStudioContext,
} from './story-studio-context';

interface StoryStudioProps {
  episodeId: string;
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
  const shotListUnlocked =
    episode.shotList !== null ||
    (episode.screenplayData?.scenes?.length ?? 0) > 0;

  return {
    ideation: true,
    story: storyUnlocked,
    screenplay: screenplayUnlocked,
    'shot-list': shotListUnlocked,
  };
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
  const [isReadingMode, setIsReadingMode] = useState(false);
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
          if (result.queued) {
            toast.info('Converting to screenplay in the background...');
          } else if (result.data) {
            toast.success(
              `Screenplay generated with ${result.data.screenplay.scenes.length} scenes`,
            );
          }
          await refetchEpisode();
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

  /* Helper to style ACT headers in raw text */
  const formatStoryText = (text: string) => {
    return text.split('\n').map((line, i) => {
      // ACT headers (e.g. ACT ONE, ACT 1, ACT I)
      if (
        /^ACT\s+(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|I|II|III|IV|V|VI|\d+)/i.test(
          line.trim(),
        )
      ) {
        return (
          <span
            key={i}
            className="text-primary/80 mb-4 mt-8 block text-center font-serif text-xl font-bold tracking-widest"
          >
            <br />
            {line}
            <br />
          </span>
        );
      }
      // Scene headers (e.g. INT. HOUSE - DAY) - Optional, but creates rhythm
      if (/^(INT\.|EXT\.)/i.test(line.trim())) {
        return (
          <span
            key={i}
            className="text-muted-foreground mb-2 mt-4 block font-mono text-sm font-bold uppercase tracking-wider"
          >
            {line}
          </span>
        );
      }
      return (
        <span key={i} className="block min-h-[1.5em]">
          {line}
        </span>
      );
    });
  };

  return (
    <div
      className={cn(
        'transition-all duration-300',
        isReadingMode
          ? 'bg-background fixed inset-0 z-50 overflow-y-auto p-8'
          : 'mt-4',
      )}
    >
      <Card
        className={cn(
          'transition-all',
          isReadingMode ? 'mx-auto max-w-3xl border-none shadow-none' : '',
        )}
      >
        <CardHeader className={cn(isReadingMode ? 'px-0' : '')}>
          <div className="flex items-center justify-between">
            <div
              className={cn('space-y-1', isReadingMode && 'w-full text-center')}
            >
              <CardTitle
                className={cn(isReadingMode ? 'text-3xl' : '', 'font-serif')}
              >
                {storyData.title ?? 'Story'}
              </CardTitle>
              {!isReadingMode && (
                <CardDescription>
                  Generated story for this episode
                </CardDescription>
              )}
            </div>

            <div
              className={cn(
                'flex items-center gap-2',
                isReadingMode && 'absolute right-8 top-8',
              )}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsReadingMode(!isReadingMode)}
                title={
                  isReadingMode ? 'Exit Reading Mode' : 'Enter Reading Mode'
                }
              >
                {isReadingMode ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>

              {!isReadingMode && !episode.screenplayData?.scenes?.length && (
                <Button
                  onClick={handleConvertToScreenplay}
                  disabled={isPending}
                  size="sm"
                >
                  {isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  To Screenplay
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className={cn(isReadingMode ? 'px-0 pb-32' : '')}>
          {/* Reading mode uses serif font with constrained width for optimal readability */}
          <div
            className={cn(
              'prose dark:prose-invert transition-all',
              isReadingMode ? 'reading-mode mx-auto' : 'prose-base max-w-none',
            )}
          >
            {formatStoryText(storyData.fullStory)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function StoryStudio({ episodeId }: StoryStudioProps) {
  const [activeTab, setActiveTab] = useUrlTabState('ideation');
  const [isGeneratingStory, startStoryTransition] = useTransition();
  const {
    data: episode,
    isLoading,
    error,
    refetch,
  } = useEpisodeQuery(episodeId);

  const tabUnlockState = useMemo(() => getTabUnlockState(episode), [episode]);
  // const currentProgress = useMemo(() => calculateProgress(episode), [episode]);
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
  const handleIdeaSelected = (selection: StoryIdeaWithSettings) => {
    if (!episode) return;

    startStoryTransition(async () => {
      try {
        const result = await generateFullStoryAction({
          episodeId: episode.id,
          version: episode.version,
          title: selection.title,
          logline: selection.logline,
          targetDuration: selection.targetDuration,
          contentStyle: selection.contentStyle,
          style: selection.visualPotential,
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
                  episodeId={episode.id}
                  onComplete={handleIdeaSelected}
                  isGenerating={isGeneratingStory}
                  initialPremise={
                    episode?.storyData?.premise as string | undefined
                  }
                  characterIds={
                    (episode?.metadata?.character_ids as string[]) ?? []
                  }
                  locationIds={
                    (episode?.metadata?.location_ids as string[]) ?? []
                  }
                  projectGenre={
                    (episode?.projectMetadata?.genre as string) ?? 'general'
                  }
                  projectStyle={episode?.projectMetadata?.videoStyle}
                  projectAudience={episode?.projectMetadata?.targetAudience}
                  defaultDuration={
                    (episode?.projectMetadata
                      ?.defaultEpisodeDuration as number) ?? 300
                  }
                  defaultContentStyle={
                    (episode?.projectMetadata?.contentStyle as ContentStyle) ??
                    'dialogue-heavy'
                  }
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
