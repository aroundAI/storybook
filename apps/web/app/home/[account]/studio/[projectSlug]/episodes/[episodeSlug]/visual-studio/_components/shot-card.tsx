'use client';

import { AlertCircle, Clock, ImageIcon, Loader2, Play } from 'lucide-react';

import type { Shot, ShotStatus } from '@kit/episodes/types';
import { cn } from '@kit/ui/utils';

interface ShotCardProps {
  shot: Shot;
  isSelected: boolean;
  onClick: () => void;
  size?: 'lg' | 'md' | 'sm';
}

const STATUS_STYLES: Record<ShotStatus, string> = {
  pending:
    'bg-orange-200/80 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  generating:
    'bg-blue-200/80 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  completed:
    'bg-green-200/80 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  failed: 'bg-red-200/80 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};

const STATUS_ICONS: Record<ShotStatus, React.ReactNode> = {
  pending: <Clock className="h-3 w-3" />,
  generating: <Loader2 className="h-3 w-3 animate-spin" />,
  completed: <Play className="h-3 w-3" />,
  failed: <AlertCircle className="h-3 w-3" />,
};

const SIZE_CLASSES = {
  lg: 'col-span-2 min-h-[400px]',
  md: 'col-span-1 min-h-[300px]',
  sm: 'col-span-1 min-h-[200px]',
};

export function ShotCard({
  shot,
  isSelected,
  onClick,
  size = 'md',
}: ShotCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'liquid-card group flex cursor-pointer flex-col overflow-hidden p-4 pb-6 transition-all',
        SIZE_CLASSES[size],
        isSelected && 'ring-2 ring-blue-500/50',
      )}
    >
      {/* Image Container with liquid styling */}
      <div className="liquid-image-container relative flex-1 overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-700">
        {shot.thumbnailUrl ? (
          <img
            src={shot.thumbnailUrl}
            alt={`Shot ${shot.shotNumber}`}
            className="h-full w-full object-cover"
          />
        ) : shot.videoUrl ? (
          <video
            src={shot.videoUrl}
            className="h-full w-full object-cover"
            muted
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

        {/* Shot Number - bottom left */}
        <div className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-2 py-1 text-xs font-medium text-white">
          Shot {shot.sceneNumber}.{shot.shotNumber}
        </div>

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
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Shot {shot.sceneNumber}.{shot.shotNumber}
        </p>
      </div>
    </div>
  );
}
