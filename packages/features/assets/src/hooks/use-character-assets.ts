'use client';

import { useCallback, useState, useTransition } from 'react';

import { toast } from '@kit/ui/sonner';

import { deleteAssetAction } from '../lib/server/asset.mutations';
import { listCharactersAction } from '../lib/server/character.mutations';
import type { CharacterWithDetails } from '../lib/types';

interface UseCharacterAssetsOptions {
  projectId: string;
  limit?: number;
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
}: UseCharacterAssetsOptions): UseCharacterAssetsReturn {
  const [characters, setCharacters] = useState<CharacterWithDetails[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, startLoadTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  const fetchCharacters = useCallback(async () => {
    startLoadTransition(async () => {
      try {
        setError(null);
        const response = await listCharactersAction({
          projectId,
          limit,
          offset: 0,
        });

        if (response.success && response.data) {
          setCharacters(response.data.characters);
          setTotal(response.data.total);
          setHasMore(response.data.hasMore);
        }
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Failed to fetch characters');
        setError(error);
        toast.error(error.message);
      }
    });
  }, [projectId, limit]);

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
    isLoading,
    isDeleting,
    error,
    fetchCharacters,
    deleteCharacter,
    refetch,
  };
}
