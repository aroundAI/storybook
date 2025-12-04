# FILM-902: Dashboard Widgets

## Metadata
- **Phase:** 9 - Integration
- **Priority:** P2 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-805 (Analytics), FILM-804 (Sync), All feature packages
- **Blocks:** None

---

## Context

Dashboard Widgets provide at-a-glance information on the Studio home page and project overview pages. They show recent activity, active generations, upcoming scheduled publishes, and performance summaries to help creators quickly understand their content status.

---

## Specification

### Requirements

1. **Recent Activity**: Latest actions across all projects
2. **Generation Queue**: Active and recent generation jobs
3. **Scheduled Publishes**: Upcoming content going live
4. **Quick Stats**: Key metrics summary
5. **Project Cards**: Recently accessed projects
6. **Customizable**: Users can reorder/hide widgets

### Widget Container

```typescript
// packages/features/film-studio/src/components/dashboard-widgets.tsx

'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { MoreHorizontal, ArrowRight } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

interface WidgetProps {
  title: string;
  description?: string;
  action?: {
    label: string;
    href: string;
  };
  children: React.ReactNode;
  onRemove?: () => void;
}

export function Widget({
  title,
  description,
  action,
  children,
  onRemove,
}: WidgetProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && (
            <CardDescription className="text-sm">{description}</CardDescription>
          )}
        </div>
        <div className="flex items-center gap-2">
          {action && (
            <Button variant="ghost" size="sm" asChild>
              <Link href={action.href}>
                {action.label}
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          )}
          {onRemove && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onRemove}>
                  Hide widget
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
```

### Recent Activity Widget

```typescript
// packages/features/film-studio/src/components/widgets/recent-activity.tsx

'use client';

import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Widget } from '../dashboard-widgets';
import { getRecentActivityAction } from '../../server/activity-actions';
import {
  Clapperboard,
  Video,
  Music,
  Share2,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react';

const ACTIVITY_ICONS = {
  episode_created: Clapperboard,
  video_generated: Video,
  audio_generated: Music,
  published: Share2,
  generation_completed: CheckCircle,
  generation_failed: XCircle,
};

interface RecentActivityWidgetProps {
  accountId: string;
}

export function RecentActivityWidget({ accountId }: RecentActivityWidgetProps) {
  const { data: activities } = useQuery({
    queryKey: ['recent-activity', accountId],
    queryFn: () => getRecentActivityAction({ accountId, limit: 10 }),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  return (
    <Widget
      title="Recent Activity"
      action={{ label: 'View all', href: '/activity' }}
    >
      <div className="space-y-3">
        {activities?.map((activity) => {
          const Icon = ACTIVITY_ICONS[activity.type] || Clock;

          return (
            <div key={activity.id} className="flex items-start gap-3">
              <div className="p-1.5 rounded-full bg-muted">
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm line-clamp-1">{activity.description}</p>
                <p className="text-xs text-muted-foreground">
                  {activity.projectName} • {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                </p>
              </div>
            </div>
          );
        })}

        {activities?.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No recent activity
          </p>
        )}
      </div>
    </Widget>
  );
}
```

### Generation Queue Widget

