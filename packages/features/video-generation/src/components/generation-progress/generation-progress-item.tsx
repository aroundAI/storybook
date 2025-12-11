'use client';

import { memo } from 'react';

import { AlertCircle, Check, Clock, Loader2, X } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Progress } from '@kit/ui/progress';
import { cn } from '@kit/ui/utils';

import type { GenerationProgressItemProps } from './types';

const STATUS_CONFIG = {
  queued: {
    icon: Clock,
    label: 'In queue',
    badgeVariant: 'outline' as const,
    badgeClass:
      'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  processing: {
    icon: Loader2,
    label: 'Generating',
    badgeVariant: 'secondary' as const,
    badgeClass:
      'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  },
  completed: {
    icon: Check,
    label: 'Complete',
    badgeVariant: 'default' as const,
    badgeClass:
      'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
  failed: {
    icon: AlertCircle,
    label: 'Failed',
    badgeVariant: 'destructive' as const,
    badgeClass: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
};

export const GenerationProgressItem = memo(function GenerationProgressItem({
  shot,
  status,
  isLoading,
  onCancel,
}: GenerationProgressItemProps) {
  // Map shot status to config status
  const statusKey =
    shot.status === 'generating' ? 'processing' : (shot.status as string);
  const currentStatus = status?.status ?? statusKey;
  const config =
    STATUS_CONFIG[currentStatus as keyof typeof STATUS_CONFIG] ??
    STATUS_CONFIG.queued;
  const Icon = config.icon;
  const isActive = currentStatus === 'queued' || currentStatus === 'processing';
  const progress = status?.progress ?? 0;

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        isActive ? 'bg-muted/50' : 'bg-background',
      )}
      role="status"
      aria-live="polite"
      aria-label={`Shot ${shot.sceneNumber}.${shot.shotNumber}: ${config.label}`}
      data-test="generation-progress-item"
    >
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            Shot #{shot.sceneNumber}.{shot.shotNumber}
          </span>
          <Badge
            variant={config.badgeVariant}
            className={cn('text-xs', config.badgeClass)}
          >
            <Icon
              className={cn(
                'mr-1 h-3 w-3',
                currentStatus === 'processing' && 'animate-spin',
              )}
            />
            {config.label}
          </Badge>
          {isLoading && (
            <Loader2 className="text-muted-foreground h-3 w-3 animate-spin" />
          )}
        </div>

        {/* Cancel button - only show for active jobs */}
        {isActive && onCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-muted-foreground hover:text-destructive h-7 px-2"
            aria-label={`Cancel generation for shot ${shot.sceneNumber}.${shot.shotNumber}`}
            data-test="cancel-generation-button"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Progress bar - only for processing status */}
      {currentStatus === 'processing' && (
        <div className="mb-2">
          <Progress
            value={progress}
            className="h-1.5"
            aria-label={`Shot ${shot.sequenceNumber} generation progress: ${progress}%`}
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
          <div className="text-muted-foreground mt-1 flex justify-between text-xs">
            <span>{progress}%</span>
            {status?.estimatedTimeRemaining && (
              <span>
                ~{Math.ceil(status.estimatedTimeRemaining / 60)}m remaining
              </span>
            )}
          </div>
        </div>
      )}

      {/* Queue position */}
      {currentStatus === 'queued' && status?.queuePosition && (
        <p className="text-muted-foreground mb-2 text-xs">
          Position in queue: {status.queuePosition}
        </p>
      )}

      {/* Error message */}
      {currentStatus === 'failed' && status?.errorMessage && (
        <p className="text-destructive mb-2 text-xs">
          Error: {status.errorMessage}
        </p>
      )}

      {/* Prompt preview */}
      {shot.prompt && (
        <p className="text-muted-foreground line-clamp-1 text-xs">
          {shot.prompt}
        </p>
      )}
    </div>
  );
});
