import type { ReactElement, ReactNode } from 'react';

import { render } from '@testing-library/react';

import {
  ANALYTICS_PLATFORMS,
  type AnalyticsPlatform,
  CAPABILITY_MATRIX,
  type ObservedCoverageRow,
  foldObservedCoverage,
} from '@kit/clickhouse';

import { CoverageContext } from '../../src/components/coverage-context';
import type { CoverageMatrixResult } from '../../src/lib/coverage';
import type { ChannelRef } from '../../src/server/channels';

/**
 * Coverage for a component under test, without a query client: every card
 * reads it through `useCoverage` and throws without a provider (FILM-1704),
 * so a card rendered alone needs one. Defaults to the state a page is in
 * before the answer arrives — the matrix's half only.
 */
export interface TestCoverageOptions {
  status?: 'pending' | 'error' | 'success';
  result?: CoverageMatrixResult;
  windowLabel?: string;
  selectedPlatforms?: readonly AnalyticsPlatform[];
}

export function TestCoverage({
  status = 'pending',
  result,
  windowLabel = '2026-09-01 to 2026-09-30',
  selectedPlatforms = ANALYTICS_PLATFORMS,
  children,
}: TestCoverageOptions & { children: ReactNode }) {
  return (
    <CoverageContext.Provider
      value={{
        windowLabel,
        status: result ? 'success' : status,
        result,
        selectedPlatforms,
      }}
    >
      {children}
    </CoverageContext.Provider>
  );
}

export function renderWithCoverage(
  ui: ReactElement,
  options: TestCoverageOptions = {},
) {
  // As a wrapper, so `rerender` keeps the provider.
  return render(ui, {
    wrapper: ({ children }) => (
      <TestCoverage {...options}>{children}</TestCoverage>
    ),
  });
}

export function channelRef(
  platform: string,
  overrides: Partial<ChannelRef> = {},
): ChannelRef {
  return {
    connectionId: `connection-${platform}`,
    platform,
    name: `${platform} channel`,
    thumbnailUrl: null,
    isActive: true,
    language: 'en',
    analyticsAccess: 'authorised',
    ...overrides,
  };
}

/** A coverage answer, folded by the real fold from rows and connections. */
export function coverageResult({
  rows,
  channels,
  window = { from: '2026-09-01', to: '2026-09-30' },
  observed = true,
}: {
  rows: ObservedCoverageRow[];
  channels: ChannelRef[];
  window?: { from: string; to: string };
  observed?: boolean;
}): CoverageMatrixResult {
  return {
    window,
    matrix: foldObservedCoverage(observed ? rows : null, CAPABILITY_MATRIX, {
      connectedPlatforms: channels
        .filter((channel) => channel.isActive)
        .map((channel) => channel.platform),
      asOf: window.to,
    }),
    channels,
    observed,
  };
}
