'use client';

import { memo, useState } from 'react';

import Image from 'next/image';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  GripVertical,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Upload,
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
  onCopyPrompt,
  onEditPrompt,
  onRegeneratePrompt,
  onUploadVideo,
}: ShotCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const handleCopyPrompt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const promptText = shot.prompt ?? shot.description;
    if (promptText) {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopyPrompt?.();
    }
  };

  const handleEditPrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEditPrompt?.();
  };

  const handleRegeneratePrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRegeneratePrompt?.();
  };

  const handleUploadVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUploadVideo?.();
  };

  const toggleExpanded = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
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
          /* Skeleton shimmer with prompt preview */
          <div className="flex h-full flex-col items-center justify-center p-3 skeleton">
            <div className="text-center">
              <span className="text-xs text-muted-foreground/80 line-clamp-3">
                {shot.prompt ?? shot.description ?? 'Awaiting generation...'}
              </span>
            </div>
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

        {/* Prompt Section */}
        <div className="mt-2">
          <div className="flex items-start gap-1">
            <p
              className={cn(
                'text-muted-foreground flex-1 text-xs',
                !isExpanded && 'line-clamp-2',
              )}
            >
              {shot.prompt ?? shot.description}
            </p>
            {(shot.prompt ?? shot.description) && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0"
                onClick={toggleExpanded}
                title={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </Button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-2 flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={handleCopyPrompt}
              title="Copy prompt to clipboard"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-green-600" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy</span>
                </>
              )}
            </Button>

            {onEditPrompt && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleEditPrompt}
                title="Edit prompt"
              >
                <Edit3 className="h-3 w-3" />
              </Button>
            )}

            {onRegeneratePrompt && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleRegeneratePrompt}
                title="Regenerate prompt"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}

            {onUploadVideo && !shot.videoUrl && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleUploadVideo}
                title="Upload video"
              >
                <Upload className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        <div className="text-muted-foreground mt-1 text-xs">
          {shot.duration}s &middot; {shot.aspectRatio}
        </div>
      </div>
    </div>
  );
});
