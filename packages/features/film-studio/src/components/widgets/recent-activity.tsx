'use client';

import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  CheckCircle,
  Clapperboard,
  Clock,
  Music,
  Share2,
  Video,
  XCircle,
} from 'lucide-react';

import { Skeleton } from '@kit/ui/skeleton';

import type { Activity, ActivityType } from '../../server/activity-actions';
import { getRecentActivityAction } from '../../server/activity-actions';
import { Widget } from '../dashboard-widgets';

const ACTIVITY_ICONS: Record<
  ActivityType,
  React.ComponentType<{ className?: string }>
> = {
  episode_created: Clapperboard,
  video_generated: Video,
  audio_generated: Music,
  published: Share2,
  generation_completed: CheckCircle,
  generation_failed: XCircle,
};

interface RecentActivityWidgetProps {
  accountId: string;
  onRemove?: () => void;
}

export function RecentActivityWidget({
  accountId,
  onRemove,
}: RecentActivityWidgetProps) {
  const { data: activities, isLoading } = useQuery({
    queryKey: ['recent-activity', accountId],
    queryFn: () => getRecentActivityAction({ accountId, limit: 10 }),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  return (
    <Widget
      title="Recent Activity"
      action={{ label: 'View all', href: '#' }}
      onRemove={onRemove}
    >
      <div className="space-y-3">
        {isLoading && <ActivitySkeleton />}

        {!isLoading &&
          activities?.map((activity: Activity) => {
            const Icon = ACTIVITY_ICONS[activity.type] || Clock;

            return (
              <div key={activity.id} className="flex items-start gap-3">
                <div className="bg-muted rounded-full p-1.5">
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm">{activity.description}</p>
                  <p className="text-muted-foreground text-xs">
                    {activity.projectName} •{' '}
                    {formatDistanceToNow(new Date(activity.createdAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              </div>
            );
          })}

        {!isLoading && activities?.length === 0 && (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No recent activity
          </p>
        )}
      </div>
    </Widget>
  );
}

function ActivitySkeleton() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-3">
          <Skeleton className="h-7 w-7 rounded-full" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </>
  );
}
