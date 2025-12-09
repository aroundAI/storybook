'use client';

import { useQuery } from '@tanstack/react-query';
import { format, isToday, isTomorrow } from 'date-fns';
import { Facebook, Instagram, Linkedin, Twitter, Youtube } from 'lucide-react';

import { Skeleton } from '@kit/ui/skeleton';

import type { Platform, ScheduledPublish } from '../../server/publish-actions';
import { getScheduledPublishesAction } from '../../server/publish-actions';
import { Widget } from '../dashboard-widgets';

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
    </svg>
  );
}

const PLATFORM_ICONS: Record<
  Platform,
  React.ComponentType<{ className?: string }>
> = {
  youtube: Youtube,
  tiktok: TikTokIcon,
  instagram: Instagram,
  facebook: Facebook,
  twitter: Twitter,
  linkedin: Linkedin,
};

interface ScheduledPublishesWidgetProps {
  accountId: string;
  onRemove?: () => void;
}

export function ScheduledPublishesWidget({
  accountId,
  onRemove,
}: ScheduledPublishesWidgetProps) {
  const { data: publishes, isLoading } = useQuery({
    queryKey: ['scheduled-publishes', accountId],
    queryFn: () => getScheduledPublishesAction({ accountId, limit: 5 }),
  });

  return (
    <Widget
      title="Scheduled Publishes"
      action={{ label: 'Manage', href: '#' }}
      onRemove={onRemove}
    >
      <div className="space-y-3">
        {isLoading && <PublishesSkeleton />}

        {!isLoading &&
          publishes?.map((publish: ScheduledPublish) => {
            const Icon = PLATFORM_ICONS[publish.platform];
            const scheduledDate = new Date(publish.scheduledAt);

            return (
              <div key={publish.id} className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {publish.title}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {publish.episodeTitle}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">
                    {formatScheduleDate(scheduledDate)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {format(scheduledDate, 'h:mm a')}
                  </p>
                </div>
              </div>
            );
          })}

        {!isLoading && publishes?.length === 0 && (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No scheduled publishes
          </p>
        )}
      </div>
    </Widget>
  );
}

function formatScheduleDate(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'MMM d');
}

function PublishesSkeleton() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-4" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <div className="space-y-1 text-right">
            <Skeleton className="ml-auto h-4 w-12" />
            <Skeleton className="ml-auto h-3 w-10" />
          </div>
        </div>
      ))}
    </>
  );
}
