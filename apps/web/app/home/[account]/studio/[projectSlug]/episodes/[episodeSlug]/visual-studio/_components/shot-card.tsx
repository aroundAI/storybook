'use client';

import React from 'react';

import {
  AlertCircle,
  Clock,
  Flame,
  ImageIcon,
  Loader2,
  Play,
  Users,
} from 'lucide-react';

import { OriginBadge } from '@kit/episodes/components/origin-badge';
import type { Shot, ShotStatus } from '@kit/episodes/types';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';
import { cn } from '@kit/ui/utils';

import type { SelectionModifiers } from './shot-selection';

interface ShotCardProps {
  shot: Shot;
  isSelected: boolean;
  onSelect: (modifiers: SelectionModifiers) => void;
  onFocus: () => void;
  tabIndex: 0 | -1;
  size?: 'lg' | 'md' | 'sm';
}

/**
 * Extract unique character names from shot metadata (VEO timeline)
 */
function extractCharacters(shot: Shot): string[] {
  const metadata = shot.metadata as {
    veoPrompt?: {
      timeline?: Array<{ character?: string }>;
    };
    characters?: string[];
  } | null;

  // First try metadata.characters (direct field)
  if (metadata?.characters && metadata.characters.length > 0) {
    return metadata.characters;
  }

  // Then try extracting from VEO timeline
  if (metadata?.veoPrompt?.timeline) {
    const chars = new Set<string>();
    for (const event of metadata.veoPrompt.timeline) {
      if (event.character) {
        chars.add(event.character);
      }
    }
    return Array.from(chars);
  }

  return [];
}

const STATUS_STYLES: Record<ShotStatus, string> = {
  pending:
    'bg-orange-200/80 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
  generating:
    'bg-blue-200/80 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
  completed:
    'bg-green-200/80 text-green-800 dark:bg-green-900/50 dark:text-green-300',
  failed: 'bg-red-200/80 text-red-800 dark:bg-red-900/50 dark:text-red-300',
};

const STATUS_ICONS: Record<ShotStatus, React.ReactNode> = {
  pending: <Clock className="h-3 w-3" />,
  generating: <Loader2 className="h-3 w-3 animate-spin" />,
  completed: <Play className="h-3 w-3" />,
  failed: <AlertCircle className="h-3 w-3" />,
};

const SIZE_CLASSES = {
  lg: 'sm:col-span-2 min-h-[400px]',
  md: 'col-span-1 min-h-[300px]',
  sm: 'col-span-1 min-h-[200px]',
};

