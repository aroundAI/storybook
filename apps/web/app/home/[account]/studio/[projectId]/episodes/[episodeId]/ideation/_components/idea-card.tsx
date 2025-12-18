'use client';

import { ArrowRight } from 'lucide-react';

import type { StoryIdea } from '@kit/prompt-engine/schemas';
import { cn } from '@kit/ui/utils';

interface IdeaCardProps {
  idea: StoryIdea;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
}

export function IdeaCard({ idea, index, isSelected, onSelect }: IdeaCardProps) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        'group relative cursor-pointer rounded-xl border p-6 transition-all',
        isSelected
          ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-500 dark:border-blue-600 dark:bg-blue-900/20'
          : 'border-gray-200 bg-white/50 hover:border-gray-300 hover:bg-white dark:border-gray-700 dark:bg-white/5 dark:hover:bg-white/10',
      )}
    >
      <div className="mb-2 flex items-start justify-between">
        <h4 className="text-sm font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
          Variation {index + 1}
        </h4>
        <ArrowRight
          className={cn(
            'h-4 w-4 text-gray-400 transition-opacity dark:text-gray-500',
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        />
      </div>
      <p className="line-clamp-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {idea.logline}
      </p>
      {idea.title && (
        <p className="mt-2 text-xs font-medium text-blue-600 dark:text-blue-400">
          {idea.title}
        </p>
      )}
    </div>
  );
}
