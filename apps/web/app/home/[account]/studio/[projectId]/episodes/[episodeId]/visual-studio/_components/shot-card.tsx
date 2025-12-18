'use client';

import { AlertCircle, Clock, ImageIcon, Loader2, Play } from 'lucide-react';

import type { Shot, ShotStatus } from '@kit/episodes/types';
import { cn } from '@kit/ui/utils';

interface ShotCardProps {
  shot: Shot;
  isSelected: boolean;
  onClick: () => void;
}

const STATUS_STYLES: Record<ShotStatus, string> = {
  pending:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  generating:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  completed:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const STATUS_ICONS: Record<ShotStatus, React.ReactNode> = {
  pending: <Clock className="h-3 w-3" />,
  generating: <Loader2 className="h-3 w-3 animate-spin" />,
  completed: <Play className="h-3 w-3" />,
  failed: <AlertCircle className="h-3 w-3" />,
};

export function ShotCard({ shot, isSelected, onClick }: ShotCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group cursor-pointer overflow-hidden rounded-xl border backdrop-blur-sm transition-all',
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-500/20 dark:border-blue-400'
          : 'border-white/50 hover:border-gray-300 hover:shadow-lg dark:border-white/10 dark:hover:border-gray-600',
        'bg-white/80 shadow-sm dark:bg-gray-800/80',
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gray-100 dark:bg-gray-700">
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
            <ImageIcon className="h-8 w-8 text-gray-300 dark:text-gray-600" />
          </div>
        )}

        {/* Status Badge */}
        <div
          className={cn(
            'absolute top-2 left-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            STATUS_STYLES[shot.status],
          )}
        >
          {STATUS_ICONS[shot.status]}
          <span className="capitalize">{shot.status}</span>
        </div>

        {/* Shot Number */}
        <div className="absolute right-2 bottom-2 rounded bg-black/70 px-2 py-0.5 text-xs font-bold text-white">
          #{shot.shotNumber}
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

      {/* Content */}
      <div className="p-3">
        {/* Duration */}
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {shot.duration}s
          </span>
          {shot.cameraDirection && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {shot.cameraDirection}
            </span>
          )}
        </div>

        {/* Description */}
        <p className="line-clamp-2 text-sm text-gray-700 dark:text-gray-300">
          {shot.description || shot.prompt || 'No description'}
        </p>
      </div>
    </div>
  );
}