const ShotCardInner = ({
  shot,
  isSelected,
  onSelect,
  onFocus,
  tabIndex,
  size = 'md',
}: ShotCardProps) => {
  const characters = extractCharacters(shot);

  return (
    <div
      role="option"
      aria-selected={isSelected}
      aria-label={`Shot ${shot.sceneNumber}.${shot.shotNumber}: ${shot.description || shot.prompt || 'No description'}`}
      tabIndex={tabIndex}
      data-test="shot-card"
      data-shot-id={shot.id}
      data-selected={isSelected}
      onFocus={onFocus}
      onClick={(event) =>
        onSelect({
          toggle: event.metaKey || event.ctrlKey,
          range: event.shiftKey,
        })
      }
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;

        event.preventDefault();
        onSelect({
          toggle: event.metaKey || event.ctrlKey,
          range: event.shiftKey,
        });
      }}
      className={cn(
        'liquid-card group flex cursor-pointer flex-col overflow-hidden p-4 pb-6 transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        SIZE_CLASSES[size],
        isSelected && 'ring-2 ring-blue-500/50',
      )}
    >
      {/* Image Container with liquid styling */}
      {/* Priority: Video → Thumbnail → First Frame → Last Frame → Placeholder */}
      <div className="liquid-image-container relative flex-1 overflow-hidden rounded-2xl bg-gray-100 dark:bg-[#252525]">
        {shot.videoUrl ? (
          <video
            src={shot.videoUrl}
            className="h-full w-full object-cover"
            muted
          />
        ) : shot.thumbnailUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={shot.thumbnailUrl}
            alt={`Shot ${shot.shotNumber}`}
            className="h-full w-full object-cover"
          />
        ) : shot.firstFrameUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={shot.firstFrameUrl}
            alt={`Shot ${shot.shotNumber} first frame`}
            className="h-full w-full object-cover"
          />
        ) : shot.lastFrameUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={shot.lastFrameUrl}
            alt={`Shot ${shot.shotNumber} last frame`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="h-12 w-12 text-gray-300 dark:text-gray-600" />
          </div>
        )}

        {/* Status Badge - top right */}
        <div
          className={cn(
            'liquid-pill absolute top-3 right-3 flex items-center gap-1 uppercase',
            STATUS_STYLES[shot.status],
          )}
        >
          {STATUS_ICONS[shot.status]}
          <span>{shot.status}</span>
        </div>

        {/* Shorts Candidate Badge - top left */}
        {shot.shortsCandidate && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="absolute top-3 left-3 flex cursor-help items-center gap-1 rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-2 py-1 text-xs font-bold text-white shadow-lg">
                  <Flame className="h-3 w-3" />
                  <span>Shorts</span>
                  {shot.shortsMetadata?.viralScore !== undefined && (
                    <span className="ml-0.5 opacity-80">
                      {shot.shortsMetadata.viralScore.toFixed(1)}
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="start"
                className="max-w-xs space-y-2 p-3 text-xs"
              >
                {shot.shortsMetadata?.whyThisWorksAsReel && (
                  <div>
                    <span className="font-semibold text-green-400">
                      ✓ Why it works as a Reel
                    </span>
                    <p className="mt-0.5 leading-snug text-gray-200">
                      {shot.shortsMetadata.whyThisWorksAsReel}
                    </p>
                  </div>
                )}
                {shot.shortsMetadata?.keyMoment && (
                  <div>
                    <span className="font-semibold text-amber-400">
                      ⚡ Key moment
                    </span>
                    <p className="mt-0.5 leading-snug text-gray-200">
                      {shot.shortsMetadata.keyMoment}
                    </p>
                  </div>
                )}
                {shot.shortsMetadata?.sceneEmotionalArc && (
                  <div>
                    <span className="font-semibold text-blue-400">
                      🎭 Emotional arc
                    </span>
                    <p className="mt-0.5 text-gray-200">
                      {shot.shortsMetadata.sceneEmotionalArc}
                    </p>
                  </div>
                )}
                {shot.shortsMetadata?.hookType && (
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-purple-400">Hook:</span>
                    <span className="rounded bg-purple-900/50 px-1.5 py-0.5 text-purple-200 capitalize">
                      {shot.shortsMetadata.hookType}
                    </span>
                  </div>
                )}
                {!shot.shortsMetadata?.whyThisWorksAsReel && (
                  <p className="text-gray-300">
                    Viral Score: {shot.shortsMetadata?.viralScore ?? 'N/A'}/10
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Shot Number - bottom left */}
        <div className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-2 py-1 text-xs font-medium text-white">
          Shot {shot.sceneNumber}.{shot.shotNumber}
        </div>

        {/* Character Badges - bottom right */}
        {characters.length > 0 && (
          <div className="absolute right-3 bottom-3 flex items-center gap-1">
            {characters.slice(0, 3).map((char) => (
              <div
                key={char}
                className="flex items-center gap-1 rounded-lg bg-purple-600/80 px-2 py-1 text-xs font-medium text-white shadow-lg backdrop-blur-sm"
                title={char}
              >
                {char.length > 8 ? `${char.slice(0, 8)}…` : char}
              </div>
            ))}
            {characters.length > 3 && (
              <div className="flex items-center gap-1 rounded-lg bg-gray-600/80 px-2 py-1 text-xs font-medium text-white shadow-lg backdrop-blur-sm">
                +{characters.length - 3}
              </div>
            )}
          </div>
        )}

        {/* Play Overlay (for completed shots) */}
        {shot.status === 'completed' && shot.videoUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
            <div className="rounded-full bg-white/90 p-3">
              <Play className="h-6 w-6 text-gray-800" />
            </div>
          </div>
        )}
      </div>

      {/* Action Description - below image */}
      <div className="mt-4 px-2">
        <p className="line-clamp-3 font-semibold text-gray-800 dark:text-gray-200">
          Action: {shot.description || shot.prompt || 'No description'}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Shot {shot.sceneNumber}.{shot.shotNumber}
          </span>
          <OriginBadge origin={shot.generationOrigin} />
          {characters.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400">
              <Users className="h-3 w-3" />
              {characters.join(', ')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export const ShotCard = React.memo(ShotCardInner);
ShotCard.displayName = 'ShotCard';
