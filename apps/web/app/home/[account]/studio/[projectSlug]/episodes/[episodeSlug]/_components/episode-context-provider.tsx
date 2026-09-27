'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';

import { useRouter } from 'next/navigation';

/**
 * Hook to consolidate generation state check and safety refetch logic.
 * Reduces duplication across Story, Screenplay, and Visual Studio pages.
 */
import {
  type GenerationJobType,
  useActiveGenerationJob,
} from '@kit/episodes/hooks';
import type { EpisodeWithShots } from '@kit/episodes/types';

interface EpisodeContextValue {
  episode: EpisodeWithShots;
  projectId: string;
  projectSlug: string;
  accountSlug: string;
  accountId: string;
  projectName: string;
  projectMetadata: Record<string, unknown> | null;
  /** Owner or admin of the project: may take published videos down (KB-47) */
  canTakeDown: boolean;
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
  canTakeDown: boolean;
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
  canTakeDown,
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
        canTakeDown,
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

export function useEpisodeGenerationCheck({
  episodeId,
  jobType,
  hasData,
}: {
  episodeId: string;
  jobType: GenerationJobType;
  /** Pass the condition that indicates data is present */
  hasData: boolean;
}) {
  const {
    isGenerating: isContextGenerating,
    setIsGenerating,
    refetchEpisode,
  } = useEpisodeContext();

  // Check for active generation job (only if no data exists)
  const { isGenerating: isGeneratingJob } = useActiveGenerationJob(
    episodeId,
    jobType,
    {
      enabled: !hasData,
    },
  );

  const isGenerating = isGeneratingJob || isContextGenerating;

  // Safety mechanism: If context says generating, but we have data, clear it.
  // If context says generating and we DON'T have data, refetch to be safe (handles race conditions).
  useEffect(() => {
    if (isContextGenerating) {
      if (hasData) {
        setIsGenerating(false);
      } else {
        refetchEpisode();
      }
    }
  }, [isContextGenerating, hasData, setIsGenerating, refetchEpisode]);

  // A job can finish between this page's data being read and its WebSocket
  // subscription opening - the previous page queues it and navigates at once,
  // and a fast worker answers first. Neither the active-job query (finished
  // jobs are not active) nor the socket (the message came before the
  // subscriber) would then show it, and the step stayed locked until a reload.
  // One read on arrival closes that gap.
  const checkedOnArrival = useRef(false);
  useEffect(() => {
    if (hasData || checkedOnArrival.current) return;
    checkedOnArrival.current = true;
    refetchEpisode();
  }, [hasData, refetchEpisode]);

  return useMemo(() => ({ isGenerating }), [isGenerating]);
}
