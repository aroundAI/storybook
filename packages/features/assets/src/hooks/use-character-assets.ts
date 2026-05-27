'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { toast } from '@kit/ui/sonner';

import {
  deleteAssetAction,
  getProjectAssetsAction,
} from '../lib/server/asset.mutations';
import { listCharactersAction } from '../lib/server/character.mutations';
import type { Asset, CharacterWithDetails } from '../lib/types';

interface UseCharacterAssetsOptions {
  projectId: string;
  limit?: number;
  initialData?: {
    characters: CharacterWithDetails[];
    total: number;
    hasMore: boolean;
  };
}

interface UseCharacterAssetsReturn {
  characters: CharacterWithDetails[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isDeleting: boolean;
  error: Error | null;
  fetchCharacters: () => Promise<void>;
  deleteCharacter: (assetId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useCharacterAssets({
  projectId,
  limit = 100,
  initialData,
}: UseCharacterAssetsOptions): UseCharacterAssetsReturn {
  const [characters, setCharacters] = useState<CharacterWithDetails[]>(
    initialData?.characters ?? [],
  );
  const [total, setTotal] = useState(initialData?.total ?? 0);
  const [hasMore, setHasMore] = useState(initialData?.hasMore ?? false);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, startLoadTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [hasFetched, setHasFetched] = useState(!!initialData);

  const fetchCharacters = useCallback(async () => {
    startLoadTransition(async () => {
      try {
        setError(null);

        // Primary: try listCharactersAction (has full character_details join)
        try {
          const response = await listCharactersAction({
            projectId,
            limit,
            offset: 0,
          });

          if (response && typeof response === 'object') {
            const payload =
              'data' in response && response.data
                ? (response.data as {
                    characters: CharacterWithDetails[];
                    total: number;
                    hasMore: boolean;
                  })
                : null;

            if (payload?.characters) {
              setCharacters(payload.characters);
              setTotal(payload.total);
              setHasMore(payload.hasMore);
              setHasFetched(true);
              return;
            }
          }
        } catch (primaryErr) {
          console.warn(
            '[useCharacterAssets] listCharactersAction failed, falling back:',
            primaryErr,
          );
        }

        // Fallback: use the proven getProjectAssetsAction
        const fallbackResponse = await getProjectAssetsAction({
          projectId,
          type: 'character',
          limit,
          offset: 0,
        });

        const mapped: CharacterWithDetails[] = fallbackResponse.assets.map(
          (asset: Asset) => ({
            ...asset,
            type: 'character' as const,
            role:
              ((asset.metadata as Record<string, unknown>)
                ?.role as CharacterWithDetails['role']) ?? 'supporting',
            physicalAttributes: null,
            personality: null,
            personalityTraits: null,
            clothingStyle: null,
            backstory: null,
            elementPrompt: null,
            referenceImages: null,
            voiceAssetId: null,
          }),
        );

        setCharacters(mapped);
        setTotal(fallbackResponse.total);
        setHasMore(fallbackResponse.hasMore);
        setHasFetched(true);
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Failed to fetch characters');

        if (error.message?.includes('NEXT_REDIRECT')) {
          return;
        }

        setError(error);
        toast.error(error.message);
        setHasFetched(true);
      }
    });
  }, [projectId, limit]);

  // Only auto-fetch if no initial data was provided
  useEffect(() => {
    if (!hasFetched) {
      void fetchCharacters();
    }
  }, [hasFetched, fetchCharacters]);

  const deleteCharacter = useCallback(
    async (assetId: string) => {
      const previousCharacters = characters;

      setCharacters((prev) => prev.filter((c) => c.id !== assetId));
      setTotal((prev) => prev - 1);

      startDeleteTransition(async () => {
        try {
          await deleteAssetAction({ assetId });
          toast.success('Character deleted successfully');
        } catch (err) {
          setCharacters(previousCharacters);
          setTotal((prev) => prev + 1);

          const error =
            err instanceof Error
              ? err
              : new Error('Failed to delete character');

          if (error.message.includes('in use')) {
            toast.error('Cannot delete character that is in use by episodes');
          } else {
            toast.error('Failed to delete character');
          }
        }
      });
    },
    [characters],
  );

  const refetch = useCallback(async () => {
    await fetchCharacters();
  }, [fetchCharacters]);

  return {
    characters,
    total,
    hasMore,
    isLoading: !hasFetched || isLoading,
    isDeleting,
    error,
    fetchCharacters,
    deleteCharacter,
    refetch,
  };
}