```typescript
// packages/features/film-studio/src/components/widgets/generation-queue.tsx

'use client';

import { useQuery } from '@tanstack/react-query';
import { Widget } from '../dashboard-widgets';
import { Progress } from '@kit/ui/progress';
import { Badge } from '@kit/ui/badge';
import { getActiveGenerationsAction } from '../../server/generation-actions';

interface GenerationQueueWidgetProps {
  accountId: string;
}

export function GenerationQueueWidget({ accountId }: GenerationQueueWidgetProps) {
  const { data: jobs } = useQuery({
    queryKey: ['active-generations', accountId],
    queryFn: () => getActiveGenerationsAction({ accountId }),
    refetchInterval: 5000, // Poll every 5 seconds for active jobs
  });

  const activeJobs = jobs?.filter((j) => j.status === 'processing') || [];
  const queuedJobs = jobs?.filter((j) => j.status === 'queued') || [];

  return (
    <Widget
      title="Generation Queue"
      description={`${activeJobs.length} active, ${queuedJobs.length} queued`}
    >
      <div className="space-y-4">
        {activeJobs.map((job) => (
          <div key={job.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {job.jobType}
                </Badge>
                <span className="text-sm truncate max-w-[150px]">
                  {job.name}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {job.progress}%
              </span>
            </div>
            <Progress value={job.progress} className="h-1.5" />
          </div>
        ))}

        {queuedJobs.length > 0 && (
          <div className="pt-2 border-t">
            <p className="text-sm text-muted-foreground mb-2">
              Queued ({queuedJobs.length})
            </p>
            <div className="flex flex-wrap gap-1">
              {queuedJobs.slice(0, 5).map((job) => (
                <Badge key={job.id} variant="outline" className="text-xs">
                  {job.jobType}
                </Badge>
              ))}
              {queuedJobs.length > 5 && (
                <Badge variant="outline" className="text-xs">
                  +{queuedJobs.length - 5} more
                </Badge>
              )}
            </div>
          </div>
        )}

        {activeJobs.length === 0 && queuedJobs.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No active generations
          </p>
        )}
      </div>
    </Widget>
  );
}
```

### Scheduled Publishes Widget

```typescript
// packages/features/film-studio/src/components/widgets/scheduled-publishes.tsx

'use client';

import { useQuery } from '@tanstack/react-query';
import { format, isSameDay, isToday, isTomorrow } from 'date-fns';
import { Widget } from '../dashboard-widgets';
import { Badge } from '@kit/ui/badge';
import { getScheduledPublishesAction } from '../../server/publish-actions';
import { Youtube, Instagram, Facebook } from 'lucide-react';

const PLATFORM_ICONS = {
  youtube: Youtube,
  tiktok: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
    </svg>
  ),
  instagram: Instagram,
  facebook: Facebook,
};

interface ScheduledPublishesWidgetProps {
  accountId: string;
}

export function ScheduledPublishesWidget({ accountId }: ScheduledPublishesWidgetProps) {
  const { data: publishes } = useQuery({
    queryKey: ['scheduled-publishes', accountId],
    queryFn: () => getScheduledPublishesAction({ accountId, limit: 5 }),
  });

  return (
    <Widget
      title="Scheduled Publishes"
      action={{ label: 'Manage', href: '/studio/publish' }}
    >
      <div className="space-y-3">
        {publishes?.map((publish) => {
          const Icon = PLATFORM_ICONS[publish.platform];
          const scheduledDate = new Date(publish.scheduledAt);

          return (
            <div key={publish.id} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{publish.title}</p>
                <p className="text-xs text-muted-foreground">
                  {publish.episodeTitle}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">
                  {formatScheduleDate(scheduledDate)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(scheduledDate, 'h:mm a')}
                </p>
              </div>
            </div>
          );
        })}

        {publishes?.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
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
```

### Quick Stats Widget

