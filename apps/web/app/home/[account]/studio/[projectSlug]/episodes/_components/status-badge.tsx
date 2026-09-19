'use client';

import {
  CheckCircle,
  FileText,
  Loader2,
  Pencil,
  Send,
  Sparkles,
} from 'lucide-react';

import type { EpisodeStatus } from '@kit/episodes/types';
import { Badge } from '@kit/ui/badge';
import { cn } from '@kit/ui/utils';

interface StatusBadgeProps {
  status: EpisodeStatus;
  className?: string;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Status configuration with semantic colors and icons
 * Uses the new status color tokens defined in shadcn-ui.css
 */
const STATUS_CONFIG: Record<
  EpisodeStatus,
  {
    label: string;
    className: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  draft: {
    label: 'Draft',
    className: 'status-pending',
    icon: FileText,
  },
  story: {
    label: 'Story',
    className: 'status-draft',
    icon: Pencil,
  },
  storyboard: {
    label: 'Storyboard',
    className: 'status-processing',
    icon: Sparkles,
  },
  generating: {
    label: 'Generating',
    className: 'status-processing',
    icon: Loader2,
  },
  editing: {
    label: 'Editing',
    className: 'status-draft',
    icon: Pencil,
  },
  ready: {
    label: 'Ready',
    className: 'status-complete',
    icon: CheckCircle,
  },
  published: {
    label: 'Published',
    className: 'status-complete',
    icon: Send,
  },
};

const SIZE_CLASSES = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-xs px-2.5 py-0.5',
  lg: 'text-sm px-3 py-1',
};

export function StatusBadge({
  status,
  className,
  showIcon = true,
  size = 'md',
}: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG['draft'];
  const IconComponent = config.icon;
  const isAnimated = status === 'generating';

  return (
    <Badge
      className={cn(
        config.className,
        SIZE_CLASSES[size],
        'inline-flex items-center gap-1.5 rounded-full border-0 font-medium',
        className,
      )}
    >
      {showIcon && (
        <IconComponent
          className={cn('h-3 w-3', isAnimated && 'animate-spin')}
        />
      )}
      {config.label}
    </Badge>
  );
}

/**
 * Compact status indicator for list views - just a colored dot
 */
interface StatusDotProps {
  status: 'complete' | 'in-progress' | 'empty' | 'error';
  className?: string;
  size?: 'sm' | 'md';
}

export function StatusDot({ status, className, size = 'md' }: StatusDotProps) {
  const dotClasses = {
    complete: 'bg-status-complete',
    'in-progress': 'bg-status-processing animate-pulse',
    empty: 'bg-muted-foreground/30',
    error: 'bg-status-error',
  };

  const sizeClasses = {
    sm: 'h-2 w-2',
    md: 'h-2.5 w-2.5',
  };

  return (
    <span
      className={cn(
        'inline-block rounded-full',
        dotClasses[status],
        sizeClasses[size],
        className,
      )}
      aria-label={status}
    />
  );
}

/**
 * Stage status with label for episode cards
 */
interface StageIndicatorProps {
  stage: string;
  status: 'complete' | 'in-progress' | 'empty';
  className?: string;
}

export function StageIndicator({
  stage,
  status,
  className,
}: StageIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <StatusDot status={status} size="sm" />
      <span className="text-xs text-muted-foreground">{stage}</span>
    </div>
  );
}
