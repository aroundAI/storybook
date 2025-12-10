'use client';

import { memo } from 'react';

import Image from 'next/image';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertCircle,
  GripVertical,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

import type { ShotCardProps } from './types';
import { STATUS_VARIANTS } from './types';

export const ShotCard = memo(function ShotCard({
  shot,
  isSelected,
  isDragging = false,
  onClick,
  onDoubleClick,
  onGenerateClick,
  onRetryClick,
}: ShotCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: shot.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isBeingDragged = isDragging || isSortableDragging;

  const handleGenerateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onGenerateClick?.();
  };

  const handleRetryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRetryClick?.();
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick?.();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
      role="gridcell"
      aria-selected={isSelected}
      aria-label={`Shot ${shot.sceneNumber}.${shot.shotNumber}: ${shot.prompt ?? shot.description}`}
      data-test="shot-card"
      className={cn(
        'bg-card group relative cursor-pointer rounded-lg border-2 p-2 transition-all',
        isSelected
          ? 'border-primary ring-primary/20 shadow-lg ring-2'
          : 'border-border hover:border-muted-foreground/50 hover:shadow-md',
        isBeingDragged && 'opacity-50',
      )}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="text-muted-foreground hover:text-foreground absolute left-2 top-2 z-10 cursor-grab rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Thumbnail/Video Preview */}
      <div className="bg-muted relative aspect-video overflow-hidden rounded">
        {shot.videoUrl ? (
          <video
            src={shot.videoUrl}
            className="h-full w-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
        ) : shot.thumbnailUrl ? (
          <Image
            src={shot.thumbnailUrl}
            alt={`Shot ${shot.sceneNumber}.${shot.shotNumber}`}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            No preview
          </div>
        )}

        {/* Status Overlays */}
        {shot.status === 'generating' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
            <span className="mt-2 text-sm text-white">Generating...</span>
            {shot.progress !== undefined && shot.progress > 0 && (
              <div className="mt-2 h-1 w-3/4 overflow-hidden rounded-full bg-white/30">
                <div
                  className="h-full bg-white transition-all"
                  style={{ width: `${shot.progress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {shot.status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-500/20">
            <AlertCircle className="h-8 w-8 text-red-600" />
            <span className="mt-2 text-sm font-medium text-red-700">
              Failed
            </span>
            {onRetryClick && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={handleRetryClick}
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                Retry
              </Button>
            )}
          </div>
        )}

        {shot.status === 'completed' && shot.videoUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity hover:opacity-100">
            <Button
              size="icon"
              variant="secondary"
              className="h-10 w-10 rounded-full"
              onClick={handleDoubleClick}
            >
              <Play className="h-5 w-5" />
            </Button>
          </div>
        )}

        {(shot.status === 'pending' || shot.status === 'queued') &&
          !shot.videoUrl &&
          onGenerateClick && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity hover:opacity-100">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleGenerateClick}
              >
                <Sparkles className="mr-1 h-4 w-4" />
                Generate
              </Button>
            </div>
          )}
      </div>

      {/* Shot Info */}
      <div className="mt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">
            Shot #{shot.sceneNumber}.{shot.shotNumber}
          </span>
          <Badge className={cn('text-xs', STATUS_VARIANTS[shot.status])}>
            {shot.status}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
          {shot.prompt ?? shot.description}
        </p>
        <div className="text-muted-foreground mt-1 text-xs">
          {shot.duration}s &middot; {shot.aspectRatio}
        </div>
      </div>
    </div>
  );
});
