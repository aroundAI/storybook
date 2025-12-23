'use client';

import { useMemo } from 'react';

import { Edit2, Mic } from 'lucide-react';

import type { CharacterAsset } from '@kit/audio-generation/lib';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

interface VoiceAssignmentPanelProps {
  characters: CharacterAsset[];
  episodeId: string;
  isLoading: boolean;
}

// Character color palette - matches timeline colors
const CHARACTER_COLORS = [
  {
    name: 'orange',
    border: 'border-l-orange-400',
    bg: 'bg-orange-100',
    text: 'text-orange-600',
  },
  {
    name: 'purple',
    border: 'border-l-purple-400',
    bg: 'bg-purple-100',
    text: 'text-purple-600',
  },
  {
    name: 'green',
    border: 'border-l-green-400',
    bg: 'bg-green-100',
    text: 'text-green-600',
  },
  {
    name: 'blue',
    border: 'border-l-blue-400',
    bg: 'bg-blue-100',
    text: 'text-blue-600',
  },
  {
    name: 'pink',
    border: 'border-l-pink-400',
    bg: 'bg-pink-100',
    text: 'text-pink-600',
  },
  {
    name: 'cyan',
    border: 'border-l-cyan-400',
    bg: 'bg-cyan-100',
    text: 'text-cyan-600',
  },
];

// Placeholder voice descriptions (would come from character/voice data)
function getVoiceDescription(characterName: string): string | null {
  // In a real implementation, this would come from the character's voice profile
  const descriptions: Record<string, string> = {
    Dante: 'Young Boy • Energetic',
    Cece: 'High Pitch • Excited',
    Narrator: 'Deep • Calm',
  };
  return descriptions[characterName] ?? null;
}

// Placeholder for determining if voice is assigned
function hasVoiceAssigned(_characterId: string): boolean {
  // In a real implementation, this would check if the character has a voice profile
  return Math.random() > 0.5; // Placeholder
}

export function VoiceAssignmentPanel({
  characters,
  episodeId: _episodeId,
  isLoading,
}: VoiceAssignmentPanelProps) {
  // Map characters to colors
  const characterColors = useMemo(() => {
    const map: Record<string, (typeof CHARACTER_COLORS)[0]> = {};
    characters.forEach((char, i) => {
      map[char.id] = CHARACTER_COLORS[i % CHARACTER_COLORS.length]!;
    });
    return map;
  }, [characters]);

  const handleEditVoice = (characterId: string, characterName: string) => {
    toast.info(`Voice assignment for ${characterName} coming soon`);
    // TODO: Open voice assignment modal
  };

  const handleManageAll = () => {
    toast.info('Voice management coming soon');
    // TODO: Open voice management modal
  };

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-gray-200 p-4 dark:border-gray-700">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Voice Assignment
          </h3>
        </div>
        <button
          onClick={handleManageAll}
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Manage All
        </button>
      </div>

      {/* Character List */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {characters.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No characters found in dialogue
          </div>
        ) : (
          characters.map((character) => {
            const colors = characterColors[character.id]!;
            const voiceAssigned = hasVoiceAssigned(character.id);
            const voiceDescription = getVoiceDescription(character.name);

            return (
              <div
                key={character.id}
                className={cn(
                  'group relative cursor-pointer rounded-xl border border-l-4 bg-white p-3 shadow-sm transition-all hover:shadow-md dark:border-gray-700 dark:bg-white/5',
                  colors.border,
                )}
              >
                {/* Character Info */}
                <div className="mb-2 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold',
                        colors.bg,
                        colors.text,
                      )}
                    >
                      {character.name[0]?.toUpperCase()}
                    </div>
                    {/* Name & Role */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                        {character.name}
                      </h4>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        Character
                      </p>
                    </div>
                  </div>
                  {/* Status Indicator */}
                  <div
                    className={cn(
                      'h-2 w-2 rounded-full',
                      voiceAssigned ? 'bg-green-500' : 'bg-yellow-400',
                    )}
                    title={
                      voiceAssigned ? 'Voice assigned' : 'No voice assigned'
                    }
                  />
                </div>

                {/* Voice Description & Edit */}
                <div className="flex items-center justify-between">
                  <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600 dark:bg-white/10 dark:text-gray-400">
                    {voiceDescription ?? 'No voice assigned'}
                  </span>
                  <button
                    onClick={() =>
                      handleEditVoice(character.id, character.name)
                    }
                    className="text-gray-400 transition-colors hover:text-blue-500"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
