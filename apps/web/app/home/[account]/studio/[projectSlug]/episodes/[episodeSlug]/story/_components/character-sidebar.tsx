'use client';

import { useState } from 'react';

import { ChevronRight, Users } from 'lucide-react';

import type { StoryCharacterArc } from '@kit/episodes/types';
import { cn } from '@kit/ui/utils';

interface CharacterSidebarProps {
  characters: StoryCharacterArc[];
}

const ROLE_COLORS: Record<string, string> = {
  protagonist:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  antagonist: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  supporting:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

export function CharacterSidebar({ characters }: CharacterSidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!characters || characters.length === 0) {
    return null;
  }

  return (
    <>
      {/* Trigger Button - Fixed to right edge */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'fixed top-1/2 right-0 z-40 -translate-y-1/2 rounded-l-xl border border-r-0 border-gray-200 bg-white p-3 shadow-lg transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700',
          isExpanded && 'right-80',
        )}
      >
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          <ChevronRight
            className={cn(
              'h-4 w-4 text-gray-400 transition-transform',
              isExpanded && 'rotate-180',
            )}
          />
        </div>
      </button>

      {/* Sidebar Panel */}
      <div
        className={cn(
          'fixed top-0 right-0 z-30 h-full w-80 transform border-l border-gray-200 bg-white shadow-2xl transition-transform duration-300 dark:border-gray-700 dark:bg-gray-800',
          isExpanded ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="border-b border-gray-200 p-6 dark:border-gray-700">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
              <Users className="h-5 w-5" />
              Characters
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {characters.length} character
              {characters.length !== 1 ? 's' : ''} in this story
            </p>
          </div>

          {/* Character List */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-3">
              {characters.map((character, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-gray-100 bg-gray-50 p-4 transition-colors hover:border-border dark:bg-gray-800/50 dark:hover:border-gray-600"
                >
                  <div className="mb-2 flex items-start justify-between">
                    <h4 className="font-semibold text-gray-900 dark:text-white">
                      {character.name}
                    </h4>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                        ROLE_COLORS[character.role.toLowerCase()] ??
                          'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
                      )}
                    >
                      {character.role}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                    {character.arc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Backdrop */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-20 bg-black/20"
          onClick={() => setIsExpanded(false)}
        />
      )}
    </>
  );
}
