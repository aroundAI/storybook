'use client';

import { cn } from '@kit/ui/utils';

import type { Shot } from '../../lib/types';
import { MaterialIcon } from '../ui';

interface ShotCardProps {
  shot: Shot;
  size?: 'sm' | 'md' | 'lg';
  isSelected?: boolean;
  onSelect?: (selected: boolean) => void;
  onClick?: () => void;
}

const sizeClasses = {
  sm: 'comic-panel-sm',
  md: 'comic-panel-md',
  lg: 'comic-panel-lg',
};

const statusColors = {
  pending: 'bg-orange-200 text-orange-700',
  generating: 'bg-blue-200 text-blue-700',
  completed: 'bg-green-200 text-green-700',
  failed: 'bg-red-200 text-red-700',
};

const statusLabels = {
  pending: 'PENDING',
  generating: 'GENERATING',
  completed: 'COMPLETED',
  failed: 'FAILED',
};

/**
 * ShotCard - Individual shot card with liquid glass styling
 */
export function ShotCard({
  shot,
  size = 'md',
  isSelected,
  onSelect,
  onClick,
}: ShotCardProps) {
  const hasImage = !!shot.thumbnailUrl;

  return (
    <div
      className={cn(
        'liquid-card relative flex flex-col overflow-hidden p-4 pb-6 transition-all',
        sizeClasses[size],
        'group cursor-pointer',
        isSelected && 'ring-primary ring-2',
        'hover:shadow-apple-lg hover:-translate-y-0.5',
      )}
      onClick={onClick}
    >
      {/* Selection checkbox */}
      {onSelect && (
        <div className="absolute left-3 top-3 z-10">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => {
              e.stopPropagation();
              onSelect(e.target.checked);
            }}
            className="h-4 w-4 rounded border-gray-300"
          />
        </div>
      )}

      {/* Image container */}
      <div className="relative flex-1">
        {hasImage ? (
          <div className="liquid-image-container h-full w-full">
            <img
              src={shot.thumbnailUrl!}
              alt={shot.description}
              className="relative z-0 h-full w-full rounded-2xl object-cover"
            />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-2xl bg-gray-100">
            <MaterialIcon name="image" size="xl" className="text-gray-400" />
          </div>
        )}

        {/* Status badge - top right */}
        <div
          className={cn(
            'liquid-pill absolute right-3 top-3 text-xs font-medium',
            statusColors[shot.status],
          )}
        >
          {statusLabels[shot.status]}
        </div>
      </div>

      {/* Shot number badge - bottom left */}
      <div className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-2 py-1 text-xs font-medium text-white">
        Shot {shot.sceneNumber}.{shot.shotNumber}
      </div>

      {/* Action description */}
      <div className="mt-4 px-2">
        <p className="text-debossed line-clamp-2 font-semibold text-gray-800">
          {shot.description}
        </p>
        <p className="text-debossed mt-1 text-xs text-gray-500">
          {shot.duration}s • {shot.cameraAngle || 'medium'} •{' '}
          {shot.cameraMovement || 'static'}
        </p>
      </div>
    </div>
  );
}

/**
 * AddShotCard - Placeholder card for adding new shots
 */
export function AddShotCard({ onClick }: { onClick?: () => void }) {
  return (
    <div
      className={cn(
        'comic-panel liquid-card flex cursor-pointer flex-col items-center justify-center',
        'border-dashed border-gray-300 bg-gray-50/50 text-gray-500',
        'transition-colors hover:bg-gray-100/50',
      )}
      onClick={onClick}
    >
      <MaterialIcon name="add_circle" size="xl" className="mb-2" />
      <span className="text-debossed">Add New Shot</span>
    </div>
  );
}
