'use client';

import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useQuery } from '@tanstack/react-query';

import {
  ANALYTICS_PLATFORMS,
  CAPABILITY_MATRIX,
  capabilityCoverage,
} from '@kit/clickhouse';
import type {
  AnalyticsPlatform,
  CoverageState,
  MetricFamily,
} from '@kit/clickhouse';

import type { CoverageMatrixResult } from '../lib/coverage';
import type { Scope } from '../lib/schemas/traffic.schema';
import { getCoverageMatrixAction } from '../server/coverage-actions';

/**
 * How long the window must stay put before it is asked about. A range
 * calendar emits a range on every click — the first click is a one-day
 * range — and each would otherwise be a five-table scan nobody reads.
 */
export const COVERAGE_WINDOW_SETTLE_MS = 400;

/**
 * Coverage changes when ingest runs — hourly at most — not when a user moves
 * a date picker. A short `staleTime` here would undo the point of asking
 * once, so an answer is reused for half an hour and kept for an hour.
 */
const COVERAGE_STALE_TIME_MS = 30 * 60 * 1000;
const COVERAGE_GC_TIME_MS = 60 * 60 * 1000;

/**
 * One (family, platform) cell as a card reads it:
 *
 * - a `CoverageState` once known — the matrix's half immediately;
 * - `'pending'` while the observed half is in flight;
 * - `null` when it cannot be measured: ClickHouse is off, the request
 *   failed, or the family's table is not one the coverage query reads.
 */
export type CoverageCell = CoverageState | 'pending' | null;

export interface FamilyCoverage {
  family: MetricFamily;
  /** The window this coverage describes, in words — e.g. "the last 52 complete weeks". */
  windowLabel: string;
  platforms: Record<AnalyticsPlatform, CoverageCell>;
}

interface CoverageContextValue {
  windowLabel: string;
  status: 'pending' | 'error' | 'success';
  result: CoverageMatrixResult | undefined;
}

export const CoverageContext = createContext<CoverageContextValue | null>(null);

/**
 * The window as last held still for `COVERAGE_WINDOW_SETTLE_MS`. The first
 * render uses the window as given, so nothing waits on a timer to paint.
 *
 * The effect is justified: a debounce is a timer, and a timer is a side
 * effect of a prop changing. Nothing in render can express it.
 */
function useSettledWindow(from: string, to: string) {
  const [settled, setSettled] = useState({ from, to });

  useEffect(() => {
    if (settled.from === from && settled.to === to) return;

    const timer = setTimeout(
      () => setSettled({ from, to }),
      COVERAGE_WINDOW_SETTLE_MS,
    );

    return () => clearTimeout(timer);
  }, [from, to, settled.from, settled.to]);

  return settled;
}

interface CoverageProviderProps {
  scope: Scope;
  /** First calendar day of the window, `YYYY-MM-DD`. */
  from: string;
  /** Last calendar day of the window, inclusive. */
  to: string;
  windowLabel: string;
  children: ReactNode;
}

/**
 * Fetches coverage once for everything beneath it (FILM-1704). Cards call
 * `useCoverage(family)` and issue no query of their own, so a card added is
 * a query not added.
 *
 * **Two windows, on purpose.** The dashboard mounts one of these for the
 * header's date range, and the Deep Dive tab mounts its own, nested, for the
 * fixed 52 complete weeks its cards actually read — it ignores the header's
 * range. One page-level provider would describe a window Deep Dive is not
 * showing. The nesting is the design, not a duplicate to remove: the inner
 * provider wins for the cards inside it, which is the point.
 */
export function CoverageProvider({
  scope,
  from,
  to,
  windowLabel,
  children,
}: CoverageProviderProps) {
  const window = useSettledWindow(from, to);

  const query = useQuery({
    // By value, field by field: callers build `scope` inline, and a key
    // holding the object would still compare equal by structure — but the
    // fields are what the cache is about, so they are what it names.
    queryKey: [
      'analytics-coverage',
      scope.projectId,
      scope.accountId,
      scope.connectionId,
      scope.platform,
      scope.contentType,
      scope.language,
      window.from,
      window.to,
    ],
    queryFn: () =>
      getCoverageMatrixAction({ scope, from: window.from, to: window.to }),
    staleTime: COVERAGE_STALE_TIME_MS,
    gcTime: COVERAGE_GC_TIME_MS,
    refetchOnWindowFocus: false,
  });

  const value = useMemo<CoverageContextValue>(
    () => ({ windowLabel, status: query.status, result: query.data }),
    [windowLabel, query.status, query.data],
  );

  return (
    <CoverageContext.Provider value={value}>
      {children}
    </CoverageContext.Provider>
  );
}

/**
 * What one card needs to say about its coverage. The capability half is
 * filled in on the first render — it is a fact about the product, not about
 * this project — and only the cells that need an observation wait for one.
 */
export function useCoverage(family: MetricFamily): FamilyCoverage {
  const context = useContext(CoverageContext);

  if (!context) {
    throw new Error(
      'useCoverage needs a CoverageProvider above it: coverage is fetched once per page, never per card.',
    );
  }

  const { windowLabel, status, result } = context;

  return useMemo(() => {
    const platforms = Object.fromEntries(
      ANALYTICS_PLATFORMS.map((platform): [AnalyticsPlatform, CoverageCell] => {
        const fromMatrix = capabilityCoverage(
          CAPABILITY_MATRIX[family][platform],
        );

        if (fromMatrix) return [platform, fromMatrix];
        if (status === 'success' && result) {
          return [platform, result.matrix[family][platform]];
        }

        return [platform, status === 'error' ? null : 'pending'];
      }),
    ) as Record<AnalyticsPlatform, CoverageCell>;

    return { family, windowLabel, platforms };
  }, [family, windowLabel, status, result]);
}
