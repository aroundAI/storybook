'use client';

import { useCallback, useMemo } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { StudioTab } from '../lib/types';

const VALID_TABS: StudioTab[] = [
  'ideation',
  'story',
  'screenplay',
  'shot-list',
];

function isValidTab(tab: string | null): tab is StudioTab {
  return tab !== null && VALID_TABS.includes(tab as StudioTab);
}

export function useUrlTabState(
  defaultTab: StudioTab,
): [StudioTab, (tab: StudioTab) => void] {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const rawSearchParams = useSearchParams();
  const searchParams = useMemo(
    () => rawSearchParams ?? new URLSearchParams(),
    [rawSearchParams],
  );

  // Derive active tab directly from URL - single source of truth
  const activeTab = useMemo(() => {
    const urlTab = searchParams.get('tab');
    return isValidTab(urlTab) ? urlTab : defaultTab;
  }, [searchParams, defaultTab]);

  const setActiveTab = useCallback(
    (newTab: StudioTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', newTab);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return [activeTab, setActiveTab];
}
