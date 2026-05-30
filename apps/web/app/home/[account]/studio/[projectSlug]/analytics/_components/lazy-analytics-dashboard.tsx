'use client';

import dynamic from 'next/dynamic';

import { AnalyticsDashboardSkeleton } from '@kit/content-analytics/components';

export const LazyAnalyticsDashboard = dynamic(
  () =>
    import('@kit/content-analytics/components').then((mod) => ({
      default: mod.AnalyticsDashboard,
    })),
  {
    ssr: false,
    loading: () => <AnalyticsDashboardSkeleton />,
  },
);
