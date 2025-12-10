import type { EpisodeStatus } from '@kit/episodes/types';
import { Badge } from '@kit/ui/badge';
import { cn } from '@kit/ui/utils';

interface StatusBadgeProps {
  status: EpisodeStatus;
  className?: string;
}

const STATUS_CONFIG: Record<
  EpisodeStatus,
  { label: string; className: string }
> = {
  draft: {
    label: 'Draft',
    className: 'bg-gray-500 hover:bg-gray-600',
  },
  story: {
    label: 'Story',
    className: 'bg-blue-500 hover:bg-blue-600',
  },
  storyboard: {
    label: 'Storyboard',
    className: 'bg-purple-500 hover:bg-purple-600',
  },
  generating: {
    label: 'Generating',
    className: 'bg-yellow-500 hover:bg-yellow-600',
  },
  editing: {
    label: 'Editing',
    className: 'bg-orange-500 hover:bg-orange-600',
  },
  ready: {
    label: 'Ready',
    className: 'bg-green-500 hover:bg-green-600',
  },
  published: {
    label: 'Published',
    className: 'bg-emerald-500 hover:bg-emerald-600',
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG['draft'];

  return (
    <Badge className={cn(config.className, 'text-white', className)}>
      {config.label}
    </Badge>
  );
}
