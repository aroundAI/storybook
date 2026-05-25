'use client';

import { useCallback, useMemo, useState } from 'react';

import type { CharacterRole, CharacterWithDetails } from '../lib/types';

export type VoiceStatus = 'all' | 'has-voice' | 'no-voice';
export type ImageStatus = 'all' | 'has-image' | 'no-image';
export type ElementPromptStatus = 'all' | 'has-prompt' | 'no-prompt';
export type SortOption =
  | 'name-asc'
  | 'name-desc'
  | 'role-priority'
  | 'created-desc'
  | 'updated-desc';

export interface CharacterFilters {
  search: string;
  roles: CharacterRole[];
  voiceStatus: VoiceStatus;
  imageStatus: ImageStatus;
  elementPromptStatus: ElementPromptStatus;
  sortBy: SortOption;
}

const DEFAULT_FILTERS: CharacterFilters = {
  search: '',
  roles: [],
  voiceStatus: 'all',
  imageStatus: 'all',
  elementPromptStatus: 'all',
  sortBy: 'role-priority',
};

const ROLE_PRIORITY: Record<CharacterRole, number> = {
  protagonist: 1,
  deuteragonist: 2,
  supporting: 3,
  narrator: 4,
  creature: 5,
  object: 6,
  background: 7,
};

interface UseCharacterFiltersOptions {
  characters: CharacterWithDetails[];
}

export function useCharacterFilters({
  characters,
}: UseCharacterFiltersOptions) {
  const [filters, setFilters] = useState<CharacterFilters>(DEFAULT_FILTERS);

  const setFilter = useCallback(
    <K extends keyof CharacterFilters>(key: K, value: CharacterFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const toggleRole = useCallback((role: CharacterRole) => {
    setFilters((prev) => ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role],
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.search) count++;
    if (filters.roles.length > 0) count++;
    if (filters.voiceStatus !== 'all') count++;
    if (filters.imageStatus !== 'all') count++;
    if (filters.elementPromptStatus !== 'all') count++;
    if (filters.sortBy !== 'role-priority') count++;
    return count;
  }, [filters]);

  const filteredCharacters = useMemo(() => {
    let result = [...characters];

    // Text search
    if (filters.search) {
      const query = filters.search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.description?.toLowerCase().includes(query),
      );
    }

    // Role filter
    if (filters.roles.length > 0) {
      result = result.filter((c) => filters.roles.includes(c.role));
    }

    // Voice status filter
    if (filters.voiceStatus === 'has-voice') {
      result = result.filter((c) => !!c.voiceAssetId);
    } else if (filters.voiceStatus === 'no-voice') {
      result = result.filter((c) => !c.voiceAssetId);
    }

    // Image status filter
    if (filters.imageStatus === 'has-image') {
      result = result.filter((c) => !!(c.fileUrl || c.thumbnailUrl));
    } else if (filters.imageStatus === 'no-image') {
      result = result.filter((c) => !(c.fileUrl || c.thumbnailUrl));
    }

    // Element prompt status filter
    if (filters.elementPromptStatus === 'has-prompt') {
      result = result.filter((c) => !!c.elementPrompt);
    } else if (filters.elementPromptStatus === 'no-prompt') {
      result = result.filter((c) => !c.elementPrompt);
    }

    // Sort
    result.sort((a, b) => {
      switch (filters.sortBy) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'role-priority': {
          const priorityA = ROLE_PRIORITY[a.role] ?? 99;
          const priorityB = ROLE_PRIORITY[b.role] ?? 99;
          if (priorityA !== priorityB) return priorityA - priorityB;
          return a.name.localeCompare(b.name);
        }
        case 'created-desc':
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        case 'updated-desc':
          return (
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        default:
          return 0;
      }
    });

    return result;
  }, [characters, filters]);

  return {
    filters,
    setFilter,
    toggleRole,
    clearFilters,
    activeFilterCount,
    filteredCharacters,
  };
}