```typescript
// packages/features/film-studio/src/components/widgets/quick-stats.tsx

'use client';

import { useQuery } from '@tanstack/react-query';
import { Widget } from '../dashboard-widgets';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { getQuickStatsAction } from '../../server/stats-actions';
import { formatNumber, formatPercent } from '@kit/content-analytics/lib/format';

interface QuickStatsWidgetProps {
  accountId: string;
}

export function QuickStatsWidget({ accountId }: QuickStatsWidgetProps) {
  const { data: stats } = useQuery({
    queryKey: ['quick-stats', accountId],
    queryFn: () => getQuickStatsAction({ accountId }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const metrics = [
    {
      label: 'Total Views (7d)',
      value: stats?.views || 0,
      change: stats?.viewsChange || 0,
    },
    {
      label: 'New Followers',
      value: stats?.followers || 0,
      change: stats?.followersChange || 0,
    },
    {
      label: 'Engagement Rate',
      value: `${(stats?.engagementRate || 0).toFixed(1)}%`,
      change: stats?.engagementChange || 0,
    },
    {
      label: 'Content Published',
      value: stats?.publishedCount || 0,
      change: null,
    },
  ];

  return (
    <Widget title="Quick Stats" description="Last 7 days">
      <div className="grid grid-cols-2 gap-4">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <p className="text-xs text-muted-foreground">{metric.label}</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-bold tabular-nums">
                {typeof metric.value === 'number'
                  ? formatNumber(metric.value)
                  : metric.value}
              </span>
              {metric.change !== null && (
                <ChangeIndicator value={metric.change} />
              )}
            </div>
          </div>
        ))}
      </div>
    </Widget>
  );
}

function ChangeIndicator({ value }: { value: number }) {
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  const color = value > 0 ? 'text-green-600' : value < 0 ? 'text-red-600' : 'text-muted-foreground';

  return (
    <span className={`flex items-center gap-0.5 text-xs ${color}`}>
      <Icon className="h-3 w-3" />
      {formatPercent(Math.abs(value))}
    </span>
  );
}
```

### Dashboard Layout

```typescript
// packages/features/film-studio/src/components/studio-dashboard.tsx

'use client';

import { RecentActivityWidget } from './widgets/recent-activity';
import { GenerationQueueWidget } from './widgets/generation-queue';
import { ScheduledPublishesWidget } from './widgets/scheduled-publishes';
import { QuickStatsWidget } from './widgets/quick-stats';
import { RecentProjectsWidget } from './widgets/recent-projects';

interface StudioDashboardProps {
  accountId: string;
}

export function StudioDashboard({ accountId }: StudioDashboardProps) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <QuickStatsWidget accountId={accountId} />
      </div>
      <div>
        <GenerationQueueWidget accountId={accountId} />
      </div>
      <div>
        <RecentActivityWidget accountId={accountId} />
      </div>
      <div>
        <ScheduledPublishesWidget accountId={accountId} />
      </div>
      <div>
        <RecentProjectsWidget accountId={accountId} />
      </div>
    </div>
  );
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/film-studio/src/components/dashboard-widgets.tsx` |
| CREATE | `packages/features/film-studio/src/components/widgets/recent-activity.tsx` |
| CREATE | `packages/features/film-studio/src/components/widgets/generation-queue.tsx` |
| CREATE | `packages/features/film-studio/src/components/widgets/scheduled-publishes.tsx` |
| CREATE | `packages/features/film-studio/src/components/widgets/quick-stats.tsx` |
| CREATE | `packages/features/film-studio/src/components/widgets/recent-projects.tsx` |
| CREATE | `packages/features/film-studio/src/components/studio-dashboard.tsx` |
| CREATE | `packages/features/film-studio/src/server/activity-actions.ts` |
| CREATE | `packages/features/film-studio/src/server/stats-actions.ts` |

---

## Acceptance Criteria

- [ ] Dashboard shows all widgets in responsive grid
- [ ] Recent Activity updates every 30 seconds
- [ ] Generation Queue updates every 5 seconds
- [ ] Scheduled Publishes shows upcoming content
- [ ] Quick Stats shows 7-day trends
- [ ] Widgets can be hidden via dropdown menu
- [ ] Links navigate to full sections
- [ ] Loading states for all widgets
- [ ] Empty states when no data

---

## Test Plan

### Unit Tests
- [ ] Test date formatting functions
- [ ] Test change indicator logic

### Integration Tests
- [ ] Test widget data fetching
- [ ] Test real-time updates

---

## Performance Considerations

- Use React Query for caching and background updates
- Stagger refetch intervals to avoid request bursts
- Skeleton loading for initial render
- Limit activity/queue items to recent 10
