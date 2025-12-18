'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useTransition,
} from 'react';

import { useRouter } from 'next/navigation';

import type { EpisodeWithShots } from '@kit/episodes/types';

interface EpisodeContextValue {
  episode: EpisodeWithShots;
  projectId: string;
  accountSlug: string;
  accountId: string;
  projectName: string;
  isGenerating: boolean;
  setIsGenerating: (value: boolean) => void;
  refetchEpisode: () => void;
  isRefetching: boolean;
}

const EpisodeContext = createContext<EpisodeContextValue | null>(null);

export function useEpisodeContext() {
  const context = useContext(EpisodeContext);
  if (!context) {
    throw new Error(
      'useEpisodeContext must be used within an EpisodeContextProvider',
    );
  }
  return context;
}

interface EpisodeContextProviderProps {
  children: React.ReactNode;
  episode: EpisodeWithShots;
  projectId: string;
  accountSlug: string;
  accountId: string;
  projectName: string;
}

export function EpisodeContextProvider({
  children,
  episode: initialEpisode,
  projectId,
  accountSlug,
  accountId,
  projectName,
}: EpisodeContextProviderProps) {
  const router = useRouter();
  const [isRefetching, startRefetchTransition] = useTransition();
  const [episode] = useState(initialEpisode);
  const [isGenerating, setIsGenerating] = useState(false);

  const refetchEpisode = useCallback(() => {
    startRefetchTransition(() => {
      router.refresh();
    });
  }, [router]);

  return (
    <EpisodeContext.Provider
      value={{
        episode,
        projectId,
        accountSlug,
        accountId,
        projectName,
        isGenerating,
        setIsGenerating,
        refetchEpisode,
        isRefetching,
      }}
    >
      {children}
    </EpisodeContext.Provider>
  );
}
