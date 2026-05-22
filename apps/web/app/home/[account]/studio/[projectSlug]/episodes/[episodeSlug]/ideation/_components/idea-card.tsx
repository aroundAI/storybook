'use client';

import { Edit3, Eye, Sparkles } from 'lucide-react';

import type { StoryIdea } from '@kit/prompt-engine/schemas';
import { cn } from '@kit/ui/utils';

interface IdeaCardProps {
  idea: StoryIdea;
  index: number;
  onSelect: () => void;
}

export function IdeaCard({ idea, index, onSelect }: IdeaCardProps) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        'group relative cursor-pointer rounded-xl border p-6 backdrop-blur-sm transition-all duration-200',
        'border-white/[0.08] bg-[#1A1A1A] hover:border-[#3B82F6]/30 hover:bg-[#1A1A1A] hover:shadow-[0_0_20px_rgba(59,130,246,0.08)]',
      )}
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between">
        <h4 className="text-sm font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
          Variation {index + 1}
        </h4>
        <span className="flex items-center gap-1 text-xs text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">
          <Edit3 className="h-3 w-3" />
          Refine & generate
        </span>
      </div>

      {/* Logline */}
      <p className="line-clamp-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {idea.logline}
      </p>

      {/* Title */}
      {idea.title && (
        <p className="mt-2 text-xs font-medium text-blue-600 dark:text-blue-400">
          {idea.title}
        </p>
      )}

      {/* Themes */}
      {idea.themes && idea.themes.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
            <Sparkles className="h-3 w-3" />
            Themes
          </div>
          <div className="flex flex-wrap gap-1.5">
            {idea.themes.slice(0, 3).map((theme, i) => (
              <span
                key={i}
                className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-[#252525] dark:text-[#A3A3A3]"
              >
                {theme}
              </span>
            ))}
            {idea.themes.length > 3 && (
              <span className="rounded-md border border-gray-200 bg-transparent px-2 py-0.5 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
                +{idea.themes.length - 3}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Hook */}
      {idea.hook && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
            Hook
          </div>
          <p className="line-clamp-2 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            {idea.hook}
          </p>
        </div>
      )}

      {/* Visual Potential */}
      {idea.visualPotential && (
        <div className="mt-3 flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Eye className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-1">{idea.visualPotential}</span>
        </div>
      )}
    </div>
  );
}
