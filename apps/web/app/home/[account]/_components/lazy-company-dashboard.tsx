'use client';

import dynamic from 'next/dynamic';

import { CompanyDashboardSkeleton } from '@kit/content-analytics/components';

export const LazyCompanyDashboard = dynamic(
  () =>
    import('@kit/content-analytics/components').then((mod) => ({
      default: mod.CompanyDashboard,
    })),
  {
    ssr: false,
    loading: () => <CompanyDashboardSkeleton />,
  },
);
