'use client';

import { useCallback, useEffect, useState } from 'react';

import { GenerationQueueWidget } from './widgets/generation-queue';
import { QuickStatsWidget } from './widgets/quick-stats';
import { RecentActivityWidget } from './widgets/recent-activity';
import { RecentProjectsWidget } from './widgets/recent-projects';
import { ScheduledPublishesWidget } from './widgets/scheduled-publishes';

const STORAGE_KEY = 'studio-dashboard-hidden-widgets';

type WidgetId =
  | 'quick-stats'
  | 'generation-queue'
  | 'recent-activity'
  | 'scheduled-publishes'
  | 'recent-projects';

interface StudioDashboardProps {
  accountId: string;
  accountSlug: string;
}

export function StudioDashboard({
  accountId,
  accountSlug,
}: StudioDashboardProps) {
  const [hiddenWidgets, setHiddenWidgets] = useState<Set<WidgetId>>(new Set());

  // useEffect justified: Required for client-side localStorage hydration.
  // localStorage is only available in the browser, so we need to read
  // stored widget preferences after the component mounts on the client.
  // This avoids hydration mismatch between server and client rendering.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setHiddenWidgets(new Set(JSON.parse(stored) as WidgetId[]));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const hideWidget = useCallback((widgetId: WidgetId) => {
    setHiddenWidgets((prev) => {
      const next = new Set(prev);
      next.add(widgetId);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }, []);

  const isVisible = (widgetId: WidgetId) => !hiddenWidgets.has(widgetId);

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {isVisible('quick-stats') && (
        <div className="lg:col-span-2">
          <QuickStatsWidget
            accountId={accountId}
            onRemove={() => hideWidget('quick-stats')}
          />
        </div>
      )}

      {isVisible('generation-queue') && (
        <div>
          <GenerationQueueWidget
            accountId={accountId}
            onRemove={() => hideWidget('generation-queue')}
          />
        </div>
      )}

      {isVisible('recent-activity') && (
        <div>
          <RecentActivityWidget
            accountId={accountId}
            onRemove={() => hideWidget('recent-activity')}
          />
        </div>
      )}

      {isVisible('scheduled-publishes') && (
        <div>
          <ScheduledPublishesWidget
            accountId={accountId}
            onRemove={() => hideWidget('scheduled-publishes')}
          />
        </div>
      )}

      {isVisible('recent-projects') && (
        <div>
          <RecentProjectsWidget
            accountId={accountId}
            accountSlug={accountSlug}
            onRemove={() => hideWidget('recent-projects')}
          />
        </div>
      )}
    </div>
  );
}
