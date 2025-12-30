'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useTransition,
} from 'react';

import { useRouter } from 'next/navigation';

import type { EpisodeWithShots } from '@kit/episodes/types';

interface EpisodeContextValue {
  episode: EpisodeWithShots;
  projectId: string;
  projectSlug: string;
  accountSlug: string;
  accountId: string;
  projectName: string;
  projectMetadata: Record<string, unknown> | null;
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
  projectSlug: string;
  accountSlug: string;
  accountId: string;
  projectName: string;
  projectMetadata: Record<string, unknown> | null;
}

export function EpisodeContextProvider({
  children,
  episode: initialEpisode,
  projectId,
  projectSlug,
  accountSlug,
  accountId,
  projectName,
  projectMetadata,
}: EpisodeContextProviderProps) {
  const router = useRouter();
  const [isRefetching, startRefetchTransition] = useTransition();
  const [episode, setEpisode] = useState(initialEpisode);
  const [isGenerating, setIsGenerating] = useState(false);

  // Update episode when initialEpisode changes (after router.refresh)
  useEffect(() => {
    setEpisode(initialEpisode);
  }, [initialEpisode]);

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
        projectSlug,
        accountSlug,
        accountId,
        projectName,
        projectMetadata,
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
