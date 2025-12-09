'use client';

import { createContext, useContext } from 'react';

import type { EpisodeWithShots, StudioTab } from '../../lib/types';

interface StoryStudioContextValue {
  episode: EpisodeWithShots;
  tabUnlockState: Record<StudioTab, boolean>;
  activeTab: StudioTab;
  isGenerating: boolean;
  refetchEpisode: () => void;
}

const StoryStudioContext = createContext<StoryStudioContextValue | null>(null);

export function useStoryStudioContext() {
  const context = useContext(StoryStudioContext);

  if (!context) {
    throw new Error('useStoryStudioContext must be used within StoryStudio');
  }

  return context;
}

export { StoryStudioContext };
