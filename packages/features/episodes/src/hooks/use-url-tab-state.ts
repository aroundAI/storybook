'use client';

import { useCallback, useEffect, useState } from 'react';

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
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlTab = searchParams.get('tab');
  const initialTab = isValidTab(urlTab) ? urlTab : defaultTab;

  const [activeTab, setActiveTabState] = useState<StudioTab>(initialTab);

  // Sync URL to state on mount and URL changes
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');

    if (isValidTab(tabFromUrl) && tabFromUrl !== activeTab) {
      setActiveTabState(tabFromUrl);
    }
  }, [searchParams, activeTab]);

  const setActiveTab = useCallback(
    (newTab: StudioTab) => {
      setActiveTabState(newTab);

      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', newTab);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return [activeTab, setActiveTab];
}
